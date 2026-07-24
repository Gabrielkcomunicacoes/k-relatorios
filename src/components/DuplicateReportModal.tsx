import React from 'react';
import { AlertTriangle, FileText, CheckCircle2, XCircle, ArrowRight, RefreshCw, Layers, ShieldAlert, Database, Copy } from 'lucide-react';
import { PDFReport, DuplicateReportDetails, DuplicateResolutionAction } from '../types';

interface DuplicateReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: PDFReport;
  duplicateInfo: DuplicateReportDetails;
  onResolve: (action: DuplicateResolutionAction) => void;
  isProcessing?: boolean;
}

export const DuplicateReportModal: React.FC<DuplicateReportModalProps> = ({
  isOpen,
  onClose,
  report,
  duplicateInfo,
  onResolve,
  isProcessing = false
}) => {
  if (!isOpen) return null;

  const formatDate = (isoStr: string) => {
    try {
      return new Date(isoStr).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return isoStr;
    }
  };

  const isHashIdentical = duplicateInfo.hashMatches;
  const hasActiveQueue = duplicateInfo.hasActiveQueue;
  const alreadySent = duplicateInfo.alreadySentWhatsApp;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 max-w-2xl w-full p-6 md:p-8 space-y-6 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-start space-x-4">
          <div className="p-3 bg-amber-100 text-amber-600 rounded-xl shrink-0">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-gray-900 tracking-tight">
              Relatório duplicado encontrado
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Já existe um relatório para este cliente e esta competência. O que deseja fazer?
            </p>
          </div>
        </div>

        {/* Existing Report Details Card */}
        <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <div className="flex items-center space-x-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <Database className="w-4 h-4 text-slate-400" />
              <span>Dados do Arquivo Existente no Sistema</span>
            </div>
            {duplicateInfo.currentVersion > 1 && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                Versão {duplicateInfo.currentVersion} atual
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-xs text-gray-500 block">Cliente</span>
              <span className="font-semibold text-gray-900">{duplicateInfo.existingClientName}</span>
            </div>
            <div>
              <span className="text-xs text-gray-500 block">Competência</span>
              <span className="font-semibold text-gray-900">{duplicateInfo.existingCompetencia}</span>
            </div>
            <div>
              <span className="text-xs text-gray-500 block">Nome do Arquivo Atual</span>
              <span className="font-medium text-gray-800 break-all font-mono text-xs bg-white px-2 py-1 rounded border border-gray-200 inline-block mt-0.5">
                {duplicateInfo.existingFileName}
              </span>
            </div>
            <div>
              <span className="text-xs text-gray-500 block">Data de Upload</span>
              <span className="text-gray-800">{formatDate(duplicateInfo.existingCreatedAt)}</span>
            </div>
            <div>
              <span className="text-xs text-gray-500 block">Status de Envio</span>
              <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded mt-0.5 ${
                alreadySent 
                  ? 'bg-emerald-100 text-emerald-800' 
                  : hasActiveQueue 
                    ? 'bg-blue-100 text-blue-800' 
                    : 'bg-gray-100 text-gray-700'
              }`}>
                {alreadySent ? 'Enviado via WhatsApp' : hasActiveQueue ? `Em Fila (${duplicateInfo.activeQueueStatus})` : 'Aguardando Disparo'}
              </span>
            </div>
            <div>
              <span className="text-xs text-gray-500 block">Armazenamento</span>
              <span className="text-xs font-medium text-slate-700 flex items-center space-x-1 mt-0.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 inline mr-1" />
                <span>PDF preservado no Storage</span>
              </span>
            </div>
          </div>

          {duplicateInfo.existingBatchName && (
            <div className="text-xs text-gray-600 bg-white p-2 rounded border border-slate-200">
              <span className="font-semibold">Lote associado:</span> {duplicateInfo.existingBatchName}
            </div>
          )}
        </div>

        {/* Warning Banners based on Scenarios */}
        {isHashIdentical && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900 flex items-start space-x-3">
            <Copy className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold block text-amber-950 text-sm mb-0.5">Conteúdo do Arquivo Idêntico (Hash Match)</span>
              Este novo arquivo possui exatamente o mesmo conteúdo binário (hash) do relatório que já está salvo no sistema.
            </div>
          </div>
        )}

        {!isHashIdentical && alreadySent && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-900 flex items-start space-x-3">
            <ShieldAlert className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold block text-blue-950 text-sm mb-0.5">Aviso de Relatório Já Enviado</span>
              Este relatório já foi enviado anteriormente para o cliente via WhatsApp. Caso opte por substituir o PDF ou criar nova versão, o arquivo interno será atualizado, mas isso não altera a mensagem que o cliente já recebeu.
            </div>
          </div>
        )}

        {!isHashIdentical && hasActiveQueue && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-xs text-rose-900 flex items-start space-x-3">
            <XCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold block text-rose-950 text-sm mb-0.5">Relatório em Fila Activa</span>
              Este relatório está em uma fila de disparo pendente/agendada. A opção de substituir o arquivo foi desativada por segurança para evitar inconsistências durante o envio.
            </div>
          </div>
        )}

        {/* Action Options */}
        <div className="space-y-3 pt-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Escolha como proceder:
          </h3>

          {/* SCENARIO A: IDENTICAL HASH */}
          {isHashIdentical ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => onResolve('cancelado')}
                className="w-full text-left p-4 rounded-xl border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all flex items-center justify-between group disabled:opacity-50"
              >
                <div>
                  <span className="font-semibold text-gray-900 text-sm block">Cancelar</span>
                  <span className="text-xs text-gray-500">Ignorar este upload sem fazer alterações.</span>
                </div>
                <XCircle className="w-5 h-5 text-gray-400 group-hover:text-gray-600 shrink-0 ml-2" />
              </button>

              <button
                type="button"
                disabled={isProcessing}
                onClick={() => onResolve('reutilizar')}
                className="w-full text-left p-4 rounded-xl border border-indigo-200 bg-indigo-50/50 hover:bg-indigo-50 hover:border-indigo-300 transition-all flex items-center justify-between group disabled:opacity-50"
              >
                <div>
                  <span className="font-semibold text-indigo-950 text-sm block">Reenviar com o Arquivo Existente</span>
                  <span className="text-xs text-indigo-700">Aproveitar o PDF já armazenado.</span>
                </div>
                <RefreshCw className="w-5 h-5 text-indigo-600 group-hover:rotate-180 transition-transform shrink-0 ml-2" />
              </button>
            </div>
          ) : (
            /* SCENARIO B: DIFFERENT HASH / SAME COMPETENCY */
            <div className="space-y-2">
              {/* Option 1: Substituir */}
              <button
                type="button"
                disabled={isProcessing || hasActiveQueue}
                onClick={() => onResolve('substituir')}
                className={`w-full text-left p-4 rounded-xl border transition-all flex items-start justify-between group ${
                  hasActiveQueue 
                    ? 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
                    : 'border-amber-200 bg-amber-50/40 hover:bg-amber-50 hover:border-amber-300'
                }`}
              >
                <div className="pr-4">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-gray-900 text-sm">Substituir Arquivo Existente</span>
                    <span className="text-[10px] font-semibold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">Atualiza PDF</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">
                    Substitui o PDF no Storage e atualiza os dados mantendo o mesmo registro de histórico. O PDF antigo será removido com segurança.
                  </p>
                </div>
                <ArrowRight className="w-5 h-5 text-amber-600 shrink-0 mt-1 group-hover:translate-x-1 transition-transform" />
              </button>

              {/* Option 2: Criar Nova Versão */}
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => onResolve('nova_versao')}
                className="w-full text-left p-4 rounded-xl border border-indigo-200 bg-indigo-50/40 hover:bg-indigo-50 hover:border-indigo-300 transition-all flex items-start justify-between group"
              >
                <div className="pr-4">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-indigo-950 text-sm">Criar Nova Versão</span>
                    <span className="text-[10px] font-semibold bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full">
                      Versão {(duplicateInfo.currentVersion || 1) + 1}
                    </span>
                  </div>
                  <p className="text-xs text-indigo-900/80 mt-1">
                    Preserva a versão anterior no histórico e registra o novo arquivo como a versão ativa (Versão {(duplicateInfo.currentVersion || 1) + 1}).
                  </p>
                </div>
                <Layers className="w-5 h-5 text-indigo-600 shrink-0 mt-1 group-hover:scale-110 transition-transform" />
              </button>

              {/* Option 3: Cancelar */}
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => onResolve('cancelado')}
                className="w-full text-left p-3 rounded-xl border border-gray-200 hover:bg-gray-50 transition-all flex items-center justify-between text-gray-700 hover:text-gray-900"
              >
                <span className="text-xs font-medium">Cancelar upload deste arquivo</span>
                <XCircle className="w-4 h-4 text-gray-400" />
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-2 border-t border-gray-100">
          <button
            type="button"
            disabled={isProcessing}
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-600 hover:text-gray-900 transition-colors"
          >
            Fechar sem decidir agora
          </button>
        </div>

      </div>
    </div>
  );
};
