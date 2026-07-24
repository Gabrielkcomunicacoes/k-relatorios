import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Variáveis de ambiente do Supabase não configuradas no Edge Functions.");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Validar Token de Autenticação do Usuário
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Cabeçalho de autorização ausente." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Sessão inválida ou usuário não autenticado." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Buscar e validar perfil do usuário
    const { data: perfil, error: perfilError } = await supabase
      .from("perfis")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (perfilError || (perfil && !perfil.ativo)) {
      return new Response(
        JSON.stringify({ error: "Perfil de usuário inativo ou sem permissão." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse Body
    const body = await req.json();
    const { acao, relatorioExistenteId, novoArquivoData } = body;

    if (!acao || !relatorioExistenteId) {
      return new Response(
        JSON.stringify({ error: "Parâmetros 'acao' e 'relatorioExistenteId' são obrigatórios." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Buscar relatório existente
    const { data: relatorioExistente, error: fetchErr } = await supabase
      .from("relatorios")
      .select("*")
      .eq("id", relatorioExistenteId)
      .single();

    if (fetchErr || !relatorioExistente) {
      return new Response(
        JSON.stringify({ error: "Relatório existente não foi encontrado." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let resultadoRelatorio = null;

    // =========================================================================
    // AÇÃO 1: CANCELAR (Gerenciado no Frontend sem alterações no BD)
    // =========================================================================

    // =========================================================================
    // AÇÃO 2: SUBSTITUIR ARQUIVO EXISTENTE
    // =========================================================================
    if (acao === "substituir") {
      if (!novoArquivoData || !novoArquivoData.storage_path) {
        return new Response(
          JSON.stringify({ error: "Dados do novo arquivo para substituição não informados." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validar se existe item ativo na fila_envios (pendente, agendado, processando)
      const { data: filaAtiva, error: filaErr } = await supabase
        .from("fila_envios")
        .select("id, status")
        .eq("relatorio_id", relatorioExistenteId)
        .in("status", ["pendente", "agendado", "processando"]);

      if (filaErr) {
        throw new Error(`Erro ao verificar fila de envios ativa: ${filaErr.message}`);
      }

      if (filaAtiva && filaAtiva.length > 0) {
        return new Response(
          JSON.stringify({
            error: "Este relatório já está em uma fila ativa. Cancele o envio antes de substituir o arquivo.",
            activeQueue: filaAtiva
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const oldStoragePath = relatorioExistente.storage_path;

      // Atualizar a linha existente em public.relatorios
      const { data: updatedReport, error: updateErr } = await supabase
        .from("relatorios")
        .update({
          nome_arquivo: novoArquivoData.nome_arquivo,
          nome_original: novoArquivoData.nome_original || novoArquivoData.nome_arquivo,
          storage_path: novoArquivoData.storage_path,
          tamanho_bytes: novoArquivoData.tamanho_bytes,
          mime_type: novoArquivoData.mime_type || "application/pdf",
          hash_arquivo: novoArquivoData.hash_arquivo,
          updated_at: new Date().toISOString()
        })
        .eq("id", relatorioExistenteId)
        .select("*")
        .single();

      if (updateErr) {
        // Se update falhar, remover o novo arquivo do storage e manter o antigo
        try {
          await supabase.storage.from("relatorios").remove([novoArquivoData.storage_path]);
        } catch (_) {}
        throw new Error(`Falha ao atualizar relatório no banco: ${updateErr.message}`);
      }

      // Só depois do update confirmado, remover o PDF antigo do Storage se for um caminho diferente
      if (oldStoragePath && oldStoragePath !== novoArquivoData.storage_path) {
        try {
          await supabase.storage.from("relatorios").remove([oldStoragePath]);
        } catch (removeOldErr) {
          console.error("Aviso: Falha ao remover PDF antigo do Storage após substituição:", removeOldErr);
        }
      }

      // Log de Auditoria
      await supabase.from("logs_auditoria").insert({
        usuario_id: user.id,
        acao: "substituir_relatorio",
        entidade: "relatorios",
        entidade_id: relatorioExistenteId,
        dados_anteriores: {
          nome_arquivo: relatorioExistente.nome_arquivo,
          storage_path: relatorioExistente.storage_path,
          hash_arquivo: relatorioExistente.hash_arquivo,
          tamanho_bytes: relatorioExistente.tamanho_bytes
        },
        dados_novos: {
          nome_arquivo: updatedReport.nome_arquivo,
          storage_path: updatedReport.storage_path,
          hash_arquivo: updatedReport.hash_arquivo,
          tamanho_bytes: updatedReport.tamanho_bytes
        },
        user_agent: req.headers.get("user-agent") || null
      });

      resultadoRelatorio = updatedReport;
    }

    // =========================================================================
    // AÇÃO 3: CRIAR NOVA VERSÃO
    // =========================================================================
    else if (acao === "nova_versao") {
      if (!novoArquivoData || !novoArquivoData.storage_path) {
        return new Response(
          JSON.stringify({ error: "Dados do novo arquivo para nova versão não informados." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 1. Localizar a versão atual ativa para este cliente/competência/tipo
      const { data: versaoAtualExistente } = await supabase
        .from("relatorios")
        .select("*")
        .eq("cliente_id", relatorioExistente.cliente_id)
        .eq("competencia", relatorioExistente.competencia)
        .eq("tipo_relatorio", relatorioExistente.tipo_relatorio)
        .eq("versao_atual", true)
        .maybeSingle();

      const versaoBase = versaoAtualExistente || relatorioExistente;

      // 2. Marcar a versão anterior como versao_atual = false
      await supabase
        .from("relatorios")
        .update({ versao_atual: false, updated_at: new Date().toISOString() })
        .eq("id", versaoBase.id);

      const novaVersaoNum = (versaoBase.versao || 1) + 1;

      // 3. Criar nova linha no banco de dados
      const { data: newVersionReport, error: insertVersaoErr } = await supabase
        .from("relatorios")
        .insert({
          cliente_id: versaoBase.cliente_id,
          codigo_extraido: versaoBase.codigo_extraido || novoArquivoData.codigo_cliente,
          competencia: versaoBase.competencia,
          tipo_relatorio: versaoBase.tipo_relatorio,
          nome_arquivo: novoArquivoData.nome_arquivo,
          nome_original: novoArquivoData.nome_original || novoArquivoData.nome_arquivo,
          storage_path: novoArquivoData.storage_path,
          tamanho_bytes: novoArquivoData.tamanho_bytes,
          mime_type: novoArquivoData.mime_type || "application/pdf",
          hash_arquivo: novoArquivoData.hash_arquivo,
          status_validacao: "pronto",
          versao: novaVersaoNum,
          relatorio_anterior_id: versaoBase.id,
          versao_atual: true,
          created_by: user.id
        })
        .select("*")
        .single();

      if (insertVersaoErr) {
        // Reverter flag da versão anterior se falhar inserção
        await supabase
          .from("relatorios")
          .update({ versao_atual: true })
          .eq("id", versaoBase.id);

        throw new Error(`Falha ao criar nova versão no banco: ${insertVersaoErr.message}`);
      }

      // Log de Auditoria
      await supabase.from("logs_auditoria").insert({
        usuario_id: user.id,
        acao: "nova_versao_relatorio",
        entidade: "relatorios",
        entidade_id: newVersionReport.id,
        dados_anteriores: {
          relatorio_anterior_id: versaoBase.id,
          versao_anterior: versaoBase.versao || 1
        },
        dados_novos: {
          relatorio_id: newVersionReport.id,
          nova_versao: novaVersaoNum,
          storage_path: newVersionReport.storage_path
        },
        user_agent: req.headers.get("user-agent") || null
      });

      resultadoRelatorio = newVersionReport;
    }

    // =========================================================================
    // AÇÃO 4: REUTILIZAR ARQUIVO EXISTENTE
    // =========================================================================
    else if (acao === "reutilizar") {
      // Reutiliza o relatório existente sem criar novo upload nem alterar linhas de relatorios
      await supabase.from("logs_auditoria").insert({
        usuario_id: user.id,
        acao: "reutilizar_relatorio_existente",
        entidade: "relatorios",
        entidade_id: relatorioExistente.id,
        dados_anteriores: null,
        dados_novos: {
          relatorio_id: relatorioExistente.id,
          nome_arquivo: relatorioExistente.nome_arquivo,
          hash_arquivo: relatorioExistente.hash_arquivo
        },
        user_agent: req.headers.get("user-agent") || null
      });

      resultadoRelatorio = relatorioExistente;
    } else {
      return new Response(
        JSON.stringify({ error: `Ação '${acao}' desconhecida.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        relatorio: resultadoRelatorio,
        message: `Decisão de duplicidade (${acao}) executada com sucesso.`
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Erro na Edge Function resolver-relatorio-duplicado:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Erro interno na execução." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
