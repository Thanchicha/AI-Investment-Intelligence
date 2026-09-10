insert into public.company_events (id, company_id, event_date, event_type, title_th, summary_th, lesson_th, source_title, source_url)
select event.id, company.id, event.event_date::date, event.event_type,
  event.title_th, event.summary_th, event.lesson_th, event.source_title, event.source_url
from public.companies company
cross join (values
  ('aapl-services-2019', '2019-09-28', 'growth_engine', 'บริการดิจิทัลมีบทบาทมากขึ้น',
   'Apple ระบุบริการแบบสมาชิกและคอนเทนต์ดิจิทัล เช่น Apple Music และ Apple TV+ ในรายงานประจำปี ช่วยต่อยอดฐานอุปกรณ์และรายได้ที่เกิดซ้ำ.',
   'ธุรกิจบริการช่วยกระจายรายได้จากฮาร์ดแวร์ แต่ควรติดตามการแข่งขัน กฎแพลตฟอร์ม และความสามารถในการรักษาฐานผู้ใช้.',
   'Apple FY2019 Form 10-K', 'https://www.sec.gov/Archives/edgar/data/320193/000032019319000119/a10-k20199282019.htm'),
  ('aapl-covid-2020', '2020-02-17', 'crisis', 'COVID-19 กระทบการผลิต iPhone และยอดขายในจีน',
   'Apple แจ้งว่าน่าจะทำรายได้ไม่ถึงเป้าหมายไตรมาสมีนาคม 2020 จากข้อจำกัดด้านอุปทาน iPhone และความต้องการที่ลดลงในจีนช่วงการระบาด.',
   'บริษัทที่มีห่วงโซ่อุปทานทั่วโลกอาจได้รับผลกระทบพร้อมกันทั้งฝั่งผลิตและอุปสงค์ จึงควรติดตามสินค้าคงคลังและการฟื้นตัวรายภูมิภาค.',
   'Apple investor update on quarterly guidance', 'https://www.apple.com/ie/newsroom/2020/02/investor-update-on-quarterly-guidance/'),
  ('aapl-silicon-2020', '2020-06-22', 'structural_change', 'เริ่มเปลี่ยน Mac สู่ Apple silicon',
   'Apple ประกาศเปลี่ยน Mac ไปใช้ชิปที่ออกแบบเอง เพื่อสร้างสถาปัตยกรรมร่วมกับผลิตภัณฑ์อื่นและควบคุมประสิทธิภาพต่อพลังงานของแพลตฟอร์มได้มากขึ้น.',
   'การควบคุมเทคโนโลยีแกนหลักเองอาจเพิ่มความแตกต่างของผลิตภัณฑ์และลดการพึ่งพาคู่ค้า แต่ต้องประเมินต้นทุนการพัฒนาและวงจรการเปลี่ยนผ่าน.',
   'Apple announces Mac transition to Apple silicon', 'https://www.apple.com/newsroom/2020/06/apple-announces-mac-transition-to-apple-silicon/')
) as event(id, event_date, event_type, title_th, summary_th, lesson_th, source_title, source_url)
where company.ticker = 'AAPL'
on conflict (id) do update set
  event_date = excluded.event_date,
  event_type = excluded.event_type,
  title_th = excluded.title_th,
  summary_th = excluded.summary_th,
  lesson_th = excluded.lesson_th,
  source_title = excluded.source_title,
  source_url = excluded.source_url;
