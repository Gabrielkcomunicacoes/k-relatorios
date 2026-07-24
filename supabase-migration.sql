-- ====================================================================
-- K RELATÓRIOS - SUPABASE MIGRATION & RLS POLICIES
-- ====================================================================
-- Execute este script no SQL Editor do seu projeto Supabase para criar 
-- toda a estrutura do banco de dados, índices e políticas de segurança.

-- Habilitar a extensão pgcrypto para geração de UUID se necessário
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. TABELA DE PERFIS
-- Armazena os perfis de usuários integrados ao Auth do Supabase
CREATE TABLE IF NOT EXISTS public.perfis (
    id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
    nome TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT CHECK (role IN ('administrador', 'operador')) NOT NULL,
    ativo BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. TABELA DE CLIENTES
-- Cadastro de clientes com controle de opt-in e agenda de envios
CREATE TABLE IF NOT EXISTS public.clientes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_cliente TEXT UNIQUE NOT NULL,
    empresa TEXT NOT NULL,
    nome_contato TEXT,
    telefone_whatsapp TEXT, -- Apenas dígitos numéricos
    email TEXT,
    ativo BOOLEAN DEFAULT true NOT NULL,
    possui_optin BOOLEAN DEFAULT false NOT NULL,
    dia_envio SMALLINT DEFAULT 5 CHECK (dia_envio BETWEEN 1 AND 31),
    horario_envio TIME DEFAULT '09:00:00',
    observacoes TEXT,
    created_by UUID REFERENCES auth.users ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. TABELA DE RELATÓRIOS
-- Registro de cada arquivo PDF carregado, validado e armazenado no bucket
CREATE TABLE IF NOT EXISTS public.relatorios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id UUID REFERENCES public.clientes ON DELETE SET NULL,
    codigo_cliente TEXT,
    competencia DATE NOT NULL, -- Primeiro dia da competência correspondente (Ex: 2026-07-01)
    tipo_relatorio TEXT DEFAULT 'desempenho' NOT NULL,
    nome_arquivo TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    tamanho_bytes BIGINT,
    mime_type TEXT,
    hash_arquivo TEXT, -- MD5 ou similar para evitar upload duplicado do mesmo arquivo
    status_validacao TEXT CHECK (status_validacao IN (
        'processando', 'pronto', 'cliente_nao_encontrado', 'telefone_ausente',
        'arquivo_invalido', 'duplicado', 'cliente_inativo', 'enviado_anteriormente', 'erro_upload'
    )) NOT NULL,
    motivo_pendencia TEXT,
    enviado_anteriormente BOOLEAN DEFAULT false NOT NULL,
    versao INTEGER NOT NULL DEFAULT 1,
    relatorio_anterior_id UUID REFERENCES public.relatorios(id) ON DELETE SET NULL,
    versao_atual BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES auth.users ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Índice único parcial para permitir apenas UMA versão ativa (versao_atual = true) por cliente/competencia/tipo
CREATE UNIQUE INDEX IF NOT EXISTS idx_relatorios_versao_atual
ON public.relatorios (cliente_id, competencia, tipo_relatorio)
WHERE versao_atual = true;

CREATE INDEX IF NOT EXISTS idx_relatorios_hash_arquivo
ON public.relatorios (hash_arquivo);

-- 4. TABELA DE LOTES DE ENVIO
-- Agrupamento lógico dos disparos que serão processados
CREATE TABLE IF NOT EXISTS public.lotes_envio (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL,
    competencia DATE NOT NULL,
    modalidade TEXT CHECK (modalidade IN ('imediato', 'agendado', 'agenda_individual')) NOT NULL,
    data_programada TIMESTAMP WITH TIME ZONE,
    status TEXT CHECK (status IN (
        'rascunho', 'agendado', 'aguardando', 'processando', 'concluido', 'concluido_com_falhas', 'cancelado'
    )) NOT NULL DEFAULT 'rascunho',
    total_itens INTEGER DEFAULT 0 NOT NULL,
    total_validos INTEGER DEFAULT 0 NOT NULL,
    total_enviados INTEGER DEFAULT 0 NOT NULL,
    total_falhas INTEGER DEFAULT 0 NOT NULL,
    created_by UUID REFERENCES auth.users ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. TABELA DE FILA DE ENVIOS
-- Fila de agendamento e status de envio de cada WhatsApp individual
CREATE TABLE IF NOT EXISTS public.fila_envios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lote_id UUID REFERENCES public.lotes_envio ON DELETE CASCADE NOT NULL,
    cliente_id UUID REFERENCES public.clientes ON DELETE SET NULL,
    relatorio_id UUID REFERENCES public.relatorios ON DELETE SET NULL,
    telefone_destino TEXT NOT NULL,
    data_programada TIMESTAMP WITH TIME ZONE,
    status TEXT CHECK (status IN (
        'pendente', 'agendado', 'processando', 'enviado', 'entregue', 'lido', 'falhou', 'cancelado'
    )) NOT NULL DEFAULT 'pendente',
    tentativas INTEGER DEFAULT 0 NOT NULL,
    proxima_tentativa TIMESTAMP WITH TIME ZONE,
    whatsapp_message_id TEXT,
    erro_codigo TEXT,
    erro_mensagem TEXT,
    enviado_em TIMESTAMP WITH TIME ZONE,
    entregue_em TIMESTAMP WITH TIME ZONE,
    lido_em TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. TABELA DE HISTÓRICO DE STATUS
-- Log detalhado de alteração de cada item da fila (Para Webhooks e Retries)
CREATE TABLE IF NOT EXISTS public.historico_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fila_envio_id UUID REFERENCES public.fila_envios ON DELETE CASCADE NOT NULL,
    status_anterior TEXT,
    status_novo TEXT NOT NULL,
    detalhes JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. TABELA DE LOGS DE AUDITORIA
-- Trilha imutável de segurança das ações realizadas na plataforma
CREATE TABLE IF NOT EXISTS public.logs_auditoria (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID, -- UUID do auth.users do executor
    acao TEXT NOT NULL,
    entidade TEXT, -- Ex: 'clientes', 'lotes_envio', 'relatorios'
    entidade_id UUID,
    dados_anteriores JSONB,
    dados_novos JSONB,
    ip TEXT,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ====================================================================
-- CRIAR ÍNDICES DE PERFORMANCE
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_clientes_codigo_cliente ON public.clientes(codigo_cliente);
CREATE INDEX IF NOT EXISTS idx_clientes_telefone_whatsapp ON public.clientes(telefone_whatsapp);
CREATE INDEX IF NOT EXISTS idx_relatorios_cliente_id ON public.relatorios(cliente_id);
CREATE INDEX IF NOT EXISTS idx_relatorios_competencia ON public.relatorios(competencia);
CREATE INDEX IF NOT EXISTS idx_relatorios_status_validacao ON public.relatorios(status_validacao);
CREATE INDEX IF NOT EXISTS idx_lotes_envio_status ON public.lotes_envio(status);
CREATE INDEX IF NOT EXISTS idx_fila_envios_status ON public.fila_envios(status);
CREATE INDEX IF NOT EXISTS idx_fila_envios_data_programada ON public.fila_envios(data_programada);
CREATE INDEX IF NOT EXISTS idx_fila_envios_whatsapp_message_id ON public.fila_envios(whatsapp_message_id);

-- ====================================================================
-- ROW LEVEL SECURITY (RLS) - CONFIGURAÇÃO E POLÍTICAS
-- ====================================================================

-- Ativar RLS em todas as tabelas
ALTER TABLE public.perfis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relatorios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lotes_envio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fila_envios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historico_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs_auditoria ENABLE ROW LEVEL SECURITY;

-- FUNÇÕES AUXILIARES DE SUPORTE (SECURITY DEFINER para contornar recursão)
CREATE OR REPLACE FUNCTION public.check_user_is_admin(user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.perfis 
    WHERE id = user_id AND role = 'administrador'
  );
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.check_user_is_operator(user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.perfis 
    WHERE id = user_id AND role = 'operador'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- 1. POLÍTICAS DE PERFIS (profiles)
CREATE POLICY "Selecione o próprio perfil" ON public.perfis
    FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE POLICY "Admin total sobre perfis" ON public.perfis
    FOR ALL TO authenticated USING (public.check_user_is_admin(auth.uid()));

-- 2. POLÍTICAS DE CLIENTES
CREATE POLICY "Clientes - Admin total" ON public.clientes
    FOR ALL TO authenticated USING (public.check_user_is_admin(auth.uid()));

CREATE POLICY "Clientes - Operador select" ON public.clientes
    FOR SELECT TO authenticated USING (public.check_user_is_operator(auth.uid()));

CREATE POLICY "Clientes - Operador insert" ON public.clientes
    FOR INSERT TO authenticated WITH CHECK (public.check_user_is_operator(auth.uid()));

CREATE POLICY "Clientes - Operador update" ON public.clientes
    FOR UPDATE TO authenticated USING (public.check_user_is_operator(auth.uid()));

-- 3. POLÍTICAS DE RELATÓRIOS
CREATE POLICY "Relatorios - Admin total" ON public.relatorios
    FOR ALL TO authenticated USING (public.check_user_is_admin(auth.uid()));

CREATE POLICY "Relatorios - Operador select" ON public.relatorios
    FOR SELECT TO authenticated USING (public.check_user_is_operator(auth.uid()));

CREATE POLICY "Relatorios - Operador insert" ON public.relatorios
    FOR INSERT TO authenticated WITH CHECK (public.check_user_is_operator(auth.uid()));

CREATE POLICY "Relatorios - Operador update" ON public.relatorios
    FOR UPDATE TO authenticated USING (public.check_user_is_operator(auth.uid()));

-- 4. POLÍTICAS DE LOTES DE ENVIO
CREATE POLICY "Lotes - Admin total" ON public.lotes_envio
    FOR ALL TO authenticated USING (public.check_user_is_admin(auth.uid()));

CREATE POLICY "Lotes - Operador select" ON public.lotes_envio
    FOR SELECT TO authenticated USING (public.check_user_is_operator(auth.uid()));

CREATE POLICY "Lotes - Operador insert" ON public.lotes_envio
    FOR INSERT TO authenticated WITH CHECK (public.check_user_is_operator(auth.uid()));

CREATE POLICY "Lotes - Operador update" ON public.lotes_envio
    FOR UPDATE TO authenticated USING (public.check_user_is_operator(auth.uid()));

-- 5. POLÍTICAS DE FILA DE ENVIOS
CREATE POLICY "Fila - Admin total" ON public.fila_envios
    FOR ALL TO authenticated USING (public.check_user_is_admin(auth.uid()));

CREATE POLICY "Fila - Operador select" ON public.fila_envios
    FOR SELECT TO authenticated USING (public.check_user_is_operator(auth.uid()));

CREATE POLICY "Fila - Operador insert" ON public.fila_envios
    FOR INSERT TO authenticated WITH CHECK (public.check_user_is_operator(auth.uid()));

CREATE POLICY "Fila - Operador update" ON public.fila_envios
    FOR UPDATE TO authenticated USING (public.check_user_is_operator(auth.uid()));

-- 6. POLÍTICAS DE HISTÓRICO DE STATUS
CREATE POLICY "Historico - Admin total" ON public.historico_status
    FOR ALL TO authenticated USING (public.check_user_is_admin(auth.uid()));

CREATE POLICY "Historico - Operador select" ON public.historico_status
    FOR SELECT TO authenticated USING (public.check_user_is_operator(auth.uid()));

CREATE POLICY "Historico - Operador insert" ON public.historico_status
    FOR INSERT TO authenticated WITH CHECK (public.check_user_is_operator(auth.uid()));

-- 7. POLÍTICAS DE AUDITORIA
CREATE POLICY "Logs - Admin select" ON public.logs_auditoria
    FOR SELECT TO authenticated USING (public.check_user_is_admin(auth.uid()));

CREATE POLICY "Logs - Admin insert" ON public.logs_auditoria
    FOR INSERT TO authenticated WITH CHECK (public.check_user_is_admin(auth.uid()));

CREATE POLICY "Logs - Operador select" ON public.logs_auditoria
    FOR SELECT TO authenticated USING (public.check_user_is_operator(auth.uid()));

CREATE POLICY "Logs - Operador insert" ON public.logs_auditoria
    FOR INSERT TO authenticated WITH CHECK (public.check_user_is_operator(auth.uid()));


-- ====================================================================
-- REGRAS PARA O STORAGE BUCKET PRIVADO 'relatorios'
-- ====================================================================
-- Nota: Certifique-se de que o bucket 'relatorios' foi criado como PRIVADO no painel do Supabase.
-- As seguintes políticas garantem segurança absoluta e bloqueiam acesso público.

-- 1. Permitir leitura apenas para usuários autenticados via URLs Assinadas (Signed URLs)
CREATE POLICY "Leitura autorizada de PDFs" ON storage.objects
    FOR SELECT TO authenticated USING (bucket_id = 'relatorios');

-- 2. Permitir upload de arquivos PDF para usuários autenticados
CREATE POLICY "Upload autorizado de PDFs" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (
        bucket_id = 'relatorios' AND 
        (storage.extension(name) = 'pdf' OR mime_type = 'application/pdf')
    );

-- 3. Permitir exclusão de arquivos PDF para administradores
CREATE POLICY "Exclusao autorizada de PDFs" ON storage.objects
    FOR DELETE TO authenticated USING (
        bucket_id = 'relatorios' AND 
        public.check_user_is_admin(auth.uid())
    );
