insert into public.company_events (id, company_id, event_date, event_type, title_th, summary_th, lesson_th, source_title, source_url)
select event.id, company.id, event.event_date::date, event.event_type,
  event.title_th, event.summary_th, event.lesson_th, event.source_title, event.source_url
from public.companies company
cross join (values
  ('tsla-model3-2018', '2018-07-02', 'structural_change', 'Model 3 เริ่มขยายกำลังผลิตสู่ระดับสูง',
   'Tesla รายงานว่าผลิต Model 3 ได้ 5,031 คันในช่วงเจ็ดวันสุดท้ายของไตรมาส 2 ปี 2018 และยอดผลิตรวมทั้งไตรมาสเพิ่มขึ้น 55% จากไตรมาสก่อน ซึ่งเป็นก้าวสำคัญจากการเปิดตัวสู่การผลิตปริมาณมาก.',
   'การเปลี่ยนจากผลิตภัณฑ์เฉพาะกลุ่มสู่การผลิตจำนวนมากอาจสร้างการเติบโตสูง แต่ต้องติดตามกำลังการผลิต ต้นทุน คุณภาพ และการส่งมอบควบคู่กัน.',
   'Tesla Q2 2018 Vehicle Production and Deliveries', 'https://ir.tesla.com/press-release/tesla-q2-2018-vehicle-production-and-deliveries'),
  ('tsla-profitability-2020', '2020-12-31', 'growth_engine', 'รายงานกำไรสุทธิทั้งปีเป็นบวกครั้งแรก',
   'รายงาน 10-K ปี 2020 ระบุรายได้รวม 31.5 พันล้านดอลลาร์ กำไรจากการดำเนินงาน 2.0 พันล้านดอลลาร์ และกำไรสุทธิสำหรับผู้ถือหุ้นสามัญ 721 ล้านดอลลาร์ เทียบกับขาดทุนสุทธิในปี 2019.',
   'ผลกำไรที่เกิดขึ้นจริงช่วยเปลี่ยนกรอบการประเมินธุรกิจได้ แต่ผู้ลงทุนควรแยกการเติบโตของรายได้ กระแสเงินสด และความยั่งยืนของอัตรากำไรออกจากกัน.',
   'Tesla 2020 Form 10-K', 'https://www.sec.gov/Archives/edgar/data/1318605/000156459021004599/tsla-10k_20201231.htm'),
  ('tsla-energy-2024', '2025-01-02', 'growth_engine', 'ธุรกิจ Energy Storage สร้างสถิติการติดตั้ง',
   'Tesla รายงานการติดตั้งระบบกักเก็บพลังงานตลอดปี 2024 ที่ 31.4 GWh และไตรมาส 4 ที่ 11.0 GWh ซึ่งเป็นสถิติสูงสุด สะท้อนว่าธุรกิจพลังงานเป็นอีกเส้นทางการเติบโตนอกเหนือจากรถยนต์.',
   'ควรติดตามสัดส่วนรายได้และกำไรของธุรกิจพลังงานแยกจากยอดส่งมอบรถยนต์ เพราะช่วยให้เห็นการกระจายตัวของแหล่งการเติบโตและความเสี่ยงได้ชัดขึ้น.',
   'Tesla Fourth Quarter 2024 Production, Deliveries & Deployments', 'https://ir.tesla.com/press-release/tesla-fourth-quarter-2024-production-deliveries-and-deployments')
) as event(id, event_date, event_type, title_th, summary_th, lesson_th, source_title, source_url)
where company.ticker = 'TSLA'
on conflict (id) do update set
  event_date = excluded.event_date,
  event_type = excluded.event_type,
  title_th = excluded.title_th,
  summary_th = excluded.summary_th,
  lesson_th = excluded.lesson_th,
  source_title = excluded.source_title,
  source_url = excluded.source_url;
