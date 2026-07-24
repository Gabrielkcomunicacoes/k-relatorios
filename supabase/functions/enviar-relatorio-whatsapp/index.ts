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
    const { filaEnvioId } = await req.json();
    if (!filaEnvioId) {
      return new Response(
        JSON.stringify({ error: "O parâmetro 'filaEnvioId' é obrigatório." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[enviar-relatorio-whatsapp] Recebida solicitação individual para filaEnvioId: ${filaEnvioId}`);

    // Lock item status to 'processando'
    const { data: itemData } = await supabase
      .from("fila_envios")
      .select("id, lote_id")
      .eq("id", filaEnvioId)
      .single();

    if (itemData) {
      await supabase
        .from("fila_envios")
        .update({ status: "processando", updated_at: new Date().toISOString() })
        .eq("id", filaEnvioId);
    }

    // Process item using shared module
    const result = await processarEnvioItem(supabase, filaEnvioId);

    // Recalculate batch if lote_id exists
    if (itemData?.lote_id) {
      await recalcularStatusLote(supabase, itemData.lote_id);
    }

    return new Response(
      JSON.stringify(result),
      { status: result.success ? 200 : 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[enviar-relatorio-whatsapp] Erro fatal:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Erro desconhecido na Edge Function" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
