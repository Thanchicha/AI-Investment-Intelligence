"""Longview local development server: static files + SQLite + SEC EDGAR ingestion."""

from __future__ import annotations

import argparse
import gzip
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
import zlib
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlparse

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "longview.db"
SEC_BASE = "https://data.sec.gov/api/xbrl/companyfacts"
ALPHA_VANTAGE_URL = "https://www.alphavantage.co/query"
LOCAL_SETTINGS_PATH = ROOT / "local_settings.json"


def load_local_settings() -> dict[str, Any]:
    if not LOCAL_SETTINGS_PATH.exists():
        return {}
    try:
        return json.loads(LOCAL_SETTINGS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


LOCAL_SETTINGS = load_local_settings()
SEC_USER_AGENT = os.getenv("SEC_USER_AGENT") or LOCAL_SETTINGS.get("sec_user_agent") or "Longview student-project contact@example.com"
ALPHA_VANTAGE_API_KEY = os.getenv("ALPHA_VANTAGE_API_KEY") or LOCAL_SETTINGS.get("alpha_vantage_api_key")

COMPANIES = [
    ("GOOGL", "0001652044", "Alphabet Inc.", "Technology · Digital advertising"),
    ("NVDA", "0001045810", "NVIDIA Corporation", "Semiconductors · AI infrastructure"),
    ("MSFT", "0000789019", "Microsoft Corporation", "Technology · Cloud software"),
    ("AAPL", "0000320193", "Apple Inc.", "Technology · Consumer electronics"),
    ("AMZN", "0001018724", "Amazon.com, Inc.", "Consumer · Cloud infrastructure"),
    ("META", "0001326801", "Meta Platforms, Inc.", "Technology · Digital advertising"),
    ("TSLA", "0001318605", "Tesla, Inc.", "Consumer · Electric vehicles"),
]

CONCEPTS = {
    "revenue": ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"],
    "net_income": ["NetIncomeLoss", "ProfitLoss"],
    "diluted_eps": ["EarningsPerShareDiluted"],
}

SCHEMA = """
pragma foreign_keys = on;
create table if not exists companies (
  id text primary key, ticker text not null unique, cik text not null unique,
  legal_name text not null, sector text, active integer not null default 1,
  last_sec_sync_at text, created_at text not null, updated_at text not null
);
create table if not exists portfolio_holdings (
  id integer primary key autoincrement, company_id text not null unique,
  created_at text not null, foreign key(company_id) references companies(id) on delete cascade
);
create table if not exists source_documents (
  id integer primary key autoincrement, company_id text not null,
  source_type text not null, external_id text not null unique, form text not null,
  title text not null, original_url text not null, filed_at text not null,
  fiscal_year integer, fiscal_period text, raw_metadata text not null default '{}',
  fetched_at text not null, foreign key(company_id) references companies(id) on delete cascade
);
create table if not exists financial_facts (
  id integer primary key autoincrement, company_id text not null,
  source_document_id integer not null, metric text not null, taxonomy_concept text not null,
  value real not null, unit text not null, period_start text, period_end text not null,
  fiscal_year integer, fiscal_period text, form text not null, filed_at text not null,
  accession_number text not null, frame text, created_at text not null,
  foreign key(company_id) references companies(id) on delete cascade,
  foreign key(source_document_id) references source_documents(id) on delete cascade,
  unique(company_id, metric, period_end, form, accession_number)
);
create index if not exists financial_facts_lookup
  on financial_facts(company_id, metric, filed_at desc);
create table if not exists stock_prices (
  id integer primary key autoincrement, company_id text not null,
  trade_date text not null, open real not null, high real not null,
  low real not null, close real not null, adjusted_close real not null,
  volume integer not null default 0, dividend real not null default 0,
  source text not null, fetched_at text not null,
  foreign key(company_id) references companies(id) on delete cascade,
  unique(company_id, trade_date, source)
);
create index if not exists stock_prices_lookup on stock_prices(company_id, trade_date);
create table if not exists company_events (
  id text primary key, company_id text not null, event_date text not null,
  event_type text not null, title_th text not null, summary_th text not null,
  lesson_th text not null, source_title text not null, source_url text not null,
  created_at text not null, foreign key(company_id) references companies(id) on delete cascade
);
"""

GOOGL_EVENTS = [
    ("googl-alphabet-2015", "2015-08-10", "structural_change", "ปรับโครงสร้างเป็น Alphabet",
     "Google ประกาศสร้าง Alphabet เป็นบริษัทแม่ เพื่อแยกธุรกิจอินเทอร์เน็ตหลักออกจากโครงการระยะยาวอื่น ๆ และเพิ่มความรับผิดชอบของแต่ละธุรกิจ",
     "การเติบโตระยะยาวอาจเกิดจากการจัดสรรเงินทุนและโครงสร้างการบริหาร ไม่ได้มาจากผลิตภัณฑ์ใหม่เพียงอย่างเดียว",
     "Alphabet — G is for Google", "https://abc.xyz/home/default.aspx"),
    ("googl-covid-2020", "2020-03-31", "crisis", "COVID-19 กระทบงบโฆษณา",
     "ผู้ลงโฆษณาลดค่าใช้จ่ายในช่วงครึ่งแรกของปี 2020 ทำให้ราคาต่อ impression ลดลง แม้การใช้งานออนไลน์ยังเพิ่มขึ้น",
     "วิกฤตภายนอกอาจกระทบรายได้ชั่วคราว ควรแยกให้ออกจากการสูญเสียความสามารถในการแข่งขันของธุรกิจหลัก",
     "Alphabet 2020 Annual Report", "https://abc.xyz/assets/investor/static/pdf/2020_alphabet_annual_report.pdf"),
    ("googl-ad-slowdown-2022", "2022-12-31", "slowdown", "โฆษณาชะลอและค่าเงินกดดัน",
     "การใช้จ่ายของผู้ลงโฆษณา product mix และค่าเงินส่งผลต่อ cost-per-click ขณะที่ Alphabet ยังพึ่งรายได้โฆษณามากกว่า 80%",
     "แม้บริษัทแข็งแรง ความกระจุกตัวของรายได้ยังเป็นความเสี่ยงเชิงโครงสร้างที่ต้องติดตามทุกวัฏจักร",
     "Alphabet 2022 Form 10-K", "https://www.sec.gov/Archives/edgar/data/1652044/000165204423000016/goog-20221231.htm"),
    ("googl-cloud-ai-2023", "2023-12-31", "growth_engine", "Cloud ทำกำไรและเข้าสู่ยุค Gemini",
     "Google Cloud มีรายได้ไตรมาส 4 ที่ 9.2 พันล้านดอลลาร์ เติบโต 26% และมีกำไรจากการดำเนินงาน ขณะที่บริษัทเปิดตัวยุค Gemini",
     "เครื่องยนต์การเติบโตใหม่มีน้ำหนักมากขึ้นเมื่อพิสูจน์ทั้งการเติบโตของรายได้และเส้นทางสู่กำไร",
     "Alphabet 2023 Q4 Earnings Call", "https://abc.xyz/investor/events/event-details/2024/2023-q4-earnings-call/"),
]

OTHER_EVENTS = [
    ("MSFT", "msft-cloud-2014", "2014-02-04", "structural_change", "เปลี่ยนแกนสู่ Cloud-first", "Microsoft วาง Azure และบริการคลาวด์เป็นแกนหลักของการเติบโตระยะยาว.", "การเปลี่ยนโมเดลรายได้ไปสู่บริการแบบสมาชิกอาจยกระดับความต่อเนื่องของรายได้ แต่ต้องติดตามต้นทุนโครงสร้างพื้นฐาน.", "Microsoft Investor Relations", "https://www.microsoft.com/en-us/annualreports"),
    ("MSFT", "msft-pandemic-2020", "2020-06-30", "growth_engine", "การทำงานทางไกลเร่งการใช้ Cloud", "การทำงานและการเรียนทางไกลเพิ่มความต้องการผลิตภัณฑ์ Cloud, Teams และบริการองค์กร.", "แรงส่งจากเหตุการณ์ภายนอกควรแยกจากการเติบโตที่ยั่งยืนของลูกค้าและอัตรากำไร.", "Microsoft 2020 Annual Report", "https://www.microsoft.com/en-us/annualreports/ar2020/index.html"),
    ("MSFT", "msft-activision-2023", "2023-10-13", "structural_change", "ปิดดีล Activision Blizzard", "Microsoft ปิดการเข้าซื้อ Activision Blizzard เพื่อขยายธุรกิจเกมและคอนเทนต์.", "การซื้อกิจการขนาดใหญ่ต้องติดตามการผสานธุรกิจ ผลตอบแทนจากเงินลงทุน และการกำกับดูแล.", "Microsoft News Center", "https://news.microsoft.com/"),
    ("AAPL", "aapl-services-2019", "2019-09-28", "growth_engine", "ธุรกิจบริการมีบทบาทมากขึ้น", "Apple รายงานการขยายตัวของบริการดิจิทัลควบคู่กับฐานอุปกรณ์ที่ติดตั้งอยู่จำนวนมาก.", "รายได้บริการช่วยกระจายความพึ่งพายอดขายฮาร์ดแวร์ แต่ควรติดตามการแข่งขันและกฎระเบียบของแพลตฟอร์ม.", "Apple Investor Relations", "https://investor.apple.com/"),
    ("AAPL", "aapl-supply-2020", "2020-03-28", "crisis", "COVID-19 กระทบห่วงโซ่อุปทาน", "การระบาดทำให้ Apple เผชิญความไม่แน่นอนของการผลิตและการเปิดร้านค้าในหลายประเทศ.", "บริษัทฮาร์ดแวร์ระดับโลกมีความเสี่ยงจากห่วงโซ่อุปทาน แม้ความต้องการของลูกค้าอาจฟื้นตัวภายหลัง.", "Apple 2020 Form 10-K", "https://investor.apple.com/sec-filings/default.aspx"),
    ("AAPL", "aapl-silicon-2020", "2020-11-10", "structural_change", "เริ่มเปลี่ยน Mac สู่ Apple silicon", "Apple เปิดตัวชิป Apple silicon สำหรับ Mac เพื่อควบคุมเทคโนโลยีสำคัญของผลิตภัณฑ์มากขึ้น.", "การบูรณาการเทคโนโลยีเองอาจสร้างความแตกต่างของผลิตภัณฑ์ แต่ใช้เวลาและเงินลงทุนต่อเนื่อง.", "Apple Newsroom", "https://www.apple.com/newsroom/"),
    ("META", "meta-privacy-2021", "2021-09-30", "slowdown", "การเปลี่ยนนโยบายความเป็นส่วนตัวกระทบโฆษณา", "การเปลี่ยนแปลงด้านความเป็นส่วนตัวของระบบปฏิบัติการทำให้การวัดผลและการกำหนดเป้าหมายโฆษณายากขึ้น.", "ธุรกิจโฆษณาดิจิทัลพึ่งพาข้อมูลและการวัดผล จึงควรติดตามผลของกฎแพลตฟอร์มและกฎระเบียบ.", "Meta Investor Relations", "https://investor.atmeta.com/financials/default.aspx"),
    ("META", "meta-efficiency-2023", "2023-12-31", "structural_change", "ปีแห่งประสิทธิภาพ", "Meta ปรับโครงสร้างต้นทุนและให้ความสำคัญกับประสิทธิภาพการดำเนินงานหลังช่วงการลงทุนสูง.", "การลดต้นทุนอาจช่วยกำไรระยะสั้น แต่การประเมินต้องดูว่ายังรักษาการลงทุนในผลิตภัณฑ์และการแข่งขันได้หรือไม่.", "Meta 2023 Annual Report", "https://investor.atmeta.com/financials/default.aspx"),
    ("META", "meta-ai-2024", "2024-03-31", "growth_engine", "AI สนับสนุนการมีส่วนร่วมและโฆษณา", "Meta รายงานการลงทุนใน AI เพื่อพัฒนาการแนะนำคอนเทนต์และเครื่องมือโฆษณา.", "ผลตอบแทนจาก AI ควรติดตามผ่านการใช้งาน รายได้โฆษณา และค่าใช้จ่ายโครงสร้างพื้นฐาน.", "Meta Investor Relations", "https://investor.atmeta.com/"),
    ("TSLA", "tsla-model3-2017", "2017-07-28", "growth_engine", "เริ่มส่งมอบ Model 3", "Tesla เริ่มส่งมอบ Model 3 ซึ่งเป็นก้าวสำคัญในการขยายตลาดรถยนต์ไฟฟ้าสู่ปริมาณมากขึ้น.", "การขยายกำลังผลิตเป็นจุดเปลี่ยนสำคัญ แต่ต้องติดตามต้นทุน คุณภาพ และกระแสเงินสดควบคู่กัน.", "Tesla Investor Relations", "https://ir.tesla.com/"),
    ("TSLA", "tsla-profitability-2020", "2020-12-31", "growth_engine", "ทำกำไรต่อเนื่องและขยายโรงงาน", "Tesla รายงานปีที่ทำกำไรและขยายกำลังผลิตผ่านโรงงานใหม่หลายแห่ง.", "การเปลี่ยนจากการเติบโตที่ใช้เงินทุนสูงสู่กำไรต้องวัดด้วยอัตรากำไร กระแสเงินสด และการแข่งขัน.", "Tesla 2020 Annual Report", "https://ir.tesla.com/"),
    ("TSLA", "tsla-price-cuts-2023", "2023-12-31", "slowdown", "ลดราคาเพื่อแข่งขัน", "Tesla ใช้การปรับราคาขายเพื่อกระตุ้นอุปสงค์ท่ามกลางการแข่งขันรถยนต์ไฟฟ้าที่สูงขึ้น.", "การเติบโตของยอดขายที่แลกกับราคาขายและอัตรากำไรที่ลดลงต้องประเมินร่วมกัน.", "Tesla 2023 Annual Report", "https://ir.tesla.com/"),
    ("NVDA", "nvda-crypto-2018", "2018-12-31", "crisis", "วัฏจักรคริปโทกดดันสินค้าคงคลัง", "ความต้องการ GPU จากตลาดคริปโทที่ผันผวนทำให้การจัดการสินค้าคงคลังและคาดการณ์อุปสงค์ท้าทายขึ้น.", "ธุรกิจเซมิคอนดักเตอร์มีวัฏจักร ควรแยกความต้องการชั่วคราวออกจากตลาดปลายทางระยะยาว.", "NVIDIA Investor Relations", "https://investor.nvidia.com/"),
    ("NVDA", "nvda-ai-2023", "2023-05-24", "growth_engine", "ความต้องการโครงสร้างพื้นฐาน AI เร่งตัว", "NVIDIA รายงานอุปสงค์ด้านศูนย์ข้อมูลและ AI ที่เพิ่มขึ้นอย่างมาก.", "โอกาสเติบโตสูงควรติดตามความสามารถในการส่งมอบ การแข่งขัน และการกระจุกตัวของลูกค้า.", "NVIDIA Investor Relations", "https://investor.nvidia.com/"),
    ("NVDA", "nvda-blackwell-2024", "2024-03-18", "structural_change", "เปิดตัวสถาปัตยกรรม Blackwell", "NVIDIA เปิดตัวแพลตฟอร์ม Blackwell สำหรับงานประมวลผล AI รุ่นถัดไป.", "การเปลี่ยนผ่านผลิตภัณฑ์ขนาดใหญ่ต้องติดตามวงจรการนำไปใช้และผลต่ออัตรากำไร.", "NVIDIA Newsroom", "https://nvidianews.nvidia.com/"),
    ("AMZN", "amzn-aws-2015", "2015-12-31", "growth_engine", "AWS กลายเป็นธุรกิจที่เปิดเผยแยก", "Amazon เริ่มเปิดเผยผลของ AWS แยกต่างหาก ทำให้บทบาทของคลาวด์ต่อกำไรชัดเจนขึ้น.", "ธุรกิจที่มีอัตรากำไรต่างกันควรวิเคราะห์แยกส่วน ไม่ใช้ยอดขายรวมเพียงอย่างเดียว.", "Amazon Investor Relations", "https://ir.aboutamazon.com/"),
    ("AMZN", "amzn-pandemic-2020", "2020-12-31", "growth_engine", "COVID-19 เร่งอีคอมเมิร์ซและ Cloud", "การระบาดเร่งการใช้ซื้อสินค้าออนไลน์และบริการคลาวด์ พร้อมเพิ่มต้นทุนด้านโลจิสติกส์และความปลอดภัย.", "การเติบโตอย่างรวดเร็วอาจมาพร้อมต้นทุนชั่วคราว จึงควรดูทั้งรายได้ กระแสเงินสด และประสิทธิภาพการดำเนินงาน.", "Amazon 2020 Annual Report", "https://ir.aboutamazon.com/"),
    ("AMZN", "amzn-cost-2022", "2022-12-31", "slowdown", "ปรับลดต้นทุนหลังการลงทุนขยายตัว", "Amazon ปรับขนาดต้นทุนและทบทวนบางโครงการหลังการขยายกำลังการดำเนินงานในช่วงก่อนหน้า.", "หลังลงทุนขยายตัวมาก นักลงทุนควรติดตามการใช้สินทรัพย์ อัตรากำไร และวินัยด้านเงินทุน.", "Amazon 2022 Annual Report", "https://ir.aboutamazon.com/"),
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("pragma foreign_keys = on")
    return connection


def initialize() -> None:
    with connect() as connection:
        connection.executescript(SCHEMA)
        timestamp = now_iso()
        for ticker, cik, name, sector in COMPANIES:
            connection.execute(
                """insert into companies(id,ticker,cik,legal_name,sector,created_at,updated_at)
                   values(?,?,?,?,?,?,?)
                   on conflict(ticker) do update set cik=excluded.cik,
                   legal_name=excluded.legal_name,sector=excluded.sector,updated_at=excluded.updated_at""",
                (ticker, ticker, cik, name, sector, timestamp, timestamp),
            )
        if connection.execute("select count(*) from portfolio_holdings").fetchone()[0] == 0:
            for ticker in ("GOOGL", "NVDA", "MSFT", "AAPL"):
                connection.execute(
                    "insert or ignore into portfolio_holdings(company_id,created_at) values(?,?)",
                    (ticker, timestamp),
                )
        for event in GOOGL_EVENTS:
            connection.execute(
                """insert or ignore into company_events(id,company_id,event_date,event_type,title_th,summary_th,
                   lesson_th,source_title,source_url,created_at) values(?,?,?,?,?,?,?,?,?,?)""",
                (event[0], "GOOGL", *event[1:], timestamp),
            )
        for ticker, event_id, *event in OTHER_EVENTS:
            connection.execute(
                """insert or ignore into company_events(id,company_id,event_date,event_type,title_th,summary_th,
                   lesson_th,source_title,source_url,created_at) values(?,?,?,?,?,?,?,?,?,?)""",
                (event_id, ticker, *event, timestamp),
            )


def query_rows(sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    with connect() as connection:
        return [dict(row) for row in connection.execute(sql, params).fetchall()]


def fetch_sec_companyfacts(cik: str) -> dict[str, Any]:
    request = urllib.request.Request(
        f"{SEC_BASE}/CIK{cik}.json",
        headers={"User-Agent": SEC_USER_AGENT, "Accept-Encoding": "gzip, deflate", "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        body = response.read()
        encoding = response.headers.get("Content-Encoding", "").lower()
        if encoding == "gzip" or body.startswith(b"\x1f\x8b"):
            body = gzip.decompress(body)
        elif encoding == "deflate":
            body = zlib.decompress(body)
        return json.loads(body.decode("utf-8"))


def select_facts(payload: dict[str, Any]) -> list[dict[str, Any]]:
    us_gaap = payload.get("facts", {}).get("us-gaap", {})
    selected: list[dict[str, Any]] = []
    for metric, candidates in CONCEPTS.items():
        preferred = "USD/shares" if metric == "diluted_eps" else "USD"
        facts: list[dict[str, Any]] = []
        for rank, concept in enumerate(candidates):
            units = us_gaap.get(concept, {}).get("units", {})
            unit = preferred if preferred in units else next(iter(units), None)
            if not unit:
                continue
            facts.extend(
                {**fact, "metric": metric, "concept": concept, "unit": unit, "concept_rank": rank}
                for fact in units[unit]
                if fact.get("form") in {"10-K", "10-Q"} and isinstance(fact.get("val"), (int, float))
            )
        facts.sort(key=lambda fact: (fact.get("filed", ""), -fact["concept_rank"]), reverse=True)
        seen: set[str] = set()
        for fact in facts:
            key = f"{fact.get('end')}:{fact.get('form')}:{fact.get('fp', '')}"
            if key in seen:
                continue
            seen.add(key)
            selected.append(fact)
            if len(seen) >= 12:
                break
    return selected


def filing_url(cik: str, accession: str) -> str:
    return f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}/{accession}-index.html"


def sync_company(ticker: str) -> dict[str, Any]:
    ticker = ticker.upper()
    with connect() as connection:
        company = connection.execute("select * from companies where ticker=? and active=1", (ticker,)).fetchone()
        if not company:
            raise ValueError(f"Unknown ticker: {ticker}")
        payload = fetch_sec_companyfacts(company["cik"])
        facts = select_facts(payload)
        timestamp = now_iso()
        for fact in facts:
            accession = fact["accn"]
            url = filing_url(company["cik"], accession)
            connection.execute(
                """insert into source_documents(company_id,source_type,external_id,form,title,original_url,
                   filed_at,fiscal_year,fiscal_period,raw_metadata,fetched_at)
                   values(?,?,?,?,?,?,?,?,?,?,?)
                   on conflict(external_id) do update set fetched_at=excluded.fetched_at, original_url=excluded.original_url""",
                (company["id"], "sec_filing", accession, fact["form"],
                 f"{company['legal_name']} {fact['form']} filing", url, fact["filed"], fact.get("fy"),
                 fact.get("fp"), json.dumps({"accession_number": accession}), timestamp),
            )
            document_id = connection.execute("select id from source_documents where external_id=?", (accession,)).fetchone()[0]
            connection.execute(
                """insert into financial_facts(company_id,source_document_id,metric,taxonomy_concept,value,
                   unit,period_start,period_end,fiscal_year,fiscal_period,form,filed_at,accession_number,frame,created_at)
                   values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                   on conflict(company_id,metric,period_end,form,accession_number) do update set
                   value=excluded.value,source_document_id=excluded.source_document_id,filed_at=excluded.filed_at,
                   taxonomy_concept=excluded.taxonomy_concept,unit=excluded.unit""",
                (company["id"], document_id, fact["metric"], fact["concept"], fact["val"], fact["unit"],
                 fact.get("start"), fact["end"], fact.get("fy"), fact.get("fp"), fact["form"], fact["filed"],
                 accession, fact.get("frame"), timestamp),
            )
        connection.execute("update companies set last_sec_sync_at=?,updated_at=? where id=?", (timestamp, timestamp, company["id"]))
    return {"ticker": ticker, "facts": len(facts), "ok": True}


def sync_tickers(tickers: list[str]) -> list[dict[str, Any]]:
    results = []
    for ticker in tickers:
        try:
            results.append(sync_company(ticker))
        except (ValueError, urllib.error.URLError, TimeoutError, OSError) as error:
            results.append({"ticker": ticker.upper(), "ok": False, "error": str(error)})
    return results


def sync_price(ticker: str) -> dict[str, Any]:
    ticker = ticker.upper()
    cutoff_year = datetime.now(timezone.utc).year - 20
    timestamp = now_iso()
    rows: list[tuple[str, float, float, float, float, float, int, float, str]] = []
    if ALPHA_VANTAGE_API_KEY:
        params = urlencode({"function": "TIME_SERIES_MONTHLY_ADJUSTED", "symbol": ticker, "apikey": ALPHA_VANTAGE_API_KEY})
        with urllib.request.urlopen(f"{ALPHA_VANTAGE_URL}?{params}", timeout=45) as response:
            payload = json.load(response)
        series = payload.get("Monthly Adjusted Time Series")
        if series:
            rows = [
                (trade_date, float(row["1. open"]), float(row["2. high"]), float(row["3. low"]), float(row["4. close"]),
                 float(row["5. adjusted close"]), int(row["6. volume"]), float(row["7. dividend amount"]), "alpha_vantage")
                for trade_date, row in series.items() if int(trade_date[:4]) >= cutoff_year
            ]
    if not rows:
        now = int(datetime.now(timezone.utc).timestamp())
        start = now - 21 * 365 * 24 * 60 * 60
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?period1={start}&period2={now}&interval=1mo&events=div%2Csplits&includeAdjustedClose=true"
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 Longview investment education app", "Accept": "application/json"})
        with urllib.request.urlopen(request, timeout=45) as response:
            result = json.load(response).get("chart", {}).get("result", [None])[0]
        if not result:
            raise ValueError("Yahoo Finance price data unavailable")
        quote = result.get("indicators", {}).get("quote", [{}])[0]
        adjusted = result.get("indicators", {}).get("adjclose", [{}])[0].get("adjclose", [])
        for index, unix_time in enumerate(result.get("timestamp", [])):
            values = [quote.get("open", [None])[index], quote.get("high", [None])[index], quote.get("low", [None])[index], quote.get("close", [None])[index]]
            if not all(isinstance(value, (int, float)) for value in values):
                continue
            trade_date = datetime.fromtimestamp(unix_time, timezone.utc).date().isoformat()
            if int(trade_date[:4]) < cutoff_year:
                continue
            adjusted_close = adjusted[index] if index < len(adjusted) and isinstance(adjusted[index], (int, float)) else values[3]
            volume = quote.get("volume", [0])[index] or 0
            rows.append((trade_date, *[float(value) for value in values], float(adjusted_close), int(volume), 0.0, "yahoo_finance"))
    if not rows:
        raise ValueError("Price data unavailable")
    inserted = 0
    with connect() as connection:
        company = connection.execute("select id from companies where ticker=?", (ticker,)).fetchone()
        if not company:
            raise ValueError(f"Unknown ticker: {ticker}")
        for trade_date, open_price, high, low, close, adjusted_close, volume, dividend, source in rows:
            connection.execute(
                """insert into stock_prices(company_id,trade_date,open,high,low,close,adjusted_close,volume,dividend,source,fetched_at)
                   values(?,?,?,?,?,?,?,?,?,?,?) on conflict(company_id,trade_date,source) do update set
                   open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,
                   adjusted_close=excluded.adjusted_close,volume=excluded.volume,dividend=excluded.dividend,fetched_at=excluded.fetched_at""",
                (company["id"], trade_date, open_price, high, low, close, adjusted_close, volume, dividend, source, timestamp),
            )
            inserted += 1
    return {"ticker": ticker, "prices": inserted, "ok": True}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, value: Any, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/api/status":
            return self.send_json({"mode": "sqlite", "database": str(DB_PATH), "secUserAgentConfigured": "contact@example.com" not in SEC_USER_AGENT})
        if path == "/api/bootstrap":
            return self.send_json({
                "companies": query_rows("select id,ticker,cik,legal_name,sector,last_sec_sync_at from companies where active=1 order by ticker"),
                "holdings": query_rows("select id,company_id,created_at from portfolio_holdings order by created_at"),
                "facts": query_rows("select id,company_id,source_document_id,metric,value,unit,period_start,period_end,form,filed_at,accession_number,taxonomy_concept from financial_facts order by filed_at desc limit 1000"),
                "sources": query_rows("select id,company_id,form,title,original_url,filed_at,fiscal_year,fiscal_period from source_documents order by filed_at desc limit 200"),
                "prices": query_rows("select company_id,trade_date,open,high,low,close,adjusted_close,volume,source from stock_prices order by trade_date"),
                "events": query_rows("select id,company_id,event_date,event_type,title_th,summary_th,lesson_th,source_title,source_url from company_events order by event_date"),
            })
        return super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/api/portfolio":
            ticker = str(self.read_json().get("ticker", "")).upper()
            with connect() as connection:
                company = connection.execute("select id from companies where ticker=?", (ticker,)).fetchone()
                if not company:
                    return self.send_json({"error": "Unknown ticker"}, HTTPStatus.BAD_REQUEST)
                connection.execute("insert or ignore into portfolio_holdings(company_id,created_at) values(?,?)", (company["id"], now_iso()))
                row = connection.execute("select id,company_id,created_at from portfolio_holdings where company_id=?", (company["id"],)).fetchone()
            return self.send_json(dict(row), HTTPStatus.CREATED)
        if path == "/api/sec/sync":
            body = self.read_json()
            tickers = body.get("tickers") or [row["ticker"] for row in query_rows("select ticker from companies where active=1")]
            return self.send_json({"results": sync_tickers(tickers)})
        if path == "/api/prices/sync":
            ticker = str(self.read_json().get("ticker", "GOOGL")).upper()
            try:
                return self.send_json(sync_price(ticker))
            except (ValueError, urllib.error.URLError, TimeoutError, OSError) as error:
                return self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
        return self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def do_DELETE(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        prefix = "/api/portfolio/"
        if path.startswith(prefix):
            ticker = path[len(prefix):].upper()
            with connect() as connection:
                connection.execute("delete from portfolio_holdings where company_id=?", (ticker,))
            return self.send_json({"ok": True})
        return self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Longview local SQLite development server")
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--sync", nargs="*", metavar="TICKER", help="Sync SEC data and exit; defaults to all companies")
    args = parser.parse_args()
    initialize()
    if args.sync is not None:
        tickers = args.sync or [company[0] for company in COMPANIES]
        print(json.dumps({"results": sync_tickers(tickers)}, ensure_ascii=False, indent=2))
        return
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Longview local mode: http://localhost:{args.port}")
    print(f"SQLite database: {DB_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()


if __name__ == "__main__":
    main()
