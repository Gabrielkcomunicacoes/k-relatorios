import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // 1. GET Request: Verify Webhook from Meta Developer Portal
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode && token) {
      if (mode === "subscribe") {
        // Read Verify Token securely via Deno.env.get()
        const expectedVerifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || Deno.env.get("META_VERIFY_TOKEN") || "k_relatorios_verify_token";

        if (token === expectedVerifyToken) {
          console.log("Webhook verificado com sucesso pelo Facebook!");
          return new Response(challenge, { status: 200 });
        } else {
          console.warn("Verify token invalido informado pelo Facebook.");
          return new Response("Forbidden", { status: 403 });
        }
      }
    }
    return new Response("Bad Request", { status: 400 });
  }

  // 2. POST Request: Handle Webhook Status/Message Events from Meta
  if (req.method === "POST") {
    try {
      const payload = await req.json();
      console.log("Recebido Webhook Event da Meta:", JSON.stringify(payload));

      // Check if it's a whatsapp status notification
      const entry = payload.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const statuses = value?.statuses;

      if (statuses && Array.isArray(statuses) && statuses.length > 0) {
        for (const metaStatus of statuses) {
          const messageId = metaStatus.id;
          const statusName = metaStatus.status; // 'sent', 'delivered', 'read', 'failed'
          const timestampSec = parseInt(metaStatus.timestamp, 10);
          const dateStr = !isNaN(timestampSec) ? new Date(timestampSec * 1000).toISOString() : new Date().toISOString();

          console.log(`Processando status do WhatsApp: ID=${messageId}, Status=${statusName}`);

          // Find the matching queue item in fila_envios
          const { data: filaItem, error: findError } = await supabase
            .from("fila_envios")
            .select("*")
            .eq("whatsapp_message_id", messageId)
            .maybeSingle();

          if (findError) {
            console.error(`Erro ao buscar ID do WhatsApp ${messageId}:`, findError);
            continue;
          }

          if (!filaItem) {
            console.warn(`Nenhum item encontrado na fila_envios correspondente ao whatsapp_message_id ${messageId}`);
            continue;
          }

          // Map Meta status names to database status names
          let dbStatus = "enviado";
          const updates: any = { updated_at: new Date().toISOString() };

          if (statusName === "sent") {
            dbStatus = "enviado";
            updates.status = "enviado";
          } else if (statusName === "delivered") {
            dbStatus = "entregue";
            updates.status = "entregue";
            updates.entregue_em = dateStr;
          } else if (statusName === "read") {
            dbStatus = "lido";
            updates.status = "lido";
            updates.lido_em = dateStr;
          } else if (statusName === "failed") {
            dbStatus = "falhou";
            updates.status = "falhou";
            
            // Extract Meta error if present
            const errorObj = metaStatus.errors?.[0];
            updates.erro_codigo = errorObj?.code ? String(errorObj.code) : "META_ERROR";
            updates.erro_mensagem = errorObj?.message || errorObj?.title || "Meta delivery failure";
          } else {
            console.log(`Status não mapeado: ${statusName}. Ignorando atualização.`);
            continue;
          }

          // Apply updates to fila_envios
          const { error: updateError } = await supabase
            .from("fila_envios")
            .update(updates)
            .eq("id", filaItem.id);

          if (updateError) {
            console.error(`Falha ao atualizar fila_envios para o ID ${filaItem.id}:`, updateError);
            continue;
          }

          // Save to status history
          await supabase.from("historico_status").insert({
            fila_envio_id: filaItem.id,
            status_anterior: filaItem.status,
            status_novo: dbStatus,
            detalhes: {
              meta_payload: metaStatus,
            },
          });

          // Update batch metrics on changes
          if (filaItem.lote_id && filaItem.status !== dbStatus) {
            const { data: lote } = await supabase
              .from("lotes_envio")
              .select("*")
              .eq("id", filaItem.lote_id)
              .single();

            if (lote) {
              const countersUpdate: any = {};
              
              // If status transitions to failed, we adjust
              if (dbStatus === "falhou" && filaItem.status !== "falhou") {
                countersUpdate.total_falhas = (lote.total_falhas || 0) + 1;
                if (filaItem.status === "enviado" || filaItem.status === "entregue" || filaItem.status === "lido") {
                  countersUpdate.total_enviados = Math.max(0, (lote.total_enviados || 0) - 1);
                }
                countersUpdate.status = "concluido_com_falhas";
              }
              // If it recovers from failure to sent/delivered/read
              else if (dbStatus !== "falhou" && filaItem.status === "falhou") {
                countersUpdate.total_falhas = Math.max(0, (lote.total_falhas || 0) - 1);
                countersUpdate.total_enviados = (lote.total_enviados || 0) + 1;
              }

              if (Object.keys(countersUpdate).length > 0) {
                await supabase
                  .from("lotes_envio")
                  .update({
                    ...countersUpdate,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", lote.id);
              }
            }
          }

          console.log(`Item ${filaItem.id} atualizado com sucesso para status '${dbStatus}'.`);
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err: any) {
      console.error("Erro ao processar POST webhook:", err);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
});
