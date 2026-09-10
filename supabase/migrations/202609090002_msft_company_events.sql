insert into public.company_events (id, company_id, event_date, event_type, title_th, summary_th, lesson_th, source_title, source_url)
select event.id, company.id, event.event_date::date, event.event_type,
  event.title_th, event.summary_th, event.lesson_th, event.source_title, event.source_url
from public.companies company
cross join (values
  ('msft-cloud-2014', '2014-07-22', 'structural_change', 'เปลี่ยนยุทธศาสตร์สู่ Mobile-first และ Cloud-first',
   'Microsoft วางตำแหน่งบริษัทเป็นผู้สร้างแพลตฟอร์มและผลิตภาพสำหรับโลก mobile-first, cloud-first ขณะที่รายได้ Commercial Cloud แบบ annualized run rate เกิน 4.4 พันล้านดอลลาร์.',
   'การปรับโมเดลธุรกิจจากไลเซนส์ครั้งเดียวสู่บริการ Cloud และสมาชิกต้องดูทั้งรายได้ประจำ การรักษาลูกค้า และต้นทุนโครงสร้างพื้นฐาน.',
   'Microsoft FY2014 Form 10-K', 'https://www.sec.gov/Archives/edgar/data/789019/000119312514289961/d722626d10k.htm'),
  ('msft-remote-work-2020', '2020-03-31', 'growth_engine', 'การทำงานระยะไกลเร่งการใช้ Cloud และ Teams',
   'การเปลี่ยนไปทำงานจากระยะไกลทำให้องค์กรใช้เครื่องมือสื่อสารและบริการ Cloud มากขึ้น Microsoft ศึกษาการเปลี่ยนรูปแบบการทำงานจากข้อมูลการใช้งานของพนักงานและ Teams.',
   'แรงส่งจากเหตุการณ์ภายนอกอาจขยายฐานผู้ใช้ได้รวดเร็ว แต่ควรติดตามว่าการใช้งานและรายได้ยังยั่งยืนหลังภาวะพิเศษหรือไม่.',
   'Microsoft New Future of Work Report', 'https://www.microsoft.com/en-us/research/wp-content/uploads/2021/01/NewFutureOfWorkReport.pdf'),
  ('msft-activision-2023', '2023-10-13', 'structural_change', 'ปิดดีล Activision Blizzard',
   'Microsoft ปิดการเข้าซื้อ Activision Blizzard ทำให้มีแฟรนไชส์เกมและทีมพัฒนาสำคัญเพิ่มเข้ามา และผลประกอบการของธุรกิจที่ซื้อถูกบันทึกในกลุ่ม More Personal Computing.',
   'การซื้อกิจการขนาดใหญ่ควรประเมินทั้งการผสานธุรกิจ การกำกับดูแล และผลตอบแทนที่เกิดขึ้นจริงต่อรายได้และกำไรในระยะยาว.',
   'Microsoft official blog: Activision Blizzard acquisition', 'https://blogs.microsoft.com/blog/2023/10/13/welcoming-the-legendary-teams-at-activision-blizzard-king-to-team-xbox/')
) as event(id, event_date, event_type, title_th, summary_th, lesson_th, source_title, source_url)
where company.ticker = 'MSFT'
on conflict (id) do update set
  event_date = excluded.event_date,
  event_type = excluded.event_type,
  title_th = excluded.title_th,
  summary_th = excluded.summary_th,
  lesson_th = excluded.lesson_th,
  source_title = excluded.source_title,
  source_url = excluded.source_url;
