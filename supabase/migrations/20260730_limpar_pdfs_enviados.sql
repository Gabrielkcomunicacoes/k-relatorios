-- Migration: Exclusão Automática de PDFs 24 horas após envio do relatório
-- Objetivo: Liberar armazenamento no Supabase Storage (bucket 'relatorios') sem perder histórico.
-- Frequência Cron: Execução a cada hora (0 * * * *)

-- 1. Adicionar colunas necessárias na tabela public.relatorios
alter table public.relatorios 
  add column if not exists arquivo_excluido boolean not null default false,
  add column if not exists arquivo_excluido_em timestamptz null,
  add column if not exists arquivo_exclusao_agendada_para timestamptz null,
  add column if not exists arquivo_exclusao_tentativas integer not null default 0,
  add column if not exists arquivo_exclusao_erro text null;

-- 2. Trigger para recalcular a data de exclusão agendada (24 horas após o envio mais recente)
create or replace function public.trg_atualizar_exclusao_agendada_relatorio()
returns trigger as $$
declare
  v_ultimo_envio timestamptz;
  v_relatorio_id uuid;
begin
  v_relatorio_id := new.relatorio_id;
  if v_relatorio_id is null then
    return new;
  end if;

  if new.status in ('enviado', 'entregue', 'lido') and new.enviado_em is not null then
    select max(enviado_em)
      into v_ultimo_envio
      from public.fila_envios
     where relatorio_id = v_relatorio_id
       and status in ('enviado', 'entregue', 'lido')
       and enviado_em is not null;

    if v_ultimo_envio is not null then
      update public.relatorios
         set arquivo_exclusao_agendada_para = v_ultimo_envio + interval '24 hours',
             updated_at = now()
       where id = v_relatorio_id
         and arquivo_excluido = false;
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_fila_envios_atualizar_exclusao on public.fila_envios;
create trigger trg_fila_envios_atualizar_exclusao
after insert or update of status, enviado_em on public.fila_envios
for each row
execute function public.trg_atualizar_exclusao_agendada_relatorio();

-- 3. Atualizar retroativamente os relatórios existentes que possuem envios concluídos
update public.relatorios r
   set arquivo_exclusao_agendada_para = (
       select max(f.enviado_em) + interval '24 hours'
         from public.fila_envios f
        where f.relatorio_id = r.id
          and f.status in ('enviado', 'entregue', 'lido')
          and f.enviado_em is not null
   )
 where r.arquivo_excluido = false
   and r.arquivo_exclusao_agendada_para is null
   and exists (
       select 1
         from public.fila_envios f
        where f.relatorio_id = r.id
          and f.status in ('enviado', 'entregue', 'lido')
          and f.enviado_em is not null
   );

-- 4. Habilitar extensões pg_cron e pg_net para agendamento automático
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 5. Cancelar agendamentos anteriores para evitar duplicidade
select cron.unschedule('limpar-pdfs-enviados-cron')
where exists (
  select 1 from cron.job where jobname = 'limpar-pdfs-enviados-cron'
);

-- 6. Configurar o Cron para executar a Edge Function 'limpar-pdfs-enviados' a cada hora (0 * * * *)
select cron.schedule(
  'limpar-pdfs-enviados-cron',
  '0 * * * *',
  $$
  select
    net.http_post(
      url := 'https://' || current_setting('app.settings.supabase_project_ref', true) || '.functions.supabase.co/limpar-pdfs-enviados',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := '{}'::jsonb
    ) as request_id;
  $$
);
