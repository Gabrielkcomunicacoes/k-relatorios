-- ====================================================================
-- K RELATÓRIOS - MIGRATION PARA TRATAMENTO DE DUPLICADOS E VERSIONAMENTO
-- ====================================================================

-- 1. Remover restrição antiga que impedia múltiplas versões da mesma competência
ALTER TABLE public.relatorios DROP CONSTRAINT IF EXISTS unique_report_client_competencia_type;

-- 2. Adicionar colunas de versionamento à tabela public.relatorios
ALTER TABLE public.relatorios
ADD COLUMN IF NOT EXISTS versao INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS relatorio_anterior_id UUID REFERENCES public.relatorios(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS versao_atual BOOLEAN NOT NULL DEFAULT true;

-- 3. Criar índice único parcial permitindo apenas UMA versão ativa (versao_atual = true) por cliente/competencia/tipo
CREATE UNIQUE INDEX IF NOT EXISTS idx_relatorios_versao_atual
ON public.relatorios (cliente_id, competencia, tipo_relatorio)
WHERE versao_atual = true;

-- 4. Índice para busca rápida de duplicatas por hash
CREATE INDEX IF NOT EXISTS idx_relatorios_hash_arquivo
ON public.relatorios (hash_arquivo);
