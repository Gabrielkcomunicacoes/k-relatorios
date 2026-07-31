-- Migration: Configuração do Worker Automático com Cron pg_cron
-- Frequência: A cada 1 minuto (* * * * *)
-- Fluxo: Cron -> worker-fila-envios -> Meta WhatsApp Cloud API

-- 1. Habilitar extensões necessárias para agendamento
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Remover agendamento anterior se houver
select cron.unschedule('worker-fila-envios-cron')
where exists (
  select 1 from cron.job where jobname = 'worker-fila-envios-cron'
);

-- 3. Criar agendamento automático a cada 1 minuto
select cron.schedule(
  'worker-fila-envios-cron',
  '* * * * *',
  $$
  select
    net.http_post(
      url := 'https://' || current_setting('app.settings.supabase_project_ref', true) || '.functions.supabase.co/worker-fila-envios',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := '{}'::jsonb
    ) as request_id;
  $$
);
