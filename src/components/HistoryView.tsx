import React, { useState } from 'react';
import { QueueItem, Client } from '../types';
import {
  Search,
  Filter,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Clock,
  ExternalLink,
  Phone,
  User,
  Calendar,
  Layers,
  FileText
} from 'lucide-react';

interface HistoryViewProps {
  queueItems: QueueItem[];
  clients: Client[];
  onRetrySingleItem: (itemId: string) => void;
  onResendReport?: (relatorioId: string) => void;
  sendingId: string | null;
  userRole?: string;
}

export default function HistoryView({ queueItems, clients, onRetrySingleItem, onResendReport, sendingId, userRole = 'Administrador' }: HistoryViewProps) {
  // Filters
  const [clientSearch, setClientSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('todos');
  const [competenciaFilter, setCompetenciaFilter] = useState<string>('todos');

  // Confirmation Modal state for resending reports
  const [itemToResend, setItemToResend] = useState<QueueItem | null>(null);

  // Find unique competencies for filter select dropdown
  const competencies = Array.from(new Set(queueItems.map((item) => item.competencia)));

  // Filter queue items
  const filteredItems = queueItems.filter((item) => {
    const matchesSearch =
      item.cliente_nome.toLowerCase().includes(clientSearch.toLowerCase()) ||
      item.arquivo_nome.toLowerCase().includes(clientSearch.toLowerCase()) ||
      item.telefone.includes(clientSearch);

    const matchesStatus = statusFilter === 'todos' || item.status === statusFilter;

    const matchesCompetencia = competenciaFilter === 'todos' || item.competencia === competenciaFilter;

    return matchesSearch && matchesStatus && matchesCompetencia;
  });

  const getQueueItemStatusBadge = (status: string) => {
    switch (status) {
      case 'Lido':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">Lido (✓✓)</span>;
      case 'Entregue':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">Entregue (✓✓)</span>;
      case 'Enviado':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">Enviado (✓)</span>;
      case 'Enviando':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200 animate-pulse">Enviando</span>;
      case 'Fila':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">Na Fila</span>;
      case 'Falhou':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">Falhou</span>;
      case 'Cancelado':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-semibold bg-slate-50 text-slate-500 border border-slate-200">Cancelado</span>;
      default:
        return <span className="px-2.5 py-0.5 rounded text-[10px] font-semibold bg-slate-50 text-slate-700 border border-slate-200">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-semibold text-slate-950 tracking-tight">
          Histórico Geral & Fila de Transmissão
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Histórico e fila de mensagens transmitidas pela API Oficial. Filtre envios ou force o reprocessamento de mensagens individuais com falhas.
        </p>
      </div>

      {/* Advanced Filters Panel */}
      <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-subtle flex flex-col md:flex-row gap-3 items-center justify-between">
        {/* Search Input */}
        <div className="relative w-full md:w-80">
          <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-slate-400">
            <Search className="w-4 h-4" />
          </span>
          <input
            id="hist_search_input"
            type="text"
            placeholder="Buscar por cliente, arquivo ou celular..."
            value={clientSearch}
            onChange={(e) => setClientSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:bg-white transition-all text-slate-900"
          />
        </div>

        {/* Filters Dropdowns */}
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {/* Status filter */}
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span>Status:</span>
            <select
              id="hist_filter_status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs font-semibold text-slate-700 outline-none focus:bg-white"
            >
              <option value="todos">Todos os Status</option>
              <option value="Fila">Na Fila (Agendados)</option>
              <option value="Enviando">Enviando</option>
              <option value="Enviado">Enviado</option>
              <option value="Entregue">Entregue</option>
              <option value="Lido">Lido</option>
              <option value="Falhou">Falhou</option>
              <option value="Cancelado">Cancelado</option>
            </select>
          </div>

          {/* Competência Filter */}
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span>Competência:</span>
            <select
              id="hist_filter_comp"
              value={competenciaFilter}
              onChange={(e) => setCompetenciaFilter(e.target.value)}
              className="px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs font-semibold text-slate-700 outline-none focus:bg-white"
            >
              <option value="todos">Todas</option>
              {competencies.map((comp) => (
                <option key={comp} value={comp}>
                  {comp}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main Table List */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-subtle overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-4">Destinatário</th>
                <th className="py-3 px-4">Celular WhatsApp</th>
                <th className="py-3 px-4">Arquivo PDF</th>
                <th className="py-3 px-4">Competência</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-center">Tentativas</th>
                <th className="py-3 px-4">Último Disparo</th>
                <th className="py-3 px-4">Erro de Transmissão</th>
                <th className="py-3 px-4 text-right">Reprocessar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-xs text-slate-400 italic">
                    Nenhum envio registrado com os critérios selecionados.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.id} className="text-xs hover:bg-slate-50/50 transition-all">
                    {/* Receiver */}
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      <div className="flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        <span>{item.cliente_nome}</span>
                      </div>
                    </td>

                    {/* Phone */}
                    <td className="py-3 px-4 font-mono text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <Phone className="w-3 h-3 text-slate-400" />
                        <span>{item.telefone}</span>
                      </div>
                    </td>

                    {/* PDF Document */}
                    <td className="py-3 px-4 font-mono text-slate-500 truncate max-w-xs" title={item.arquivo_nome}>
                      <div className="flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-slate-400" />
                        <span>{item.arquivo_nome}</span>
                      </div>
                    </td>

                    {/* Competency Period */}
                    <td className="py-3 px-4 font-mono text-slate-600 font-medium">
                      {item.competencia}
                    </td>

                    {/* Status Badge */}
                    <td className="py-3 px-4 text-center">
                      {getQueueItemStatusBadge(item.status)}
                    </td>

                    {/* Attempts count */}
                    <td className="py-3 px-4 text-center font-mono font-bold text-slate-500">
                      {item.tentativas}
                    </td>

                    {/* Dispatch date/time */}
                    <td className="py-3 px-4 text-slate-500 font-mono">
                      {item.data_envio ? (
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          <span>{new Date(item.data_envio).toLocaleDateString('pt-BR')} {new Date(item.data_envio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      ) : (
                        <span className="italic text-slate-400">Agendado</span>
                      )}
                    </td>

                    {/* Error info */}
                    <td className="py-3 px-4 max-w-xs truncate text-rose-600 font-medium italic" title={item.erro}>
                      {item.erro ? item.erro : <span className="text-slate-400 not-italic">-</span>}
                    </td>

                    {/* Manual Retry/Resend action trigger */}
                    <td className="py-3 px-4 text-right">
                      {!item.relatorio_id ? (
                        <span
                          className="inline-flex items-center gap-1 py-1 px-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-bold rounded cursor-not-allowed"
                          title="Registro sem relatório vinculado. O disparo não é permitido."
                        >
                          <AlertCircle className="w-3 h-3 text-rose-500" />
                          {userRole === 'Administrador' ? 'Registro inválido' : 'Indisponível'}
                        </span>
                      ) : sendingId === item.id ? (
                        <button
                          disabled
                          className="inline-flex items-center gap-1 py-1 px-2.5 bg-slate-100 border border-slate-200 text-slate-400 text-[10px] font-bold rounded cursor-not-allowed"
                        >
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          Enviando...
                        </button>
                      ) : item.status === 'Fila' ? (
                        <button
                          id={`send_item_btn_${item.id}`}
                          disabled={sendingId !== null}
                          onClick={() => onRetrySingleItem(item.id)}
                          className="inline-flex items-center gap-1 py-1 px-2.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 text-[10px] font-bold rounded shadow-subtle transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          Enviar Relatório
                        </button>
                      ) : item.status === 'Falhou' ? (
                        <button
                          id={`retry_item_btn_${item.id}`}
                          disabled={sendingId !== null}
                          onClick={() => onRetrySingleItem(item.id)}
                          className="inline-flex items-center gap-1 py-1 px-2.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 text-[10px] font-bold rounded shadow-subtle transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          Retentar
                        </button>
                      ) : (item.status === 'Enviado' || item.status === 'Entregue' || item.status === 'Lido') ? (
                        <button
                          id={`resend_item_btn_${item.id}`}
                          disabled={sendingId !== null}
                          onClick={() => item.relatorio_id && setItemToResend(item)}
                          className="inline-flex items-center gap-1 py-1 px-2.5 bg-slate-100 hover:bg-amber-50 border border-slate-200 hover:border-amber-300 text-slate-700 hover:text-amber-800 text-[10px] font-bold rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Reenviar Relatório
                        </button>
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="p-3 bg-slate-50 border-t border-slate-200 text-slate-500 text-[10px] font-medium">
          Total de {filteredItems.length} registros listados. Mensagens "Lidas" indicam visualização confirmada pelo cliente final no WhatsApp.
        </div>
      </div>

      {/* Confirmation Modal for Resending Sent Reports */}
      {itemToResend && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 font-sans">
          <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-premium p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-amber-100 text-amber-800 rounded-lg shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Reenviar Relatório</h3>
                <p className="text-xs text-slate-600 mt-1">
                  Este cliente já recebeu um relatório desta competência. Deseja enviar novamente?
                </p>
                <div className="mt-3 bg-slate-50 p-2.5 rounded border border-slate-200 font-mono text-[11px] text-slate-700 space-y-1">
                  <div><strong>Cliente:</strong> {itemToResend.cliente_nome}</div>
                  <div><strong>Competência:</strong> {itemToResend.competencia}</div>
                  <div><strong>Arquivo:</strong> {itemToResend.arquivo_nome}</div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setItemToResend(null)}
                className="px-3 py-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-semibold rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const targetItem = itemToResend;
                  setItemToResend(null);
                  if (onResendReport && targetItem.relatorio_id) {
                    onResendReport(targetItem.relatorio_id);
                  } else {
                    onRetrySingleItem(targetItem.id);
                  }
                }}
                className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg shadow-sm"
              >
                Sim, reenviar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
