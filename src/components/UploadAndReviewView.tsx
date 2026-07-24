import React, { useState, useRef } from 'react';
import { Client, PDFReport, ReportStatus, Batch, DuplicateReportDetails, DuplicateResolutionAction } from '../types';
import {
  UploadCloud,
  FileText,
  AlertTriangle,
  CheckCircle,
  HelpCircle,
  X,
  Plus,
  ArrowRight,
  Sparkles,
  RefreshCw,
  CalendarDays,
  Play,
  Trash2,
  Phone,
  User,
  Info,
  Layers,
  Database,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DuplicateReportModal } from './DuplicateReportModal';
import { relatoriosService, calculateFileHash, competenciaToDateStr } from '../services/supabaseService';

interface UploadAndReviewViewProps {
  clients: Client[];
  historyQueue: { competencia: string; cliente_id: string }[];
  onCreateBatch: (name: string, competencia: string, reports: PDFReport[], scheduledDate?: string) => Promise<void>;
  onNavigateToTab: (tab: 'lotes' | 'historico') => void;
}

export default function UploadAndReviewView({
  clients,
  historyQueue,
  onCreateBatch,
  onNavigateToTab
}: UploadAndReviewViewProps) {
  const [reports, setReports] = useState<PDFReport[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Scheduling states
  const [isDispatchModalOpen, setIsDispatchModalOpen] = useState(false);
  const [dispatchType, setDispatchType] = useState<'imediato' | 'agendado' | 'cliente_padrao'>('imediato');
  const [scheduledDate, setScheduledDate] = useState('2026-07-21');
  const [scheduledTime, setScheduledTime] = useState('09:00');
  const [batchName, setBatchName] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filename Parsing Logic
  const parseFilename = (fileName: string): Omit<PDFReport, 'id' | 'progress' | 'isDuplicate'> => {
    const uppercase = fileName.toUpperCase();
    
    // Check if valid PDF extension
    const isPDF = uppercase.endsWith('.PDF');
    if (!isPDF) {
      return {
        fileName,
        fileSize: 0,
        extractedCode: null,
        extractedYear: null,
        extractedMonth: null,
        competencia: null,
        client_id: null,
        client_name: null,
        client_phone: null,
        status: 'Arquivo inválido'
      };
    }

    // Parse CLICODE (e.g. CLI0001)
    const codeMatch = uppercase.match(/CLI\d+/);
    const code = codeMatch ? codeMatch[0] : null;

    // Parse Date (e.g. 2026-07 or similar date combos)
    const dateMatch = uppercase.match(/(20\d{2})[-_](\d{2})/);
    let year: string | null = null;
    let month: string | null = null;
    let competencia: string | null = null;

    if (dateMatch) {
      year = dateMatch[1];
      month = dateMatch[2];
      competencia = `${month}/${year}`;
    } else {
      // Look for Year and Month in separate parts
      const yearMatch = uppercase.match(/\b(20\d{2})\b/);
      if (yearMatch) {
        year = yearMatch[1];
        // Guess month from text or default 07
        month = '07';
        competencia = `${month}/${year}`;
      }
    }

    if (!code) {
      return {
        fileName,
        fileSize: 0,
        extractedCode: null,
        extractedYear: year,
        extractedMonth: month,
        competencia,
        client_id: null,
        client_name: null,
        client_phone: null,
        status: 'Cliente não encontrado'
      };
    }

    // Match code in our database
    const matchedClient = clients.find(
      (c) => c.codigo_cliente.trim().toUpperCase() === code.trim().toUpperCase()
    );

    if (!matchedClient) {
      return {
        fileName,
        fileSize: 0,
        extractedCode: code,
        extractedYear: year,
        extractedMonth: month,
        competencia,
        client_id: null,
        client_name: null,
        client_phone: null,
        status: 'Cliente não encontrado'
      };
    }

    // Determine status issues
    let status: ReportStatus = 'Pronto';

    if (!matchedClient.ativo) {
      status = 'Cliente inativo';
    } else if (!matchedClient.telefone_whatsapp) {
      status = 'Telefone ausente';
    } else {
      // Check if report already exists in history queue
      const alreadySent = historyQueue.some(
        (h) => h.cliente_id === matchedClient.id && h.competencia === competencia
      );
      if (alreadySent) {
        status = 'Relatório já enviado';
      }
    }

    return {
      fileName,
      fileSize: 0,
      extractedCode: code,
      extractedYear: year,
      extractedMonth: month,
      competencia,
      client_id: matchedClient.id,
      client_name: matchedClient.empresa,
      client_phone: matchedClient.telefone_whatsapp,
      status
    };
  };

  // Duplicate modal states
  const [selectedDuplicateReport, setSelectedDuplicateReport] = useState<PDFReport | null>(null);
  const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState(false);
  const [isResolvingDuplicate, setIsResolvingDuplicate] = useState(false);

  const handleOpenDuplicateModal = (report: PDFReport) => {
    setSelectedDuplicateReport(report);
    setIsDuplicateModalOpen(true);
  };

  const handleResolveDuplicate = async (action: DuplicateResolutionAction) => {
    if (!selectedDuplicateReport || !selectedDuplicateReport.duplicateInfo) return;

    setIsResolvingDuplicate(true);

    try {
      if (action === 'cancelado') {
        // Remove item or mark as canceled
        setReports((prev) => prev.filter((r) => r.id !== selectedDuplicateReport.id));
        setIsDuplicateModalOpen(false);
        setSelectedDuplicateReport(null);
        return;
      }

      const fileData = selectedDuplicateReport.fileObject ? {
        nome_arquivo: selectedDuplicateReport.fileName,
        nome_original: selectedDuplicateReport.fileName,
        storage_path: `${selectedDuplicateReport.competencia?.slice(0, 7) || '2026-07'}/${selectedDuplicateReport.extractedCode || 'SEM_CODIGO'}/${Date.now()}_${selectedDuplicateReport.fileName}`,
        tamanho_bytes: selectedDuplicateReport.fileSize,
        mime_type: 'application/pdf',
        hash_arquivo: selectedDuplicateReport.fileHash || `hash-${selectedDuplicateReport.fileName}`,
        cliente_id: selectedDuplicateReport.client_id,
        codigo_cliente: selectedDuplicateReport.extractedCode,
        competencia: competenciaToDateStr(selectedDuplicateReport.competencia),
        tipo_relatorio: 'desempenho'
      } : undefined;

      const resolvedDBReport = await relatoriosService.resolverDuplicado(
        action,
        selectedDuplicateReport.duplicateInfo.existingReportId,
        fileData
      );

      // Update local report
      setReports((prev) =>
        prev.map((r) => {
          if (r.id !== selectedDuplicateReport.id) return r;

          return {
            ...r,
            status: 'Pronto',
            isDuplicate: false,
            duplicateResolution: action,
            versao: resolvedDBReport?.versao || (selectedDuplicateReport.duplicateInfo?.currentVersion || 1) + 1,
            storage_path: resolvedDBReport?.storage_path
          };
        })
      );

      setIsDuplicateModalOpen(false);
      setSelectedDuplicateReport(null);
    } catch (err: any) {
      alert(err.message || 'Erro ao resolver duplicidade do relatório.');
    } finally {
      setIsResolvingDuplicate(false);
    }
  };

  // Process files selected
  const processFiles = async (files: FileList) => {
    setIsProcessing(true);
    const filesArray = Array.from(files);
    const newReportsList: PDFReport[] = [];
    const currentBatchCodes = new Set<string>();

    for (let index = 0; index < filesArray.length; index++) {
      const file = filesArray[index];
      const parsed = parseFilename(file.name);
      const reportId = `rep-${Date.now()}-${index}`;

      let fileHash = '';
      try {
        fileHash = await calculateFileHash(file);
      } catch {
        fileHash = `hash-${file.name}-${file.size}`;
      }

      let isDuplicate = false;
      let finalStatus = parsed.status;
      let duplicateInfo: DuplicateReportDetails | undefined = undefined;

      // Check Duplicates within the uploaded batch
      if (parsed.extractedCode && parsed.competencia) {
        const uniqueKey = `${parsed.extractedCode}-${parsed.competencia}`;
        if (currentBatchCodes.has(uniqueKey)) {
          isDuplicate = true;
          finalStatus = 'Duplicado';
        } else {
          currentBatchCodes.add(uniqueKey);
        }
      }

      // Check Duplicates in DB / Storage
      if (!isDuplicate && parsed.competencia) {
        try {
          const dupDetails = await relatoriosService.findDuplicateDetails(
            fileHash,
            parsed.client_id,
            parsed.competencia,
            'desempenho'
          );
          if (dupDetails) {
            isDuplicate = true;
            finalStatus = 'Duplicado';
            duplicateInfo = dupDetails;
          }
        } catch (err) {
          console.error('Erro ao verificar duplicidade no banco:', err);
        }
      }

      newReportsList.push({
        id: reportId,
        fileName: file.name,
        fileSize: file.size,
        extractedCode: parsed.extractedCode,
        extractedYear: parsed.extractedYear,
        extractedMonth: parsed.extractedMonth,
        competencia: parsed.competencia,
        client_id: parsed.client_id,
        client_name: parsed.client_name,
        client_phone: parsed.client_phone,
        status: finalStatus,
        progress: 0,
        isDuplicate,
        fileObject: file,
        fileHash,
        duplicateInfo
      });
    }

    setReports((prev) => [...prev, ...newReportsList]);

    newReportsList.forEach((newRep) => {
      let currentProgress = 0;
      const interval = setInterval(() => {
        currentProgress += Math.floor(Math.random() * 25) + 15;
        if (currentProgress >= 100) {
          currentProgress = 100;
          clearInterval(interval);
        }
        setReports((prev) =>
          prev.map((r) => (r.id === newRep.id ? { ...r, progress: currentProgress } : r))
        );
      }, 100);
    });

    setIsProcessing(false);
  };

  // Drag and Drop hooks
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragActive(true);
    } else if (e.type === 'dragleave') {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleManualSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFiles(e.target.files);
    }
  };

  // Delete uploaded report
  const handleDeleteReport = (id: string) => {
    setReports((prev) => prev.filter((r) => r.id !== id));
  };

  // Manual client re-mapping override
  const handleManualMapClient = (reportId: string, clientId: string) => {
    const selectedClient = clients.find((c) => c.id === clientId);
    if (!selectedClient) return;

    setReports((prev) =>
      prev.map((r) => {
        if (r.id !== reportId) return r;

        let status: ReportStatus = 'Pronto';
        if (!selectedClient.ativo) {
          status = 'Cliente inativo';
        } else if (!selectedClient.telefone_whatsapp) {
          status = 'Telefone ausente';
        } else {
          const alreadySent = historyQueue.some(
            (h) => h.cliente_id === selectedClient.id && h.competencia === r.competencia
          );
          if (alreadySent) {
            status = 'Relatório já enviado';
          }
        }

        return {
          ...r,
          client_id: selectedClient.id,
          client_name: selectedClient.empresa,
          client_phone: selectedClient.telefone_whatsapp,
          extractedCode: selectedClient.codigo_cliente,
          status
        };
      })
    );
  };

  // Clear all
  const handleClearAll = () => {
    setReports([]);
  };

  // Summary counts
  const totalPDFs = reports.length;
  const readyCount = reports.filter((r) => r.status === 'Pronto' && r.progress === 100).length;
  const duplicatesCount = reports.filter((r) => r.status === 'Duplicado' && r.progress === 100).length;
  const pendingCount = totalPDFs - readyCount - duplicatesCount; // any error

  const hasPendencies = reports.some(
    (r) => (r.status !== 'Pronto' && r.progress === 100) || (r.status === 'Duplicado' && !r.duplicateResolution)
  );

  const getStatusIcon = (status: ReportStatus) => {
    switch (status) {
      case 'Pronto':
        return <CheckCircle className="w-4 h-4 text-emerald-500" />;
      case 'Duplicado':
        return <AlertTriangle className="w-4 h-4 text-amber-500" />;
      default:
        return <AlertTriangle className="w-4 h-4 text-rose-500" />;
    }
  };

  const getStatusBadge = (report: PDFReport) => {
    if (report.status === 'Duplicado' && report.duplicateInfo && !report.duplicateResolution) {
      return (
        <div className="flex flex-col items-center gap-1">
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
            Duplicado — decisão necessária
          </span>
          <button
            type="button"
            onClick={() => handleOpenDuplicateModal(report)}
            className="text-[10px] font-bold text-amber-700 underline hover:text-amber-900 cursor-pointer"
          >
            Resolver Decisão
          </button>
        </div>
      );
    }

    if (report.duplicateResolution === 'substituir') {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-300">
          Substituição Autorizada
        </span>
      );
    }

    if (report.duplicateResolution === 'nova_versao') {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-300">
          Nova Versão v{report.versao || 2}
        </span>
      );
    }

    if (report.duplicateResolution === 'reutilizar') {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-teal-100 text-teal-800 border border-teal-300">
          Reutilizando Existente
        </span>
      );
    }

    switch (report.status) {
      case 'Pronto':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Pronto</span>;
      case 'Erro de Upload':
        return (
          <div className="flex flex-col items-center gap-1">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
              Erro de Upload
            </span>
            <button
              type="button"
              onClick={() => {
                setReports((prev) =>
                  prev.map((r) => (r.id === report.id ? { ...r, status: 'Pronto' } : r))
                );
              }}
              className="text-[10px] font-bold text-blue-600 underline hover:text-blue-800 cursor-pointer"
            >
              Tentar novamente
            </button>
          </div>
        );
      case 'Cliente não encontrado':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">Não Encontrado</span>;
      case 'Telefone ausente':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">Sem WhatsApp</span>;
      case 'Duplicado':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Duplicado</span>;
      case 'Cliente inativo':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">Cliente Inativo</span>;
      case 'Relatório já enviado':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Já Enviado</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">{report.status}</span>;
    }
  };

  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  // Open dispatch confirmation modal
  const handleOpenDispatch = () => {
    if (readyCount === 0) {
      alert('Nenhum relatório está marcado como "Pronto" para envio.');
      return;
    }
    setDispatchError(null);
    // Auto populate batch name based on month parsed
    const firstRepComp = reports.find((r) => r.competencia)?.competencia || '07/2026';
    setBatchName(`Lote de Relatórios ${firstRepComp} - Gerado em ${new Date().toLocaleDateString('pt-BR')}`);
    setIsDispatchModalOpen(true);
  };

  // Initiate sending lote
  const handleConfirmDispatch = async () => {
    const readyReports = reports.filter((r) => r.status === 'Pronto' && r.progress === 100);
    const competencia = readyReports[0]?.competencia || '07/2026';

    let schedString: string | undefined = undefined;
    if (dispatchType === 'agendado') {
      schedString = `${scheduledDate}T${scheduledTime}:00`;
    } else if (dispatchType === 'cliente_padrao') {
      schedString = 'PRESET_CLIENTE'; // Tag indicating engine should match clients day_envio & horario_envio
    }

    setIsDispatching(true);
    setDispatchError(null);

    try {
      await onCreateBatch(batchName, competencia, readyReports, schedString);
      setIsDispatchModalOpen(false);
      setReports([]); // Clear queue after successful creation
      onNavigateToTab('lotes');
    } catch (err: any) {
      console.error('Erro no despacho de lote:', err);
      const errMsg = err.message || 'Falha ao realizar upload para o Storage ou criar lote.';
      setDispatchError(errMsg);
      setReports((prev) =>
        prev.map((r) => {
          if (r.status === 'Pronto') {
            return {
              ...r,
              status: 'Erro de Upload' as ReportStatus,
            };
          }
          return r;
        })
      );
    } finally {
      setIsDispatching(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-semibold text-slate-950 tracking-tight">
          Upload & Conferência de Relatórios
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Arraste relatórios em PDF. O sistema fará a leitura automática de nomes de arquivos para associar a clientes da base.
        </p>
      </div>

      {/* Step 1: Upload Zone */}
      <div
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-2 ${
          isDragActive
            ? 'border-blue-500 bg-blue-50/20'
            : 'border-slate-200 hover:border-blue-400 bg-white shadow-subtle'
        }`}
        onClick={() => fileInputRef.current?.click()}
      >
        <UploadCloud className={`w-10 h-10 ${isDragActive ? 'text-blue-500' : 'text-slate-400'}`} />
        <h3 className="text-sm font-semibold text-slate-800">
          Arraste e solte seus relatórios PDF aqui
        </h3>
        <p className="text-xs text-slate-500 max-w-sm">
          Ou clique para procurar em seu computador. Os arquivos devem seguir o padrão: <strong className="font-mono text-blue-600 font-normal">RELATORIO_CLI0001_2026-07.pdf</strong>
        </p>
        <input
          type="file"
          ref={fileInputRef}
          multiple
          accept=".pdf"
          onChange={handleManualSelect}
          className="hidden"
        />
      </div>

      {/* Conference Table section (only if reports are loaded) */}
      {reports.length > 0 && (
        <div className="space-y-4">
          {/* Summary Indicators */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-subtle text-center">
              <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider block">Total PDFs</span>
              <span className="text-lg font-bold text-slate-900 mt-0.5 block">{totalPDFs}</span>
            </div>
            <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-center">
              <span className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider block">Prontos</span>
              <span className="text-lg font-bold text-emerald-800 mt-0.5 block">{readyCount}</span>
            </div>
            <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl text-center">
              <span className="text-[10px] font-semibold text-amber-600 uppercase tracking-wider block">Duplicados</span>
              <span className="text-lg font-bold text-amber-800 mt-0.5 block">{duplicatesCount}</span>
            </div>
            <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-center">
              <span className="text-[10px] font-semibold text-rose-600 uppercase tracking-wider block">Pendências</span>
              <span className="text-lg font-bold text-rose-800 mt-0.5 block">{pendingCount}</span>
            </div>

            {/* Action Card Button */}
            <div className="col-span-2 md:col-span-1 flex items-center justify-center p-1 bg-slate-50 border border-slate-200 rounded-xl">
              <button
                id="conference_clear_all_btn"
                onClick={handleClearAll}
                className="w-full h-full text-center text-xs font-semibold text-slate-500 hover:text-red-600 transition-all rounded-lg hover:bg-red-50/40 inline-flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Limpar Fila
              </button>
            </div>
          </div>

          {/* Validation Notice Bar */}
          {hasPendencies && (
            <div className="bg-rose-50 border border-rose-100 text-rose-800 p-3.5 rounded-lg flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <div className="text-xs">
                <strong>Pendências Detectadas:</strong> Foram identificados erros de associação ou ausência de dados necessários para envio. Por favor, remova ou corrija manualmente os itens com erros na tabela de conferência antes de iniciar o lote. <strong className="underline">O envio não é permitido com pendências.</strong>
              </div>
            </div>
          )}

          {/* Table Container */}
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-subtle overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="py-3 px-4">Arquivo PDF</th>
                    <th className="py-3 px-4">Código / Cliente Associado</th>
                    <th className="py-3 px-4">WhatsApp de Destino</th>
                    <th className="py-3 px-4">Referência</th>
                    <th className="py-3 px-4 text-center">Progresso</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reports.map((report) => (
                    <tr key={report.id} className="text-xs hover:bg-slate-50/50 transition-all">
                      {/* File Info */}
                      <td className="py-3.5 px-4 font-mono text-slate-800 max-w-xs truncate">
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                          <span title={report.fileName}>{report.fileName}</span>
                        </div>
                      </td>

                      {/* Associated Client OR Selector */}
                      <td className="py-3.5 px-4">
                        {report.client_id ? (
                          <div>
                            <span className="font-mono text-[11px] bg-blue-50 text-blue-700 px-1 py-0.5 rounded font-bold mr-1.5">
                              {report.extractedCode}
                            </span>
                            <span className="font-semibold text-slate-900">{report.client_name}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-rose-500 font-bold bg-rose-50 px-1 py-0.5 rounded">Pendência</span>
                            <select
                              id={`manual_match_select_${report.id}`}
                              onChange={(e) => handleManualMapClient(report.id, e.target.value)}
                              defaultValue=""
                              className="px-2 py-1 text-[11px] bg-slate-50 border border-slate-200 rounded text-slate-700 outline-none max-w-xs focus:bg-white focus:border-blue-500"
                            >
                              <option value="" disabled>Corrigir: Vincular cliente...</option>
                              {clients.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.codigo_cliente} - {c.empresa}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </td>

                      {/* WhatsApp Destination */}
                      <td className="py-3.5 px-4 font-mono text-slate-600">
                        {report.client_phone ? (
                          <span className="flex items-center gap-1">
                            <Phone className="w-3 h-3 text-slate-400" />
                            {report.client_phone}
                          </span>
                        ) : report.client_id ? (
                          <span className="text-rose-500 italic">Celular ausente</span>
                        ) : (
                          '-'
                        )}
                      </td>

                      {/* Period Competencia */}
                      <td className="py-3.5 px-4 font-mono text-slate-600 font-medium">
                        {report.competencia || '-'}
                      </td>

                      {/* Upload Animation Progress */}
                      <td className="py-3.5 px-4 text-center">
                        {report.progress < 100 ? (
                          <div className="w-24 mx-auto">
                            <div className="flex justify-between text-[9px] text-slate-400 mb-0.5">
                              <span>Processando...</span>
                              <span>{report.progress}%</span>
                            </div>
                            <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                              <div
                                className="bg-blue-600 h-full transition-all duration-150"
                                style={{ width: `${report.progress}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-400 font-medium font-mono">Processado</span>
                        )}
                      </td>

                      {/* Validation Status Badge */}
                      <td className="py-3.5 px-4 text-center">
                        {report.progress < 100 ? (
                          <span className="text-[10px] text-slate-400 animate-pulse">Lendo...</span>
                        ) : (
                          getStatusBadge(report)
                        )}
                      </td>

                      {/* Row Delete Action */}
                      <td className="py-3.5 px-4 text-right">
                        <button
                          id={`delete_review_item_${report.id}`}
                          onClick={() => handleDeleteReport(report.id)}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-all"
                          title="Remover arquivo"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <span className="text-[10px] text-slate-500 font-semibold uppercase">
                Prontos para Lote: {readyCount} de {totalPDFs} relatórios
              </span>

              {/* Action Buttons trigger sheet modal */}
              <div className="flex items-center gap-2">
                <button
                  id="dispatch_reports_btn"
                  disabled={readyCount === 0 || hasPendencies}
                  onClick={handleOpenDispatch}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-bold rounded-lg shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" />
                  Despachar Lote ({readyCount})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DISPATCH ACTION SHEET MODAL */}
      {isDispatchModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 font-sans">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-lg bg-white rounded-xl border border-slate-200 shadow-premium overflow-hidden"
          >
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-blue-600" />
                <h2 className="text-sm font-bold text-slate-900">
                  Despachar Lote de Relatórios via WhatsApp
                </h2>
              </div>
              <button
                onClick={() => setIsDispatchModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Nome do Lote
                </label>
                <input
                  type="text"
                  required
                  value={batchName}
                  onChange={(e) => setBatchName(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:bg-white text-slate-900"
                />
              </div>

              {/* Selector for Send style */}
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-2">
                  Método de Programação
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setDispatchType('imediato')}
                    className={`p-3 rounded-lg border text-center flex flex-col items-center gap-1.5 transition-all ${
                      dispatchType === 'imediato'
                        ? 'border-blue-500 bg-blue-50/30 text-blue-700 font-semibold'
                        : 'border-slate-200 bg-white text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <Play className="w-4 h-4" />
                    <span className="text-[10px]">Enviar Agora</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDispatchType('agendado')}
                    className={`p-3 rounded-lg border text-center flex flex-col items-center gap-1.5 transition-all ${
                      dispatchType === 'agendado'
                        ? 'border-blue-500 bg-blue-50/30 text-blue-700 font-semibold'
                        : 'border-slate-200 bg-white text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <CalendarDays className="w-4 h-4" />
                    <span className="text-[10px]">Agendar Data</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDispatchType('cliente_padrao')}
                    className={`p-3 rounded-lg border text-center flex flex-col items-center gap-1.5 transition-all ${
                      dispatchType === 'cliente_padrao'
                        ? 'border-blue-500 bg-blue-50/30 text-blue-700 font-semibold'
                        : 'border-slate-200 bg-white text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <User className="w-4 h-4" />
                    <span className="text-[10px]">Dia do Cliente</span>
                  </button>
                </div>
              </div>

              {/* Scheduling Details Block */}
              {dispatchType === 'agendado' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="bg-slate-50 p-4 rounded-lg border border-slate-200 grid grid-cols-2 gap-4"
                >
                  <div>
                    <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                      Data de Envio
                    </label>
                    <input
                      type="date"
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                      className="w-full px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-md outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                      Horário de Envio
                    </label>
                    <input
                      type="text"
                      placeholder="09:30"
                      value={scheduledTime}
                      onChange={(e) => setScheduledTime(e.target.value)}
                      className="w-full px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-md outline-none font-mono"
                    />
                  </div>
                </motion.div>
              )}

              {dispatchType === 'cliente_padrao' && (
                <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 text-[11px] text-slate-600 flex gap-2">
                  <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Automação Inteligente Ativada:</strong> Os itens do lote serão agendados na fila de envio do Supabase utilizando o <strong>dia e horário preferencial</strong> de cada cliente. Timezone configurado para <strong>America/Sao_Paulo</strong>.
                  </span>
                </div>
              )}

              {dispatchError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 font-medium flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{dispatchError}</span>
                </div>
              )}

              <div className="bg-blue-50/50 p-3.5 rounded-lg border border-blue-100 text-[11px] text-blue-800 flex gap-2">
                <CheckCircle className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <span>
                  Este lote irá gerar <strong>{readyCount} itens na Fila de Envios</strong>. O processamento ocorrerá em segundo plano no Supabase via Edge Functions integradas à API Oficial da Meta.
                </span>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={isDispatching}
                  onClick={() => setIsDispatchModalOpen(false)}
                  className="px-3 py-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 text-xs font-semibold rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  id="confirm_lote_dispatch_btn"
                  type="button"
                  disabled={isDispatching}
                  onClick={handleConfirmDispatch}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-xs font-semibold rounded-lg shadow-sm flex items-center gap-1.5"
                >
                  {isDispatching ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Processando envios...
                    </>
                  ) : (
                    'Confirmar e Criar Lote'
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Duplicate Resolution Decision Modal */}
      {selectedDuplicateReport && selectedDuplicateReport.duplicateInfo && (
        <DuplicateReportModal
          isOpen={isDuplicateModalOpen}
          onClose={() => {
            setIsDuplicateModalOpen(false);
            setSelectedDuplicateReport(null);
          }}
          report={selectedDuplicateReport}
          duplicateInfo={selectedDuplicateReport.duplicateInfo}
          onResolve={handleResolveDuplicate}
          isProcessing={isResolvingDuplicate}
        />
      )}
    </div>
  );
}
