import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export interface EnvioResult {
  filaEnvioId: string;
  success: boolean;
  status: string;
  whatsappMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
}

function formatDateToCompetencia(dateStr: string): string {
  if (!dateStr) return "";
  const clean = dateStr.split("T")[0];
  const parts = clean.split("-");
  if (parts.length >= 2) {
    return `${parts[1]}/${parts[0]}`;
  }
  return "";
}

/**
 * Recalculates total statistics and batch status based on fila_envios rows.
 */
async function recalcularStatusLote(
  supabase: SupabaseClient,
  loteId: string
): Promise<void> {
  if (!loteId) return;

  const { data: queueItems, error: qErr } = await supabase
    .from("fila_envios")
    .select("status")
    .eq("lote_id", loteId);

  if (qErr || !queueItems) {
    console.error(`[worker-fila-envios] Erro ao buscar fila para lote ${loteId}:`, qErr);
    return;
  }

  const { data: loteAtual } = await supabase
    .from("lotes_envio")
    .select("status")
    .eq("id", loteId)
    .single();

  const totalItens = queueItems.length;
  const totalEnviados = queueItems.filter(i =>
    ["enviado", "entregue", "lido"].includes(i.status)
  ).length;
  const totalFalhas = queueItems.filter(i => i.status === "falhou").length;
  const totalPendentes = queueItems.filter(i =>
    ["pendente", "agendado", "processando"].includes(i.status)
  ).length;
  const temProcessando = queueItems.some(i => i.status === "processando");

  let novoStatus = loteAtual?.status || "aguardando";

  if (loteAtual?.status === "cancelado") {
    novoStatus = "cancelado";
  } else if (totalPendentes > 0) {
    novoStatus = temProcessando ? "processando" : "aguardando";
  } else if (totalItens > 0) {
    novoStatus = totalFalhas > 0 ? "concluido_com_falhas" : "concluido";
  }

  await supabase
    .from("lotes_envio")
    .update({
      total_itens: totalItens,
      total_enviados: totalEnviados,
      total_falhas: totalFalhas,
      status: novoStatus,
      updated_at: new Date().toISOString()
    })
    .eq("id", loteId);

  console.log(`[worker-fila-envios] Lote ${loteId} atualizado: status=${novoStatus}, enviados=${totalEnviados}/${totalItens}, falhas=${totalFalhas}`);
}

/**
 * Core module for sending a single PDF report via Meta WhatsApp Cloud API.
 */
