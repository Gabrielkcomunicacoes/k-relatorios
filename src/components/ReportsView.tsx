import React, { useState, useEffect, useMemo } from 'react';
import { AuthUser, Client } from '../types';
import { relatoriosService, DetailedReport, auditoriaService, workerService } from '../services/supabaseService';
import { supabase } from '../lib/supabase';
import {
  FileText,
  Search,
  Filter,
  RefreshCw,
  Send,
  Calendar,
  CheckCircle2,
  Clock,
  AlertTriangle,
  HardDrive,
  Eye,
  Download,
  Trash2,
  History as HistoryIcon,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  X,
  AlertCircle,
  Shield,
  PhoneOff,
  UserX,
  CheckSquare,
  Square,
  Sparkles,
  Loader2,
  ExternalLink,
  Zap
} from 'lucide-react';

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
}

export function validateReportEligibility(report: DetailedReport): EligibilityResult {
  const reasons: string[] = [];

  if (!report?.id) {
    reasons.push('ID do relatório não encontrado.');
  }
  if (report?.status_validacao !== 'pronto') {
    reasons.push(`Status de validação não está pronto (${report?.status_validacao || 'pendente'}).`);
  }
  if (!report?.cliente_id) {
    reasons.push('Cliente não associado ao relatório.');
  }
  if (report?.cliente_ativo === false) {
    reasons.push('Cliente associado está inativo.');
  }
  if (report?.cliente_possui_optin === false) {
    reasons.push('Cliente não possui termo de consentimento (opt-in) ativo.');
  }
  if (!report?.cliente_telefone || report.cliente_telefone.replace(/\D/g, '').length === 0) {
    reasons.push('Cliente não possui telefone de WhatsApp cadastrado.');
  }
  if (!report?.storage_path) {
    reasons.push('Caminho do arquivo PDF (storage_path) ausente.');
  }
  if (report?.tem_envio_ativo) {
    reasons.push('Relatório já possui um envio ativo na fila de disparos.');
  }

  return {
    eligible: reasons.length === 0,
    reasons
  };
}

