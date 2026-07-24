import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { processarEnvioItem, recalcularStatusLote } from "../_shared/enviarRelatorio.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight requests
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

    // Parse request body
    let loteId: string | undefined = undefined;
    try {
      const body = await req.json();
      if (body && body.loteId) {
        loteId = body.loteId;
      }
    } catch (_e) {
      // Body empty or not JSON -> process general queue
    }

    console.log(`[processar-fila-whatsapp] Inicio do processamento. LoteId especificado: ${loteId || 'Nenhum (fila geral)'}`);

    // If specific loteId provided, check if batch is canceled
    if (loteId) {
      const { data: lote, error: loteErr } = await supabase
        .from("lotes_envio")
        .select("id, status")
        .eq("id", loteId)
        .single();

      if (loteErr || !lote) {
        console.warn(`[processar-fila-whatsapp] Lote ${loteId} não foi encontrado no banco.`);
        return new Response(
          JSON.stringify({ success: false, error: "Lote não encontrado." }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (lote.status === "cancelado") {
        console.warn(`[processar-fila-whatsapp] Lote ${loteId} está cancelado. Interrompendo processamento.`);
        return new Response(
          JSON.stringify({ success: false, message: "Lote está cancelado. Nenhum envio processado." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const nowIso = new Date().toISOString();

    // Query candidate queue items
    let query = supabase
      .from("fila_envios")
      .select("id, lote_id, cliente_id, relatorio_id, tentativas, created_at, status")
      .eq("status", "pendente")
      .not("relatorio_id", "is", null)
      .is("whatsapp_message_id", null)
      .lt("tentativas", 3)
      .order("created_at", { ascending: true })
      .limit(5);

    if (loteId) {
      query = query.eq("lote_id", loteId);
    }

    const { data: candidates, error: candidateErr } = await query;

    if (candidateErr) {
      console.error("[processar-fila-whatsapp] Erro ao buscar itens elegíveis:", candidateErr);
      throw candidateErr;
    }

    // Filter candidate items where data_programada <= now or null
    const nowTimestamp = Date.now();
    const eligibleItems = (candidates || []).filter((item: any) => {
      if (!item.data_programada) return true;
      return new Date(item.data_programada).getTime() <= nowTimestamp;
    });

    console.log(`[processar-fila-whatsapp] Encontrados ${eligibleItems.length} itens elegíveis de ${candidates?.length || 0} candidatos.`);

    if (eligibleItems.length === 0) {
      if (loteId) {
        await recalcularStatusLote(supabase, loteId);
      }
      return new Response(
        JSON.stringify({
          success: true,
          processedCount: 0,
          message: "Nenhum item pendente elegível para envio no momento.",
          results: []
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results: any[] = [];
    const affectedLoteIds = new Set<string>();
    if (loteId) affectedLoteIds.add(loteId);

    // Process each candidate item with atomic concurrency locking
    for (const item of eligibleItems) {
      if (item.lote_id) {
        affectedLoteIds.add(item.lote_id);
      }

      console.log(`[processar-fila-whatsapp] Tentando bloquear item da fila ID: ${item.id}`);

      // ATOMIC LOCK: Update status 'pendente' -> 'processando' ONLY if still 'pendente'
      const { data: lockResult, error: lockError } = await supabase
        .from("fila_envios")
        .update({
          status: "processando",
          updated_at: new Date().toISOString()
        })
        .eq("id", item.id)
        .eq("status", "pendente")
        .select("id");

      if (lockError || !lockResult || lockResult.length === 0) {
        console.warn(`[processar-fila-whatsapp] Item ${item.id} já capturado por outro worker ou status alterado. Ignorando.`);
        results.push({
          filaEnvioId: item.id,
          success: false,
          status: "bloqueado_concorrencia",
          errorCode: "CONCURRENCY_LOCK_FAILED"
        });
        continue;
      }

      console.log(`[processar-fila-whatsapp] Item ${item.id} bloqueado com sucesso. Executando envio...`);

      // Execute send logic via shared module
      const itemResult = await processarEnvioItem(supabase, item.id);

      console.log(`[processar-fila-whatsapp] Resultado para filaEnvioId ${item.id}: success=${itemResult.success}, status=${itemResult.status}`);
      results.push(itemResult);
    }

    // Recalculate status for all affected batches
    for (const id of affectedLoteIds) {
      await recalcularStatusLote(supabase, id);
    }

    const summary = {
      success: true,
      processedCount: results.length,
      sucessos: results.filter(r => r.success).length,
      falhas: results.filter(r => !r.success).length,
      results
    };

    console.log(`[processar-fila-whatsapp] Processamento concluído. Resumo: Sucessos=${summary.sucessos}, Falhas=${summary.falhas}`);

    return new Response(
      JSON.stringify(summary),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[processar-fila-whatsapp] Erro fatal na Edge Function:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Erro interno ao processar a fila" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
