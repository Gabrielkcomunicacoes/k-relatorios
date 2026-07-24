import React, { useState, useEffect } from 'react';
import { Batch, QueueItem, BatchStatus } from '../types';
import {
  Layers,
  ChevronRight,
  User,
  Calendar,
  Sparkles,
  Search,
  CheckCircle,
  AlertCircle,
  Clock,
  XCircle,
  RefreshCw,
  X,
  FileText,
  Play,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface BatchesViewProps {
  batches: Batch[];
  queueItems: QueueItem[];
  onCancelBatch: (batchId: string) => void;
  onRetryFailedItems: (batchId: string) => void;
  onRebuildQueue: (batchId: string) => Promise<void>;
  onProcessQueueNow?: (batchId: string) => Promise<void>;
}

export default function BatchesView({
  batches,
  queueItems,
  onCancelBatch,
  onRetryFailedItems,
  onRebuildQueue,
  onProcessQueueNow
}: BatchesViewProps) {
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);
  const [searchBatch, setSearchBatch] = useState('');
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);

  useEffect(() => {
    setIsConfirmingCancel(false);
  }, [selectedBatch?.id]);

  // Filtered list of batches
  const filteredBatches = batches.filter((b) =>
    b.nome.toLowerCase().includes(searchBatch.toLowerCase())
  );

  // Get items for the selected batch
  const activeBatchItems = selectedBatch
    ? queueItems.filter((item) => item.lote_id === selectedBatch.id)
    : [];

  const getBatchStatusBadge = (status: BatchStatus) => {
    switch (status) {
      case 'Concluido':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Concluído</span>;
      case 'Processando':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">Processando</span>;
      case 'Pendente':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Pendente</span>;
      case 'Cancelado':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-50 text-slate-500 border border-slate-200">Cancelado</span>;
      case 'Falha':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">Falhou</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-50 text-slate-700 border border-slate-200">{status}</span>;
    }
  };

  const getQueueItemStatusBadge = (status: string) => {
    switch (status) {
      case 'Lido':
        return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">Lido (✓✓)</span>;
      case 'Entregue':
        return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">Entregue (✓✓)</span>;
      case 'Enviado':
        return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-100">Enviado (✓)</span>;
      case 'Enviando':
        return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-100 animate-pulse">Enviando</span>;
      case 'Fila':
        return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-100">Na Fila</span>;
      case 'Falhou':
        return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-100">Falhou</span>;
      case 'Cancelado':
        return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-50 text-slate-500 border border-slate-200">Cancelado</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-50 text-slate-700 border border-slate-200">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-950 tracking-tight">
            Lotes de Envio
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Monitore o processamento dos lotes enviados ou agendados, cancele disparos pendentes ou reenvie falhas.
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-subtle flex items-center justify-between">
        <div className="relative w-full max-w-sm">
          <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-slate-400">
            <Search className="w-4 h-4" />
          </span>
          <input
            id="batch_search_input"
            type="text"
            placeholder="Buscar lote por nome..."
            value={searchBatch}
            onChange={(e) => setSearchBatch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:bg-white transition-all text-slate-900"
          />
        </div>
        <div className="text-[11px] text-slate-400 italic">
          * Clique em qualquer linha para inspecionar os relatórios individuais do lote.
        </div>
      </div>

      {/* Batches Table List */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-subtle overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-4">Nome do Lote</th>
                <th className="py-3 px-4">Competência</th>
                <th className="py-3 px-4">Quantidade</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4">Criado por</th>
                <th className="py-3 px-4">Data de Criação</th>
                <th className="py-3 px-4 text-right">Inspecionar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredBatches.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-xs text-slate-400 italic">
                    Nenhum lote de envio cadastrado no sistema.
                  </td>
                </tr>
              ) : (
                filteredBatches.map((batch) => (
                  <tr
                    id={`batch_row_${batch.id}`}
                    key={batch.id}
                    onClick={() => setSelectedBatch(batch)}
                    className="text-xs hover:bg-slate-50/60 cursor-pointer transition-all"
                  >
                    {/* Name */}
                    <td className="py-3.5 px-4 font-semibold text-slate-900">
                      <div className="flex items-center gap-2">
                        <Layers className="w-4 h-4 text-slate-400 shrink-0" />
                        <span>{batch.nome}</span>
                      </div>
                    </td>

                    {/* Competence */}
                    <td className="py-3.5 px-4 font-mono font-medium text-slate-600">
                      {batch.competencia}
                    </td>

                    {/* Quantidade */}
                    <td className="py-3.5 px-4 font-mono text-slate-600 font-semibold">
                      {batch.quantidade} relatórios
                    </td>

                    {/* Status */}
                    <td className="py-3.5 px-4 text-center">
                      {getBatchStatusBadge(batch.status)}
                    </td>

                    {/* Creator */}
                    <td className="py-3.5 px-4 text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        {batch.criado_por}
                      </div>
                    </td>

                    {/* Created Date */}
                    <td className="py-3.5 px-4 text-slate-600 font-mono">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        {new Date(batch.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                      </div>
                    </td>

                    {/* Inspect button */}
                    <td className="py-3.5 px-4 text-right">
                      <ChevronRight className="w-4 h-4 text-slate-400 ml-auto" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: BATCH DETAIL INSPECT DRAWER */}
      {selectedBatch && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-end z-50">
          <motion.div
            initial={{ opacity: 0, x: 200 }}
            animate={{ opacity: 1, x: 0 }}
            className="w-full max-w-2xl bg-white h-full border-l border-slate-200 shadow-premium flex flex-col justify-between"
          >
            {/* Drawer Header */}
            <div className="p-6 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <div>
                <span className="text-[9px] font-bold text-blue-600 uppercase tracking-widest block mb-0.5">LOTE ID: {selectedBatch.id}</span>
                <h2 className="text-sm font-bold text-slate-900 truncate max-w-md">
                  {selectedBatch.nome}
                </h2>
              </div>
              <button
                onClick={() => setSelectedBatch(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded bg-white border border-slate-200 hover:bg-slate-50 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Stats Panel */}
            <div className="px-6 py-4 border-b border-slate-100 grid grid-cols-4 gap-4 text-center">
              <div>
                <span className="text-[9px] font-medium text-slate-400 uppercase tracking-wider block">Total Itens</span>
                <span className="text-base font-bold text-slate-800 mt-0.5 block">{activeBatchItems.length}</span>
              </div>
              <div>
                <span className="text-[9px] font-medium text-emerald-600 uppercase tracking-wider block">Entregues</span>
                <span className="text-base font-bold text-emerald-700 mt-0.5 block">
                  {activeBatchItems.filter((i) => i.status === 'Entregue' || i.status === 'Lido').length}
                </span>
              </div>
              <div>
                <span className="text-[9px] font-medium text-rose-500 uppercase tracking-wider block">Falhas</span>
                <span className="text-base font-bold text-rose-700 mt-0.5 block">
                  {activeBatchItems.filter((i) => i.status === 'Falhou').length}
                </span>
              </div>
              <div>
                <span className="text-[9px] font-medium text-amber-500 uppercase tracking-wider block">Pendente Fila</span>
                <span className="text-base font-bold text-amber-700 mt-0.5 block">
                  {activeBatchItems.filter((i) => i.status === 'Fila' || i.status === 'Enviando').length}
                </span>
              </div>
            </div>

            {/* Drawer Main List of queue items */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="text-xs font-semibold text-slate-800 uppercase tracking-wider">Fila Individual de Despacho:</div>
              <div className="space-y-2">
                {activeBatchItems.length === 0 ? (
                  <div className="p-5 bg-amber-50/70 border border-amber-200/80 rounded-xl text-xs text-amber-900 space-y-2">
                    <div className="flex items-center gap-1.5 font-bold text-amber-800">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>Lote Órfão Detectado</span>
                    </div>
                    <p className="leading-relaxed">
                      Este lote foi registrado no banco, mas não possui nenhum item correspondente na fila de transmissão. Isso ocorre se a criação inicial falhou ou se os relatórios não foram vinculados corretamente.
                    </p>
                    <p className="font-semibold text-amber-950 mt-1">
                      Clique no botão "Reconstruir Fila" abaixo para tentar gerar os itens da fila automaticamente a partir dos relatórios prontos desta competência.
                    </p>
                  </div>
                ) : (
                  activeBatchItems.map((item) => (
                    <div key={item.id} className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
                      {/* Item title / file */}
                      <div className="overflow-hidden">
                        <div className="font-semibold text-slate-900 flex items-center gap-1">
                          <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          {item.cliente_nome}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5 flex items-center gap-1.5">
                          <FileText className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>{item.arquivo_nome}</span>
                          <span>•</span>
                          <span>{item.telefone}</span>
                        </div>
                      </div>

                      {/* Status & details */}
                      <div className="flex flex-col sm:items-end gap-1.5">
                        <div className="flex items-center gap-2">
                          {getQueueItemStatusBadge(item.status)}
                        </div>
                        {item.erro && (
                          <div className="text-[10px] text-rose-600 bg-rose-50 border border-rose-100/60 px-2 py-0.5 rounded leading-normal max-w-xs text-right">
                            {item.erro}
                          </div>
                        )}
                        {item.message_id && (
                          <div className="text-[8px] text-slate-400 font-mono" title={item.message_id}>
                            MSG-ID: {item.message_id.slice(0, 14)}...
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Drawer Footer Actions */}
            <div className="p-6 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
              {/* If active batch is processing/pending, offer to cancel */}
              {(selectedBatch.status === 'Processando' || selectedBatch.status === 'Pendente') ? (
                <button
                  id="drawer_cancel_batch_btn"
                  onClick={() => {
                    if (isConfirmingCancel) {
                      onCancelBatch(selectedBatch.id);
                      setSelectedBatch(null);
                    } else {
                      setIsConfirmingCancel(true);
                    }
                  }}
                  className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-all ${
                    isConfirmingCancel
                      ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-sm'
                      : 'border border-rose-200 text-rose-700 hover:bg-rose-50'
                  }`}
                >
                  {isConfirmingCancel ? 'Confirmar Cancelamento?' : 'Cancelar Todo o Lote'}
                </button>
              ) : (
                <div />
              )}

              {/* Action options */}
              {activeBatchItems.length === 0 ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedBatch(null)}
                    className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-lg transition-all"
                  >
                    Fechar
                  </button>
                  <button
                    id="drawer_rebuild_queue_btn"
                    onClick={async () => {
                      try {
                        await onRebuildQueue(selectedBatch.id);
                        alert('Fila reconstruída com sucesso!');
                        setSelectedBatch(null);
                      } catch (err: any) {
                        alert(err.message || 'Erro ao reconstruir fila');
                      }
                    }}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shadow-sm"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Reconstruir Fila
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {onProcessQueueNow && activeBatchItems.some((i) => i.status === 'Fila' || i.status === 'Enviando') && (
                    <button
                      id="drawer_process_queue_now_btn"
                      disabled={isProcessingQueue}
                      onClick={async () => {
                        try {
                          setIsProcessingQueue(true);
                          await onProcessQueueNow(selectedBatch.id);
                          alert('Fila de envios processada com sucesso!');
                        } catch (err: any) {
                          alert(err.message || 'Erro ao processar fila do lote');
                        } finally {
                          setIsProcessingQueue(false);
                        }
                      }}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                    >
                      {isProcessingQueue ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Processando...
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-current" />
                          Processar fila agora
                        </>
                      )}
                    </button>
                  )}

                  {activeBatchItems.some((i) => i.status === 'Falhou') && (
                    <button
                      id="drawer_retry_failed_btn"
                      onClick={() => {
                        onRetryFailedItems(selectedBatch.id);
                        alert('Reenviando itens falhos do lote em segundo plano no Supabase!');
                        setSelectedBatch(null);
                      }}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shadow-sm"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Reenviar Falhas ({activeBatchItems.filter((i) => i.status === 'Falhou').length})
                    </button>
                  )}

                  <button
                    onClick={() => setSelectedBatch(null)}
                    className="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg hover:bg-slate-800 transition-all"
                  >
                    Fechar Painel
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