export function getExpirationNotice(report: DetailedReport) {
  // If already deleted or missing storage path
  if (report.arquivo_excluido || !report.storage_path) {
    const dataExcluidoStr = report.arquivo_excluido_em
      ? new Date(report.arquivo_excluido_em).toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        })
      : null;

    return {
      status: 'excluido' as const,
      eProximo: false,
      texto: 'PDF removido após envio',
      detalhes: dataExcluidoStr ? `Excluído em ${dataExcluidoStr}` : 'Excluído automaticamente 24h após envio'
    };
  }

  // Check if sent and calculate 24h timer
  if (!['enviado', 'entregue', 'lido'].includes(report.status_envio) || !report.ultimo_envio_data) {
    return null;
  }

  let targetTime: Date;
  if (report.arquivo_exclusao_agendada_para) {
    targetTime = new Date(report.arquivo_exclusao_agendada_para);
  } else {
    const envioDate = new Date(report.ultimo_envio_data);
    targetTime = new Date(envioDate.getTime() + 24 * 60 * 60 * 1000);
  }

  if (isNaN(targetTime.getTime())) return null;

  const diffMs = targetTime.getTime() - Date.now();

  if (diffMs <= 0) {
    return {
      status: 'pendente_limpeza' as const,
      eProximo: true,
      texto: 'Aguardando fila de exclusão 24h',
      detalhes: 'Agendado para remoção automática a qualquer momento'
    };
  }

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  let textoTempo = '';
  if (hours >= 1) {
    textoTempo = `Exclusão auto em ${hours}h ${minutes}m`;
  } else {
    textoTempo = `Exclusão auto em ${Math.max(1, minutes)} min`;
  }

  return {
    status: 'agendado' as const,
    eProximo: hours <= 3,
    texto: textoTempo,
    detalhes: `PDF será removido do storage em ${targetTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
  };
}

interface ReportsViewProps {
  user: AuthUser;
  clients: Client[];
  onNavigateToTab?: (tab: any) => void;
  onDataChange?: () => void;
}

export default function ReportsView({ user, clients, onNavigateToTab, onDataChange }: ReportsViewProps) {
  const [reports, setReports] = useState<DetailedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClient, setSelectedClient] = useState('');
  const [selectedCompetencia, setSelectedCompetencia] = useState('');
  const [selectedValidationStatus, setSelectedValidationStatus] = useState('');
  const [selectedSendStatus, setSelectedSendStatus] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [selectedOrigin, setSelectedOrigin] = useState('');

  // Selection state - strictly using Set of real UUIDs (report.id)
  const [selectedReportIds, setSelectedReportIds] = useState<Set<string>>(new Set());

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Modals state
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchModalType, setBatchModalType] = useState<'selected' | 'all'>('selected');
  
  // Single action schedule modal
  const [scheduleModalItem, setScheduleModalItem] = useState<DetailedReport | null>(null);
  const [scheduledDateTime, setScheduledDateTime] = useState('');

  // PDF Preview modal
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [previewPdfTitle, setPreviewPdfTitle] = useState<string>('');

  // History modal
  const [historyModalItem, setHistoryModalItem] = useState<DetailedReport | null>(null);
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Delete confirmation modal
  const [deleteModalItem, setDeleteModalItem] = useState<DetailedReport | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Admin Manual PDF Delete Modal State
  const [manualDeletePdfModalItem, setManualDeletePdfModalItem] = useState<DetailedReport | null>(null);
  const [deletingPdfManually, setDeletingPdfManually] = useState(false);

  // Action loading states per row
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Batch modal settings
  const [modalMode, setModalMode] = useState<'imediato' | 'agendado'>('imediato');
  const [batchScheduledDate, setBatchScheduledDate] = useState('');
  const [allowResend, setAllowResend] = useState(false);
  const [processingBatch, setProcessingBatch] = useState(false);

  // Fetch reports list
  const loadReports = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await relatoriosService.listDetailedReports();
      setReports(data || []);
    } catch (err: any) {
      console.error('Erro ao carregar relatórios:', err);
      setError(err.message || 'Falha ao carregar a lista de relatórios.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, []);

  // Compute summary stats
  const stats = useMemo(() => {
    const total = reports.length;
    const prontos = reports.filter(r => r.status_validacao === 'pronto').length;
    const naoEnviados = reports.filter(r => r.status_envio === 'nao_enviado').length;
    const enviados = reports.filter(r => ['enviado', 'entregue', 'lido'].includes(r.status_envio)).length;
    const falhou = reports.filter(r => r.status_envio === 'falhou').length;
    const bytesTotal = reports.reduce((acc, r) => acc + (r.tamanho_bytes || 0), 0);

    return {
      total,
      prontos,
      naoEnviados,
      enviados,
      falhou,
      bytesTotal
    };
  }, [reports]);

  // Format bytes
  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Unique dropdown options
  const uniqueCompetencias = useMemo(() => {
    const setComp = new Set<string>();
    reports.forEach(r => {
      if (r.competencia) setComp.add(r.competencia);
    });
    return Array.from(setComp).sort().reverse();
  }, [reports]);

  const uniqueTypes = useMemo(() => {
    const setTypes = new Set<string>();
    reports.forEach(r => {
      if (r.tipo_relatorio) setTypes.add(r.tipo_relatorio);
    });
    return Array.from(setTypes).sort();
  }, [reports]);

  // Filtered reports
  const filteredReports = useMemo(() => {
    return reports.filter(r => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = (r.nome_arquivo || '').toLowerCase().includes(q) || (r.nome_original || '').toLowerCase().includes(q);
        const matchesClient = (r.cliente_empresa || '').toLowerCase().includes(q);
        const matchesCode = (r.codigo_cliente || '').toLowerCase().includes(q);
        if (!matchesName && !matchesClient && !matchesCode) return false;
      }

      if (selectedClient && r.cliente_id !== selectedClient) {
        return false;
      }

      if (selectedCompetencia && r.competencia !== selectedCompetencia) {
        return false;
      }

      if (selectedValidationStatus && r.status_validacao !== selectedValidationStatus) {
        return false;
      }

      if (selectedSendStatus) {
        if (selectedSendStatus === 'proximos_exclusao') {
          const notice = getExpirationNotice(r);
          if (!notice || !notice.eProximo) return false;
        } else if (r.status_envio !== selectedSendStatus) {
          return false;
        }
      }

      if (selectedType && r.tipo_relatorio !== selectedType) {
        return false;
      }

      if (selectedOrigin) {
        if (selectedOrigin === 'manual' && r.recebido_via_integracao) return false;
        if (selectedOrigin === 'integracao' && !r.recebido_via_integracao) return false;
      }

      return true;
    });
  }, [
    reports,
    searchQuery,
    selectedClient,
    selectedCompetencia,
    selectedValidationStatus,
    selectedSendStatus,
    selectedType,
    selectedOrigin
  ]);

  // Pagination logic
  const totalPages = Math.ceil(filteredReports.length / pageSize) || 1;
  const paginatedReports = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredReports.slice(start, start + pageSize);
  }, [filteredReports, currentPage, pageSize]);

  // Handle select all visible on current page
  const visiblePageIds = useMemo(() => paginatedReports.map(r => r.id), [paginatedReports]);
  const isAllPageSelected = useMemo(() => {
    if (visiblePageIds.length === 0) return false;
    return visiblePageIds.every(id => selectedReportIds.has(id));
  }, [visiblePageIds, selectedReportIds]);

  const handleToggleSelectAllPage = () => {
    setSelectedReportIds(prev => {
      const next = new Set(prev);
      if (isAllPageSelected) {
        visiblePageIds.forEach(id => next.delete(id));
      } else {
        visiblePageIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const handleToggleSelectOne = (id: string) => {
    setSelectedReportIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setSelectedClient('');
    setSelectedCompetencia('');
    setSelectedValidationStatus('');
    setSelectedSendStatus('');
    setSelectedType('');
    setSelectedOrigin('');
    setCurrentPage(1);
  };

  // Open batch modal
  const openBatchModal = (type: 'selected' | 'all') => {
    setBatchModalType(type);
    setModalMode('imediato');
    setBatchScheduledDate('');
    setAllowResend(false);
    setBatchModalOpen(true);
  };

  // Target reports for batch modal (Strict filtering, no silent dropping before reporting)
  const batchTargetReports = useMemo(() => {
    if (batchModalType === 'selected') {
      return reports.filter(r => selectedReportIds.has(r.id));
    } else {
      return filteredReports;
    }
  }, [batchModalType, selectedReportIds, reports, filteredReports]);

  // Detailed analysis of batch target reports for eligibility
  const batchAnalysis = useMemo(() => {
    let semTelefone = 0;
    let clienteInativo = 0;
    let semOptin = 0;
    let naoPronto = 0;
    let jaEnviados = 0;
    let envioAtivo = 0;
    let semStorage = 0;

    const clientSet = new Set<string>();

    batchTargetReports.forEach(r => {
      if (r.cliente_id) clientSet.add(r.cliente_id);

      if (r.status_validacao !== 'pronto') naoPronto++;
      if (r.cliente_ativo === false) clienteInativo++;
      if (!r.cliente_telefone || r.cliente_telefone.replace(/\D/g, '').length === 0) semTelefone++;
      if (r.cliente_possui_optin === false) semOptin++;
      if (!r.storage_path) semStorage++;
      if (r.tem_envio_ativo) envioAtivo++;
      if (['enviado', 'entregue', 'lido'].includes(r.status_envio)) jaEnviados++;
    });

    // Calculate eligible list based on allowResend toggle and eligibility rules
    const eligibleList = batchTargetReports.filter(r => {
      if (!allowResend && ['enviado', 'entregue', 'lido'].includes(r.status_envio)) return false;
      const { eligible } = validateReportEligibility(r);
      return eligible;
    });

    return {
      total: batchTargetReports.length,
      clientesCount: clientSet.size,
      semTelefone,
      clienteInativo,
      semOptin,
      naoPronto,
      jaEnviados,
      envioAtivo,
      semStorage,
      eligibleCount: eligibleList.length,
      ineligibleCount: batchTargetReports.length - eligibleList.length,
      eligibleList
    };
  }, [batchTargetReports, allowResend]);

  // Execute Batch Send and trigger Edge Function
  const handleConfirmBatchSend = async () => {
    if (batchAnalysis.eligibleCount === 0) {
      alert('Não há relatórios elegíveis para envio com as opções selecionadas.');
      return;
    }

    if (modalMode === 'agendado' && !batchScheduledDate) {
      alert('Por favor, informe a data e o horário para o agendamento.');
      return;
    }

    setProcessingBatch(true);
    try {
      const nowStr = new Date().toLocaleDateString('pt-BR');
      const batchName = `Lote Relatórios ${nowStr} (${batchAnalysis.eligibleCount} envios)`;

      // 1. Create batch & queue items in database
      const res = await relatoriosService.criarLoteRelatorios(
        batchAnalysis.eligibleList,
        batchName,
        modalMode,
        modalMode === 'agendado' ? batchScheduledDate : null,
        allowResend,
        user.id
      );

      const createdLoteId = res?.loteId;
      if (!createdLoteId) {
        throw new Error('Falha ao obter ID do lote gerado.');
      }

      // 2. Trigger Edge Function if immediate mode
      if (modalMode === 'imediato') {
        const { data: triggerData, error: triggerErr } = await supabase.functions.invoke(
          'processar-fila-whatsapp',
          {
            body: { loteId: createdLoteId }
          }
        );

        if (triggerErr) {
          console.error('Erro na Edge Function processar-fila-whatsapp:', triggerErr);
          alert(`Lote criado, mas houve um erro ao disparar as mensagens: ${triggerErr.message || triggerErr}`);
        } else if (triggerData) {
          const processedCount = triggerData.processedCount ?? 0;
          const sucessos = triggerData.sucessos ?? 0;
          const falhas = triggerData.falhas ?? 0;

          if (processedCount === 0 && batchAnalysis.eligibleCount > 0) {
            alert(`Lote #${createdLoteId} criado, mas nenhum item pôde ser processado imediatamente. Verifique a fila.`);
          } else {
            alert(`Lote de envio processado com sucesso! Envio de ${sucessos} mensagem(ns) concluído com êxito (Falhas: ${falhas}).`);
          }
        }
      } else {
        alert(`Lote agendado com sucesso para ${new Date(batchScheduledDate).toLocaleString('pt-BR')}!`);
      }

      setBatchModalOpen(false);
      setSelectedReportIds(new Set());
      await loadReports();
      if (onDataChange) onDataChange();
    } catch (err: any) {
      console.error('Erro ao disparar lote de relatórios:', err);
      alert(err.message || 'Erro ao processar o envio em lote.');
    } finally {
      setProcessingBatch(false);
    }
  };

  // View PDF via temporary Signed URL and PDF Preview modal
  const handleViewPDF = async (report: DetailedReport) => {
    if (!report.storage_path) {
      alert('Caminho do arquivo PDF não cadastrado no banco de dados.');
      return;
    }
    setViewingId(report.id);
    try {
      const url = await relatoriosService.getSignedUrl(report.storage_path);
      setPreviewPdfUrl(url);
      setPreviewPdfTitle(report.nome_original || report.nome_arquivo || 'Visualização de PDF');
    } catch (err: any) {
      alert(err.message || 'Erro ao abrir visualização do PDF.');
    } finally {
      setViewingId(null);
    }
  };

  // Download PDF as Blob with multi-layer fallback
  const handleDownloadPDF = async (report: DetailedReport) => {
    if (!report.storage_path) {
      alert('Caminho do arquivo não informado no banco de dados.');
      return;
    }
    setDownloadingId(report.id);
    try {
      const url = await relatoriosService.getSignedUrl(report.storage_path);
      let downloaded = false;

      try {
        const res = await fetch(url);
        if (res.ok) {
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);

          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = report.nome_original || report.nome_arquivo || 'relatorio.pdf';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(blobUrl);
          downloaded = true;
        }
      } catch (fetchErr) {
        console.warn('Fetch de blob PDF falhou, ativando fallback de link direto:', fetchErr);
      }

      if (!downloaded) {
        const a = document.createElement('a');
        a.href = url;
        a.download = report.nome_original || report.nome_arquivo || 'relatorio.pdf';
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (err: any) {
      alert(err.message || 'Erro ao baixar o arquivo PDF.');
    } finally {
      setDownloadingId(null);
    }
  };

  // Single send now
  const handleSendSingleNow = async (report: DetailedReport) => {
    const { eligible, reasons } = validateReportEligibility(report);
    if (!eligible) {
      alert(`Atenção: O relatório não está pronto para envio imediato:\n\n• ${reasons.join('\n• ')}\n\nAcesse o cadastro do cliente para regularizar antes do disparo.`);
      return;
    }

    if (!confirm(`Confirmar envio imediato do relatório '${report.nome_arquivo}' para ${report.cliente_empresa}?`)) {
      return;
    }

    setSendingId(report.id);
    try {
      const batchName = `Envio Individual - ${report.cliente_empresa || 'Cliente'}`;
      const res = await relatoriosService.criarLoteRelatorios(
        [report],
        batchName,
        'imediato',
        null,
        true,
        user.id
      );

      const createdLoteId = res?.loteId;

      if (createdLoteId) {
        try {
          await supabase.functions.invoke('processar-fila-whatsapp', { body: { loteId: createdLoteId } });
        } catch (efErr) {
          console.warn('Edge function indisponível, acionando processador local:', efErr);
        }

        // Always trigger worker execution directly
        await workerService.triggerManualRun(user.id);
      }

      await loadReports();
      if (onDataChange) onDataChange();
      alert('Relatório enfileirado e enviado com sucesso via WhatsApp!');
    } catch (err: any) {
      alert(err.message || 'Erro ao enviar relatório.');
    } finally {
      setSendingId(null);
    }
  };

  // Single resend
  const handleResendSingle = async (report: DetailedReport) => {
    if (report.tem_envio_ativo) {
      alert('Este relatório já possui um envio ativo em processamento na fila. Verifique na aba de Lotes.');
      return;
    }

    if (!confirm(`Deseja reenviar o relatório '${report.nome_arquivo}' para ${report.cliente_empresa}?`)) {
      return;
    }

    setResendingId(report.id);
    try {
      const batchName = `Reenvio - ${report.cliente_empresa || 'Cliente'}`;
      const res = await relatoriosService.criarLoteRelatorios(
        [report],
        batchName,
        'imediato',
        null,
        true,
        user.id
      );

      const createdLoteId = res?.loteId;
      if (createdLoteId) {
        try {
          await supabase.functions.invoke('processar-fila-whatsapp', { body: { loteId: createdLoteId } });
        } catch (efErr) {
          console.warn('Edge function indisponível, acionando processador local:', efErr);
        }

        await workerService.triggerManualRun(user.id);
      }

      await loadReports();
      if (onDataChange) onDataChange();
      alert('Reenvio disparado com sucesso via WhatsApp!');
    } catch (err: any) {
      alert(err.message || 'Erro ao reenviar relatório.');
    } finally {
      setResendingId(null);
    }
  };

  // Single schedule submit
  const handleConfirmSingleSchedule = async () => {
    if (!scheduleModalItem) return;
    if (!scheduledDateTime) {
      alert('Informe a data e o horário para o agendamento.');
      return;
    }

    try {
      const batchName = `Agendamento - ${scheduleModalItem.cliente_empresa || 'Cliente'}`;
      await relatoriosService.criarLoteRelatorios(
        [scheduleModalItem],
        batchName,
        'agendado',
        scheduledDateTime,
        true,
        user.id
      );

      setScheduleModalItem(null);
      setScheduledDateTime('');
      await workerService.triggerManualRun(user.id);
      await loadReports();
      if (onDataChange) onDataChange();
      alert('Envio do relatório agendado com sucesso!');
    } catch (err: any) {
      alert(err.message || 'Erro ao agendar envio.');
    }
  };

  // View History
  const handleOpenHistory = async (report: DetailedReport) => {
    setHistoryModalItem(report);
    setLoadingHistory(true);
    try {
      const history = await relatoriosService.getHistory(report.id);
      setHistoryItems(history);
    } catch (err: any) {
      console.error('Erro ao carregar histórico:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  // Manual PDF Storage Deletion (Admin)
  const handleConfirmManualPdfDelete = async () => {
    if (!manualDeletePdfModalItem) return;
    setDeletingPdfManually(true);
    try {
      const res = await relatoriosService.excluirPdfManualmente(manualDeletePdfModalItem.id, user.id);
      if (res.success) {
        setManualDeletePdfModalItem(null);
        await loadReports();
        if (onDataChange) onDataChange();
        alert('PDF do relatório excluído com sucesso do Storage!');
      } else {
        alert(`Erro ao excluir PDF: ${res.message || 'Falha ao executar exclusão.'}`);
      }
    } catch (err: any) {
      alert(`Erro ao excluir PDF: ${err.message || 'Ocorreu um erro inesperado.'}`);
    } finally {
      setDeletingPdfManually(false);
    }
  };

  // Delete Report
  const handleConfirmDelete = async () => {
    if (!deleteModalItem) return;

    if (deleteConfirmText.trim().toUpperCase() !== 'EXCLUIR') {
      alert('Digite EXCLUIR para confirmar a exclusão definitiva.');
      return;
    }

    if (deleteModalItem.tem_envio_ativo) {
      alert('Não é possível excluir este relatório pois ele possui um envio ativo em andamento.');
      return;
    }

    setDeletingId(deleteModalItem.id);
    setDeleting(true);
    try {
      await relatoriosService.excluirManualCompleto(deleteModalItem.id, user.id);

      setSelectedReportIds(prev => {
        const next = new Set(prev);
        next.delete(deleteModalItem.id);
        return next;
      });

      setDeleteModalItem(null);
      setDeleteConfirmText('');
      await loadReports();
      if (onDataChange) onDataChange();
      alert('Relatório excluído do sistema com sucesso!');
    } catch (err: any) {
      alert(err.message || 'Erro ao excluir o relatório.');
    } finally {
      setDeleting(false);
      setDeletingId(null);
    }
  };

  // Helper status badge colors
  const getValidationStatusBadge = (status: string) => {
    switch (status) {
      case 'pronto':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      case 'pendente':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
      case 'invalido':
      case 'erro':
        return 'bg-red-500/10 text-red-400 border-red-500/30';
      default:
        return 'bg-slate-800 text-slate-400 border-slate-700';
    }
  };

  const getSendStatusBadge = (status: DetailedReport['status_envio']) => {
    switch (status) {
      case 'enviado':
      case 'entregue':
      case 'lido':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      case 'pendente':
      case 'agendado':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
      case 'processando':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
      case 'falhou':
        return 'bg-red-500/10 text-red-400 border-red-500/30';
      case 'nao_enviado':
      case 'cancelado':
      default:
        return 'bg-slate-800 text-slate-400 border-slate-700';
    }
  };

  const getSendStatusText = (status: DetailedReport['status_envio']) => {
    switch (status) {
      case 'nao_enviado': return 'Não enviado';
      case 'pendente': return 'Na fila';
      case 'agendado': return 'Agendado';
      case 'processando': return 'Processando';
      case 'enviado': return 'Enviado';
      case 'entregue': return 'Entregue';
      case 'lido': return 'Lido';
      case 'falhou': return 'Falhou';
      case 'cancelado': return 'Cancelado';
      default: return 'Não enviado';
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-600/10 border border-blue-500/20 rounded-xl text-blue-400">
              <FileText className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">Relatórios do Sistema</h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Consulte todos os relatórios em PDF cadastrados, verifique status de validação e disparo via WhatsApp API.
          </p>
        </div>

        {/* Top Primary Actions */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            id="btn_enviar_selecionados"
            onClick={() => openBatchModal('selected')}
            disabled={selectedReportIds.size === 0}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all shadow-sm ${
              selectedReportIds.size > 0
                ? 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            <span>Enviar selecionados</span>
            {selectedReportIds.size > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-blue-700 text-blue-100 font-bold">
                {selectedReportIds.size}
              </span>
            )}
          </button>

          <button
            id="btn_enviar_todos"
            onClick={() => openBatchModal('all')}
            disabled={filteredReports.length === 0}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all border shadow-sm ${
              filteredReports.length > 0
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 hover:border-slate-600 cursor-pointer'
                : 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-blue-400" />
            <span>Enviar todos os filtrados</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-700 text-slate-300 font-bold">
              {filteredReports.length}
            </span>
          </button>

          <button
            onClick={loadReports}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg transition-all"
            title="Atualizar lista"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Total</span>
            <FileText className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="text-xl font-bold text-white mt-2">{stats.total}</div>
        </div>

        <div className="p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-emerald-400 text-xs font-medium">
            <span>Prontos</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-emerald-400 mt-2">{stats.prontos}</div>
        </div>

        <div className="p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Não Enviados</span>
            <Clock className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="text-xl font-bold text-slate-300 mt-2">{stats.naoEnviados}</div>
        </div>

        <div className="p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-blue-400 text-xs font-medium">
            <span>Enviados</span>
            <Send className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <div className="text-xl font-bold text-blue-400 mt-2">{stats.enviados}</div>
        </div>

        <div className="p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-red-400 text-xs font-medium">
            <span>Com Falha</span>
            <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
          </div>
          <div className="text-xl font-bold text-red-400 mt-2">{stats.falhou}</div>
        </div>

        <div className="p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-purple-400 text-xs font-medium">
            <span>Armazenamento</span>
            <HardDrive className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="text-sm font-bold text-purple-300 mt-2">{formatBytes(stats.bytesTotal)}</div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-xl space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
          <Filter className="w-3.5 h-3.5 text-blue-400" />
          <span>Filtros de Busca</span>
          {(searchQuery || selectedClient || selectedCompetencia || selectedValidationStatus || selectedSendStatus || selectedType) && (
            <span className="text-[10px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full border border-blue-500/30">
              Filtros Ativos
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {/* Search query */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder="Buscar arquivo ou código..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Client Filter */}
          <select
            value={selectedClient}
            onChange={(e) => { setSelectedClient(e.target.value); setCurrentPage(1); }}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
          >
            <option value="">Todos os Clientes</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>
                {c.empresa} ({c.codigo_cliente})
              </option>
            ))}
          </select>

          {/* Competencia Filter */}
          <select
            value={selectedCompetencia}
            onChange={(e) => { setSelectedCompetencia(e.target.value); setCurrentPage(1); }}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
          >
            <option value="">Todas Competências</option>
            {uniqueCompetencias.map(comp => (
              <option key={comp} value={comp}>{comp}</option>
            ))}
          </select>

          {/* Validation Status Filter */}
          <select
            value={selectedValidationStatus}
            onChange={(e) => { setSelectedValidationStatus(e.target.value); setCurrentPage(1); }}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
          >
            <option value="">Status Validação</option>
            <option value="pronto">Pronto</option>
            <option value="pendente">Pendente</option>
            <option value="invalido">Inválido</option>
          </select>

          {/* Send Status Filter */}
          <select
            value={selectedSendStatus}
            onChange={(e) => { setSelectedSendStatus(e.target.value); setCurrentPage(1); }}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
          >
            <option value="">Status de Envio</option>
            <option value="nao_enviado">Não enviado</option>
            <option value="pendente">Na fila</option>
            <option value="agendado">Agendado</option>
            <option value="processando">Processando</option>
            <option value="enviado">Enviado</option>
            <option value="entregue">Entregue</option>
            <option value="lido">Lido</option>
            <option value="falhou">Falhou</option>
            <option value="cancelado">Cancelado</option>
            <option value="proximos_exclusao">⚠️ Próximos da exclusão (≤ 2 dias)</option>
          </select>

          {/* Type Filter */}
          <select
            value={selectedType}
            onChange={(e) => { setSelectedType(e.target.value); setCurrentPage(1); }}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
          >
            <option value="">Tipo de Relatório</option>
            {uniqueTypes.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          {/* Origin Filter */}
          <select
            value={selectedOrigin}
            onChange={(e) => { setSelectedOrigin(e.target.value); setCurrentPage(1); }}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
          >
            <option value="">Origem do Relatório</option>
            <option value="manual">Upload Manual</option>
            <option value="integracao">Recebido via Integração</option>
          </select>
        </div>

        {(searchQuery || selectedClient || selectedCompetencia || selectedValidationStatus || selectedSendStatus || selectedType || selectedOrigin) && (
          <div className="flex justify-end pt-1">
            <button
              onClick={handleClearFilters}
              className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3 h-3" />
              <span>Limpar todos os filtros</span>
            </button>
          </div>
        )}
      </div>

      {/* Error state alert */}
      {error && (
        <div className="p-4 bg-red-950/30 border border-red-800/50 rounded-xl text-red-300 text-xs flex items-center gap-3">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Table Card */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        {/* Selection Indicator & Page Size header */}
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between text-xs bg-slate-950/40">
          <div className="flex items-center gap-3">
            <button
              onClick={handleToggleSelectAllPage}
              className="flex items-center gap-1.5 text-slate-300 hover:text-white font-medium cursor-pointer"
            >
              {isAllPageSelected ? (
                <CheckSquare className="w-4 h-4 text-blue-400" />
              ) : (
                <Square className="w-4 h-4 text-slate-500" />
              )}
              <span>Selecionar todos visíveis nesta página</span>
            </button>

            {selectedReportIds.size > 0 && (
              <span className="text-blue-400 font-semibold bg-blue-500/10 px-2.5 py-0.5 rounded-full border border-blue-500/20">
                {selectedReportIds.size} selecionado(s)
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-slate-400">
            <span>Exibir por página:</span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
              className="bg-slate-950 border border-slate-800 text-slate-300 text-xs rounded px-2 py-1 focus:outline-none"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>

        {/* Table Content */}
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-blue-400" />
            <p className="text-xs">Carregando relatórios do banco de dados...</p>
          </div>
        ) : filteredReports.length === 0 ? (
          <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
            <FileText className="w-8 h-8 text-slate-600 mb-1" />
            <p className="text-sm font-semibold text-slate-300">Nenhum relatório encontrado</p>
            <p className="text-xs text-slate-500">Tente ajustar seus filtros de busca ou fazer o upload de novos PDFs.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-950/80 text-slate-400 border-b border-slate-800 font-medium">
                  <th className="p-3 w-10 text-center">#</th>
                  <th className="p-3">Nome do Arquivo</th>
                  <th className="p-3">Cliente</th>
                  <th className="p-3">Código</th>
                  <th className="p-3">Competência</th>
                  <th className="p-3">Tipo</th>
                  <th className="p-3">Validação</th>
                  <th className="p-3">Versão</th>
                  <th className="p-3">Upload</th>
                  <th className="p-3">Tamanho</th>
                  <th className="p-3">Status Envio</th>
                  <th className="p-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {paginatedReports.map((report) => {
                  const isSelected = selectedReportIds.has(report.id);
                  const { eligible, reasons } = validateReportEligibility(report);
                  const hasPreviousSend = ['enviado', 'entregue', 'lido', 'falhou'].includes(report.status_envio);
                  const isPdfDeleted = Boolean(report.arquivo_excluido || !report.storage_path);

                  return (
                    <tr
                      key={report.id}
                      className={`hover:bg-slate-800/40 transition-colors ${
                        isSelected ? 'bg-blue-950/20' : ''
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="p-3 text-center">
                        <button
                          onClick={() => handleToggleSelectOne(report.id)}
                          className="text-slate-400 hover:text-white cursor-pointer"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-blue-400" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-600" />
                          )}
                        </button>
                      </td>

                      {/* File Name */}
                      <td className="p-3 font-medium text-slate-200 max-w-[240px]" title={report.nome_arquivo}>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5 truncate">
                            <FileText className={`w-3.5 h-3.5 shrink-0 ${isPdfDeleted ? 'text-slate-500' : 'text-blue-400'}`} />
                            <span className={`truncate ${isPdfDeleted ? 'text-slate-400 line-through decoration-slate-600' : ''}`}>
                              {report.nome_arquivo}
                            </span>
                          </div>
                          {isPdfDeleted && (
                            <div className="flex items-center gap-1">
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-slate-800 text-slate-400 border border-slate-700/80"
                                title="O arquivo PDF foi removido 24 horas após o envio para liberar armazenamento no Storage."
                              >
                                <Trash2 className="w-2.5 h-2.5 text-slate-500 shrink-0" />
                                <span>PDF removido após envio</span>
                              </span>
                            </div>
                          )}
                          {report.recebido_via_integracao && (
                            <div className="flex items-center gap-1">
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/30"
                                title={`Origem: ${report.origem_sistema || 'Sistema Externo'} | ID: ${report.identificador_origem || '-'} | Período: ${report.periodo_inicio || '-'} a ${report.periodo_fim || '-'}`}
                              >
                                <Zap className="w-2.5 h-2.5 text-purple-400" />
                                <span>Recebido automaticamente</span>
                              </span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Cliente */}
                      <td className="p-3 max-w-[160px] truncate" title={report.cliente_empresa || 'Sem cliente'}>
                        <div className="flex flex-col">
                          <span className="font-semibold text-slate-200 truncate">{report.cliente_empresa || 'Não associado'}</span>
                          {report.cliente_telefone ? (
                            <span className="text-[10px] text-slate-500">{report.cliente_telefone}</span>
                          ) : (
                            <span className="text-[10px] text-amber-500/80">Sem WhatsApp</span>
                          )}
                        </div>
                      </td>

                      {/* Código */}
                      <td className="p-3 text-slate-400 font-mono text-[11px]">
                        {report.codigo_cliente || '-'}
                      </td>

                      {/* Competencia */}
                      <td className="p-3 text-slate-300 font-medium">
                        {report.competencia}
                      </td>

                      {/* Tipo */}
                      <td className="p-3 text-slate-400">
                        {report.tipo_relatorio}
                      </td>

                      {/* Validação */}
                      <td className="p-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${getValidationStatusBadge(report.status_validacao)}`}>
                          {report.status_validacao === 'pronto' ? 'Pronto' : report.status_validacao}
                        </span>
                      </td>

                      {/* Versão */}
                      <td className="p-3">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 font-mono">
                          v{report.versao || 1}
                          {report.versao_atual && (
                            <span className="text-[9px] text-emerald-400 font-bold">•</span>
                          )}
                        </span>
                      </td>

                      {/* Upload Date */}
                      <td className="p-3 text-slate-400 text-[11px]">
                        {new Date(report.created_at).toLocaleDateString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </td>

                      {/* File Size */}
                      <td className="p-3 text-slate-400 font-mono text-[11px]">
                        {formatBytes(report.tamanho_bytes)}
                      </td>

                      {/* Status Envio */}
                      <td className="p-3">
                        <div className="flex flex-col items-start gap-1">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${getSendStatusBadge(report.status_envio)}`}>
                            {getSendStatusText(report.status_envio)}
                          </span>
                          {(() => {
                            const notice = getExpirationNotice(report);
                            if (!notice) return null;

                            if (notice.status === 'excluido') {
                              return (
                                <span
                                  className="text-[9px] font-semibold flex items-center gap-1 text-slate-400 bg-slate-800/80 px-1.5 py-0.5 rounded border border-slate-700/60"
                                  title={notice.detalhes}
                                >
                                  <Trash2 className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                                  <span>{notice.texto}</span>
                                </span>
                              );
                            }

                            if (notice.status === 'pendente_limpeza') {
                              return (
                                <span
                                  className="text-[9px] font-semibold flex items-center gap-1 text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30"
                                  title={notice.detalhes}
                                >
                                  <Clock className="w-2.5 h-2.5 shrink-0" />
                                  <span>{notice.texto}</span>
                                </span>
                              );
                            }

                            return (
                              <span
                                className={`text-[9px] font-semibold flex items-center gap-1 ${
                                  notice.eProximo
                                    ? 'text-amber-400 font-bold bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20'
                                    : 'text-slate-400'
                                }`}
                                title={notice.detalhes}
                              >
                                <Clock className="w-2.5 h-2.5 shrink-0" />
                                <span>{notice.texto}</span>
                              </span>
                            );
                          })()}
                        </div>
                      </td>

                      {/* Actions Column */}
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* Visualizar PDF */}
                          <button
                            onClick={() => handleViewPDF(report)}
                            disabled={isPdfDeleted || viewingId === report.id}
                            className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-800 rounded transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                            title={isPdfDeleted ? "O PDF foi excluído 24h após o envio. O histórico foi preservado." : "Visualizar PDF"}
                          >
                            {viewingId === report.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {/* Baixar PDF */}
                          <button
                            onClick={() => handleDownloadPDF(report)}
                            disabled={isPdfDeleted || downloadingId === report.id}
                            className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                            title={isPdfDeleted ? "O PDF foi excluído 24h após o envio. O histórico foi preservado." : "Baixar PDF"}
                          >
                            {downloadingId === report.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                            ) : (
                              <Download className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {/* Enviar Agora */}
                          <button
                            onClick={() => handleSendSingleNow(report)}
                            disabled={isPdfDeleted || !eligible || sendingId === report.id}
                            className={`p-1.5 rounded transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                              eligible && !isPdfDeleted
                                ? 'text-slate-400 hover:text-blue-400 hover:bg-slate-800'
                                : 'text-slate-400 hover:text-amber-400 hover:bg-slate-800'
                            }`}
                            title={
                              isPdfDeleted
                                ? "Não é possível enviar um PDF excluído. Envie um novo relatório."
                                : eligible
                                ? "Enviar Agora via WhatsApp"
                                : `Informações pendentes: ${reasons.join(', ')}`
                            }
                          >
                            {sendingId === report.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                            ) : (
                              <Send className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {/* Agendar */}
                          <button
                            onClick={() => { setScheduleModalItem(report); setScheduledDateTime(''); }}
                            disabled={isPdfDeleted}
                            className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                            title={isPdfDeleted ? "Não é possível agendar um PDF excluído." : "Agendar Envio"}
                          >
                            <Calendar className="w-3.5 h-3.5" />
                          </button>

                          {/* Reenviar */}
                          <button
                            onClick={() => handleResendSingle(report)}
                            disabled={isPdfDeleted || resendingId === report.id}
                            className="p-1.5 text-slate-400 hover:text-purple-400 hover:bg-slate-800 rounded transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                            title={
                              isPdfDeleted
                                ? "O PDF deste relatório foi removido 24h após o envio para liberar armazenamento."
                                : hasPreviousSend
                                ? "Reenviar Relatório via WhatsApp"
                                : "Disparar Relatório via WhatsApp"
                            }
                          >
                            {resendingId === report.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
                            ) : (
                              <RotateCcw className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {/* Ver Histórico */}
                          <button
                            onClick={() => handleOpenHistory(report)}
                            className="p-1.5 text-slate-400 hover:text-teal-400 hover:bg-slate-800 rounded transition-all cursor-pointer"
                            title="Ver histórico de envios (Preservado)"
                          >
                            <HistoryIcon className="w-3.5 h-3.5" />
                          </button>

                          {/* Excluir PDF Agora (Administrador) */}
                          {user.role === 'Administrador' && !isPdfDeleted && (
                            <button
                              onClick={() => setManualDeletePdfModalItem(report)}
                              disabled={deletingId === report.id}
                              className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 rounded transition-all cursor-pointer disabled:opacity-50"
                              title="Excluir PDF do Storage Agora"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-amber-400/80" />
                            </button>
                          )}

                          {/* Excluir Registro do Relatório Inteiro */}
                          {user.role === 'Administrador' && (
                            <button
                              onClick={() => setDeleteModalItem(report)}
                              disabled={deletingId === report.id}
                              className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-all cursor-pointer disabled:opacity-50"
                              title="Excluir Registro do Relatório"
                            >
                              {deletingId === report.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-red-400" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5 text-red-400/60 hover:text-red-400" />
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {filteredReports.length > 0 && (
          <div className="p-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 bg-slate-950/40">
            <div>
              Mostrando <span className="font-semibold text-slate-200">{Math.min((currentPage - 1) * pageSize + 1, filteredReports.length)}</span> a{' '}
              <span className="font-semibold text-slate-200">{Math.min(currentPage * pageSize, filteredReports.length)}</span> de{' '}
              <span className="font-semibold text-slate-200">{filteredReports.length}</span> relatórios
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1.5 bg-slate-900 border border-slate-800 rounded hover:bg-slate-800 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2 text-slate-300 font-medium">
                Página {currentPage} de {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 bg-slate-900 border border-slate-800 rounded hover:bg-slate-800 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ==========================================
          MODAL DE ENVIO EM LOTE (Rule 4, 5, 6)
         ========================================== */}
      {batchModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full overflow-hidden shadow-2xl animate-fade-in flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-blue-600/10 border border-blue-500/20 rounded-xl text-blue-400">
                  <Send className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-100 text-base">Criar Lote de Envio em Massa</h3>
                  <p className="text-xs text-slate-400">
                    Análise prévia dos relatórios {batchModalType === 'selected' ? 'selecionados' : 'filtrados'}.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setBatchModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5 overflow-y-auto flex-1">
              {/* Summary target numbers (Explicit Total Selecionado vs Elegíveis vs Inelegíveis) */}
              <div className="grid grid-cols-3 gap-3 p-3.5 bg-slate-950 border border-slate-800 rounded-xl text-xs">
                <div>
                  <span className="text-slate-400 block font-medium">Total Selecionado:</span>
                  <span className="text-lg font-bold text-white">{batchAnalysis.total}</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Total Elegível:</span>
                  <span className="text-lg font-bold text-emerald-400">{batchAnalysis.eligibleCount}</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Total Inelegível:</span>
                  <span className="text-lg font-bold text-amber-400">{batchAnalysis.ineligibleCount}</span>
                </div>
              </div>

              {/* Warnings / Ineligibility breakdown */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-300">Análise de Elegibilidade e Validações:</h4>
                <div className="space-y-1.5 text-xs">
                  {batchAnalysis.semTelefone > 0 && (
                    <div className="p-2.5 bg-amber-950/30 border border-amber-800/40 rounded-lg text-amber-300 flex items-center gap-2">
                      <PhoneOff className="w-4 h-4 shrink-0 text-amber-400" />
                      <span>{batchAnalysis.semTelefone} arquivo(s) sem telefone de WhatsApp cadastrado</span>
                    </div>
                  )}

                  {batchAnalysis.clienteInativo > 0 && (
                    <div className="p-2.5 bg-amber-950/30 border border-amber-800/40 rounded-lg text-amber-300 flex items-center gap-2">
                      <UserX className="w-4 h-4 shrink-0 text-amber-400" />
                      <span>{batchAnalysis.clienteInativo} arquivo(s) pertencem a clientes inativos</span>
                    </div>
                  )}

                  {batchAnalysis.semOptin > 0 && (
                    <div className="p-2.5 bg-amber-950/30 border border-amber-800/40 rounded-lg text-amber-300 flex items-center gap-2">
                      <Shield className="w-4 h-4 shrink-0 text-amber-400" />
                      <span>{batchAnalysis.semOptin} arquivo(s) sem opt-in ativo do cliente</span>
                    </div>
                  )}

                  {batchAnalysis.naoPronto > 0 && (
                    <div className="p-2.5 bg-red-950/30 border border-red-800/40 rounded-lg text-red-300 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                      <span>{batchAnalysis.naoPronto} arquivo(s) com status de validação pendente/inválido</span>
                    </div>
                  )}

                  {batchAnalysis.envioAtivo > 0 && (
                    <div className="p-2.5 bg-blue-950/30 border border-blue-800/40 rounded-lg text-blue-300 flex items-center gap-2">
                      <Clock className="w-4 h-4 shrink-0 text-blue-400" />
                      <span>{batchAnalysis.envioAtivo} relatório(s) já possuem envio ativo na fila</span>
                    </div>
                  )}

                  {batchAnalysis.jaEnviados > 0 && (
                    <div className="p-2.5 bg-slate-800/80 border border-slate-700/80 rounded-lg text-slate-300 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                      <span>{batchAnalysis.jaEnviados} relatório(s) já foram enviados anteriormente</span>
                    </div>
                  )}

                  <div className="p-3 bg-blue-950/40 border border-blue-800/60 rounded-xl text-blue-200 flex items-center justify-between font-semibold mt-2">
                    <span>Total final elegível para este lote:</span>
                    <span className="text-sm text-blue-300 font-bold">{batchAnalysis.eligibleCount} relatórios</span>
                  </div>
                </div>
              </div>

              {/* Mode Options */}
              <div className="space-y-3 pt-2">
                <label className="text-xs font-semibold text-slate-300 block">Modalidade do Disparo:</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setModalMode('imediato')}
                    className={`p-3 rounded-xl border text-left text-xs font-medium transition-all cursor-pointer ${
                      modalMode === 'imediato'
                        ? 'bg-blue-600/10 border-blue-500 text-blue-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold text-slate-200 mb-0.5">
                      <Send className="w-3.5 h-3.5 text-blue-400" />
                      <span>Enviar Imediatamente</span>
                    </div>
                    <span>Cria o lote e dispara a fila no WhatsApp em tempo real.</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setModalMode('agendado')}
                    className={`p-3 rounded-xl border text-left text-xs font-medium transition-all cursor-pointer ${
                      modalMode === 'agendado'
                        ? 'bg-blue-600/10 border-blue-500 text-blue-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold text-slate-200 mb-0.5">
                      <Calendar className="w-3.5 h-3.5 text-amber-400" />
                      <span>Agendar Data e Hora</span>
                    </div>
                    <span>Enfileira os itens para disparo na data programada.</span>
                  </button>
                </div>

                {modalMode === 'agendado' && (
                  <div className="mt-2 space-y-1">
                    <label className="text-[11px] text-slate-400 block font-medium">Data e Horário do Agendamento:</label>
                    <input
                      type="datetime-local"
                      value={batchScheduledDate}
                      onChange={(e) => setBatchScheduledDate(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                )}

                {/* Checkbox Reenviar ja enviados */}
                <div className="pt-2">
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowResend}
                      onChange={(e) => setAllowResend(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-950 text-blue-600 focus:ring-blue-500"
                    />
                    <span>Reenviar relatórios que já foram enviados anteriormente</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setBatchModalOpen(false)}
                disabled={processingBatch}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition-all cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleConfirmBatchSend}
                disabled={processingBatch || batchAnalysis.eligibleCount === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-sm"
              >
                {processingBatch ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Processando Lote...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Criar Lote e Disparar ({batchAnalysis.eligibleCount})</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================
          MODAL DE VISUALIZAÇÃO DE PDF
         ========================================== */}
      {previewPdfUrl && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full p-5 space-y-4 shadow-2xl animate-fade-in flex flex-col h-[85vh]">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-slate-100 font-bold text-sm">
                <FileText className="w-4 h-4 text-blue-400" />
                <span className="truncate max-w-md">{previewPdfTitle}</span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={previewPdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg flex items-center gap-1 transition-all"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Abrir em Nova Aba</span>
                </a>
                <button
                  onClick={() => setPreviewPdfUrl(null)}
                  className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-all cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 bg-slate-950 rounded-xl overflow-hidden border border-slate-800">
              <iframe
                src={previewPdfUrl}
                title={previewPdfTitle}
                className="w-full h-full border-0"
              />
            </div>
          </div>
        </div>
      )}

      {/* ==========================================
          MODAL DE AGENDAMENTO INDIVIDUAL
         ========================================== */}
      {scheduleModalItem && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-fade-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
                <Calendar className="w-4 h-4 text-amber-400" />
                <span>Agendar Envio de Relatório</span>
              </h3>
              <button onClick={() => setScheduleModalItem(null)} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-300 space-y-1 bg-slate-950 p-3 rounded-xl border border-slate-800">
              <p><strong>Arquivo:</strong> {scheduleModalItem.nome_arquivo}</p>
              <p><strong>Cliente:</strong> {scheduleModalItem.cliente_empresa || 'Não associado'}</p>
              <p><strong>Telefone:</strong> {scheduleModalItem.cliente_telefone || 'Sem WhatsApp'}</p>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400 block font-medium">Data e Horário do Disparo:</label>
              <input
                type="datetime-local"
                value={scheduledDateTime}
                onChange={(e) => setScheduledDateTime(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setScheduleModalItem(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:bg-slate-800 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmSingleSchedule}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white cursor-pointer"
              >
                Confirmar Agendamento
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================
          MODAL DE HISTÓRICO DE ENVIOS
         ========================================== */}
      {historyModalItem && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 space-y-4 shadow-2xl animate-fade-in max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
                <HistoryIcon className="w-4 h-4 text-teal-400" />
                <span>Histórico de Envios do Relatório</span>
              </h3>
              <button onClick={() => setHistoryModalItem(null)} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-300 space-y-1 bg-slate-950 p-3 rounded-lg border border-slate-800">
              <p><strong>Arquivo:</strong> {historyModalItem.nome_arquivo}</p>
              <p><strong>Cliente:</strong> {historyModalItem.cliente_empresa} ({historyModalItem.codigo_cliente || 'Sem código'})</p>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2">
              {loadingHistory ? (
                <div className="p-8 text-center text-slate-500 text-xs flex flex-col items-center gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-teal-400" />
                  <span>Carregando histórico do banco de dados...</span>
                </div>
              ) : historyItems.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs">
                  Nenhum histórico de envio registrado para este relatório.
                </div>
              ) : (
                <div className="space-y-2 text-xs">
                  {historyItems.map((item, idx) => (
                    <div key={item.id || idx} className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-slate-200">
                          {item.lotes_envio?.nome || 'Envio Direto'}
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getSendStatusBadge(item.status)}`}>
                          {getSendStatusText(item.status)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                        <div>
                          <strong>Destino:</strong> {item.telefone_destino || '-'}
                        </div>
                        <div>
                          <strong>Criado em:</strong> {new Date(item.created_at).toLocaleString('pt-BR')}
                        </div>
                        {item.whatsapp_message_id && (
                          <div className="col-span-2 font-mono text-[10px] text-slate-500">
                            <strong>WhatsApp ID:</strong> {item.whatsapp_message_id}
                          </div>
                        )}
                        {item.tentativas > 0 && (
                          <div>
                            <strong>Tentativas:</strong> {item.tentativas}
                          </div>
                        )}
                      </div>

                      {item.erro_mensagem && (
                        <div className="p-2 bg-red-950/40 border border-red-800/40 rounded text-red-300 text-[11px]">
                          <strong>Erro:</strong> {item.erro_mensagem}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-800">
              <button
                onClick={() => setHistoryModalItem(null)}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================
          MODAL DE CONFIRMAÇÃO DE EXCLUSÃO
         ========================================== */}
      {deleteModalItem && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl animate-fade-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-3 text-rose-400">
                <div className="p-2 bg-rose-500/10 border border-rose-500/20 rounded-xl">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-100 text-sm">Excluir Relatório Definitivamente</h3>
                  <p className="text-[11px] text-slate-400">Ação irreversível de limpeza completa</p>
                </div>
              </div>
              <button
                onClick={() => { setDeleteModalItem(null); setDeleteConfirmText(''); }}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Detailed Info Card */}
            <div className="space-y-2 text-xs bg-slate-950 p-3.5 rounded-xl border border-slate-800 text-slate-300">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-slate-500 text-[10px] uppercase font-bold block">Cliente</span>
                  <span className="font-semibold text-slate-200">{deleteModalItem.cliente_empresa || 'Não associado'}</span>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px] uppercase font-bold block">Competência</span>
                  <span className="font-semibold text-slate-200">{deleteModalItem.competencia}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500 text-[10px] uppercase font-bold block">Arquivo PDF</span>
                  <span className="font-mono text-slate-200 break-all">{deleteModalItem.nome_arquivo}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500 text-[10px] uppercase font-bold block">Data do Último Envio Real</span>
                  <span className="font-medium text-slate-300">
                    {deleteModalItem.ultimo_envio_data
                      ? new Date(deleteModalItem.ultimo_envio_data).toLocaleString('pt-BR')
                      : 'Nenhum envio concluído'}
                  </span>
                </div>
              </div>
            </div>

            {/* Explicit Notice */}
            <div className="p-3 bg-rose-950/30 border border-rose-800/40 rounded-xl text-xs text-rose-300 space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-rose-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Atenção: Exclusão Permanente</span>
              </div>
              <p className="text-[11px] leading-relaxed text-rose-200/90">
                Serão removidos o arquivo PDF do bucket Storage, o registro em <code>public.relatorios</code> e os históricos de fila de envios. Os dados do cliente, lotes e logs de auditoria serão totalmente preservados.
              </p>
            </div>

            {/* Required Text Input */}
            <div className="space-y-1.5">
              <label className="text-xs text-slate-300 font-medium block">
                Para confirmar a exclusão, digite <span className="font-mono font-bold text-rose-400">EXCLUIR</span> no campo abaixo:
              </label>
              <input
                type="text"
                placeholder="EXCLUIR"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono tracking-wider focus:outline-none focus:border-rose-500 uppercase"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => { setDeleteModalItem(null); setDeleteConfirmText(''); }}
                disabled={deleting}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:bg-slate-800 cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={deleting || deleteConfirmText.trim().toUpperCase() !== 'EXCLUIR'}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-sm"
              >
                {deleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Excluindo...</span>
                  </>
                ) : (
                  <span>Excluir Agora</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================
          MODAL DE EXCLUSÃO MANUAL DO PDF (ADMIN)
         ========================================== */}
      {manualDeletePdfModalItem && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl animate-fade-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-3 text-amber-400">
                <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                  <Trash2 className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-100 text-sm">Excluir PDF do Storage Agora</h3>
                  <p className="text-[11px] text-slate-400">Liberar espaço de armazenamento no Supabase</p>
                </div>
              </div>
              <button
                onClick={() => setManualDeletePdfModalItem(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Detailed Info Card */}
            <div className="space-y-2 text-xs bg-slate-950 p-3.5 rounded-xl border border-slate-800 text-slate-300">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-slate-500 text-[10px] uppercase font-bold block">Cliente</span>
                  <span className="font-semibold text-slate-200">{manualDeletePdfModalItem.cliente_empresa || 'Não associado'}</span>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px] uppercase font-bold block">Competência</span>
                  <span className="font-semibold text-slate-200">{manualDeletePdfModalItem.competencia}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500 text-[10px] uppercase font-bold block">Nome do Arquivo</span>
                  <span className="font-mono text-slate-200 break-all">{manualDeletePdfModalItem.nome_arquivo}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500 text-[10px] uppercase font-bold block">Data do Envio</span>
                  <span className="font-medium text-slate-300">
                    {manualDeletePdfModalItem.ultimo_envio_data
                      ? new Date(manualDeletePdfModalItem.ultimo_envio_data).toLocaleString('pt-BR')
                      : 'Não enviado'}
                  </span>
                </div>
              </div>
            </div>

            {/* Warning Notice */}
            <div className="p-3.5 bg-amber-950/30 border border-amber-800/40 rounded-xl text-xs text-amber-300 space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Aviso Importante</span>
              </div>
              <p className="text-[11px] leading-relaxed text-amber-200/90">
                Após a exclusão, o download, a visualização e o reenvio do arquivo PDF não serão mais possíveis. Todos os registros históricos do relatório, logs de auditoria e informações do cliente serão mantidos integralmente no sistema.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setManualDeletePdfModalItem(null)}
                disabled={deletingPdfManually}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:bg-slate-800 cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmManualPdfDelete}
                disabled={deletingPdfManually}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
              >
                {deletingPdfManually ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Excluindo PDF...</span>
                  </>
                ) : (
                  <span>Excluir PDF Agora</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
