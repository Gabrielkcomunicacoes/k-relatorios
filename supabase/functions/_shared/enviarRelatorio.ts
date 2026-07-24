import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

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
export async function recalcularStatusLote(
  supabase: SupabaseClient,
  loteId: string
): Promise<void> {
  if (!loteId) return;

  const { data: queueItems, error: qErr } = await supabase
    .from("fila_envios")
    .select("status")
    .eq("lote_id", loteId);

  if (qErr || !queueItems) {
    console.error(`[recalcularStatusLote] Erro ao buscar fila para lote ${loteId}:`, qErr);
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

  // If already canceled, preserve canceled
  if (loteAtual?.status === "cancelado") {
    novoStatus = "cancelado";
  } else if (totalPendentes > 0) {
    novoStatus = temProcessando ? "processando" : "aguardando";
  } else if (totalItens > 0) {
    // All items processed
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

  console.log(`[recalcularStatusLote] Lote ${loteId} atualizado: status=${novoStatus}, enviados=${totalEnviados}/${totalItens}, falhas=${totalFalhas}`);
}

/**
 * Shared core module for sending a single PDF report via Meta WhatsApp Cloud API.
 */
export async function processarEnvioItem(
  supabase: SupabaseClient,
  filaEnvioId: string
): Promise<EnvioResult> {
  const saveFailure = async (code: string, message: string, itemCurrentTentativas: number = 0): Promise<EnvioResult> => {
    console.error(`[Falha no Envio - Fila ID: ${filaEnvioId}] Código: ${code} - Mensagem: ${message}`);

    const novasTentativas = itemCurrentTentativas + 1;

    // Update fila_envios status
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

    // Insert status history
    await supabase.from("historico_status").insert({
      fila_envio_id: filaEnvioId,
      status_anterior: "processando",
      status_novo: "falhou",
      detalhes: { error_code: code, error_message: message },
    });

    // Insert audit log
    await supabase.from("logs_auditoria").insert({
      acao: "Falha no Envio de Relatório",
      entidade: "fila_envios",
      entidade_id: filaEnvioId,
      dados_novos: { error_code: code, error_message: message },
      user_agent: "Supabase Edge Function",
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
    // 1. Fetch fila_envios
    const { data: filaItem, error: filaError } = await supabase
      .from("fila_envios")
      .select("*")
      .eq("id", filaEnvioId)
      .single();

    if (filaError || !filaItem) {
      return await saveFailure("FILA_NOT_FOUND", `Item da fila não encontrado: ${filaError?.message || ""}`);
    }

    const currentTentativas = filaItem.tentativas || 0;

    // 2. Read Meta WhatsApp credentials securely from env vars
    const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const businessAccountId = Deno.env.get("WHATSAPP_BUSINESS_ACCOUNT_ID");
    const templateName = Deno.env.get("WHATSAPP_TEMPLATE_NAME");
    const templateLanguage = Deno.env.get("WHATSAPP_TEMPLATE_LANGUAGE");
    const graphApiVersion = Deno.env.get("META_GRAPH_API_VERSION");

    if (!accessToken || !phoneNumberId || !businessAccountId || !templateName || !templateLanguage || !graphApiVersion) {
      return await saveFailure(
        "CONFIG_ERROR",
        "Erro de configuração: Credenciais do WhatsApp ausentes ou inválidas nas variáveis de ambiente.",
        currentTentativas
      );
    }

    // 3. Fetch Lote
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

    // 4. Fetch Cliente
    const { data: cliente, error: clienteError } = await supabase
      .from("clientes")
      .select("*")
      .eq("id", filaItem.cliente_id)
      .single();

    if (clienteError || !cliente) {
      return await saveFailure("CLIENTE_NOT_FOUND", "Cliente associado não foi encontrado.", currentTentativas);
    }

    // 5. Validations
    if (!cliente.ativo) {
      return await saveFailure("CLIENTE_INATIVO", "O cliente associado está marcado como inativo.", currentTentativas);
    }

    if (!cliente.possui_optin) {
      return await saveFailure("CLIENTE_SEM_OPTIN", "O cliente não possui termo de consentimento (opt-in) ativo.", currentTentativas);
    }

    if (!cliente.telefone_whatsapp) {
      return await saveFailure("TELEFONE_AUSENTE", "O cliente não possui um número de WhatsApp cadastrado.", currentTentativas);
    }

    // 6. Fetch Relatório
    let relatorio = null;
    if (filaItem.relatorio_id) {
      const { data: r } = await supabase
        .from("relatorios")
        .select("*")
        .eq("id", filaItem.relatorio_id)
        .single();
      relatorio = r;
    } else if (loteCompetencia) {
      const { data: r } = await supabase
        .from("relatorios")
        .select("*")
        .eq("cliente_id", cliente.id)
        .eq("competencia", loteCompetencia)
        .maybeSingle();
      relatorio = r;
    }

    if (!relatorio) {
      return await saveFailure(
        "RELATORIO_NOT_FOUND",
        `Nenhum relatório encontrado para o cliente.`,
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

    // Synchronize relatorio_id if not present
    if (!filaItem.relatorio_id) {
      await supabase
        .from("fila_envios")
        .update({ relatorio_id: relatorio.id })
        .eq("id", filaEnvioId);
    }

    // 7. Download PDF from Storage bucket 'relatorios'
    console.log(`[Storage] Baixando PDF para Fila Item ${filaEnvioId}: ${relatorio.storage_path}`);
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

    // 8. Upload PDF file to Meta (WhatsApp Cloud API Media Endpoint)
    console.log(`[Meta Upload] Iniciando upload de mídia PDF para Meta...`);
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
    console.log(`[Meta Upload Success] Media ID obtido: ${mediaId}`);

    // 9. Send Template Message via WhatsApp Cloud API
    const competenciaFormatada = formatDateToCompetencia(relatorio.competencia || loteCompetencia);

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
                text: cliente.empresa, // {{1}}
              },
              {
                type: "text",
                text: competenciaFormatada, // {{2}}
              },
            ],
          },
        ],
      },
    };

    console.log(`[Meta Message Send] Enviando template para WhatsApp do cliente...`);
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

    console.log(`[Meta Send Success] Mensagem disparada com sucesso! ID: ${whatsappMessageId}`);

    // 10. Update databases for successful send
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

    // Save status history
    await supabase.from("historico_status").insert({
      fila_envio_id: filaEnvioId,
      status_anterior: "processando",
      status_novo: "enviado",
      detalhes: { whatsapp_message_id: whatsappMessageId, media_id: mediaId },
    });

    // Save audit log
    await supabase.from("logs_auditoria").insert({
      acao: "Envio de Relatório Sucesso",
      entidade: "fila_envios",
      entidade_id: filaEnvioId,
      dados_novos: { whatsapp_message_id: whatsappMessageId, media_id: mediaId },
      user_agent: "Supabase Edge Function",
    });

    return {
      filaEnvioId,
      success: true,
      status: "enviado",
      whatsappMessageId
    };
  } catch (err: any) {
    console.error(`[Fatal Error - Fila ID: ${filaEnvioId}] Exception:`, err);
    return await saveFailure("EXCEPTION", err.message || "Erro desconhecido ao processar envio.");
  }
}
