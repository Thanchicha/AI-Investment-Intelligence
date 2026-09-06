create table public.stock_prices (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  trade_date date not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  adjusted_close numeric not null,
  volume bigint not null default 0,
  dividend numeric not null default 0,
  source text not null,
  fetched_at timestamptz not null default now(),
  unique(company_id, trade_date, source)
);

create table public.company_events (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  event_date date not null,
  event_type text not null check(event_type in ('structural_change','crisis','slowdown','growth_engine')),
  title_th text not null,
  summary_th text not null,
  lesson_th text not null,
  source_title text not null,
  source_url text not null,
  created_at timestamptz not null default now()
);

create index stock_prices_company_date_idx on public.stock_prices(company_id, trade_date);
create index company_events_company_date_idx on public.company_events(company_id, event_date);

alter table public.stock_prices enable row level security;
alter table public.company_events enable row level security;
revoke all on public.stock_prices, public.company_events from anon, authenticated;
grant select on public.stock_prices, public.company_events to authenticated;

create policy "authenticated users read stock prices"
  on public.stock_prices for select to authenticated using(true);
create policy "authenticated users read company events"
  on public.company_events for select to authenticated using(true);

insert into public.company_events(id,company_id,event_date,event_type,title_th,summary_th,lesson_th,source_title,source_url)
select values_table.id, companies.id, values_table.event_date::date, values_table.event_type,
  values_table.title_th, values_table.summary_th, values_table.lesson_th,
  values_table.source_title, values_table.source_url
from public.companies
cross join (values
  ('googl-alphabet-2015','2015-08-10','structural_change','ปรับโครงสร้างเป็น Alphabet','Google ประกาศสร้าง Alphabet เป็นบริษัทแม่ เพื่อแยกธุรกิจอินเทอร์เน็ตหลักออกจากโครงการระยะยาวอื่น ๆ และเพิ่มความรับผิดชอบของแต่ละธุรกิจ','การเติบโตระยะยาวอาจเกิดจากการจัดสรรเงินทุนและโครงสร้างการบริหาร ไม่ได้มาจากผลิตภัณฑ์ใหม่เพียงอย่างเดียว','Alphabet — G is for Google','https://abc.xyz/home/default.aspx'),
  ('googl-covid-2020','2020-03-31','crisis','COVID-19 กระทบงบโฆษณา','ผู้ลงโฆษณาลดค่าใช้จ่ายในช่วงครึ่งแรกของปี 2020 ทำให้ราคาต่อ impression ลดลง แม้การใช้งานออนไลน์ยังเพิ่มขึ้น','วิกฤตภายนอกอาจกระทบรายได้ชั่วคราว ควรแยกให้ออกจากการสูญเสียความสามารถในการแข่งขันของธุรกิจหลัก','Alphabet 2020 Annual Report','https://abc.xyz/assets/investor/static/pdf/2020_alphabet_annual_report.pdf'),
  ('googl-ad-slowdown-2022','2022-12-31','slowdown','โฆษณาชะลอและค่าเงินกดดัน','การใช้จ่ายของผู้ลงโฆษณา product mix และค่าเงินส่งผลต่อ cost-per-click ขณะที่ Alphabet ยังพึ่งรายได้โฆษณามากกว่า 80%','แม้บริษัทแข็งแรง ความกระจุกตัวของรายได้ยังเป็นความเสี่ยงเชิงโครงสร้างที่ต้องติดตามทุกวัฏจักร','Alphabet 2022 Form 10-K','https://www.sec.gov/Archives/edgar/data/1652044/000165204423000016/goog-20221231.htm'),
  ('googl-cloud-ai-2023','2023-12-31','growth_engine','Cloud ทำกำไรและเข้าสู่ยุค Gemini','Google Cloud มีรายได้ไตรมาส 4 ที่ 9.2 พันล้านดอลลาร์ เติบโต 26% และมีกำไรจากการดำเนินงาน ขณะที่บริษัทเปิดตัวยุค Gemini','เครื่องยนต์การเติบโตใหม่มีน้ำหนักมากขึ้นเมื่อพิสูจน์ทั้งการเติบโตของรายได้และเส้นทางสู่กำไร','Alphabet 2023 Q4 Earnings Call','https://abc.xyz/investor/events/event-details/2024/2023-q4-earnings-call/')
) as values_table(id,event_date,event_type,title_th,summary_th,lesson_th,source_title,source_url)
where companies.ticker='GOOGL'
on conflict(id) do nothing;
