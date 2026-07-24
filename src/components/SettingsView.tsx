import React from 'react';
import { WhatsAppConfig, AuditLog, AuthUser } from '../types';
import {
  Settings,
  ShieldAlert,
  Server,
  Code,
  ListTodo,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Link2
} from 'lucide-react';

interface SettingsViewProps {
  config: WhatsAppConfig;
  onSaveConfig: (updates: Partial<WhatsAppConfig>) => void;
  auditLogs: AuditLog[];
  user: AuthUser;
}

export default function SettingsView({
  config,
  auditLogs,
  user
}: SettingsViewProps) {
  // Guard against non-admin role accessing settings
  if (user.role !== 'Administrador') {
    return (
      <div id="restricted-access-container" className="p-8 text-center max-w-md mx-auto space-y-4">
        <ShieldAlert id="restricted-shield-icon" className="w-12 h-12 text-rose-500 mx-auto" />
        <h2 id="restricted-title" className="text-base font-bold text-slate-900">Acesso Restrito</h2>
        <p id="restricted-desc" className="text-xs text-slate-500">
          Você está conectado como <strong>{user.nome} ({user.role})</strong>. Apenas usuários com privilégios de <strong>Administrador</strong> podem acessar as configurações de integração.
        </p>
      </div>
    );
  }

  // Helper to check if a value is securely configured
  const isConfigured = (value?: string) => {
    if (!value) return false;
    const clean = value.trim().toLowerCase();
    return clean !== '' && clean !== 'não configurado' && clean !== 'nao configurado' && clean !== 'false' && clean !== 'undefined';
  };

  const indicators = [
    {
      id: 'ind-access-token',
      name: 'Access Token (System User)',
      status: isConfigured(config.accessToken),
      description: 'Token de autenticação da API de Nuvem do WhatsApp Oficial.',
    },
    {
      id: 'ind-app-secret',
      name: 'App Secret Key',
      status: isConfigured(config.appSecret),
      description: 'Chave secreta para validação e integridade criptográfica.',
    },
    {
      id: 'ind-verify-token',
      name: 'Verify Token (Webhook)',
      status: isConfigured(config.verifyToken),
      description: 'Token de validação para handshake com os servidores da Meta.',
    },
    {
      id: 'ind-phone-id',
      name: 'Phone Number ID',
      status: isConfigured(config.phoneNumberId),
      description: 'Identificador único do número telefônico de disparo.',
    },
    {
      id: 'ind-template',
      name: 'Template Name (envio_relatorio)',
      status: isConfigured(config.templateName),
      description: 'Estrutura de template homologado para envios ativos.',
    },
  ];

  return (
    <div id="settings-view-root" className="space-y-6">
      {/* Header */}
      <div id="settings-header">
        <h1 id="settings-title" className="text-xl font-semibold text-slate-950 tracking-tight">
          Painel de Integração WhatsApp Business
        </h1>
        <p id="settings-subtitle" className="text-xs text-slate-500 mt-1">
          Monitoramento de status da API Oficial da Meta, credenciais de webhook e auditoria detalhada de disparos.
        </p>
      </div>

      <div id="settings-grid" className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Status Indicators Dashboard */}
        <div id="status-dashboard-card" className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-subtle lg:col-span-2 space-y-4">
          <div id="status-card-header" className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <Settings id="status-settings-icon" className="w-5 h-5 text-blue-600" />
            <h2 id="status-card-title" className="text-sm font-semibold text-slate-900">Indicadores de Credenciais WhatsApp API</h2>
          </div>

          <div id="security-notice-box" className="p-3.5 bg-slate-50 border border-slate-200/60 rounded-lg text-xs text-slate-600 leading-relaxed flex gap-2.5">
            <ShieldCheck id="security-shield-icon" className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-slate-800">Conformidade e Segurança de Dados</p>
              <p className="mt-0.5 text-slate-500 text-[11px]">
                Em conformidade com as diretrizes de segurança, as credenciais confidenciais (Access Token, App Secret e Verify Token) estão protegidas de forma isolada nos Secrets do backend das <strong>Supabase Edge Functions</strong> e são lidas exclusivamente por variáveis de ambiente (Deno.env). Valores reais nunca são transmitidos ao cliente React.
              </p>
            </div>
          </div>

          <div id="indicators-list" className="space-y-3.5 pt-2">
            {indicators.map((ind) => (
              <div
                id={`indicator-item-${ind.id}`}
                key={ind.id}
                className="flex items-start justify-between p-3 bg-white border border-slate-100 rounded-lg hover:border-slate-200 transition-colors"
              >
                <div id={`indicator-text-block-${ind.id}`} className="space-y-0.5 pr-4">
                  <span id={`indicator-name-${ind.id}`} className="text-xs font-semibold text-slate-800 block">
                    {ind.name}
                  </span>
                  <span id={`indicator-desc-${ind.id}`} className="text-[11px] text-slate-400 block font-normal leading-normal">
                    {ind.description}
                  </span>
                </div>

                <div id={`indicator-badge-block-${ind.id}`} className="shrink-0 pt-0.5">
                  {ind.status ? (
                    <span
                      id={`badge-configured-${ind.id}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 border border-emerald-100 text-emerald-700 text-[10px] font-bold rounded-full"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      Configurado
                    </span>
                  ) : (
                    <span
                      id={`badge-not-configured-${ind.id}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 border border-amber-100 text-amber-700 text-[10px] font-bold rounded-full"
                    >
                      <XCircle className="w-3.5 h-3.5 text-amber-500" />
                      Não Configurado
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Webhook Connection Card */}
        <div id="webhook-card-container" className="space-y-6">
          <div id="webhook-card" className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-subtle flex flex-col justify-between">
            <div id="webhook-card-content">
              <div id="webhook-header" className="flex items-center gap-2 mb-3 pb-3 border-b border-slate-100">
                <Server id="webhook-server-icon" className="w-5 h-5 text-indigo-500" />
                <h2 id="webhook-title" className="text-sm font-semibold text-slate-900">Webhook Oficial (Supabase)</h2>
              </div>
              <p id="webhook-desc" className="text-xs text-slate-500 leading-relaxed mb-4">
                Esta URL recebe notificações de status de envio e leitura (Statuses Webhooks) diretamente dos servidores oficiais da Meta.
              </p>

              <div id="webhook-details" className="space-y-4 text-xs">
                <div id="webhook-url-block">
                  <span id="webhook-url-label" className="text-slate-400 font-semibold block mb-1.5 flex items-center gap-1">
                    <Link2 className="w-3.5 h-3.5 text-indigo-400" />
                    Webhook URL (Produção)
                  </span>
                  <div
                    id="webhook-url-value"
                    className="bg-slate-50 border border-slate-200 p-2.5 rounded-lg font-mono text-[10px] text-indigo-600 break-all select-all font-semibold"
                  >
                    https://otrakowcdizdrwnlmuzv.supabase.co/functions/v1/webhook-whatsapp
                  </div>
                </div>

                <div id="webhook-verify-token-block">
                  <span id="webhook-verify-label" className="text-slate-400 font-semibold block mb-1">Verify Token correspondente:</span>
                  <div id="webhook-verify-value" className="bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg font-mono text-[11px] text-slate-700 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    Gerido de forma privada no Deno Secret
                  </div>
                </div>

                <div id="webhook-tip-box" className="bg-indigo-50/50 p-3 rounded-lg border border-indigo-100 text-[11px] text-indigo-800 leading-relaxed flex gap-2">
                  <Code id="webhook-code-icon" className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                  <span>
                    O endpoint de webhook aceita pings de handshake do Facebook e processa as atualizações de entrega da fila em tempo real de forma totalmente assíncrona.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Audit logs panel */}
      <div id="audit-logs-card" className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-subtle space-y-4">
        <div id="audit-logs-header" className="flex items-center gap-2 pb-3 border-b border-slate-100">
          <ListTodo id="audit-logs-list-icon" className="w-5 h-5 text-slate-700" />
          <h2 id="audit-logs-title" className="text-sm font-semibold text-slate-900">Logs de Auditoria de Ações do Sistema</h2>
        </div>

        <div id="audit-logs-table-wrapper" className="overflow-x-auto">
          <table id="audit-logs-table" className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="py-2.5 px-4">Operador</th>
                <th className="py-2.5 px-4">Ação Realizada</th>
                <th className="py-2.5 px-4">Informações Detalhadas</th>
                <th className="py-2.5 px-4 text-right">Horário UTC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {auditLogs.map((log) => (
                <tr id={`audit-log-row-${log.id}`} key={log.id} className="hover:bg-slate-50/40 transition-all">
                  <td id={`audit-log-user-${log.id}`} className="py-3 px-4 font-semibold text-slate-800">
                    {log.usuario_nome}
                  </td>
                  <td id={`audit-log-action-${log.id}`} className="py-3 px-4">
                    <span id={`audit-log-action-badge-${log.id}`} className="px-2 py-0.5 bg-slate-100 border border-slate-200 text-slate-700 rounded-full text-[10px] font-bold">
                      {log.acao}
                    </span>
                  </td>
                  <td id={`audit-log-details-${log.id}`} className="py-3 px-4 text-slate-500 font-medium">
                    {log.detalhes}
                  </td>
                  <td id={`audit-log-time-${log.id}`} className="py-3 px-4 text-slate-500 text-right font-mono">
                    {new Date(log.created_at).toLocaleString('pt-BR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
