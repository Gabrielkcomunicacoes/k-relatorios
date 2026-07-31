export type UserRole = 'Administrador' | 'Operador';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  nome: string;
}

export interface Client {
  id: string;
  codigo_cliente: string; // CLI0001, CLI0002, etc.
  empresa: string;
  nome_contato: string;
  telefone_whatsapp: string;
  email: string;
  ativo: boolean;
  possui_optin: boolean;
  dia_envio: number; // Day of month or standard selection
  horario_envio: string; // "HH:MM" format
  observacoes?: string;
  created_at: string;
  updated_at: string;
}

export type ReportStatus =
  | 'Pronto'
  | 'Cliente não encontrado'
  | 'Telefone ausente'
  | 'Duplicado'
  | 'Cliente inativo'
  | 'Relatório já enviado'
  | 'Arquivo inválido'
  | 'Erro de Upload';

export type DuplicateResolutionAction = 'substituir' | 'nova_versao' | 'reutilizar' | 'cancelado';

export interface DuplicateReportDetails {
  existingReportId: string;
  existingFileName: string;
  existingCreatedAt: string;
  existingCompetencia: string;
  existingClientName: string;
  existingBatchName?: string;
  hashMatches: boolean;
  hasActiveQueue: boolean;
  activeQueueStatus?: string;
  alreadySentWhatsApp: boolean;
  pdfExistsInStorage: boolean;
  existingHash: string;
  currentVersion: number;
}

export interface PDFReport {
  id: string;
  relatorio_id?: string; // Real UUID persisted in public.relatorios
  fileName: string;
  fileSize: number;
  extractedCode: string | null;
  extractedYear: string | null;
  extractedMonth: string | null;
  competencia: string | null; // e.g., "07/2026"
  client_id: string | null;
  client_name: string | null;
  client_phone: string | null;
  status: ReportStatus;
  progress: number; // 0-100 for upload animation
  storage_path?: string;
  isDuplicate: boolean;
  fileObject?: any;
  fileHash?: string;
  duplicateResolution?: DuplicateResolutionAction;
  duplicateInfo?: DuplicateReportDetails;
  versao?: number;
  versao_atual?: boolean;
  relatorio_anterior_id?: string | null;
}

export type BatchStatus = 'Pendente' | 'Processando' | 'Concluido' | 'Cancelado' | 'Falha';

export interface Batch {
  id: string;
  nome: string;
  competencia: string; // e.g., "07/2026"
  status: BatchStatus;
  quantidade: number;
  criado_por: string; // User Name
  created_at: string;
}

export type QueueItemStatus = 'Fila' | 'Enviando' | 'Enviado' | 'Entregue' | 'Lido' | 'Falhou' | 'Cancelado';

export interface QueueItem {
  id: string;
  lote_id: string;
  cliente_id: string;
  relatorio_id?: string | null; // Real UUID persisted in public.relatorios
  cliente_nome: string;
  telefone: string;
  arquivo_nome: string;
  competencia: string;
  status: QueueItemStatus;
  tentativas: number;
  data_envio?: string;
  message_id?: string;
  erro?: string;
  updated_at: string;
}

export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  verifyToken: string;
  appSecret: string;
  templateName: string;
  language: string;
}

export interface AuditLog {
  id: string;
  usuario_nome: string;
  acao: string;
  detalhes: string;
  created_at: string;
}

export interface WorkerStatusInfo {
  ativo: boolean;
  ultimaExecucao: string | null;
  proximaExecucao: string | null;
  itensPendentes: number;
  itensProcessadosHoje: number;
  ultimoLog?: {
    itensEncontrados: number;
    itensProcessados: number;
    sucessos: number;
    falhas: number;
    tempoExecucaoMs: number;
  };
}

export interface IntegrationLog {
  id: string;
  origem_sistema: string;
  identificador_origem: string | null;
  codigo_cliente: string | null;
  relatorio_id: string | null;
  lote_id: string | null;
  status: string;
  http_status: number;
  erro_codigo: string | null;
  erro_mensagem: string | null;
  recebido_em: string;
  processado_em: string | null;
  metadata: any;
  created_at: string;
}

export interface IntegrationConfig {
  id: string;
  endpointUrl: string;
  segredoMasked: string;
  segredoAtualCriadoEm: string;
  hasPreviousSecret: boolean;
  updatedAt: string;
}

export interface IntegrationMetrics {
  recebidosHoje: number;
  duplicadosIgnorados: number;
  errosProcessamento: number;
  clientesNaoEncontrados: number;
  ultimoRelatorioRecebidoEm: string | null;
}
