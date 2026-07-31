import React from 'react';
import { Client, Batch, QueueItem, WorkerStatusInfo, AuthUser } from '../types';
import { workerService } from '../services/supabaseService';
import {
  Users,
  Clock,
  Send,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  TrendingUp,
  FileCheck2,
  CalendarDays,
  Cpu,
  Play,
  RefreshCw,
  Zap,
  Activity
} from 'lucide-react';
import { motion } from 'motion/react';

interface DashboardViewProps {
  user?: AuthUser;
  clients: Client[];
  batches: Batch[];
  queueItems: QueueItem[];
  onNavigateToTab: (tab: 'upload' | 'historico' | 'clientes') => void;
  onDataChange?: () => void;
}

export default function DashboardView({
  user,
  clients,
  batches,
  queueItems,
  onNavigateToTab,
  onDataChange
}: DashboardViewProps) {
  const [workerInfo, setWorkerInfo] = React.useState<WorkerStatusInfo | null>(null);
  const [isLoadingWorker, setIsLoadingWorker] = React.useState(false);
  const [isTriggering, setIsTriggering] = React.useState(false);

  const loadWorkerStatus = React.useCallback(async () => {
    setIsLoadingWorker(true);
    try {
      const status = await workerService.getStatus();
      setWorkerInfo(status);
    } catch (err) {
      console.error('Erro ao carregar status do worker:', err);
    } finally {
      setIsLoadingWorker(false);
    }
  }, []);

  React.useEffect(() => {
    loadWorkerStatus();
    const interval = setInterval(loadWorkerStatus, 15000);
    return () => clearInterval(interval);
  }, [loadWorkerStatus]);

  const handleTriggerWorker = async () => {
    setIsTriggering(true);
    try {
      const res = await workerService.triggerManualRun(user?.id);
      alert(`Worker executado com sucesso!\n\nItens encontrados: ${res?.itensEncontrados ?? 0}\nProcessados: ${res?.itensProcessados ?? 0}\nEnviados com sucesso: ${res?.sucessos ?? 0}\nFalhas: ${res?.falhas ?? 0}`);
      await loadWorkerStatus();
      if (onDataChange) {
        onDataChange();
      }
    } catch (err: any) {
      alert(`Erro ao acionar worker: ${err.message || String(err)}`);
    } finally {
      setIsTriggering(false);
    }
  };

  // Calculations based on actual database state
  const totalClients = clients.length;
  const activeClients = clients.filter((c) => c.ativo).length;
  const inativeClients = totalClients - activeClients;

  // Real-time status count from queue items
  const statusCounts = queueItems.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const delivered = (statusCounts['Entregue'] || 0) + (statusCounts['Lido'] || 0);
  const failed = statusCounts['Falhou'] || 0;
  const waitingToSend = statusCounts['Fila'] || 0;
  const sending = statusCounts['Enviando'] || 0;
  const sent = statusCounts['Enviado'] || 0;

  // Let's count scheduled dispatches: this would be queue items in 'Fila'
  const totalDispatchesThisMonth = queueItems.length;

  // Get recent 5 queue transmissions
  const recentDispatches = [...queueItems]
    .sort((a, b) => {
      const dateA = a.data_envio ? new Date(a.data_envio).getTime() : 0;
      const dateB = b.data_envio ? new Date(b.data_envio).getTime() : 0;
      return dateB - dateA;
    })
    .slice(0, 5);

  // Stats cards metadata
  const stats = [
    {
      title: 'Clientes Ativos',
      value: `${activeClients}/${totalClients}`,
      subtitle: `${inativeClients} inativos ou suspensos`,
      icon: Users,
      color: 'bg-blue-50 text-blue-600 border-blue-100',
      actionLabel: 'Ver clientes',
      actionTab: 'clientes' as const
    },
    {
      title: 'Relatórios Aguardando',
      value: waitingToSend,
      subtitle: 'Prontos na fila de despacho',
      icon: Clock,
      color: 'bg-amber-50 text-amber-600 border-amber-100',
      actionLabel: 'Fila de envio',
      actionTab: 'historico' as const
    },
    {
      title: 'Entregues este Mês',
      value: delivered,
      subtitle: `${sent} enviados sem confirmação`,
      icon: CheckCircle,
      color: 'bg-emerald-50 text-emerald-600 border-emerald-100',
      actionLabel: 'Ver histórico',
      actionTab: 'historico' as const
    },
    {
      title: 'Falhas de Envio',
      value: failed,
      subtitle: 'Necessitam de atenção',
      icon: AlertTriangle,
      color: failed > 0 ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-slate-50 text-slate-400 border-slate-100',
      actionLabel: 'Ver falhas',
      actionTab: 'historico' as const
    }
  ];

  // Helper to color queue items
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Lido':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-50 text-indigo-600 border border-indigo-100 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800/80">Lido</span>;
      case 'Entregue':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-600 border border-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/80">Entregue</span>;
      case 'Enviado':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-600 border border-blue-100 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/80">Enviado</span>;
      case 'Enviando':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-sky-50 text-sky-600 border border-sky-100 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800/80 animate-pulse">Enviando</span>;
      case 'Fila':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-600 border border-amber-100 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/80">Em Fila</span>;
      case 'Falhou':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-50 text-rose-600 border border-rose-100 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/80">Falhou</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-50 text-slate-600 border border-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-950 dark:text-slate-100 tracking-tight">
            Painel Geral de Envios
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Status geral das transmissões e relatórios automatizados via WhatsApp.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            id="dash_import_reports_btn"
            onClick={() => onNavigateToTab('upload')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
          >
            <FileCheck2 className="w-3.5 h-3.5" />
            Importar PDFs
          </button>
        </div>
      </div>

      {/* Grid of Indicator Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.3 }}
              key={stat.title}
              className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200/80 dark:border-slate-800 shadow-subtle flex flex-col justify-between"
            >
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-xs font-medium text-slate-400 dark:text-slate-400 uppercase tracking-wider">
                    {stat.title}
                  </span>
                  <h3 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tracking-tight">
                    {stat.value}
                  </h3>
                </div>
                <div className={`p-2.5 rounded-lg border ${stat.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                  {stat.subtitle}
                </span>
                <button
                  id={`stat_action_btn_${stat.actionTab}`}
                  onClick={() => onNavigateToTab(stat.actionTab)}
                  className="inline-flex items-center text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 gap-0.5"
                >
                  {stat.actionLabel}
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Worker Automated Queue Processing Panel */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/80 dark:border-slate-800 shadow-subtle p-5"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-slate-900 dark:bg-slate-800 text-emerald-400 shadow-sm flex items-center justify-center border border-slate-800 dark:border-slate-700">
              <Cpu className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                  Worker Automático (worker-fila-envios)
                </h3>
                {workerInfo?.ativo ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/80">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    Ativo
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200/80 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/80">
                    <span className="w-2 h-2 rounded-full bg-rose-500" />
                    Parado
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Processamento contínuo em segundo plano (executado via Cron a cada 1 min)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="worker_refresh_btn"
              onClick={loadWorkerStatus}
              disabled={isLoadingWorker}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-lg border border-slate-200/80 dark:border-slate-700 transition-all disabled:opacity-50"
              title="Atualizar status do worker"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingWorker ? 'animate-spin' : ''}`} />
              Atualizar Status
            </button>
            <button
              id="worker_trigger_btn"
              onClick={handleTriggerWorker}
              disabled={isTriggering}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-all disabled:opacity-50"
            >
              <Play className={`w-3.5 h-3.5 text-emerald-100 ${isTriggering ? 'animate-spin' : ''}`} />
              {isTriggering ? 'Executando...' : 'Executar Worker Agora'}
            </button>
          </div>
        </div>

        {/* Worker Details Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
          <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200/60 dark:border-slate-700/60 flex flex-col justify-between">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
              Última Execução
            </span>
            <span className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-1 block">
              {workerInfo?.ultimaExecucao
                ? new Date(workerInfo.ultimaExecucao).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : 'Aguardando cron'}
            </span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 block mt-0.5 font-mono">
              {workerInfo?.ultimaExecucao
                ? new Date(workerInfo.ultimaExecucao).toLocaleDateString('pt-BR')
                : '-'}
            </span>
          </div>

          <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200/60 dark:border-slate-700/60 flex flex-col justify-between">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
              Próxima Execução
            </span>
            <span className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-1 block">
              {workerInfo?.proximaExecucao
                ? new Date(workerInfo.proximaExecucao).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : 'Em instantes'}
            </span>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold block mt-0.5">
              Agendado (1 min)
            </span>
          </div>

          <div className="bg-amber-50/70 dark:bg-amber-950/40 p-3.5 rounded-xl border border-amber-200/60 dark:border-amber-800/50 flex flex-col justify-between">
            <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider block">
              Itens Pendentes
            </span>
            <span className="text-xl font-black text-amber-950 dark:text-amber-200 mt-0.5 block">
              {workerInfo ? workerInfo.itensPendentes : waitingToSend}
            </span>
            <span className="text-[10px] text-amber-700 dark:text-amber-400/90 block mt-0.5 font-medium">
              Elegíveis na fila
            </span>
          </div>

          <div className="bg-emerald-50/70 dark:bg-emerald-950/40 p-3.5 rounded-xl border border-emerald-200/60 dark:border-emerald-800/50 flex flex-col justify-between">
            <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider block">
              Processados Hoje
            </span>
            <span className="text-xl font-black text-emerald-950 dark:text-emerald-200 mt-0.5 block">
              {workerInfo ? workerInfo.itensProcessadosHoje : delivered + sent + failed}
            </span>
            <span className="text-[10px] text-emerald-700 dark:text-emerald-400/90 block mt-0.5 font-medium">
              Transmissões concluídas
            </span>
          </div>
        </div>
      </motion.div>

      {/* Visual Charts and Recent Sendings row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sends Graphic */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200/80 dark:border-slate-800 shadow-subtle lg:col-span-2 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
                Fluxo de Transmissões Recentes
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Total de relatórios enviados com sucesso por competência.</p>
            </div>
            <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-950 p-1 rounded-md border border-slate-200/60 dark:border-slate-800 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
              <span className="px-1.5 py-0.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded shadow-sm">
                Real
              </span>
            </div>
          </div>

          {/* Clean Dynamic SVG Chart or Empty State */}
          {(() => {
            const chartItems = queueItems.filter(item => ['Entregue', 'Lido', 'Enviado'].includes(item.status));
            const chartGroups: Record<string, number> = {};
            chartItems.forEach(item => {
              const key = item.competencia || 'Fila';
              chartGroups[key] = (chartGroups[key] || 0) + 1;
            });

            const chartKeys = Object.keys(chartGroups).sort((a, b) => {
              const splitA = a.split('/');
              const splitB = b.split('/');
              if (splitA.length === 2 && splitB.length === 2) {
                const dateA = new Date(parseInt(splitA[1]), parseInt(splitA[0]) - 1, 1).getTime();
                const dateB = new Date(parseInt(splitB[1]), parseInt(splitB[0]) - 1, 1).getTime();
                return dateA - dateB;
              }
              return 0;
            });

            const hasChartData = chartKeys.length >= 2;

            if (!hasChartData) {
              return (
                <div className="flex-1 min-h-[176px] flex flex-col items-center justify-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl p-6 text-center">
                  <TrendingUp className="w-8 h-8 text-slate-300 dark:text-slate-700 mb-2" />
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                    Ainda não há dados suficientes para este gráfico
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                    Cadastre clientes, realize o upload de PDFs e envie lotes para visualizar as estatísticas.
                  </p>
                </div>
              );
            }

            const maxVal = Math.max(...Object.values(chartGroups), 1);
            const points = chartKeys.map((key, index) => {
              const x = (index / (chartKeys.length - 1)) * 90 + 5;
              const y = 85 - (chartGroups[key] / maxVal) * 65;
              return { x, y, label: key, value: chartGroups[key] };
            });

            const pathD = `M ${points.map(p => `${p.x},${p.y}`).join(' L ')}`;
            const areaD = `${pathD} L ${points[points.length - 1].x},90 L ${points[0].x},90 Z`;

            return (
              <div className="h-44 w-full flex items-end justify-between relative mt-2 pt-4">
                {/* Guide lines */}
                <div className="absolute inset-x-0 top-4 border-t border-slate-100 dark:border-slate-800 text-[9px] text-slate-400 dark:text-slate-500 font-mono pt-0.5">{maxVal} envios</div>
                <div className="absolute inset-x-0 top-20 border-t border-slate-100 dark:border-slate-800 text-[9px] text-slate-400 dark:text-slate-500 font-mono pt-0.5">{Math.floor(maxVal / 2)} envios</div>
                <div className="absolute inset-x-0 bottom-4 border-t border-slate-100 dark:border-slate-800 text-[9px] text-slate-400 dark:text-slate-500 font-mono pt-0.5">0 envios</div>

                {/* Custom SVG Path Bar or Area */}
                <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 100">
                  <defs>
                    <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2563eb" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={areaD} fill="url(#chartGrad)" />
                  <path d={pathD} fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" />
                  {points.map((p, idx) => (
                    <circle key={idx} cx={p.x} cy={p.y} r="2.5" fill="#2563eb" />
                  ))}
                </svg>

                {/* Months labels */}
                <div className="absolute bottom-0 inset-x-0 flex justify-between px-2 text-[10px] font-medium text-slate-400 dark:text-slate-500 mt-2">
                  {points.map((p, idx) => (
                    <span key={idx}>{p.label}</span>
                  ))}
                </div>
              </div>
            );
          })()}

          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <TrendingUp className="w-4 h-4 text-blue-500" />
              Exibindo fluxo baseado exclusivamente nos relatórios enviados.
            </div>
            <div className="flex items-center gap-3 text-[10px] text-slate-400 dark:text-slate-500 font-mono">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-600" />
                WhatsApp Oficial
              </span>
            </div>
          </div>
        </div>

        {/* Latest Sends */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200/80 dark:border-slate-800 shadow-subtle flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
                Últimos Envios
              </h2>
              <span className="text-[10px] font-medium text-slate-400 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 px-1.5 py-0.5 rounded">
                Realtime
              </span>
            </div>

            <div className="space-y-3.5">
              {recentDispatches.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400 dark:text-slate-500 italic">
                  Nenhum relatório enviado recentemente.
                </div>
              ) : (
                recentDispatches.map((disp) => (
                  <div key={disp.id} className="flex items-start gap-3 border-b border-slate-100/60 dark:border-slate-800/60 pb-3 last:border-0 last:pb-0">
                    <div className="p-1.5 rounded bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-[10px] font-semibold">
                      PDF
                    </div>
                    <div className="overflow-hidden flex-1">
                      <p className="text-xs font-semibold text-slate-950 dark:text-slate-100 truncate leading-snug">
                        {disp.cliente_nome}
                      </p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-400 truncate mt-0.5 font-mono">
                        {disp.arquivo_nome}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {getStatusBadge(disp.status)}
                      <span className="text-[9px] text-slate-400 dark:text-slate-500 font-mono">
                        {disp.data_envio ? new Date(disp.data_envio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '-'}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <button
            id="dash_view_queue_btn"
            onClick={() => onNavigateToTab('historico')}
            className="w-full mt-4 py-1.5 bg-slate-50 hover:bg-slate-100/80 dark:bg-slate-800 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200 text-xs font-semibold transition-all flex items-center justify-center gap-1"
          >
            Ver fila de envios completa
            <ArrowRight className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
          </button>
        </div>
      </div>

      {/* Process Flow Cards (Steps info for user) */}
      <div className="bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
        <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider mb-3">
          Fluxo de Trabalho Recomendado
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-slate-800/80 p-3.5 rounded-lg border border-slate-200 dark:border-slate-700/80 shadow-subtle flex gap-3">
            <div className="w-7 h-7 rounded-full bg-blue-50 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400 text-xs font-bold flex items-center justify-center shrink-0">1</div>
            <div>
              <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">Cadastro de Clientes</h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Cadastre ou importe clientes via CSV especificando seu código único (ex: CLI0001).</p>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-800/80 p-3.5 rounded-lg border border-slate-200 dark:border-slate-700/80 shadow-subtle flex gap-3">
            <div className="w-7 h-7 rounded-full bg-blue-50 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400 text-xs font-bold flex items-center justify-center shrink-0">2</div>
            <div>
              <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">Upload dos Relatórios</h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Arraste múltiplos relatórios em PDF. O sistema extrai o código do cliente pelo nome do arquivo automaticamente.</p>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-800/80 p-3.5 rounded-lg border border-slate-200 dark:border-slate-700/80 shadow-subtle flex gap-3">
            <div className="w-7 h-7 rounded-full bg-blue-50 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400 text-xs font-bold flex items-center justify-center shrink-0">3</div>
            <div>
              <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">Validação e Despacho</h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Confira na tabela inteligente se há pendências. Com um clique crie o lote para envio imediato ou agendado.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
