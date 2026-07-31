import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ResultadoExclusao {
  relatorio_id: string;
  nome_arquivo: string;
  storage_path: string | null;
  status: "excluido" | "ja_ausente" | "falha" | "ignorado";
  mensagem?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({ error: "Variáveis de ambiente do Supabase ausentes no Edge Function." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    let relatorioIdEspecifico: string | null = null;
    let forceManual = false;

    // Tenta extrair corpo da requisição se houver chamada manual
    try {
      if (req.method === "POST") {
        const body = await req.json();
        if (body?.relatorioId) {
          relatorioIdEspecifico = body.relatorioId;
        }
        if (body?.forceManual) {
          forceManual = true;
        }
      }
    } catch (_e) {
      // Requisição vazia (cron automático)
    }

    const agora = new Date();
    const vinteEQuatroHorasAtras = new Date(agora.getTime() - 24 * 60 * 60 * 1000);

    let candidateReports: any[] = [];

    if (relatorioIdEspecifico) {
      // Busca relatório específico para exclusão manual por administrador
      const { data, error } = await supabase
        .from("relatorios")
        .select(`
          id,
          cliente_id,
          nome_arquivo,
          nome_original,
          storage_path,
          arquivo_excluido,
          arquivo_exclusao_agendada_para,
          arquivo_exclusao_tentativas
        `)
        .eq("id", relatorioIdEspecifico)
        .single();

      if (error || !data) {
        return new Response(
          JSON.stringify({ success: false, error: "Relatório específico não encontrado." }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      candidateReports = [data];
    } else {
      // Busca automática dos relatórios elegíveis para limpeza (máximo 100 por execução)
      const { data, error } = await supabase
        .from("relatorios")
        .select(`
          id,
          cliente_id,
          nome_arquivo,
          nome_original,
          storage_path,
          arquivo_excluido,
          arquivo_exclusao_agendada_para,
          arquivo_exclusao_tentativas
        `)
        .eq("arquivo_excluido", false)
        .not("storage_path", "is", null)
        .lte("arquivo_exclusao_agendada_para", agora.toISOString())
        .lt("arquivo_exclusao_tentativas", 5)
        .limit(100);

      if (error) {
        console.error("[limpar-pdfs-enviados] Erro ao buscar relatórios elegíveis:", error);
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      candidateReports = data || [];
    }

    let excluidos = 0;
    let jaAusentes = 0;
    let falhas = 0;
    const resultados: ResultadoExclusao[] = [];

    for (const report of candidateReports) {
      const nomeArquivo = report.nome_arquivo || report.nome_original || "Relatorio.pdf";
      const storagePath = report.storage_path;

      // 1. Verificar histórico na fila_envios para confirmar regras de segurança
      const { data: queueItems } = await supabase
        .from("fila_envios")
        .select("id, status, enviado_em, created_at, updated_at")
        .eq("relatorio_id", report.id)
        .order("created_at", { ascending: false });

      const items = queueItems || [];

      // Se não for exclusão manual, valida estritamente a fila de envios
      if (!forceManual) {
        // Regra: Não excluir se houver fila relacionada em pendente, agendado ou processando
        const temFilaAtiva = items.some(q => ["pendente", "agendado", "processando"].includes(q.status));
        if (temFilaAtiva) {
          resultados.push({
            relatorio_id: report.id,
            nome_arquivo: nomeArquivo,
            storage_path: storagePath,
            status: "ignorado",
            mensagem: "Fila ativa em andamento"
          });
          continue;
        }

        // Regra: Deve possuir pelo menos um envio concluído (enviado, entregue, lido)
        const enviosConcluidos = items.filter(
          q => ["enviado", "entregue", "lido"].includes(q.status) && q.enviado_em != null
        );

        if (enviosConcluidos.length === 0) {
          resultados.push({
            relatorio_id: report.id,
            nome_arquivo: nomeArquivo,
            storage_path: storagePath,
            status: "ignorado",
            mensagem: "Sem envios concluídos válidos"
          });
          continue;
        }

        // Encontrar o envio mais recente
        enviosConcluidos.sort((a, b) => new Date(b.enviado_em!).getTime() - new Date(a.enviado_em!).getTime());
        const ultimoEnvio = enviosConcluidos[0];
        const dataUltimoEnvio = new Date(ultimoEnvio.enviado_em!);

        // Regra: ultimo_envio_em <= now() - 24 hours
        if (dataUltimoEnvio.getTime() > vinteEQuatroHorasAtras.getTime()) {
          resultados.push({
            relatorio_id: report.id,
            nome_arquivo: nomeArquivo,
            storage_path: storagePath,
            status: "ignorado",
            mensagem: "Último envio realizado há menos de 24 horas"
          });
          continue;
        }

        // Regra: Não excluir se o último status registrado for falhou ou cancelado
        const ultimoStatusGeral = items[0]?.status;
        if (ultimoStatusGeral === "falhou" || ultimoStatusGeral === "cancelado") {
          resultados.push({
            relatorio_id: report.id,
            nome_arquivo: nomeArquivo,
            storage_path: storagePath,
            status: "ignorado",
            mensagem: `Último envio encontra-se em status ${ultimoStatusGeral}`
          });
          continue;
        }
      }

      // 2. Executar remoção física do Supabase Storage
      let removeSuccess = false;
      let fileAlreadyMissing = false;
      let errorMsg: string | null = null;

      if (!storagePath) {
        fileAlreadyMissing = true;
        removeSuccess = true;
      } else {
        const { error: removeErr } = await supabase.storage
          .from("relatorios")
          .remove([storagePath]);

        if (removeErr) {
          errorMsg = removeErr.message || String(removeErr);
          const lowerMsg = errorMsg.toLowerCase();
          // Se o arquivo não existir mais no storage, trata como limpeza concluída com sucesso
          if (lowerMsg.includes("not found") || lowerMsg.includes("404") || lowerMsg.includes("object not found")) {
            fileAlreadyMissing = true;
            removeSuccess = true;
            errorMsg = null;
          }
        } else {
          removeSuccess = true;
        }
      }

      const dataExclusaoIso = new Date().toISOString();

      if (removeSuccess) {
        // 3. Atualizar public.relatorios preservando todos os campos de metadata
        await supabase
          .from("relatorios")
          .update({
            arquivo_excluido: true,
            arquivo_excluido_em: dataExclusaoIso,
            arquivo_exclusao_erro: null,
            storage_path: null,
            updated_at: dataExclusaoIso
          })
          .eq("id", report.id);

        // 4. Registrar em public.logs_auditoria
        await supabase.from("logs_auditoria").insert({
          acao: "exclusao_automatica_pdf",
          entidade: "relatorios",
          entidade_id: report.id,
          cliente_id: report.cliente_id,
          dados_novos: {
            nome_arquivo: nomeArquivo,
            storage_path_anterior: storagePath,
            data_agendada_exclusao: report.arquivo_exclusao_agendada_para,
            data_exclusao: dataExclusaoIso,
            resultado: fileAlreadyMissing ? "ja_ausente" : "excluido",
            origem: forceManual ? "exclusao_manual_admin" : "limpar-pdfs-enviados"
          },
          user_agent: "Supabase Edge Function (limpar-pdfs-enviados)"
        });

        if (fileAlreadyMissing) {
          jaAusentes++;
          resultados.push({
            relatorio_id: report.id,
            nome_arquivo: nomeArquivo,
            storage_path: storagePath,
            status: "ja_ausente",
            mensagem: "Arquivo físico já estava ausente no Storage"
          });
        } else {
          excluidos++;
          resultados.push({
            relatorio_id: report.id,
            nome_arquivo: nomeArquivo,
            storage_path: storagePath,
            status: "excluido",
            mensagem: "PDF excluído com sucesso do Storage 24h após envio"
          });
        }
      } else {
        // Trata falha sem interromper os demais relatórios
        const novasTentativas = (report.arquivo_exclusao_tentativas || 0) + 1;
        falhas++;

        await supabase
          .from("relatorios")
          .update({
            arquivo_excluido: false,
            arquivo_exclusao_tentativas: novasTentativas,
            arquivo_exclusao_erro: errorMsg ? errorMsg.slice(0, 500) : "Erro ao remover arquivo do storage",
            updated_at: dataExclusaoIso
          })
          .eq("id", report.id);

        await supabase.from("logs_auditoria").insert({
          acao: "exclusao_automatica_pdf_falha",
          entidade: "relatorios",
          entidade_id: report.id,
          cliente_id: report.cliente_id,
          dados_novos: {
            nome_arquivo: nomeArquivo,
            storage_path: storagePath,
            tentativa: novasTentativas,
            erro: errorMsg,
            origem: "limpar-pdfs-enviados"
          },
          user_agent: "Supabase Edge Function (limpar-pdfs-enviados)"
        });

        resultados.push({
          relatorio_id: report.id,
          nome_arquivo: nomeArquivo,
          storage_path: storagePath,
          status: "falha",
          mensagem: errorMsg || "Erro desconhecido ao remover do Storage"
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        encontrados: candidateReports.length,
        excluidos,
        ja_ausentes: jaAusentes,
        falhas,
        resultados
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[limpar-pdfs-enviados] Erro não tratado:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message || "Erro interno na Edge Function" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
