insert into public.company_events (id, company_id, event_date, event_type, title_th, summary_th, lesson_th, source_title, source_url)
select event.id, company.id, event.event_date::date, event.event_type,
  event.title_th, event.summary_th, event.lesson_th, event.source_title, event.source_url
from public.companies company
cross join (values
  ('nvda-crypto-2019', '2019-01-28', 'crisis', 'อุปสงค์คริปโทลดลงและสินค้าคงคลังในช่องทางสูง',
   'NVIDIA ลดประมาณการรายได้ไตรมาส 4 ปีงบประมาณ 2019 หลังอุปสงค์คริปโทลดลงอย่างรวดเร็ว ทำให้มีสินค้ากลุ่ม Pascal คงค้างในช่องทางจำหน่าย และเศรษฐกิจจีนชะลอตัว.',
   'ธุรกิจเซมิคอนดักเตอร์อาจเผชิญความผันผวนเมื่ออุปสงค์ปลายทางเปลี่ยนเร็ว นักลงทุนควรดูสินค้าคงคลังและคุณภาพของอุปสงค์ ไม่ดูยอดขายเพียงอย่างเดียว.',
   'NVIDIA shareholder letter, January 2019', 'https://www.sec.gov/Archives/edgar/data/1045810/000104581019000004/shareholderletter.htm'),
  ('nvda-ai-2023', '2023-05-24', 'growth_engine', 'อุปสงค์ Data Center จาก Generative AI เร่งตัว',
   'ผลประกอบการไตรมาส 1 ปีงบประมาณ 2024 มีรายได้ Data Center สูงสุดเป็นประวัติการณ์ 4.28 พันล้านดอลลาร์ และบริษัทให้แนวโน้มรายได้ไตรมาสถัดไป 11 พันล้านดอลลาร์จากอุปสงค์โครงสร้างพื้นฐาน AI.',
   'การเติบโตที่แรงควรตรวจต่อว่ามาจากรายได้ที่เกิดขึ้นจริง ความสามารถในการส่งมอบ และฐานลูกค้าที่กระจุกตัวเพียงใด.',
   'NVIDIA Q1 Fiscal 2024 results', 'https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-first-quarter-fiscal-2024'),
  ('nvda-blackwell-2024', '2024-03-18', 'structural_change', 'เปิดตัวแพลตฟอร์ม Blackwell',
   'NVIDIA เปิดตัว Blackwell ซึ่งรวม GPU, NVLink และเทคโนโลยีด้านความเชื่อถือได้สำหรับโมเดล AI ขนาดใหญ่มาก พร้อมการสนับสนุนจากผู้ให้บริการ Cloud และผู้ผลิตระบบรายใหญ่.',
   'การเปลี่ยนรุ่นผลิตภัณฑ์เป็นจุดสำคัญของบริษัทชิป ควรติดตามเวลาส่งมอบ การยอมรับของลูกค้า และผลต่ออัตรากำไร.',
   'NVIDIA Blackwell Platform announcement', 'https://nvidianews.nvidia.com/news/nvidia-blackwell-platform-arrives-to-power-a-new-era-of-computing')
) as event(id, event_date, event_type, title_th, summary_th, lesson_th, source_title, source_url)
where company.ticker = 'NVDA'
on conflict (id) do update set
  event_date = excluded.event_date,
  event_type = excluded.event_type,
  title_th = excluded.title_th,
  summary_th = excluded.summary_th,
  lesson_th = excluded.lesson_th,
  source_title = excluded.source_title,
  source_url = excluded.source_url;
