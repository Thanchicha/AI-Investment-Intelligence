select cron.schedule(
  'ingest-googl-prices-30m',
  '7,37 * * * *',
  $job$
  select net.http_post(
    url := 'https://pkxcbbolryyszljcedni.supabase.co/functions/v1/ingest-prices',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBreGNiYm9scnl5c3psamNlZG5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0OTA4NTUsImV4cCI6MjEwNDA2Njg1NX0.FUh4UASmXyWR2PIAhgYUljgAlWJgxSFLT_etu_i1a4U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBreGNiYm9scnl5c3psamNlZG5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0OTA4NTUsImV4cCI6MjEwNDA2Njg1NX0.FUh4UASmXyWR2PIAhgYUljgAlWJgxSFLT_etu_i1a4U'
    ),
    body := '{}'::jsonb
  );
  $job$
);
