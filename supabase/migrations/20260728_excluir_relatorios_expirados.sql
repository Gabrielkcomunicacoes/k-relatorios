-- Migration: Exclusão Automática de Relatórios Enviados Há Mais de 7 Dias
-- Execução: Diária às 03:00 no horário de Brasília (06:00 UTC) -> 0 6 * * *
-- Função Target: excluir-relatorios-enviados-expirados

-- 1. Adicionar a coluna archived_at em lotes_envio para suporte ao arquivamento de lotes vazios
alter table public.lotes_envio 
  add column if not exists archived_at timestamptz null;

-- 2. Habilitar extensoes necessarias
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 3. Remover agendamento anterior se existir
select cron.unschedule('excluir-relatorios-expirados-cron')
where exists (
  select 1 from cron.job where jobname = 'excluir-relatorios-expirados-cron'
);

-- 4. Agendar a rotina diaria de exclusão automatica de relatorios expirados (06:00 UTC = 03:00 Brasilia)
select cron.schedule(
  'excluir-relatorios-expirados-cron',
  '0 6 * * *',
  $$
  select
    net.http_post(
      url := 'https://' || current_setting('app.settings.supabase_project_ref', true) || '.functions.supabase.co/excluir-relatorios-enviados-expirados',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := '{}'::jsonb
    ) as request_id;
  $$
);
