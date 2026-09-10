insert into public.company_events (id, company_id, event_date, event_type, title_th, summary_th, lesson_th, source_title, source_url)
select event.id, company.id, event.event_date::date, event.event_type,
  event.title_th, event.summary_th, event.lesson_th, event.source_title, event.source_url
from public.companies company
cross join (values
  ('meta-att-2021', '2021-04-26', 'slowdown', 'การเปลี่ยนแปลงความเป็นส่วนตัวของ iOS กระทบการโฆษณา',
   'Meta ระบุในรายงานประจำปีว่าการเปลี่ยนนโยบายและระบบ iOS ของ Apple ในปี 2021 ลดความสามารถในการกำหนดเป้าหมายและวัดผลโฆษณา ส่งผลต่อเงินงบที่นักการตลาดยินดีใช้บนแพลตฟอร์ม.',
   'ธุรกิจโฆษณาดิจิทัลอ่อนไหวต่อกฎของแพลตฟอร์มภายนอก ควรติดตามคุณภาพการวัดผลโฆษณาและความสามารถในการปรับผลิตภัณฑ์เมื่อข้อมูลผู้ใช้เข้าถึงได้จำกัด.',
   'Meta Platforms 2021 Form 10-K', 'https://www.sec.gov/Archives/edgar/data/1326801/000132680122000018/fb-20211231.htm'),
  ('meta-efficiency-2023', '2023-02-01', 'structural_change', 'เริ่มแผน Year of Efficiency',
   'หลังปี 2022 ที่รายได้ลดลง Meta ประกาศให้ปี 2023 เป็น Year of Efficiency เพื่อทำให้องค์กรคล่องตัวขึ้น พร้อมเดินหน้าพัฒนา AI discovery engine และ Reels.',
   'การลดต้นทุนอาจช่วยฟื้นความสามารถทำกำไร แต่ควรแยกผลระยะสั้นจากความสามารถในการรักษาการเติบโตของผู้ใช้ ผลิตภัณฑ์ และการลงทุนระยะยาว.',
   'Meta Reports Fourth Quarter and Full Year 2022 Results', 'https://investor.atmeta.com/investor-news/press-release-details/2023/Meta-Reports-Fourth-Quarter-and-Full-Year-2022-Results/default.aspx'),
  ('meta-ai-2024', '2024-04-24', 'growth_engine', 'AI, Reels และโฆษณาช่วยหนุนการเติบโต',
   'ผลประกอบการไตรมาสแรกปี 2024 แสดงรายได้เพิ่ม 27% จากปีก่อน ขณะที่ ad impressions เพิ่ม 20% และราคาโฆษณาเฉลี่ยเพิ่ม 6%; Meta ยังเปิดตัว Meta AI รุ่นใหม่พร้อม Llama 3.',
   'ตัวเลขโฆษณาและการมีส่วนร่วมช่วยชี้ว่าการลงทุนในระบบแนะนำเนื้อหาและ AI เริ่มส่งผลเชิงธุรกิจ แต่ควรติดตามต้นทุนโครงสร้างพื้นฐานและผลตอบแทนจากเงินลงทุน AI ต่อเนื่อง.',
   'Meta Reports First Quarter 2024 Results', 'https://investor.atmeta.com/investor-news/press-release-details/2024/Meta-Reports-First-Quarter-2024-Results/default.aspx')
) as event(id, event_date, event_type, title_th, summary_th, lesson_th, source_title, source_url)
where company.ticker = 'META'
on conflict (id) do update set
  event_date = excluded.event_date,
  event_type = excluded.event_type,
  title_th = excluded.title_th,
  summary_th = excluded.summary_th,
  lesson_th = excluded.lesson_th,
  source_title = excluded.source_title,
  source_url = excluded.source_url;