async function processarEnvioItem(
  supabase: SupabaseClient,
  filaEnvioId: string
): Promise<EnvioResult> {
  const saveFailure = async (code: string, message: string, itemCurrentTentativas: number = 0): Promise<EnvioResult> => {
    console.error(`[Worker Falha - Fila ID: ${filaEnvioId}] Código: ${code} - Mensagem: ${message}`);

    const novasTentativas = itemCurrentTentativas + 1;

    await supabase
      .from("fila_envios")
      .update({
        status: "falhou",
        erro_codigo: code,
        erro_mensagem: message,
        tentativas: novasTentativas,
        updated_at: new Date().toISOString(),
      })
      .eq("id", filaEnvioId);

    await supabase.from("historico_status").insert({
      fila_envio_id: filaEnvioId,
      status_anterior: "processando",
      status_novo: "falhou",
      detalhes: { error_code: code, error_message: message, via: "worker-fila-envios" },
    });

    await supabase.from("logs_auditoria").insert({
      acao: "Falha no Envio pelo Worker",
      entidade: "fila_envios",
      entidade_id: filaEnvioId,
      dados_novos: { error_code: code, error_message: message },
      user_agent: "Worker Fila Envios Edge Function",
    });

    return {
      filaEnvioId,
      success: false,
      status: "falhou",
      errorCode: code,
      errorMessage: message
    };
  };

  try {
    const { data: filaItem, error: filaError } = await supabase
      .from("fila_envios")
      .select("*")
      .eq("id", filaEnvioId)
      .single();

    if (filaError || !filaItem) {
      return await saveFailure("FILA_NOT_FOUND", `Item da fila não encontrado: ${filaError?.message || ""}`);
    }

    const currentTentativas = filaItem.tentativas || 0;

    const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const businessAccountId = Deno.env.get("WHATSAPP_BUSINESS_ACCOUNT_ID");
    const templateName = Deno.env.get("WHATSAPP_TEMPLATE_NAME");
    const templateLanguage = Deno.env.get("WHATSAPP_TEMPLATE_LANGUAGE");
    const graphApiVersion = Deno.env.get("META_GRAPH_API_VERSION");

    if (!accessToken || !phoneNumberId || !businessAccountId || !templateName || !templateLanguage || !graphApiVersion) {
      return await saveFailure(
        "CONFIG_ERROR",
        "Erro de configuração: Credenciais do WhatsApp ausentes nas variáveis de ambiente.",
        currentTentativas
      );
    }

    let loteCompetencia = "";
    if (filaItem.lote_id) {
      const { data: lote } = await supabase
        .from("lotes_envio")
        .select("competencia, status")
        .eq("id", filaItem.lote_id)
        .single();
      
      if (lote?.status === "cancelado") {
        return await saveFailure("LOTE_CANCELADO", "O lote de envio correspondente foi cancelado.", currentTentativas);
      }
      loteCompetencia = lote?.competencia || "";
    }

    const { data: cliente, error: clienteError } = await supabase
      .from("clientes")
      .select("*")
      .eq("id", filaItem.cliente_id)
      .single();

    if (clienteError || !cliente) {
      return await saveFailure("CLIENTE_NOT_FOUND", "Cliente associado não foi encontrado.", currentTentativas);
    }

    if (cliente.ativo === false) {
      return await saveFailure("CLIENTE_INATIVO", "O cliente associado está marcado como inativo.", currentTentativas);
    }

    if (cliente.possui_optin === false) {
      return await saveFailure("CLIENTE_SEM_OPTIN", "O cliente não possui termo de consentimento (opt-in) ativo.", currentTentativas);
    }

    if (!cliente.telefone_whatsapp) {
      return await saveFailure("TELEFONE_AUSENTE", "O cliente não possui um número de WhatsApp cadastrado.", currentTentativas);
    }

    if (!filaItem.relatorio_id) {
      return await saveFailure(
        "RELATORIO_ID_AUSENTE",
        "O item da fila não possui relatório vinculado.",
        currentTentativas
      );
    }

    const { data: relatorio, error: relatorioError } = await supabase
      .from("relatorios")
      .select("*")
      .eq("id", filaItem.relatorio_id)
      .single();

    if (relatorioError || !relatorio) {
      return await saveFailure(
        "RELATORIO_NOT_FOUND",
        `Nenhum relatório encontrado para o id: ${filaItem.relatorio_id}`,
        currentTentativas
      );
    }

    if (relatorio.status_validacao !== "pronto") {
      return await saveFailure(
        "RELATORIO_NAO_PRONTO",
        `O relatório associado não está com status 'pronto' (status atual: ${relatorio.status_validacao}).`,
        currentTentativas
      );
    }

    if (!relatorio.storage_path) {
      return await saveFailure("STORAGE_PATH_MISSING", "O relatório associado não possui caminho de armazenamento.", currentTentativas);
    }

    // Download PDF from Storage bucket
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from("relatorios")
      .download(relatorio.storage_path);

    if (downloadError || !fileBlob) {
      return await saveFailure(
        "DOWNLOAD_FAILED",
        `Erro ao recuperar o PDF do Storage: ${downloadError?.message || "Objeto não encontrado"}`,
        currentTentativas
      );
    }

    // Upload PDF file to Meta API
    const metaFormData = new FormData();
    metaFormData.append("messaging_product", "whatsapp");
    metaFormData.append("type", "application/pdf");
    metaFormData.append("file", fileBlob, relatorio.nome_arquivo || "RELATORIO.pdf");

    const uploadResponse = await fetch(
      `https://graph.facebook.com/${graphApiVersion}/${phoneNumberId}/media`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: metaFormData,
      }
    );

    if (!uploadResponse.ok) {
      const errText = await uploadResponse.text();
      return await saveFailure("META_UPLOAD_FAILED", `Erro de upload de arquivo na Meta: ${errText}`, currentTentativas);
    }

    const uploadResult = await uploadResponse.json();
    const mediaId = uploadResult.id;

    const competenciaFormatada = formatDateToCompetencia(relatorio.competencia || loteCompetencia);
    const nomeDestinatario =
      cliente.contato_principal?.trim() ||
      cliente.nome_contato?.trim() ||
      cliente.nome?.trim() ||
      cliente.empresa?.trim() ||
      "cliente";

    const messagePayload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: cliente.telefone_whatsapp,
      type: "template",
      template: {
        name: templateName,
        language: {
          code: templateLanguage,
        },
        components: [
          {
            type: "header",
            parameters: [
              {
                type: "document",
                document: {
                  id: mediaId,
                  filename: relatorio.nome_arquivo || "Relatorio.pdf",
                },
              },
            ],
          },
          {
            type: "body",
            parameters: [
              {
                type: "text",
                text: nomeDestinatario,
              },
              {
                type: "text",
                text: competenciaFormatada,
              },
            ],
          },
        ],
      },
    };

    const sendResponse = await fetch(
      `https://graph.facebook.com/${graphApiVersion}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messagePayload),
      }
    );

    if (!sendResponse.ok) {
      const errText = await sendResponse.text();
      return await saveFailure("META_SEND_FAILED", `Falha ao enviar mensagem de template: ${errText}`, currentTentativas);
    }

    const sendResult = await sendResponse.json();
    const whatsappMessageId = sendResult.messages?.[0]?.id;

    if (!whatsappMessageId) {
      return await saveFailure("META_NO_MESSAGE_ID", "Mensagem enviada porém Meta não retornou ID único.", currentTentativas);
    }

    await supabase
      .from("fila_envios")
      .update({
        status: "enviado",
        whatsapp_message_id: whatsappMessageId,
        enviado_em: new Date().toISOString(),
        tentativas: currentTentativas + 1,
        erro_codigo: null,
        erro_mensagem: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", filaEnvioId);

    await supabase.from("historico_status").insert({
      fila_envio_id: filaEnvioId,
      status_anterior: "processando",
      status_novo: "enviado",
      detalhes: { whatsapp_message_id: whatsappMessageId, media_id: mediaId, via: "worker-fila-envios" },
    });

    await supabase.from("logs_auditoria").insert({
      acao: "Envio Sucesso via Worker",
      entidade: "fila_envios",
      entidade_id: filaEnvioId,
      dados_novos: { whatsapp_message_id: whatsappMessageId, media_id: mediaId },
      user_agent: "Worker Fila Envios Edge Function",
    });

    return {
      filaEnvioId,
      success: true,
      status: "enviado",
      whatsappMessageId
    };
  } catch (err: any) {
    console.error(`[Worker Exception - Fila ID: ${filaEnvioId}]`, err);
    return await saveFailure("EXCEPTION", err.message || "Erro desconhecido ao processar envio no worker.");
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log(`[worker-fila-envios] Worker iniciado em ${new Date().toISOString()}`);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Variáveis de ambiente do Supabase não configuradas no Edge Functions.");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Search candidate queue items: status = 'pendente' OR (status = 'agendado' AND data_programada <= now())
    const nowIso = new Date().toISOString();

    const { data: rawCandidates, error: queryErr } = await supabase
      .from("fila_envios")
      .select("id, lote_id, cliente_id, relatorio_id, tentativas, created_at, status, data_programada")
      .in("status", ["pendente", "agendado", "processando"])
      .not("relatorio_id", "is", null)
      .is("whatsapp_message_id", null)
      .lt("tentativas", 3)
      .order("created_at", { ascending: true })
      .limit(20);

    if (queryErr) {
      console.error("[worker-fila-envios] Erro ao buscar itens na fila:", queryErr);
      throw queryErr;
    }

    const candidateItems = rawCandidates || [];
    const itensEncontrados = candidateItems.length;

    console.log(`[worker-fila-envios] Itens elegíveis encontrados na fila: ${itensEncontrados}`);

    if (itensEncontrados === 0) {
      const executionTimeMs = Date.now() - startTime;
      
      // Log audit
      await supabase.from("logs_auditoria").insert({
        acao: "Worker Executado",
        entidade: "worker-fila-envios",
        entidade_id: "worker-cron",
        dados_novos: {
          inicio: new Date(startTime).toISOString(),
          itensEncontrados: 0,
          itensProcessados: 0,
          sucessos: 0,
          falhas: 0,
          tempoExecucaoMs: executionTimeMs,
        },
        user_agent: "Worker Fila Envios Edge Function",
      });

      return new Response(
        JSON.stringify({
          success: true,
          worker: "worker-fila-envios",
          inicio: new Date(startTime).toISOString(),
          tempoExecucaoMs: executionTimeMs,
          itensEncontrados: 0,
          itensProcessados: 0,
          sucessos: 0,
          falhas: 0,
          mensagem: "Nenhum item pendente ou agendado elegível encontrado.",
          detalhes: [],
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Batch pre-fetch references to validate clients, reports, and batches efficiently
    const clienteIds = Array.from(new Set(candidateItems.map(i => i.cliente_id).filter(Boolean)));
    const relatorioIds = Array.from(new Set(candidateItems.map(i => i.relatorio_id).filter(Boolean)));
    const loteIds = Array.from(new Set(candidateItems.map(i => i.lote_id).filter(Boolean)));

    const [{ data: clientes }, { data: relatorios }, { data: lotes }] = await Promise.all([
      supabase.from("clientes").select("id, ativo, possui_optin, telefone_whatsapp").in("id", clienteIds),
      supabase.from("relatorios").select("id, status_validacao, storage_path").in("id", relatorioIds),
      supabase.from("lotes_envio").select("id, status").in("id", loteIds),
    ]);

    const clientesMap = new Map((clientes || []).map(c => [c.id, c]));
    const relatoriosMap = new Map((relatorios || []).map(r => [r.id, r]));
    const lotesMap = new Map((lotes || []).map(l => [l.id, l]));

    const results: EnvioResult[] = [];
    const affectedLoteIds = new Set<string>();

    // 2 & 3. Atomic Lock & Filter & Process
    for (const item of candidateItems) {
      if (item.lote_id) affectedLoteIds.add(item.lote_id);

      // Validate client, report and batch status in-memory before locking
      const cliente = clientesMap.get(item.cliente_id);
      const relatorio = relatoriosMap.get(item.relatorio_id);
      const lote = item.lote_id ? lotesMap.get(item.lote_id) : null;

      if (lote && lote.status === "cancelado") {
        console.warn(`[worker-fila-envios] Item ${item.id} cancelado pois lote está cancelado.`);
        await supabase
          .from("fila_envios")
          .update({ status: "falhou", erro_codigo: "LOTE_CANCELADO", erro_mensagem: "Lote de envio correspondente foi cancelado.", updated_at: new Date().toISOString() })
          .eq("id", item.id);
        results.push({ filaEnvioId: item.id, success: false, status: "falhou", errorCode: "LOTE_CANCELADO", errorMessage: "Lote cancelado" });
        continue;
      }

      if (!cliente || cliente.ativo === false || cliente.possui_optin === false || !cliente.telefone_whatsapp) {
        const reason = !cliente ? "Cliente não encontrado" : !cliente.ativo ? "Cliente inativo" : !cliente.possui_optin ? "Cliente sem opt-in" : "Telefone de WhatsApp ausente";
        await supabase
          .from("fila_envios")
          .update({ status: "falhou", erro_codigo: "CLIENTE_INVALIDO", erro_mensagem: reason, updated_at: new Date().toISOString() })
          .eq("id", item.id);
        results.push({ filaEnvioId: item.id, success: false, status: "falhou", errorCode: "CLIENTE_INVALIDO", errorMessage: reason });
        continue;
      }

      if (!relatorio || relatorio.status_validacao !== "pronto" || !relatorio.storage_path) {
        const reason = !relatorio ? "Relatório não encontrado" : relatorio.status_validacao !== "pronto" ? `Relatório não está pronto (${relatorio.status_validacao})` : "Caminho do arquivo no Storage ausente";
        await supabase
          .from("fila_envios")
          .update({ status: "falhou", erro_codigo: "RELATORIO_INVALIDO", erro_mensagem: reason, updated_at: new Date().toISOString() })
          .eq("id", item.id);
        results.push({ filaEnvioId: item.id, success: false, status: "falhou", errorCode: "RELATORIO_INVALIDO", errorMessage: reason });
        continue;
      }

      // ATOMIC CONCURRENCY LOCK: lock item from 'pendente' or 'agendado' to 'processando'
      const { data: lockResult, error: lockErr } = await supabase
        .from("fila_envios")
        .update({
          status: "processando",
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id)
        .in("status", ["pendente", "agendado"])
        .select("id");

      if (lockErr || !lockResult || lockResult.length === 0) {
        console.warn(`[worker-fila-envios] Concorrência: Item ${item.id} já bloqueado por outro worker. Ignorando.`);
        results.push({
          filaEnvioId: item.id,
          success: false,
          status: "bloqueado_concorrencia",
          errorCode: "CONCURRENCY_LOCK_FAILED"
        });
        continue;
      }

      console.log(`[worker-fila-envios] Item ${item.id} bloqueado com sucesso. Executando envio...`);

      // 4. Send email/WhatsApp report using existing logic
      const itemResult = await processarEnvioItem(supabase, item.id);
      results.push(itemResult);
    }

    // Recalculate status for all affected batches
    for (const loteId of affectedLoteIds) {
      await recalcularStatusLote(supabase, loteId);
    }

    const sucessos = results.filter(r => r.success).length;
    const falhas = results.filter(r => !r.success && r.status !== "bloqueado_concorrencia").length;
    const itensProcessados = results.filter(r => r.status !== "bloqueado_concorrencia").length;
    const executionTimeMs = Date.now() - startTime;

    console.log(`[worker-fila-envios] Finalizado em ${executionTimeMs}ms. Encontrados=${itensEncontrados}, Processados=${itensProcessados}, Sucessos=${sucessos}, Falhas=${falhas}`);

    // Audit log
    await supabase.from("logs_auditoria").insert({
      acao: "Worker Executado",
      entidade: "worker-fila-envios",
      entidade_id: "worker-cron",
      dados_novos: {
        inicio: new Date(startTime).toISOString(),
        itensEncontrados,
        itensProcessados,
        sucessos,
        falhas,
        tempoExecucaoMs: executionTimeMs,
      },
      user_agent: "Worker Fila Envios Edge Function",
    });

    return new Response(
      JSON.stringify({
        success: true,
        worker: "worker-fila-envios",
        inicio: new Date(startTime).toISOString(),
        tempoExecucaoMs: executionTimeMs,
        itensEncontrados,
        itensProcessados,
        sucessos,
        falhas,
        detalhes: results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[worker-fila-envios] Erro fatal no worker:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message || "Erro interno no worker de fila de envios" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
