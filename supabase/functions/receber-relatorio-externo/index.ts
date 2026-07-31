import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Calculates SHA-256 hash of an ArrayBuffer
 */
async function calculateSHA256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Sanitizes a filename safely
 */
function sanitizeFilename(filename: string): string {
  const nameOnly = filename.replace(/^.*[\\\/]/, '');
  return nameOnly
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_");
}

/**
 * Validates authentication token securely
 */
async function validateToken(
  supabaseAdmin: SupabaseClient,
  rawToken: string
): Promise<boolean> {
  if (!rawToken) return false;
  const token = rawToken.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  // 1. Check environment variables
  const envSecret = Deno.env.get("RELATORIOS_INTEGRATION_SECRET") || "";
  const envSecretPrev = Deno.env.get("RELATORIOS_INTEGRATION_SECRET_PREVIOUS") || "";

  if (envSecret && token === envSecret) return true;
  if (envSecretPrev && token === envSecretPrev) return true;

  // 2. Check DB configuration table as fallback
  try {
    const { data: config } = await supabaseAdmin
      .from("configuracoes_integracao")
      .select("segredo_atual, segredo_anterior")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (config) {
      if (config.segredo_atual && token === config.segredo_atual) return true;
      if (config.segredo_anterior && token === config.segredo_anterior) return true;
    }
  } catch (err) {
    console.warn("[receber-relatorio-externo] Erro ao consultar configuracoes_integracao:", err);
  }

  return false;
}

/**
 * Logs integration execution safely without leaking sensitive data
 */
async function recordLog(
  supabaseAdmin: SupabaseClient,
  logData: {
    origem_sistema?: string;
    identificador_origem?: string;
    codigo_cliente?: string;
    relatorio_id?: string | null;
    lote_id?: string | null;
    status: string;
    http_status: number;
    erro_codigo?: string | null;
    erro_mensagem?: string | null;
    metadata?: any;
  }
) {
  try {
    await supabaseAdmin.from("logs_integracao_relatorios").insert({
      origem_sistema: logData.origem_sistema || "sistema_externo",
      identificador_origem: logData.identificador_origem || null,
      codigo_cliente: logData.codigo_cliente || null,
      relatorio_id: logData.relatorio_id || null,
      lote_id: logData.lote_id || null,
      status: logData.status,
      http_status: logData.http_status,
      erro_codigo: logData.erro_codigo || null,
      erro_mensagem: logData.erro_mensagem || null,
      metadata: logData.metadata || null,
      processado_em: new Date().toISOString()
    });
  } catch (err) {
    console.error("[receber-relatorio-externo] Erro ao gravar log de integração:", err);
  }
}

