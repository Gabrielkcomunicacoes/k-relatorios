import { createClient } from '@supabase/supabase-js';

const supabaseUrl = ((import.meta as any).env?.VITE_SUPABASE_URL || '').trim();
const supabaseAnonKey = ((import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '').trim();

const isPlaceholder = (val: string) =>
  !val ||
  val === 'MY_SUPABASE_URL' ||
  val === 'YOUR_SUPABASE_URL' ||
  val.includes('your-supabase-project') ||
  val.includes('example.com');

export const isSupabaseConfigured = !!(
  supabaseUrl &&
  supabaseAnonKey &&
  !isPlaceholder(supabaseUrl) &&
  !isPlaceholder(supabaseAnonKey)
);

// Only instantiate the Supabase client if the keys are actually configured.
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Test connection
if (supabase) {
  supabase.auth.getSession()
    .then(({ error }) => {
      if (error) {
        console.error("Falha ao conectar com Supabase.");
      } else {
        console.log("Conexão com Supabase estabelecida.");
      }
    })
    .catch(() => {
      console.error("Falha ao conectar com Supabase.");
    });
} else {
  console.log("Falha ao conectar com Supabase.");
}

/**
 * SQL script for the user to paste into their Supabase SQL editor.
 */
export const SUPABASE_SQL_SETUP = `-- K RELATÓRIOS - CONFIGURAÇÃO COMPLETA DO BANCO DE DADOS SUPABASE

-- 1. ENUMS (Criar se não existirem de forma segura)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'perfil_role') THEN
        CREATE TYPE perfil_role AS ENUM ('administrador', 'operador');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_validacao_relatorio') THEN
        CREATE TYPE status_validacao_relatorio AS ENUM (
            'processando',
            'pronto',
            'cliente_nao_encontrado',
            'telefone_ausente',
            'arquivo_invalido',
            'duplicado',
            'cliente_inativo',
            'enviado_anteriormente',
            'erro_upload'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'modalidade_lote') THEN
        CREATE TYPE modalidade_lote AS ENUM ('imediato', 'agendado', 'agenda_individual');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_lote') THEN
        CREATE TYPE status_lote AS ENUM (
            'rascunho',
            'agendado',
            'aguardando',
            'processando',
            'concluido',
            'concluido_com_falhas',
            'cancelado'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_envio') THEN
        CREATE TYPE status_envio AS ENUM (
            'pendente',
            'agendado',
            'processando',
            'enviado',
            'entregue',
            'lido',
            'falhou',
            'cancelado'
        );
    END IF;
END$$;

-- 2. TABELA DE PERFIS DE USUÁRIOS
CREATE TABLE IF NOT EXISTS public.perfis (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    nome TEXT NOT NULL,
    email TEXT NOT NULL,
    role perfil_role NOT NULL DEFAULT 'operador',
    ativo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. TABELA DE CLIENTES
CREATE TABLE IF NOT EXISTS public.clientes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_cliente TEXT NOT NULL UNIQUE,
    empresa TEXT NOT NULL,
    nome_contato TEXT,
    telefone_whatsapp TEXT,
    email TEXT,
    ativo BOOLEAN NOT NULL DEFAULT true,
    possui_optin BOOLEAN NOT NULL DEFAULT false,
    dia_envio SMALLINT CONSTRAINT chk_dia_envio CHECK (dia_envio >= 0 AND dia_envio <= 6),
    horario_envio TIME,
    observacoes TEXT,
    created_by UUID REFERENCES public.perfis(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT chk_telefone_whatsapp CHECK (telefone_whatsapp IS NULL OR telefone_whatsapp = '' OR telefone_whatsapp ~ '^[0-9]+$'),
    CONSTRAINT chk_codigo_cliente_upper CHECK (codigo_cliente = upper(codigo_cliente))
);

-- 4. TABELA DE RELATÓRIOS
CREATE TABLE IF NOT EXISTS public.relatorios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
    codigo_extraido TEXT,
    competencia DATE,
    tipo_relatorio TEXT NOT NULL DEFAULT 'desempenho',
    nome_arquivo TEXT NOT NULL,
    nome_original TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    tamanho_bytes BIGINT,
    mime_type TEXT,
    hash_arquivo TEXT,
    status_validacao status_validacao_relatorio NOT NULL DEFAULT 'processando',
    motivo_pendencia TEXT,
    enviado_anteriormente BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES public.perfis(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT uq_cliente_competencia_tipo UNIQUE(cliente_id, competencia, tipo_relatorio)
);

-- 5. TABELA DE LOTES DE ENVIO
CREATE TABLE IF NOT EXISTS public.lotes_envio (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL,
    competencia DATE,
    modalidade modalidade_lote NOT NULL DEFAULT 'imediato',
    data_programada TIMESTAMP WITH TIME ZONE,
    status status_lote NOT NULL DEFAULT 'rascunho',
    total_itens INTEGER NOT NULL DEFAULT 0,
    total_validos INTEGER NOT NULL DEFAULT 0,
    total_enviados INTEGER NOT NULL DEFAULT 0,
    total_falhas INTEGER NOT NULL DEFAULT 0,
    created_by UUID REFERENCES public.perfis(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. TABELA DE FILA DE ENVIOS
CREATE TABLE IF NOT EXISTS public.fila_envios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lote_id UUID REFERENCES public.lotes_envio(id) ON DELETE CASCADE,
    cliente_id UUID REFERENCES public.clientes(id) ON DELETE CASCADE,
    relatorio_id UUID NOT NULL REFERENCES public.relatorios(id) ON DELETE CASCADE,
    telefone_destino TEXT,
    data_programada TIMESTAMP WITH TIME ZONE,
    status status_envio NOT NULL DEFAULT 'pendente',
    tentativas INTEGER NOT NULL DEFAULT 0,
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

-- 7. TABELA DE HISTÓRICO DE STATUS
CREATE TABLE IF NOT EXISTS public.historico_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fila_envio_id UUID REFERENCES public.fila_envios(id) ON DELETE CASCADE,
    status_anterior TEXT,
    status_novo TEXT,
    detalhes JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 8. TABELA DE LOGS DE AUDITORIA
CREATE TABLE IF NOT EXISTS public.logs_auditoria (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID REFERENCES public.perfis(id) ON DELETE SET NULL,
    acao TEXT NOT NULL,
    entidade TEXT NOT NULL,
    entidade_id UUID,
    dados_anteriores JSONB,
    dados_novos JSONB,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 9. TABELA DE CONFIGURAÇÃO WHATSAPP
CREATE TABLE IF NOT EXISTS public.whatsapp_configs (
    id TEXT PRIMARY KEY DEFAULT 'default',
    access_token TEXT NOT NULL,
    phone_number_id TEXT NOT NULL,
    business_account_id TEXT NOT NULL,
    verify_token TEXT NOT NULL,
    app_secret TEXT NOT NULL,
    template_name TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'pt_BR'
);

-- Inserir config inicial se nao existir
INSERT INTO public.whatsapp_configs (id, access_token, phone_number_id, business_account_id, verify_token, app_secret, template_name, language)
VALUES ('default', 'configurado', 'configurado', 'configurado', 'configurado', 'configurado', 'configurado', 'pt_BR')
ON CONFLICT (id) DO NOTHING;

-- 10. CRIAR ÍNDICES
CREATE INDEX IF NOT EXISTS idx_clientes_codigo_cliente ON public.clientes(codigo_cliente);
CREATE INDEX IF NOT EXISTS idx_clientes_empresa ON public.clientes(empresa);
CREATE INDEX IF NOT EXISTS idx_clientes_telefone_whatsapp ON public.clientes(telefone_whatsapp);
CREATE INDEX IF NOT EXISTS idx_clientes_ativo ON public.clientes(ativo);
CREATE INDEX IF NOT EXISTS idx_relatorios_cliente_id ON public.relatorios(cliente_id);
CREATE INDEX IF NOT EXISTS idx_relatorios_competencia ON public.relatorios(competencia);
CREATE INDEX IF NOT EXISTS idx_relatorios_status_validacao ON public.relatorios(status_validacao);
CREATE INDEX IF NOT EXISTS idx_relatorios_hash_arquivo ON public.relatorios(hash_arquivo);
CREATE INDEX IF NOT EXISTS idx_lotes_envio_status ON public.lotes_envio(status);
CREATE INDEX IF NOT EXISTS idx_lotes_envio_data_programada ON public.lotes_envio(data_programada);
CREATE INDEX IF NOT EXISTS idx_fila_envios_status ON public.fila_envios(status);
CREATE INDEX IF NOT EXISTS idx_fila_envios_data_programada ON public.fila_envios(data_programada);
CREATE INDEX IF NOT EXISTS idx_fila_envios_whatsapp_message_id ON public.fila_envios(whatsapp_message_id);
CREATE INDEX IF NOT EXISTS idx_logs_auditoria_usuario_id ON public.logs_auditoria(usuario_id);
CREATE INDEX IF NOT EXISTS idx_logs_auditoria_created_at ON public.logs_auditoria(created_at);

-- 11. ATUALIZAÇÃO AUTOMÁTICA DE UPDATED_AT
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE OR REPLACE TRIGGER update_perfis_updated_at BEFORE UPDATE ON public.perfis FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();
CREATE OR REPLACE TRIGGER update_clientes_updated_at BEFORE UPDATE ON public.clientes FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();
CREATE OR REPLACE TRIGGER update_relatorios_updated_at BEFORE UPDATE ON public.relatorios FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();
CREATE OR REPLACE TRIGGER update_lotes_envio_updated_at BEFORE UPDATE ON public.lotes_envio FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();
CREATE OR REPLACE TRIGGER update_fila_envios_updated_at BEFORE UPDATE ON public.fila_envios FOR EACH ROW EXECUTE PROCEDURE public.update_updated_at_column();

-- 12. CRIAÇÃO AUTOMÁTICA DE PERFIL APÓS REGISTRO DE USUÁRIO
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.perfis (id, nome, email, role, ativo)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
    new.email,
    'operador',
    true
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 13. FUNÇÕES AUXILIARES DE RLS
CREATE OR REPLACE FUNCTION public.usuario_eh_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.perfis
    WHERE id = auth.uid() AND role = 'administrador' AND ativo = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.usuario_esta_ativo()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.perfis
    WHERE id = auth.uid() AND ativo = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 14. HABILITAR RLS EM TODAS AS TABELAS
ALTER TABLE public.perfis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relatorios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lotes_envio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fila_envios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historico_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs_auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_configs ENABLE ROW LEVEL SECURITY;

-- REMOVER POLÍTICAS ANTIGAS SE EXISTIREM
DROP POLICY IF EXISTS "Acesso público para leitura de perfis" ON public.perfis;
DROP POLICY IF EXISTS "Acesso total de perfis" ON public.perfis;
DROP POLICY IF EXISTS "Acesso total de clientes" ON public.clientes;
DROP POLICY IF EXISTS "Acesso total de relatórios" ON public.relatorios;
DROP POLICY IF EXISTS "Acesso total de lotes" ON public.lotes_envio;
DROP POLICY IF EXISTS "Acesso total de fila_envios" ON public.fila_envios;
DROP POLICY IF EXISTS "Acesso total de logs" ON public.logs_auditoria;
DROP POLICY IF EXISTS "Acesso total de configs" ON public.whatsapp_configs;

DROP POLICY IF EXISTS "Leitura de perfis por qualquer usuário ativo" ON public.perfis;
DROP POLICY IF EXISTS "Admin controle total de perfis" ON public.perfis;
DROP POLICY IF EXISTS "Leitura e escrita de clientes por operador/admin ativo" ON public.clientes;
DROP POLICY IF EXISTS "Operadores e admins ativos acessam relatórios" ON public.relatorios;
DROP POLICY IF EXISTS "Operadores e admins ativos acessam lotes_envio" ON public.lotes_envio;
DROP POLICY IF EXISTS "Operadores e admins ativos acessam fila_envios" ON public.fila_envios;
DROP POLICY IF EXISTS "Operadores e admins ativos acessam historico_status" ON public.historico_status;
DROP POLICY IF EXISTS "Visualização de logs por operador/admin ativo" ON public.logs_auditoria;
DROP POLICY IF EXISTS "Admin grava e altera logs" ON public.logs_auditoria;
DROP POLICY IF EXISTS "Qualquer operador/admin ativo lê whatsapp_configs" ON public.whatsapp_configs;
DROP POLICY IF EXISTS "Apenas admin altera whatsapp_configs" ON public.whatsapp_configs;

-- POLÍTICAS PARA PERFIS
CREATE POLICY "Leitura de perfis por qualquer usuário ativo" ON public.perfis
    FOR SELECT USING (public.usuario_esta_ativo());
CREATE POLICY "Admin controle total de perfis" ON public.perfis
    FOR ALL USING (public.usuario_eh_admin()) WITH CHECK (public.usuario_eh_admin());

-- POLÍTICAS PARA CLIENTES
CREATE POLICY "Leitura e escrita de clientes por operador/admin ativo" ON public.clientes
    FOR ALL USING (public.usuario_esta_ativo()) WITH CHECK (public.usuario_esta_ativo());

-- POLÍTICAS PARA RELATÓRIOS
CREATE POLICY "Operadores e admins ativos acessam relatórios" ON public.relatorios
    FOR ALL USING (public.usuario_esta_ativo()) WITH CHECK (public.usuario_esta_ativo());

-- POLÍTICAS PARA LOTES DE ENVIO
CREATE POLICY "Operadores e admins ativos acessam lotes_envio" ON public.lotes_envio
    FOR ALL USING (public.usuario_esta_ativo()) WITH CHECK (public.usuario_esta_ativo());

-- POLÍTICAS PARA FILA DE ENVIO
CREATE POLICY "Operadores e admins ativos acessam fila_envios" ON public.fila_envios
    FOR ALL USING (public.usuario_esta_ativo()) WITH CHECK (public.usuario_esta_ativo());

-- POLÍTICAS PARA HISTÓRICO DE STATUS
CREATE POLICY "Operadores e admins ativos acessam historico_status" ON public.historico_status
    FOR ALL USING (public.usuario_esta_ativo()) WITH CHECK (public.usuario_esta_ativo());

-- POLÍTICAS PARA LOGS DE AUDITORIA
CREATE POLICY "Visualização de logs por operador/admin ativo" ON public.logs_auditoria
    FOR SELECT USING (public.usuario_esta_ativo());
CREATE POLICY "Admin grava e altera logs" ON public.logs_auditoria
    FOR ALL USING (public.usuario_eh_admin()) WITH CHECK (public.usuario_eh_admin());

-- POLÍTICAS PARA WHATSAPP CONFIGS
CREATE POLICY "Qualquer operador/admin ativo lê whatsapp_configs" ON public.whatsapp_configs
    FOR SELECT USING (public.usuario_esta_ativo());
CREATE POLICY "Apenas admin altera whatsapp_configs" ON public.whatsapp_configs
    FOR ALL USING (public.usuario_eh_admin()) WITH CHECK (public.usuario_eh_admin());

-- 15. FUNÇÃO TRANSAÇÃO DE CRIAÇÃO DE LOTES COM FILA
CREATE OR REPLACE FUNCTION public.criar_lote_com_fila(
    p_nome TEXT,
    p_competencia DATE,
    p_modalidade public.modalidade_lote,
    p_data_programada TIMESTAMP WITH TIME ZONE,
    p_relatorio_ids UUID[],
    p_usuario_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_lote_id UUID;
    v_rel_id UUID;
    v_cliente_id UUID;
    v_status_validacao public.status_validacao_relatorio;
    v_telefone TEXT;
    v_cliente_ativo BOOLEAN;
    v_total_itens INT := 0;
    v_total_validos INT := 0;
    v_data_programada_item TIMESTAMP WITH TIME ZONE;
    v_status_envio public.status_envio;
    v_dia_envio SMALLINT;
    v_horario_envio TIME;
    v_temp_date DATE;
    v_result JSONB;
BEGIN
    -- 1. Validar auth.uid() contra o usuário que está criando
    IF auth.uid() IS NULL OR auth.uid() <> p_usuario_id THEN
        RAISE EXCEPTION 'Acesso não autorizado: usuário não autenticado ou inconsistente';
    END IF;

    -- Verificar se o usuário está ativo
    IF NOT EXISTS (SELECT 1 FROM public.perfis WHERE id = p_usuario_id AND ativo = true) THEN
        RAISE EXCEPTION 'Acesso não autorizado: usuário inativo';
    END IF;

    -- 2. Criar o lote (com status inicial correto)
    INSERT INTO public.lotes_envio (
        nome,
        competencia,
        modalidade,
        data_programada,
        status,
        total_itens,
        total_validos,
        created_by
    ) VALUES (
        p_nome,
        p_competencia,
        p_modalidade,
        p_data_programada,
        CASE 
            WHEN p_modalidade = 'imediato' THEN 'aguardando'::public.status_lote
            ELSE 'agendado'::public.status_lote
        END,
        0,
        0,
        p_usuario_id
    ) RETURNING id INTO v_lote_id;

    -- 3. Iterar sobre cada relatório ID fornecido
    FOREACH v_rel_id IN ARRAY p_relatorio_ids LOOP
        v_total_itens := v_total_itens + 1;

        -- Buscar relatório
        SELECT cliente_id, status_validacao 
        INTO v_cliente_id, v_status_validacao
        FROM public.relatorios
        WHERE id = v_rel_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Relatório com ID % não encontrado', v_rel_id;
        END IF;

        -- Se cliente_id for nulo, não é válido para a fila
        IF v_cliente_id IS NULL THEN
            CONTINUE;
        END IF;

        -- Buscar cliente
        SELECT telefone_whatsapp, ativo, dia_envio, horario_envio
        INTO v_telefone, v_cliente_ativo, v_dia_envio, v_horario_envio
        FROM public.clientes
        WHERE id = v_cliente_id;

        IF NOT FOUND THEN
            CONTINUE;
        END IF;

        -- Validar status_validacao = 'pronto', cliente_ativo = true, telefone_whatsapp não nulo/vazio
        IF v_status_validacao <> 'pronto'::public.status_validacao_relatorio THEN
            CONTINUE;
        END IF;

        IF NOT v_cliente_ativo THEN
            CONTINUE;
        END IF;

        -- Remover caracteres não numéricos do telefone
        v_telefone := regexp_replace(v_telefone, '\D', 'g');
        IF v_telefone IS NULL OR v_telefone = '' THEN
            CONTINUE;
        END IF;

        -- 5. Calcular modalidade / data_programada para o item
        IF p_modalidade = 'imediato' THEN
            v_status_envio := 'pendente'::public.status_envio;
            v_data_programada_item := now();
        ELSIF p_modalidade = 'agendado' THEN
            v_status_envio := 'agendado'::public.status_envio;
            v_data_programada_item := p_data_programada;
        ELSIF p_modalidade = 'agenda_individual' THEN
            v_status_envio := 'agendado'::public.status_envio;
            IF v_dia_envio IS NULL THEN
                v_dia_envio := 5; -- Sexta-feira
            END IF;
            IF v_horario_envio IS NULL THEN
                v_horario_envio := '09:00:00'::TIME;
            END IF;

            v_temp_date := CURRENT_DATE;
            WHILE extract(dow from v_temp_date)::INT <> v_dia_envio LOOP
                v_temp_date := v_temp_date + 1;
            END LOOP;

            IF v_temp_date = CURRENT_DATE AND CURRENT_TIME > v_horario_envio THEN
                v_temp_date := v_temp_date + 7;
            END IF;

            v_data_programada_item := (v_temp_date::TEXT || ' ' || v_horario_envio::TEXT)::TIMESTAMP WITH TIME ZONE;
        END IF;

        -- 6. Criar fila_envios
        INSERT INTO public.fila_envios (
            lote_id,
            cliente_id,
            relatorio_id,
            telefone_destino,
            data_programada,
            status,
            tentativas
        ) VALUES (
            v_lote_id,
            v_cliente_id,
            v_rel_id,
            v_telefone,
            v_data_programada_item,
            v_status_envio,
            0
        );

        v_total_validos := v_total_validos + 1;
    END LOOP;

    -- Validar se criamos pelo menos um item na fila de envios
    IF v_total_validos = 0 THEN
        RAISE EXCEPTION 'Não foi possível agendar nenhum envio válido para este lote. Verifique o status dos relatórios, se os clientes estão ativos e possuem telefone configurado.';
    END IF;

    -- 7. Atualizar totais no lote
    UPDATE public.lotes_envio
    SET total_itens = v_total_itens,
        total_validos = v_total_validos
    WHERE id = v_lote_id;

    -- 9. Retornar dados criados
    SELECT jsonb_build_object(
        'lote_id', v_lote_id,
        'total_itens', v_total_itens,
        'total_validos', v_total_validos
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- 16. AJUSTAR POLÍTICAS DE FILA DE ENVIO EXPLICITAMENTE
DROP POLICY IF EXISTS "usuarios ativos podem inserir fila" ON public.fila_envios;
CREATE POLICY "usuarios ativos podem inserir fila"
ON public.fila_envios
FOR INSERT
TO authenticated
WITH CHECK (
  public.usuario_esta_ativo()
);

DROP POLICY IF EXISTS "usuarios ativos podem visualizar fila" ON public.fila_envios;
CREATE POLICY "usuarios ativos podem visualizar fila"
ON public.fila_envios
FOR SELECT
TO authenticated
USING (
  public.usuario_esta_ativo()
);
`;
