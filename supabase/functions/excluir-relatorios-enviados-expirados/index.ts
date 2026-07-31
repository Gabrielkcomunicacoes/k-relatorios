import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export interface ExclusaoResult {
  relatorio_id: string;
  nome_arquivo?: string;
  status: "excluido" | "ignorado" | "erro_storage" | "erro_banco" | "fila_ativa" | "envio_nao_concluido";
  motivo?: string;
}

/**
 * Recalculates batch statistics and archives empty batches.
 */
async function recalcularEArquivarLote(
  supabase: SupabaseClient,
  loteId: string
): Promise<void> {
  if (!loteId) return;

  const { data: queueItems, error } = await supabase
    .from("fila_envios")
    .select("status")
    .eq("lote_id", loteId);

  if (error || !queueItems) {
    console.error(`[excluir-relatorios] Erro ao buscar fila do lote ${loteId}:`, error);
    return;
  }

  const totalItens = queueItems.length;
  const totalEnviados = queueItems.filter(i =>
    ["enviado", "entregue", "lido"].includes(i.status)
  ).length;
  const totalFalhas = queueItems.filter(i => i.status === "falhou").length;

  if (totalItens === 0) {
    // Batch is completely empty now -> archive batch
    await supabase
      .from("lotes_envio")
      .update({
        total_itens: 0,
        total_enviados: 0,
        total_falhas: 0,
        archived_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", loteId);

    console.log(`[excluir-relatorios] Lote ${loteId} ficou sem itens e foi arquivado (archived_at setado).`);
  } else {
    await supabase
      .from("lotes_envio")
      .update({
        total_itens: totalItens,
        total_enviados: totalEnviados,
        total_falhas: totalFalhas,
        updated_at: new Date().toISOString()
      })
      .eq("id", loteId);

    console.log(`[excluir-relatorios] Lote ${loteId} recalculado: total=${totalItens}, enviados=${totalEnviados}, falhas=${totalFalhas}`);
  }
}

/**
 * Executes safe 10-step deletion for a single report.
 */
async function processarExclusaoRelatorio(
  supabase: SupabaseClient,
  relatorio: any,
  isManual: boolean = false,
  usuarioId?: string
): Promise<ExclusaoResult> {
  const relatorioId = relatorio.id;
  const nomeArquivo = relatorio.nome_arquivo || relatorio.nome_original || "relatorio.pdf";

  // 1. Fetch all queue items for this report
  const { data: queueItems, error: qErr } = await supabase
    .from("fila_envios")
    .select("id, lote_id, status, enviado_em, created_at")
    .eq("relatorio_id", relatorioId)
    .order("created_at", { ascending: false });

  if (qErr) {
    console.error(`[excluir-relatorios] Erro ao buscar fila_envios do relatório ${relatorioId}:`, qErr);
    return { relatorio_id: relatorioId, nome_arquivo: nomeArquivo, status: "erro_banco", motivo: `Erro na consulta da fila: ${qErr.message}` };
  }

  const items = queueItems || [];

  // 2. SAFETY CHECK: Do NOT delete if there are active queue items ('pendente', 'agendado', 'processando')
  const temFilaAtiva = items.some(i => ["pendente", "agendado", "processando"].includes(i.status));
  if (temFilaAtiva) {
    console.warn(`[excluir-relatorios] Relatório ${relatorioId} possui itens ativos na fila. Ignorando.`);
    return { relatorio_id: relatorioId, nome_arquivo: nomeArquivo, status: "fila_ativa", motivo: "Possui envios pendentes ou em processamento na fila" };
  }

  // 3. SAFETY CHECK: Determine most recent send attempt and check its status & date
  const itemsCompletados = items.filter(i => ["enviado", "entregue", "lido", "falhou", "cancelado"].includes(i.status));
  const latestQueueItem = itemsCompletados[0] || items[0];

  if (!latestQueueItem) {
    // Has no send attempts at all
    if (!isManual) {
      return { relatorio_id: relatorioId, nome_arquivo: nomeArquivo, status: "ignorado", motivo: "Relatório não possui registro de envio" };
    }
  } else {
    const ultimoStatus = latestQueueItem.status;

    // Do NOT delete if the most recent send failed or was cancelled
    if (["falhou", "cancelado"].includes(ultimoStatus)) {
      return { relatorio_id: relatorioId, nome_arquivo: nomeArquivo, status: "envio_nao_concluido", motivo: `Último envio está com status '${ultimoStatus}'` };
    }

    if (!["enviado", "entregue", "lido"].includes(ultimoStatus) && !isManual) {
      return { relatorio_id: relatorioId, nome_arquivo: nomeArquivo, status: "envio_nao_concluido", motivo: `Status do último envio (${ultimoStatus}) não é 'enviado', 'entregue' ou 'lido'` };
    }

    // Determine actual send date: priority to enviado_em
    let dataUltimoEnvioStr = latestQueueItem.enviado_em;

    if (!dataUltimoEnvioStr) {
      // Fallback: check historico_status for status_novo = 'enviado'
      const { data: histEnviado } = await supabase
        .from("historico_status")
        .select("created_at")
        .in("fila_envio_id", items.map(i => i.id))
        .eq("status_novo", "enviado")
        .order("created_at", { ascending: false })
        .limit(1);

      if (histEnviado && histEnviado.length > 0) {
        dataUltimoEnvioStr = histEnviado[0].created_at;
      } else {
        dataUltimoEnvioStr = latestQueueItem.created_at;
      }
    }

    const dataUltimoEnvio = new Date(dataUltimoEnvioStr);
    const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Rule: date of most recent send <= now() - 7 days
    if (!isManual && dataUltimoEnvio > seteDiasAtras) {
      return { relatorio_id: relatorioId, nome_arquivo: nomeArquivo, status: "ignorado", motivo: `Enviado em ${dataUltimoEnvio.toISOString()} (há menos de 7 dias)` };
    }
  }

  // Collect related IDs & info
  const queueItemIds = items.map(i => i.id);
  const loteIds = Array.from(new Set(items.map(i => i.lote_id).filter(Boolean)));
  const storagePath = relatorio.storage_path;

  // 4. Register Audit Log BEFORE deletion
  await supabase.from("logs_auditoria").insert({
    usuario_id: usuarioId || null,
    acao: isManual ? "exclusao_manual_relatorio" : "exclusao_automatica_relatorio",
    entidade: "relatorios",
    entidade_id: relatorioId,
    dados_novos: {
      relatorio_id: relatorioId,
      cliente_id: relatorio.cliente_id,
      nome_arquivo: nomeArquivo,
      competencia: relatorio.competencia,
      storage_path: storagePath,
      data_ultimo_envio: latestQueueItem?.enviado_em || latestQueueItem?.created_at || null,
      lote_ids: loteIds,
      quantidade_itens_fila: items.length,
      origem: "Edge Function",
      motivo: isManual ? "Exclusão manual solicitada por administrador" : "Enviado há mais de 7 dias"
    },
    user_agent: "excluir-relatorios-enviados-expirados Edge Function"
  });

  // 5. Delete related historico_status
  if (queueItemIds.length > 0) {
    const { error: hErr } = await supabase
      .from("historico_status")
      .delete()
      .in("fila_envio_id", queueItemIds);

    if (hErr) {
      console.warn(`[excluir-relatorios] Aviso ao excluir historico_status do relatório ${relatorioId}:`, hErr);
    }
  }

  // 6. Delete related fila_envios
  const { error: fErr } = await supabase
    .from("fila_envios")
    .delete()
    .eq("relatorio_id", relatorioId);

  if (fErr) {
    console.error(`[excluir-relatorios] Erro ao excluir fila_envios do relatório ${relatorioId}:`, fErr);
    return { relatorio_id: relatorioId, nome_arquivo: nomeArquivo, status: "erro_banco", motivo: `Erro ao excluir fila_envios: ${fErr.message}` };
  }

  // 7. Delete PDF file from Storage bucket 'relatorios'
  let storageJaAusente = false;
  if (storagePath) {
    const { error: stErr } = await supabase.storage
      .from("relatorios")
      .remove([storagePath]);

    if (stErr) {
      const errMsg = stErr.message || String(stErr);
      if (errMsg.toLowerCase().includes("not found") || errMsg.toLowerCase().includes("404") || errMsg.toLowerCase().includes("does not exist")) {
        console.log(`[excluir-relatorios] Arquivo ${storagePath} já estava ausente no Storage. Prosseguindo com a limpeza do banco.`);
        storageJaAusente = true;
      } else {
        console.error(`[excluir-relatorios] Erro real no Storage para ${storagePath}:`, stErr);
        // Do NOT delete public.relatorios record if there is an unexpected storage error
        return { relatorio_id: relatorioId, nome_arquivo: nomeArquivo, status: "erro_storage", motivo: `Erro de remoção no Storage: ${errMsg}` };
      }
    }
  }

  // 8. Delete record from public.relatorios
  const { error: rErr } = await supabase
    .from("relatorios")
    .delete()
    .eq("id", relatorioId);

  if (rErr) {
    console.error(`[excluir-relatorios] Erro ao excluir registro public.relatorios (${relatorioId}):`, rErr);
    return { relatorio_id: relatorioId, nome_arquivo: nomeArquivo, status: "erro_banco", motivo: `Erro ao excluir registro no banco: ${rErr.message}` };
  }

  // 9. Recalculate affected batches
  for (const loteId of loteIds) {
    await recalcularEArquivarLote(supabase, loteId);
  }

  console.log(`[excluir-relatorios] Relatório ${relatorioId} (${nomeArquivo}) excluído com sucesso. Storage ausente: ${storageJaAusente}`);

  return {
    relatorio_id: relatorioId,
    nome_arquivo: nomeArquivo,
    status: "excluido",
    motivo: storageJaAusente ? "Excluído com sucesso (arquivo_ja_ausente no Storage)" : "Excluído com sucesso"
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Variáveis de ambiente do Supabase não configuradas no Edge Function.");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const manualRelatorioId = body.relatorioId;
    const usuarioId = body.usuarioId;

    let relatoriosParaProcessar: any[] = [];

    if (manualRelatorioId) {
      // Manual trigger for a specific report
      const { data: singleRep, error: sErr } = await supabase
        .from("relatorios")
        .select("*")
        .eq("id", manualRelatorioId)
        .single();

      if (sErr || !singleRep) {
        return new Response(
          JSON.stringify({
            success: false,
            encontrados: 0,
            excluidos: 0,
            ignorados: 0,
            falhas: 1,
            resultados: [{ relatorio_id: manualRelatorioId, status: "erro_banco", motivo: "Relatório não encontrado no banco de dados." }]
          }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      relatoriosParaProcessar = [singleRep];
    } else {
      // Automatic routine: select candidate reports
      // 1. Fetch all reports limit 100
      const { data: candidates, error: cErr } = await supabase
        .from("relatorios")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(100);

      if (cErr) {
        throw cErr;
      }
      relatoriosParaProcessar = candidates || [];
    }

    const encontrados = relatoriosParaProcessar.length;
    const resultados: ExclusaoResult[] = [];

    for (const relatorio of relatoriosParaProcessar) {
      const res = await processarExclusaoRelatorio(
        supabase,
        relatorio,
        Boolean(manualRelatorioId),
        usuarioId
      );
      resultados.push(res);
    }

    const excluidos = resultados.filter(r => r.status === "excluido").length;
    const ignorados = resultados.filter(r => r.status === "ignorado" || r.status === "fila_ativa" || r.status === "envio_nao_concluido").length;
    const falhas = resultados.filter(r => r.status === "erro_storage" || r.status === "erro_banco").length;

    return new Response(
      JSON.stringify({
        success: true,
        encontrados,
        excluidos,
        ignorados,
        falhas,
        resultados
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[excluir-relatorios] Erro fatal:", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || "Erro interno na função de exclusão de relatórios expirados"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
