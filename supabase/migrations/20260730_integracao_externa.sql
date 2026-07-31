-- ====================================================================
-- MIGRATION: Integração com Sistemas Externos de Relatórios
-- ====================================================================

-- 1. Novas colunas em public.relatorios
ALTER TABLE public.relatorios 
  ADD COLUMN IF NOT EXISTS origem_sistema TEXT NULL,
  ADD COLUMN IF NOT EXISTS identificador_origem TEXT NULL,
  ADD COLUMN IF NOT EXISTS recebido_via_integracao BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS periodo_inicio DATE NULL,
  ADD COLUMN IF NOT EXISTS periodo_fim DATE NULL,
  ADD COLUMN IF NOT EXISTS periodicidade TEXT NULL,
  ADD COLUMN IF NOT EXISTS lote_externo_id TEXT NULL;

-- 2. Índice único para idempotência por origem + identificador
CREATE UNIQUE INDEX IF NOT EXISTS idx_relatorios_origem_identificador 
ON public.relatorios (origem_sistema, identificador_origem) 
WHERE origem_sistema IS NOT NULL AND identificador_origem IS NOT NULL;

-- 3. Nova coluna lote_externo_id em public.lotes_envio
ALTER TABLE public.lotes_envio
  ADD COLUMN IF NOT EXISTS lote_externo_id TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_lotes_envio_lote_externo
ON public.lotes_envio (lote_externo_id)
WHERE lote_externo_id IS NOT NULL;

-- 4. Tabela de logs de integração
CREATE TABLE IF NOT EXISTS public.logs_integracao_relatorios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    origem_sistema TEXT,
    identificador_origem TEXT,
    codigo_cliente TEXT,
    relatorio_id UUID REFERENCES public.relatorios(id) ON DELETE SET NULL,
    lote_id UUID REFERENCES public.lotes_envio(id) ON DELETE SET NULL,
    status TEXT NOT NULL, -- 'sucesso', 'duplicado', 'erro_cliente', 'erro_validacao', 'erro_interno'
    http_status INTEGER NOT NULL,
    erro_codigo TEXT,
    erro_mensagem TEXT,
    recebido_em TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    processado_em TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    metadata JSONB NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_integracao_codigo_cliente ON public.logs_integracao_relatorios(codigo_cliente);
CREATE INDEX IF NOT EXISTS idx_logs_integracao_recebido_em ON public.logs_integracao_relatorios(recebido_em DESC);

-- 5. Tabela para segredos e rotação de integração
CREATE TABLE IF NOT EXISTS public.configuracoes_integracao (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    segredo_atual TEXT NOT NULL,
    segredo_anterior TEXT NULL,
    segredo_atual_criado_em TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Inserir segredo inicial padrão se a tabela estiver vazia
INSERT INTO public.configuracoes_integracao (id, segredo_atual, segredo_atual_criado_em)
SELECT gen_random_uuid(), 'krel_sec_' || encode(gen_random_bytes(24), 'hex'), now()
WHERE NOT EXISTS (SELECT 1 FROM public.configuracoes_integracao);

-- RLS
ALTER TABLE public.logs_integracao_relatorios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracoes_integracao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Acesso completo a logs de integracao para autenticados" 
ON public.logs_integracao_relatorios 
FOR ALL TO authenticated 
USING (true) 
WITH CHECK (true);

CREATE POLICY "Acesso a configuracoes de integracao para autenticados" 
ON public.configuracoes_integracao 
FOR ALL TO authenticated 
USING (true) 
WITH CHECK (true);
