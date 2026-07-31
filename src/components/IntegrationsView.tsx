import React, { useState, useEffect } from 'react';
import { AuthUser } from '../types';
import { integracaoService } from '../services/supabaseService';
import { IntegrationLog, IntegrationConfig, IntegrationMetrics } from '../types';
import {
  Webhook,
  Key,
  ShieldAlert,
  Copy,
  Check,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileText,
  Clock,
  Code,
  Layers,
  Sparkles,
  Info,
  ChevronRight,
  Eye,
  X,
  Zap
} from 'lucide-react';

interface IntegrationsViewProps {
  user: AuthUser;
}

export default function IntegrationsView({ user }: IntegrationsViewProps) {
  const [config, setConfig] = useState<IntegrationConfig | null>(null);
  const [metrics, setMetrics] = useState<IntegrationMetrics | null>(null);
  const [logs, setLogs] = useState<IntegrationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copiedEndpoint, setCopiedEndpoint] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  // Filters state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Secret Rotation Modal state
  const [generatingSecret, setGeneratingSecret] = useState(false);
  const [newSecretModalOpen, setNewSecretModalOpen] = useState(false);
  const [generatedSecret, setGeneratedSecret] = useState<string | null>(null);

  // Inspect Metadata Modal state
  const [inspectedLog, setInspectedLog] = useState<IntegrationLog | null>(null);

  const loadData = async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const [cfgData, metData, logData] = await Promise.all([
        integracaoService.getConfig(),
        integracaoService.getMetrics(),
        integracaoService.listLogs(200)
      ]);

      setConfig(cfgData);
      setMetrics(metData);
      setLogs(logData);
    } catch (err) {
      console.error('[IntegrationsView] Erro ao carregar dados:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCopyEndpoint = () => {
    if (config?.endpointUrl) {
      navigator.clipboard.writeText(config.endpointUrl);
      setCopiedEndpoint(true);
      setTimeout(() => setCopiedEndpoint(false), 2000);
    }
  };

  const handleCopyGeneratedSecret = () => {
    if (generatedSecret) {
      navigator.clipboard.writeText(generatedSecret);
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    }
  };

  const handleGenerateSecret = async () => {
    if (user.role !== 'Administrador') {
      alert('Apenas Administradores podem gerar ou rotacionar o segredo de integração.');
      return;
    }

    const confirmGen = window.confirm(
      'Deseja gerar um novo segredo de integração?\n\n' +
      'O segredo atual será mantido temporariamente como "Segredo Anterior" para permitir a transição sem interrupções do sistema gerador.'
    );

    if (!confirmGen) return;

    setGeneratingSecret(true);
    try {
      const { newSecret } = await integracaoService.generateNewSecret(user.id);
      setGeneratedSecret(newSecret);
      setNewSecretModalOpen(true);
      await loadData(true);
    } catch (err: any) {
      alert(err.message || 'Erro ao gerar novo segredo de integração.');
    } finally {
      setGeneratingSecret(false);
    }
  };

  const filteredLogs = logs.filter(log => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchesCliente = (log.codigo_cliente || '').toLowerCase().includes(q);
      const matchesOrigem = (log.origem_sistema || '').toLowerCase().includes(q);
      const matchesId = (log.identificador_origem || '').toLowerCase().includes(q);
      const matchesRelatorio = (log.relatorio_id || '').toLowerCase().includes(q);
      if (!matchesCliente && !matchesOrigem && !matchesId && !matchesRelatorio) return false;
    }

    if (statusFilter) {
      if (statusFilter === 'sucesso' && log.status !== 'sucesso') return false;
      if (statusFilter === 'duplicado' && log.status !== 'duplicado') return false;
      if (statusFilter === 'erro' && log.http_status < 400 && !log.status.startsWith('erro_')) return false;
      if (statusFilter === 'cliente_nao_encontrado' && log.erro_codigo !== 'CLIENTE_NAO_ENCONTRADO') return false;
    }

    return true;
  });

  const getStatusBadge = (log: IntegrationLog) => {
    if (log.status === 'sucesso') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          <span>Sucesso (201)</span>
        </span>
      );
    }
    if (log.status === 'duplicado') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/30">
          <Info className="w-3 h-3 text-blue-400" />
          <span>Duplicado (200)</span>
        </span>
      );
    }
    if (log.erro_codigo === 'CLIENTE_NAO_ENCONTRADO') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
          <AlertTriangle className="w-3 h-3 text-amber-400" />
          <span>Cliente 404</span>
        </span>
      );
    }
    if (log.http_status === 401) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-red-500/15 text-red-300 border border-red-500/30">
          <ShieldAlert className="w-3 h-3 text-red-400" />
          <span>Não Autorizado (401)</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-red-500/15 text-red-300 border border-red-500/30">
        <XCircle className="w-3 h-3 text-red-400" />
        <span>Erro ({log.http_status || 500})</span>
      </span>
    );
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <Webhook className="w-6 h-6 text-purple-400" />
            <h1 className="text-xl font-bold text-slate-100">Painel de Integração de Relatórios</h1>
            <span className="text-[10px] bg-purple-500/20 text-purple-300 px-2.5 py-0.5 rounded-full border border-purple-500/30 font-mono font-medium">
              API REST / Edge Function
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Recepção automática de relatórios PDF gerados por sistemas externos com idempotência e disparo WhatsApp.
          </p>
        </div>

        <button
          onClick={() => loadData(true)}
          disabled={refreshing}
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl flex items-center gap-2 transition-all cursor-pointer border border-slate-700 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-purple-400 ${refreshing ? 'animate-spin' : ''}`} />
          <span>Atualizar Painel</span>
        </button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-2xl shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Recebidos Hoje</span>
            <Zap className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-black text-slate-100 mt-2 font-mono">
            {metrics?.recebidosHoje ?? 0}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            Relatórios processados via webhook hoje
          </div>
        </div>

        <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-2xl shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Duplicados Ignorados</span>
            <Copy className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-black text-blue-300 mt-2 font-mono">
            {metrics?.duplicadosIgnorados ?? 0}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            Requisições idempotentes evitadas
          </div>
        </div>

        <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-2xl shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Erros de Processamento</span>
            <XCircle className="w-4 h-4 text-red-400" />
          </div>
          <div className="text-2xl font-black text-red-400 mt-2 font-mono">
            {metrics?.errosProcessamento ?? 0}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            Falhas de autenticação ou formato
          </div>
        </div>

        <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-2xl shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Cliente Não Encontrado</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-black text-amber-300 mt-2 font-mono">
            {metrics?.clientesNaoEncontrados ?? 0}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            Código de cliente inexistente
          </div>
        </div>
      </div>

      {/* Main Endpoint & Secret Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Endpoint Card */}
        <div className="lg:col-span-2 p-5 bg-slate-900/90 border border-slate-800 rounded-2xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div className="flex items-center gap-2">
              <Code className="w-4 h-4 text-purple-400" />
              <h2 className="text-sm font-bold text-slate-100">Endpoint Oficial de Recepção</h2>
            </div>
            <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-semibold">
              POST multipart/form-data
            </span>
          </div>

          <div className="space-y-2">
            <label className="text-xs text-slate-400 font-medium">URL do Webhook</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={config?.endpointUrl || 'Carregando URL...'}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-purple-300 font-mono focus:outline-none"
              />
              <button
                onClick={handleCopyEndpoint}
                className="px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shadow-sm shrink-0"
              >
                {copiedEndpoint ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedEndpoint ? 'Copiado!' : 'Copiar URL'}</span>
              </button>
            </div>
          </div>

          {/* Form fields documentation summary */}
          <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 space-y-2">
            <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-blue-400" />
              <span>Campos Esperados na Requisição (multipart/form-data)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono text-slate-400">
              <div className="bg-slate-900 p-2 rounded-lg border border-slate-800/60">
                <span className="text-purple-300 font-bold">arquivo</span>: PDF (obrigatório)
              </div>
              <div className="bg-slate-900 p-2 rounded-lg border border-slate-800/60">
                <span className="text-purple-300 font-bold">codigo_cliente</span>: ex. CLI0002 (obrigatório)
              </div>
              <div className="bg-slate-900 p-2 rounded-lg border border-slate-800/60">
                <span className="text-purple-300 font-bold">identificador_origem</span>: ID único do sistema (obrigatório)
              </div>
              <div className="bg-slate-900 p-2 rounded-lg border border-slate-800/60">
                <span className="text-purple-300 font-bold">periodo_inicio / fim</span>: YYYY-MM-DD (obrigatórios)
              </div>
              <div className="bg-slate-900 p-2 rounded-lg border border-slate-800/60">
                <span className="text-slate-300 font-bold">enviar_automaticamente</span>: boolean (opcional, padrão false)
              </div>
              <div className="bg-slate-900 p-2 rounded-lg border border-slate-800/60">
                <span className="text-slate-300 font-bold">lote_externo_id / finalizar_lote</span>: agrupamento (opcionais)
              </div>
            </div>
          </div>
        </div>

        {/* Security & Token Card */}
        <div className="p-5 bg-slate-900/90 border border-slate-800 rounded-2xl space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-amber-400" />
                <h2 className="text-sm font-bold text-slate-100">Token de Autenticação</h2>
              </div>
              <span className="text-[10px] bg-amber-500/10 text-amber-300 border border-amber-500/20 px-2 py-0.5 rounded-full font-mono font-semibold">
                Bearer Token
              </span>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Segredo Atual (Mascara)</label>
              <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl font-mono text-xs text-amber-300 flex items-center justify-between">
                <span>{config?.segredoMasked || 'krel_sec_****************'}</span>
                <span className="text-[9px] text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded">Protegido</span>
              </div>
              <p className="text-[10px] text-slate-500">
                O token de integração nunca é exibido em texto plano após a criação por motivos de segurança.
              </p>
            </div>

            {config?.hasPreviousSecret && (
              <div className="p-2.5 bg-blue-950/30 border border-blue-800/40 rounded-xl text-[10px] text-blue-300 flex items-center gap-2">
                <Info className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span>Transição ativa: O segredo anterior ainda é aceito temporariamente.</span>
              </div>
            )}
          </div>

          <div className="pt-2">
            <button
              onClick={handleGenerateSecret}
              disabled={generatingSecret}
              className="w-full py-2 px-3 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 hover:border-amber-500/60 text-xs font-semibold rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              {generatingSecret ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Key className="w-3.5 h-3.5 text-amber-400" />
              )}
              <span>Gerar Novo Segredo de Integração</span>
            </button>
          </div>
        </div>
      </div>

      {/* Logs Table Section */}
      <div className="p-5 bg-slate-900/90 border border-slate-800 rounded-2xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-purple-400" />
            <h2 className="text-sm font-bold text-slate-100">Logs de Integração em Tempo Real</h2>
            <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-mono">
              {filteredLogs.length} registros
            </span>
          </div>

          {/* Table Filters */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
              <input
                type="text"
                placeholder="Filtrar por cliente, origem, ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-2.5 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500 w-48 sm:w-64"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
            >
              <option value="">Todos os Status</option>
              <option value="sucesso">Sucesso (201)</option>
              <option value="duplicado">Duplicado (200)</option>
              <option value="cliente_nao_encontrado">Cliente 404</option>
              <option value="erro">Outros Erros</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-12 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-purple-400" />
              <span>Carregando logs de integração...</span>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="p-12 text-center text-slate-500 text-xs space-y-1">
              <FileText className="w-6 h-6 text-slate-600 mx-auto mb-2" />
              <p className="font-semibold text-slate-400">Nenhum log de integração encontrado</p>
              <p>Os envios recebidos do sistema gerador de PDF aparecerão aqui automaticamente.</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-semibold text-[11px] bg-slate-950/50">
                  <th className="p-3">Data/Hora</th>
                  <th className="p-3">Origem</th>
                  <th className="p-3">Código Cliente</th>
                  <th className="p-3">ID Externo</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Detalhes / Mensagem</th>
                  <th className="p-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="p-3 text-slate-400 font-mono text-[11px] whitespace-nowrap">
                      {new Date(log.recebido_em).toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                      })}
                    </td>
                    <td className="p-3 text-purple-300 font-semibold">
                      {log.origem_sistema || 'sistema_externo'}
                    </td>
                    <td className="p-3 text-slate-200 font-mono">
                      {log.codigo_cliente || '-'}
                    </td>
                    <td className="p-3 text-slate-400 font-mono max-w-[140px] truncate" title={log.identificador_origem || ''}>
                      {log.identificador_origem || '-'}
                    </td>
                    <td className="p-3">
                      {getStatusBadge(log)}
                    </td>
                    <td className="p-3 text-slate-300 max-w-[220px] truncate" title={log.erro_mensagem || 'Processado com sucesso'}>
                      {log.erro_mensagem || (log.status === 'sucesso' ? 'PDF armazenado e registrado' : log.status === 'duplicado' ? 'Ignorado por idempotência' : log.status)}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => setInspectedLog(log)}
                        className="p-1.5 text-slate-400 hover:text-purple-300 hover:bg-slate-800 rounded-lg transition-all cursor-pointer"
                        title="Inspecionar Metadata"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* MODAL: SEGREDO GERADO */}
      {newSecretModalOpen && generatedSecret && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl animate-fade-in">
            <div className="flex items-center gap-3 text-amber-400 border-b border-slate-800 pb-3">
              <Key className="w-5 h-5 shrink-0" />
              <h3 className="font-bold text-slate-100 text-sm">Novo Segredo de Integração Gerado</h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Guarde o segredo abaixo em um local seguro. Ele <strong className="text-amber-300">não será exibido novamente</strong> em texto limpo após fechar este aviso.
            </p>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
              <label className="text-[10px] text-slate-400 font-medium">Authorization Header Token</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={generatedSecret}
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 font-mono text-xs text-amber-300 focus:outline-none"
                />
                <button
                  onClick={handleCopyGeneratedSecret}
                  className="px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1 transition-all cursor-pointer shrink-0"
                >
                  {copiedSecret ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSecret ? 'Copiado!' : 'Copiar'}</span>
                </button>
              </div>
            </div>

            <div className="p-3 bg-blue-950/40 border border-blue-800/40 rounded-xl text-xs text-blue-300 space-y-1">
              <div className="font-semibold flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-blue-400" />
                <span>Janela de Transição Suave</span>
              </div>
              <p className="text-[11px] text-blue-200/80">
                O token anterior continua aceito temporariamente como fallback para que as aplicações parceiras atualizem a chave sem perder dados.
              </p>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => {
                  setNewSecretModalOpen(false);
                  setGeneratedSecret(null);
                }}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-all cursor-pointer"
              >
                Entendi e Copiei o Segredo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: INSPEÇÃO DE LOG / METADATA */}
      {inspectedLog && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-5 space-y-4 shadow-2xl animate-fade-in max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-slate-100 font-bold text-sm">
                <Code className="w-4 h-4 text-purple-400" />
                <span>Inspecionar Log de Integração</span>
              </div>
              <button
                onClick={() => setInspectedLog(null)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 text-xs pr-1">
              <div className="grid grid-cols-2 gap-2 p-3 bg-slate-950 rounded-xl border border-slate-800">
                <div>
                  <span className="text-slate-500 text-[10px] block">Data / Hora</span>
                  <span className="text-slate-200 font-mono">{new Date(inspectedLog.recebido_em).toLocaleString('pt-BR')}</span>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px] block">Origem do Sistema</span>
                  <span className="text-purple-300 font-semibold">{inspectedLog.origem_sistema}</span>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px] block">Código do Cliente</span>
                  <span className="text-slate-200 font-mono">{inspectedLog.codigo_cliente || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px] block">Identificador Externo</span>
                  <span className="text-slate-200 font-mono">{inspectedLog.identificador_origem || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px] block">HTTP Status</span>
                  <span className="text-slate-200 font-mono font-bold">{inspectedLog.http_status}</span>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px] block">Relatório ID (UUID)</span>
                  <span className="text-slate-200 font-mono">{inspectedLog.relatorio_id || '-'}</span>
                </div>
              </div>

              {inspectedLog.erro_mensagem && (
                <div className="p-3 bg-red-950/30 border border-red-800/50 rounded-xl text-red-300 space-y-1">
                  <span className="font-semibold block text-[10px] text-red-400">Mensagem de Erro:</span>
                  <p className="font-mono text-[11px]">{inspectedLog.erro_mensagem}</p>
                </div>
              )}

              <div className="space-y-1">
                <span className="text-slate-400 text-[10px] font-semibold">Metadata JSON</span>
                <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-purple-300 font-mono text-[11px] overflow-x-auto">
                  {JSON.stringify(inspectedLog.metadata || {}, null, 2)}
                </pre>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-800">
              <button
                onClick={() => setInspectedLog(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-all cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
