-- RPC Functions for Complete Cascading Deletions

-- 1. Function to delete a client completely with cascading records
CREATE OR REPLACE FUNCTION public.excluir_cliente_completo(p_cliente_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_relatorio RECORD;
BEGIN
  -- 1. Delete associated queue items
  DELETE FROM public.fila_envios WHERE cliente_id = p_cliente_id;

  -- 2. Delete associated reports
  DELETE FROM public.relatorios WHERE cliente_id = p_cliente_id;

  -- 3. Delete client record
  DELETE FROM public.clientes WHERE id = p_cliente_id;
END;
$$;

-- 2. Function to delete a batch completely
CREATE OR REPLACE FUNCTION public.excluir_lote_completo(p_lote_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 1. Delete queue items associated with the batch
  DELETE FROM public.fila_envios WHERE lote_id = p_lote_id;

  -- 2. Delete the batch record itself
  DELETE FROM public.lotes_envio WHERE id = p_lote_id;
END;
$$;

-- Grant permissions to authenticated users
GRANT EXECUTE ON FUNCTION public.excluir_cliente_completo(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.excluir_lote_completo(UUID) TO authenticated;