serve(async (req) => {
  // CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, code: "METODO_NAO_PERMITIDO", error: "Apenas o método POST é suportado." }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({ success: false, code: "ERRO_CONFIGURACAO", error: "Variáveis do Supabase não configuradas." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // 1. AUTENTICAÇÃO
  const authHeader = req.headers.get("Authorization") || "";
  const isValidAuth = await validateToken(supabaseAdmin, authHeader);

  if (!isValidAuth) {
    await recordLog(supabaseAdmin, {
      status: "erro_autenticacao",
      http_status: 401,
      erro_codigo: "UNAUTHORIZED",
      erro_mensagem: "Token de autorização de integração inválido ou ausente."
    });

    return new Response(
      JSON.stringify({
        success: false,
        code: "UNAUTHORIZED",
        error: "Token de autorização de integração inválido ou ausente."
      }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 2. PROCESSAR MULTIPART / FORM-DATA
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (err: any) {
    await recordLog(supabaseAdmin, {
      status: "erro_payload",
      http_status: 400,
      erro_codigo: "MULTIPART_INVALIDO",
      erro_mensagem: `Falha ao ler multipart/form-data: ${err?.message}`
    });

    return new Response(
      JSON.stringify({
        success: false,
        code: "MULTIPART_INVALIDO",
        error: "A requisição deve ser enviada como multipart/form-data válido."
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const file = formData.get("arquivo") as File | null;
  const codigoClienteRaw = (formData.get("codigo_cliente") as string) || "";
  const identificadorOrigem = (formData.get("identificador_origem") as string) || "";
  const periodoInicio = (formData.get("periodo_inicio") as string) || "";
  const periodoFim = (formData.get("periodo_fim") as string) || "";
  const periodicidade = (formData.get("periodicidade") as string) || "mensal";
  const tipoRelatorio = (formData.get("tipo_relatorio") as string) || "desempenho";

  // Opcionais
  const enviarAutoRaw = formData.get("enviar_automaticamente");
  const enviarAutomaticamente = enviarAutoRaw === "true" || enviarAutoRaw === true || enviarAutoRaw === "1";
  const dataProgramada = (formData.get("data_programada") as string) || null;
  const nomeOriginal = (formData.get("nome_original") as string) || file?.name || "relatorio.pdf";
  const origemSistema = (formData.get("origem_sistema") as string) || "sistema_externo";
  const loteExternoId = (formData.get("lote_externo_id") as string) || null;
  const finalizarLoteRaw = formData.get("finalizar_lote");
  const finalizarLote = finalizarLoteRaw === "true" || finalizarLoteRaw === true || finalizarLoteRaw === "1";
  
  let metadataObj: any = null;
  const metadataRaw = formData.get("metadata");
  if (metadataRaw) {
    try {
      metadataObj = typeof metadataRaw === "string" ? JSON.parse(metadataRaw) : metadataRaw;
    } catch (_) {
      metadataObj = { raw: String(metadataRaw) };
    }
  }

  const codigoCliente = codigoClienteRaw.trim();

  // Validação de parâmetros obrigatórios
  if (!file || !codigoCliente || !identificadorOrigem || !periodoInicio || !periodoFim) {
    const missing: string[] = [];
    if (!file) missing.push("arquivo");
    if (!codigoCliente) missing.push("codigo_cliente");
    if (!identificadorOrigem) missing.push("identificador_origem");
    if (!periodoInicio) missing.push("periodo_inicio");
    if (!periodoFim) missing.push("periodo_fim");

    await recordLog(supabaseAdmin, {
      origem_sistema: origemSistema,
      identificador_origem: identificadorOrigem,
      codigo_cliente: codigoCliente,
      status: "erro_validacao",
      http_status: 400,
      erro_codigo: "DADOS_OBRIGATORIOS_AUSENTES",
      erro_mensagem: `Parâmetros obrigatórios ausentes: ${missing.join(", ")}`
    });

    return new Response(
      JSON.stringify({
        success: false,
        code: "DADOS_OBRIGATORIOS_AUSENTES",
        error: `Os seguintes campos obrigatórios são necessários: ${missing.join(", ")}.`
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 3. VALIDAÇÃO DO ARQUIVO PDF
  if (file.size === 0) {
    return new Response(
      JSON.stringify({ success: false, code: "ARQUIVO_VAZIO", error: "O arquivo PDF enviado está vazio (0 bytes)." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (file.size > 52428800) { // 50 MB
    return new Response(
      JSON.stringify({ success: false, code: "ARQUIVO_EXCEDE_TAMANHO", error: "O arquivo PDF excede o tamanho máximo permitido (50MB)." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const fileBuffer = await file.arrayBuffer();
  const fileBytes = new Uint8Array(fileBuffer);

  // Verificar assinatura PDF (%PDF-)
  const pdfHeader = String.fromCharCode(...fileBytes.slice(0, 5));
  const isPdf = pdfHeader === "%PDF-" || file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";

  if (!isPdf || pdfHeader !== "%PDF-") {
    await recordLog(supabaseAdmin, {
      origem_sistema: origemSistema,
      identificador_origem: identificadorOrigem,
      codigo_cliente: codigoCliente,
      status: "erro_validacao",
      http_status: 400,
      erro_codigo: "TIPO_ARQUIVO_INVALIDO",
      erro_mensagem: "O arquivo enviado não é um documento PDF válido."
    });

    return new Response(
      JSON.stringify({ success: false, code: "TIPO_ARQUIVO_INVALIDO", error: "O arquivo enviado não é um PDF válido (cabeçalho %PDF- não encontrado)." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 4. LOCALIZAR CLIENTE
  const { data: cliente, error: clientErr } = await supabaseAdmin
    .from("clientes")
    .select("id, codigo_cliente, empresa, telefone_whatsapp, ativo, possui_optin")
    .ilike("codigo_cliente", codigoCliente)
    .maybeSingle();

  if (clientErr || !cliente) {
    await recordLog(supabaseAdmin, {
      origem_sistema: origemSistema,
      identificador_origem: identificadorOrigem,
      codigo_cliente: codigoCliente,
      status: "erro_cliente",
      http_status: 404,
      erro_codigo: "CLIENTE_NAO_ENCONTRADO",
      erro_mensagem: `Cliente com código '${codigoCliente}' não encontrado no cadastro.`
    });

    return new Response(
      JSON.stringify({
        success: false,
        code: "CLIENTE_NAO_ENCONTRADO",
        error: `Cliente com código '${codigoCliente}' não foi localizado no cadastro do K Relatórios.`
      }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 5. IDEMPOTÊNCIA POR ORIGEM + IDENTIFICADOR EXTERNO
  const { data: existingReport } = await supabaseAdmin
    .from("relatorios")
    .select("id, cliente_id, storage_path")
    .eq("origem_sistema", origemSistema)
    .eq("identificador_origem", identificadorOrigem)
    .maybeSingle();

  if (existingReport) {
    await recordLog(supabaseAdmin, {
      origem_sistema: origemSistema,
      identificador_origem: identificadorOrigem,
      codigo_cliente: codigoCliente,
      relatorio_id: existingReport.id,
      status: "duplicado",
      http_status: 200,
      metadata: { duplicidade: "origem_identificador" }
    });

    return new Response(
      JSON.stringify({
        success: true,
        duplicate: true,
        cliente_id: existingReport.cliente_id,
        relatorio_id: existingReport.id,
        storage_path: existingReport.storage_path,
        lote_id: null,
        fila_envio_id: null,
        envio_solicitado: false,
        status: "armazenado",
        message: "Relatório já recebido e registrado anteriormente (requisição duplicada)."
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 6. VERIFICAÇÃO DE HASH DO PDF
  const fileHash = await calculateSHA256Hex(fileBuffer);

  const { data: existingHashReport } = await supabaseAdmin
    .from("relatorios")
    .select("id, cliente_id, storage_path")
    .eq("cliente_id", cliente.id)
    .eq("hash_arquivo", fileHash)
    .maybeSingle();

  if (existingHashReport) {
    await recordLog(supabaseAdmin, {
      origem_sistema: origemSistema,
      identificador_origem: identificadorOrigem,
      codigo_cliente: codigoCliente,
      relatorio_id: existingHashReport.id,
      status: "duplicado",
      http_status: 200,
      metadata: { duplicidade: "hash_arquivo", hash: fileHash }
    });

    return new Response(
      JSON.stringify({
        success: true,
        duplicate: true,
        cliente_id: existingHashReport.cliente_id,
        relatorio_id: existingHashReport.id,
        storage_path: existingHashReport.storage_path,
        lote_id: null,
        fila_envio_id: null,
        envio_solicitado: false,
        status: "armazenado",
        message: "Conteúdo do arquivo PDF já existe para este cliente no sistema."
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 7. STORAGE UPLOAD
  const anoMes = periodoFim ? periodoFim.substring(0, 7) : new Date().toISOString().substring(0, 7);
  const reportId = crypto.randomUUID();
  const sanitizedFileName = sanitizeFilename(nomeOriginal);
  const storagePath = `${anoMes}/${cliente.codigo_cliente}/${reportId}_${sanitizedFileName}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from("relatorios")
    .upload(storagePath, fileBytes, {
      contentType: "application/pdf",
      cacheControl: "3600",
      upsert: false
    });

  if (uploadError) {
    await recordLog(supabaseAdmin, {
      origem_sistema: origemSistema,
      identificador_origem: identificadorOrigem,
      codigo_cliente: codigoCliente,
      status: "erro_storage",
      http_status: 500,
      erro_codigo: "FALHA_STORAGE_UPLOAD",
      erro_mensagem: uploadError.message
    });

    return new Response(
      JSON.stringify({
        success: false,
        code: "FALHA_STORAGE_UPLOAD",
        error: `Falha ao salvar o PDF no armazenamento: ${uploadError.message}`
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 8. REGISTRO EM public.relatorios
  // Converter periodo_fim para primeiro dia do mês para a coluna 'competencia'
  let competenciaDate = `${anoMes}-01`;

  try {
    const { error: insertErr } = await supabaseAdmin
      .from("relatorios")
      .insert({
        id: reportId,
        cliente_id: cliente.id,
        codigo_cliente: cliente.codigo_cliente,
        competencia: competenciaDate,
        tipo_relatorio: tipoRelatorio,
        nome_arquivo: sanitizedFileName,
        nome_original: nomeOriginal,
        storage_path: storagePath,
        tamanho_bytes: file.size,
        mime_type: "application/pdf",
        hash_arquivo: fileHash,
        status_validacao: "pronto",
        periodo_inicio: periodoInicio,
        periodo_fim: periodoFim,
        periodicidade: periodicidade,
        origem_sistema: origemSistema,
        identificador_origem: identificadorOrigem,
        recebido_via_integracao: true,
        lote_externo_id: loteExternoId
      });

    if (insertErr) {
      throw insertErr;
    }
  } catch (dbErr: any) {
    console.error("[receber-relatorio-externo] Erro no INSERT em public.relatorios, removendo arquivo do Storage:", dbErr);
    // Rollback no Storage
    try {
      await supabaseAdmin.storage.from("relatorios").remove([storagePath]);
    } catch (_) {}

    await recordLog(supabaseAdmin, {
      origem_sistema: origemSistema,
      identificador_origem: identificadorOrigem,
      codigo_cliente: codigoCliente,
      status: "erro_banco",
      http_status: 500,
      erro_codigo: "FALHA_INSERT_BANCO",
      erro_mensagem: dbErr?.message || String(dbErr)
    });

    return new Response(
      JSON.stringify({
        success: false,
        code: "FALHA_INSERT_BANCO",
        error: `Falha ao registrar relatório no banco de dados: ${dbErr?.message || dbErr}`
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 9. VALIDAÇÃO DE ELEGIBILIDADE DO CLIENTE PARA DISPARO AUTOMÁTICO
  const cleanPhone = cliente.telefone_whatsapp ? cliente.telefone_whatsapp.replace(/\D/g, "") : "";
  const isEligible = cliente.ativo && cleanPhone.length > 0 && cliente.possui_optin;

  let avisoElegibilidade: string | null = null;
  if (!isEligible) {
    const motivos: string[] = [];
    if (!cliente.ativo) motivos.push("cliente inativo");
    if (cleanPhone.length === 0) motivos.push("sem número de WhatsApp cadastrado");
    if (!cliente.possui_optin) motivos.push("sem termo de consentimento (opt-in) ativo");

    avisoElegibilidade = `Relatório armazenado com sucesso, mas o disparo automático não foi enfileirado pois o cliente possui pendências: ${motivos.join(", ")}.`;
  }

  // 10. PROCESSAMENTO DE ENVIO AUTOMÁTICO
  let createdLoteId: string | null = null;
  let createdFilaId: string | null = null;
  let envioSolicitado = false;
  let finalStatus = "armazenado";

  if (enviarAutomaticamente && isEligible) {
    envioSolicitado = true;
    const isAgendado = Boolean(dataProgramada);
    finalStatus = isAgendado ? "agendado" : "enfileirado";

    // A. LOTE COM LOTE_EXTERNO_ID OU INDIVIDUAL
    if (loteExternoId) {
      const { data: existingLote } = await supabaseAdmin
        .from("lotes_envio")
        .select("id")
        .eq("lote_externo_id", loteExternoId)
        .in("status", ["rascunho", "agendado", "aguardando"])
        .maybeSingle();

      if (existingLote) {
        createdLoteId = existingLote.id;
      } else {
        const batchName = `Lote Externo - ${loteExternoId}`;
        const { data: newLote, error: loteErr } = await supabaseAdmin
          .from("lotes_envio")
          .insert({
            nome: batchName,
            competencia: competenciaDate,
            modalidade: isAgendado ? "agendado" : "imediato",
            data_programada: dataProgramada || null,
            status: isAgendado ? "agendado" : "aguardando",
            lote_externo_id: loteExternoId
          })
          .select("id")
          .single();

        if (!loteErr && newLote) {
          createdLoteId = newLote.id;
        }
      }
    } else {
      // Lote individual
      const batchName = `Envio Automático - ${cliente.empresa}`;
      const { data: newLote, error: loteErr } = await supabaseAdmin
        .from("lotes_envio")
        .insert({
          nome: batchName,
          competencia: competenciaDate,
          modalidade: isAgendado ? "agendado" : "imediato",
          data_programada: dataProgramada || null,
          status: isAgendado ? "agendado" : "aguardando"
        })
        .select("id")
        .single();

      if (!loteErr && newLote) {
        createdLoteId = newLote.id;
      }
    }

    // B. CRIAR ITEM NA FILA DE ENVIOS
    if (createdLoteId) {
      const { data: newFila, error: filaErr } = await supabaseAdmin
        .from("fila_envios")
        .insert({
          lote_id: createdLoteId,
          cliente_id: cliente.id,
          relatorio_id: reportId,
          telefone_destino: cleanPhone,
          data_programada: dataProgramada || null,
          status: isAgendado ? "agendado" : "pendente"
        })
        .select("id")
        .single();

      if (!filaErr && newFila) {
        createdFilaId = newFila.id;
      }

      // Atualizar estatísticas do lote
      const { data: queueCount } = await supabaseAdmin
        .from("fila_envios")
        .select("id", { count: "exact", head: true })
        .eq("lote_id", createdLoteId);

      await supabaseAdmin
        .from("lotes_envio")
        .update({
          total_itens: queueCount || 1,
          total_validos: queueCount || 1
        })
        .eq("id", createdLoteId);

      // C. DISPARAR PROCESSADOR SE IMEDIATO E (!LOTE_EXTERNO OU FINALIZAR_LOTE)
      if (!isAgendado && (!loteExternoId || finalizarLote)) {
        try {
          // Invocar processar-fila-whatsapp de forma assíncrona
          fetch(`${supabaseUrl}/functions/v1/processar-fila-whatsapp`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseServiceKey}`
            },
            body: JSON.stringify({ loteId: createdLoteId })
          }).catch((err) => console.warn("[receber-relatorio-externo] Erro no disparo em background do lote:", err));
        } catch (procErr) {
          console.warn("[receber-relatorio-externo] Falha ao acionar processar-fila-whatsapp:", procErr);
        }
      }
    }
  }

  // 11. REGISTRAR SUCESSO NO LOG
  await recordLog(supabaseAdmin, {
    origem_sistema: origemSistema,
    identificador_origem: identificadorOrigem,
    codigo_cliente: codigoCliente,
    relatorio_id: reportId,
    lote_id: createdLoteId,
    status: "sucesso",
    http_status: 201,
    metadata: {
      enviar_automaticamente: enviarAutomaticamente,
      envio_solicitado: envioSolicitado,
      status_final: finalStatus,
      lote_externo_id: loteExternoId
    }
  });

  // 12. RETORNO DE SUCESSO HTTP 201
  return new Response(
    JSON.stringify({
      success: true,
      duplicate: false,
      cliente_id: cliente.id,
      relatorio_id: reportId,
      storage_path: storagePath,
      lote_id: createdLoteId,
      fila_envio_id: createdFilaId,
      envio_solicitado: envioSolicitado,
      status: finalStatus,
      ...(avisoElegibilidade ? { aviso: avisoElegibilidade } : {})
    }),
    { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
