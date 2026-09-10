insert into public.company_events (id, company_id, event_date, event_type, title_th, summary_th, lesson_th, source_title, source_url)
select event.id, company.id, event.event_date::date, event.event_type,
  event.title_th, event.summary_th, event.lesson_th, event.source_title, event.source_url
from public.companies company
cross join (values
  ('amzn-aws-2015', '2015-04-23', 'structural_change', 'เริ่มเปิดเผยผลประกอบการ AWS แยกเป็นธุรกิจหลัก',
   'Amazon เปิดเผย AWS เป็นส่วนธุรกิจแยกในผลประกอบการไตรมาสแรกปี 2015 โดยระบุว่า AWS เป็นธุรกิจระดับ 5 พันล้านดอลลาร์และยังเติบโตเร็ว ทำให้ภาพของ Amazon ขยายจากค้าปลีกสู่โครงสร้างพื้นฐานคลาวด์ชัดเจนขึ้น.',
   'การแยกเปิดเผยข้อมูลของธุรกิจใหม่ช่วยให้ผู้ลงทุนประเมินแหล่งรายได้และกำไรที่แตกต่างกันได้ดีขึ้น จึงควรติดตามทั้งการเติบโตและอัตรากำไรของแต่ละส่วนธุรกิจ.',
   'Amazon.com Announces First Quarter Sales up 15% to $22.72 Billion', 'https://ir.aboutamazon.com/news-release/news-release-details/2015/Amazoncom-Announces-First-Quarter-Sales-up-15-to-2272-Billion/default.aspx'),
  ('amzn-covid-2020', '2020-12-31', 'crisis', 'COVID-19 เพิ่มภาระต้นทุนและเปลี่ยนการดำเนินงานโลจิสติกส์',
   'รายงาน 10-K ปี 2020 ระบุว่า Amazon ปรับกระบวนการคลังสินค้าและขนส่งทั่วโลกเพื่อความปลอดภัย จ้างพนักงานเพิ่มกว่า 400,000 คน และมีต้นทุนที่เกี่ยวข้องกับ COVID-19 มากกว่า 11.5 พันล้านดอลลาร์ตลอดปี.',
   'ช่วงที่อุปสงค์พุ่งขึ้นอาจต้องแลกกับต้นทุนลงทุนและต้นทุนดำเนินงานสูง นักลงทุนควรมองยอดขายควบคู่กับประสิทธิภาพโลจิสติกส์และกระแสเงินสด.',
   'Amazon 2020 Form 10-K', 'https://www.sec.gov/Archives/edgar/data/1018724/000101872421000004/amzn-20201231.htm'),
  ('amzn-aws-ai-2023', '2024-02-01', 'growth_engine', 'AWS และ Generative AI ช่วยหนุนการฟื้นตัวของผลประกอบการ',
   'ผลประกอบการปี 2023 ระบุว่า AWS มีรายได้ 90.8 พันล้านดอลลาร์ เพิ่มขึ้น 13% และกำไรจากการดำเนินงาน 24.6 พันล้านดอลลาร์ ขณะที่ Amazon เปิดตัวและขยายบริการ Generative AI เช่น Bedrock, Q และ Trainium.',
   'เมื่อธุรกิจหลักหลายส่วนฟื้นตัวพร้อมกัน ควรติดตามว่า AWS รักษาการเติบโตและอัตรากำไรได้หรือไม่ รวมถึงความคุ้มค่าของการลงทุนโครงสร้างพื้นฐาน AI.',
   'Amazon.com Announces Fourth Quarter Results', 'https://ir.aboutamazon.com/news-release/news-release-details/2024/Amazon-com-Announces-Fourth-Quarter-Results/default.aspx')
) as event(id, event_date, event_type, title_th, summary_th, lesson_th, source_title, source_url)
where company.ticker = 'AMZN'
on conflict (id) do update set
  event_date = excluded.event_date,
  event_type = excluded.event_type,
  title_th = excluded.title_th,
  summary_th = excluded.summary_th,
  lesson_th = excluded.lesson_th,
  source_title = excluded.source_title,
  source_url = excluded.source_url;
