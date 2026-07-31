import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Client, PDFReport, Batch, QueueItem, QueueItemStatus, AuditLog, AuthUser, WhatsAppConfig, UserRole, DuplicateReportDetails, WorkerStatusInfo, IntegrationLog, IntegrationConfig, IntegrationMetrics } from '../types';

// Convert competencia string "MM/YYYY" to DATE format "YYYY-MM-01"
export function competenciaToDateStr(competencia: string | null): string {
  if (!competencia) return '2026-07-01';
  const parts = competencia.split('/');
  if (parts.length === 2) {
    return `${parts[1]}-${parts[0].padStart(2, '0')}-01`;
  }
  return '2026-07-01';
}

// Convert DATE format "YYYY-MM-DD" to "MM/YYYY"
export function dateStrToCompetencia(dateStr: string | null): string {
  if (!dateStr) return '07/2026';
  const clean = dateStr.split('T')[0];
  const parts = clean.split('-');
  if (parts.length >= 2) {
    return `${parts[1]}/${parts[0]}`;
  }
  return '07/2026';
}

// Handle service errors consistently
function handleServiceError(error: any, context: string): never {
  console.error(`[Supabase Service Error] - ${context}:`, error);
  const msg = typeof error === 'string' ? error : error?.message || error?.details || error?.error_description || String(error) || '';
  const lowerMsg = msg.toLowerCase();
  if (
    lowerMsg.includes('failed to fetch') ||
    lowerMsg.includes('fetch failed') ||
    lowerMsg.includes('networkerror') ||
    lowerMsg.includes('net::err') ||
    (typeof navigator !== 'undefined' && !navigator.onLine)
  ) {
    throw new Error('Falha na conexão com o servidor Supabase. Verifique a URL do Supabase ou sua conexão de internet.');
  }
  throw new Error(msg || `Erro de comunicação com o Supabase em ${context}`);
}

// Calculate SHA-256 hash of a file
export async function calculateFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

/* ==========================================
   1. AUTH SERVICE
   ========================================== */
export const authService = {
  async login(email: string, password: string): Promise<AuthUser> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      throw new Error(error.message || 'Falha ao autenticar no Supabase.');
    }

    if (!data.user) {
      throw new Error('Usuário não encontrado.');
    }

    const { data: perfil } = await supabase
      .from('perfis')
      .select('*')
      .eq('id', data.user.id)
      .maybeSingle();

    return {
      id: data.user.id,
      email: data.user.email || email,
      role: perfil?.role === 'administrador' ? 'Administrador' : 'Operador',
      nome: perfil?.nome || email.split('@')[0]
    };
  },

  async logout(): Promise<void> {
    if (!supabase) return;
    await supabase.auth.signOut();
  },

  async getCurrentUser(): Promise<AuthUser | null> {
    if (!supabase) return null;

    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) return null;

      const { data: perfil } = await supabase
        .from('perfis')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      return {
        id: user.id,
        email: user.email || '',
        role: perfil?.role === 'administrador' ? 'Administrador' : 'Operador',
        nome: perfil?.nome || user.email?.split('@')[0] || 'Usuário'
      };
    } catch {
      return null;
    }
  }
};

/* ==========================================
   2. CLIENTES SERVICE
   ========================================== */
export const clientesService = {
  async list(): Promise<Client[]> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    try {
      const { data, error } = await supabase
        .from('clientes')
        .select('*')
        .order('empresa', { ascending: true });

      if (error) {
        handleServiceError(error, 'clientesService.list');
      }
      return data || [];
    } catch (err) {
      handleServiceError(err, 'clientesService.list');
    }
  },

  async getById(id: string): Promise<Client | null> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    try {
      const { data, error } = await supabase
        .from('clientes')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        handleServiceError(error, 'clientesService.getById');
      }
      return data;
    } catch (err) {
      handleServiceError(err, 'clientesService.getById');
    }
  },

  async create(clientData: Omit<Client, 'id' | 'created_at' | 'updated_at'>, userId?: string): Promise<Client> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    const { data, error } = await supabase
      .from('clientes')
      .insert({
        codigo_cliente: clientData.codigo_cliente,
        empresa: clientData.empresa,
        nome_contato: clientData.nome_contato,
        telefone_whatsapp: clientData.telefone_whatsapp,
        email: clientData.email,
        ativo: clientData.ativo !== undefined ? clientData.ativo : true,
        possui_optin: clientData.possui_optin !== undefined ? clientData.possui_optin : true,
        dia_envio: clientData.dia_envio || 5,
        horario_envio: clientData.horario_envio || '09:00',
        observacoes: clientData.observacoes || null
      })
      .select('*')
      .single();

    if (error) {
      handleServiceError(error, 'clientesService.create');
    }
    return data;
  },

  async update(id: string, updates: Partial<Client>): Promise<Client> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    const { data, error } = await supabase
      .from('clientes')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      handleServiceError(error, 'clientesService.update');
    }
    return data;
  },

  async getClientDependencies(id: string): Promise<{
    reportsCount: number;
    queueCount: number;
    batchesCount: number;
  }> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    const [{ count: reportsCount }, { count: queueCount }, { data: queueBatches }] = await Promise.all([
      supabase.from('relatorios').select('id', { count: 'exact', head: true }).eq('cliente_id', id),
      supabase.from('fila_envios').select('id', { count: 'exact', head: true }).eq('cliente_id', id),
      supabase.from('fila_envios').select('lote_id').eq('cliente_id', id).not('lote_id', 'is', null)
    ]);

    const uniqueBatchIds = new Set((queueBatches || []).map(q => q.lote_id));

    return {
      reportsCount: reportsCount || 0,
      queueCount: queueCount || 0,
      batchesCount: uniqueBatchIds.size
    };
  },

  async excluirClienteCompleto(id: string, usuarioId?: string): Promise<void> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    try {
      const { error: rpcError } = await supabase.rpc('excluir_cliente_completo', { p_cliente_id: id });
      if (!rpcError) {
        if (usuarioId) {
          await auditoriaService.log(usuarioId, 'excluir_cliente_completo', 'clientes', id, null, { cliente_id: id });
        }
        return;
      }
    } catch (e) {
      console.warn('RPC excluir_cliente_completo não disponível. Executando cascata do cliente...');
    }

    // Fallback cascading delete:
    // 1. Fetch reports to remove files from storage bucket
    const { data: reports } = await supabase.from('relatorios').select('id, storage_path').eq('cliente_id', id);
    if (reports && reports.length > 0) {
      const storagePaths = reports.map(r => r.storage_path).filter(Boolean);
      if (storagePaths.length > 0) {
        try {
          await supabase.storage.from('relatorios').remove(storagePaths);
        } catch (sErr) {
          console.warn('Aviso: Erro ao remover arquivos do bucket ao excluir cliente:', sErr);
        }
      }
      const reportIds = reports.map(r => r.id);
      await supabase.from('fila_envios').delete().in('relatorio_id', reportIds);
      await supabase.from('relatorios').delete().eq('cliente_id', id);
    }

    // 2. Delete remaining queue items for client
    await supabase.from('fila_envios').delete().eq('cliente_id', id);

    // 3. Delete client
    const { error: delErr } = await supabase.from('clientes').delete().eq('id', id);
    if (delErr) {
      handleServiceError(delErr, 'clientesService.excluirClienteCompleto');
    }

    if (usuarioId) {
      await auditoriaService.log(usuarioId, 'excluir_cliente_completo', 'clientes', id, null, { cliente_id: id });
    }
  },

  async deleteOrInactivate(id: string): Promise<{ action: 'deleted' | 'inactivated' }> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    const [{ count: reportsCount }, { count: queueCount }] = await Promise.all([
      supabase.from('relatorios').select('id', { count: 'exact', head: true }).eq('cliente_id', id),
      supabase.from('fila_envios').select('id', { count: 'exact', head: true }).eq('cliente_id', id)
    ]);

    if ((reportsCount || 0) > 0 || (queueCount || 0) > 0) {
      const { error } = await supabase
        .from('clientes')
        .update({ ativo: false, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) {
        handleServiceError(error, 'clientesService.deleteOrInactivate');
      }
      return { action: 'inactivated' };
    } else {
      const { error } = await supabase
        .from('clientes')
        .delete()
        .eq('id', id);

      if (error) {
        handleServiceError(error, 'clientesService.deleteOrInactivate');
      }
      return { action: 'deleted' };
    }
  }
};

/* ==========================================
   3. RELATORIOS SERVICE
   ========================================== */
export interface DBReport {
  id: string;
  cliente_id: string | null;
  codigo_cliente: string | null;
  competencia: string;
  tipo_relatorio: string;
  nome_arquivo: string;
  nome_original?: string;
  storage_path: string;
  tamanho_bytes: number;
  mime_type: string;
  hash_arquivo: string;
  status_validacao: string;
  motivo_pendencia: string | null;
  enviado_anteriormente: boolean;
  versao?: number;
  relatorio_anterior_id?: string | null;
  versao_atual?: boolean;
  created_at: string;
  updated_at?: string;

  // Deletion fields
  arquivo_excluido?: boolean;
  arquivo_excluido_em?: string | null;
  arquivo_exclusao_agendada_para?: string | null;
  arquivo_exclusao_tentativas?: number;
  arquivo_exclusao_erro?: string | null;
}

export interface DetailedReport {
  id: string;
  cliente_id: string | null;
  codigo_cliente: string | null;
  competencia: string;
  tipo_relatorio: string;
  nome_arquivo: string;
  nome_original?: string;
  storage_path: string;
  tamanho_bytes: number;
  mime_type: string;
  hash_arquivo: string;
  status_validacao: string;
  motivo_pendencia: string | null;
  enviado_anteriormente: boolean;
  versao: number;
  versao_atual: boolean;
  relatorio_anterior_id?: string | null;
  created_at: string;
  updated_at?: string;

  // Deletion fields
  arquivo_excluido: boolean;
  arquivo_excluido_em?: string | null;
  arquivo_exclusao_agendada_para?: string | null;
  arquivo_exclusao_tentativas?: number;
  arquivo_exclusao_erro?: string | null;

  // Joined client fields
  cliente_empresa?: string | null;
  cliente_nome_contato?: string | null;
  cliente_telefone?: string | null;
  cliente_email?: string | null;
  cliente_ativo?: boolean;
  cliente_possui_optin?: boolean;

  // Integration fields
  origem_sistema?: string | null;
  identificador_origem?: string | null;
  recebido_via_integracao?: boolean;
  periodo_inicio?: string | null;
  periodo_fim?: string | null;
  periodicidade?: string | null;
  lote_externo_id?: string | null;

  // Most recent queue status
  status_envio: 'nao_enviado' | 'pendente' | 'agendado' | 'processando' | 'enviado' | 'entregue' | 'lido' | 'falhou' | 'cancelado';
  ultimo_envio_id?: string | null;
  ultimo_envio_data?: string | null;
  ultimo_envio_erro?: string | null;
  ultimo_lote_id?: string | null;
  tem_envio_ativo: boolean;
}

export const relatoriosService = {
  async listDetailedReports(): Promise<DetailedReport[]> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    let reportsData: any[] = [];
    try {
      const { data, error } = await supabase
        .from('relatorios')
        .select('*, clientes(empresa, codigo_cliente, telefone_whatsapp, email, ativo, possui_optin, nome_contato)')
        .order('created_at', { ascending: false });

      if (error) {
        console.warn(`[relatoriosService.listDetailedReports] Join query fallback (${error.message})...`);
        const { data: rawReports, error: repErr } = await supabase
          .from('relatorios')
          .select('*')
          .order('created_at', { ascending: false });

        if (repErr) handleServiceError(repErr, 'relatoriosService.listDetailedReports');
        reportsData = rawReports || [];
      } else {
        reportsData = data || [];
      }
    } catch (err) {
      handleServiceError(err, 'relatoriosService.listDetailedReports');
    }

    const { data: allClients } = await supabase
      .from('clientes')
      .select('id, empresa, codigo_cliente, telefone_whatsapp, email, ativo, possui_optin, nome_contato');

    const clientsMap = new Map((allClients || []).map(c => [c.id, c]));

    const { data: queueItems } = await supabase
      .from('fila_envios')
      .select('id, lote_id, cliente_id, relatorio_id, status, created_at, enviado_em, data_envio, erro_mensagem, whatsapp_message_id')
      .order('created_at', { ascending: false });

    const queueByReportId = new Map<string, any[]>();
    (queueItems || []).forEach(q => {
      if (q.relatorio_id) {
        const list = queueByReportId.get(q.relatorio_id) || [];
        list.push(q);
        queueByReportId.set(q.relatorio_id, list);
      }
    });

    return reportsData.map(r => {
      const cliFromJoin = r.clientes;
      const cli = (cliFromJoin && typeof cliFromJoin === 'object' && !Array.isArray(cliFromJoin))
        ? cliFromJoin
        : (r.cliente_id ? clientsMap.get(r.cliente_id) : null);

      const queueList = r.id ? queueByReportId.get(r.id) || [] : [];
      const latestQueueItem = queueList[0];

      let status_envio: DetailedReport['status_envio'] = 'nao_enviado';
      let tem_envio_ativo = false;

      if (latestQueueItem) {
        const st = latestQueueItem.status;
        if (st === 'pendente') {
          status_envio = 'pendente';
          tem_envio_ativo = true;
        } else if (st === 'agendado') {
          status_envio = 'agendado';
          tem_envio_ativo = true;
        } else if (st === 'processando') {
          status_envio = 'processando';
          tem_envio_ativo = true;
        } else if (st === 'enviado') {
          status_envio = 'enviado';
        } else if (st === 'entregue') {
          status_envio = 'entregue';
        } else if (st === 'lido') {
          status_envio = 'lido';
        } else if (st === 'falhou' || st === 'erro') {
          status_envio = 'falhou';
        } else if (st === 'cancelado') {
          status_envio = 'cancelado';
        }
      }

      return {
        id: r.id,
        cliente_id: r.cliente_id,
        codigo_cliente: r.codigo_extraido || r.codigo_cliente || cli?.codigo_cliente || null,
        competencia: r.competencia ? dateStrToCompetencia(r.competencia) : '07/2026',
        tipo_relatorio: r.tipo_relatorio || 'PDF',
        nome_arquivo: r.nome_arquivo || r.nome_original || 'Relatorio.pdf',
        nome_original: r.nome_original,
        storage_path: r.storage_path,
        tamanho_bytes: r.tamanho_bytes || 0,
        mime_type: r.mime_type || 'application/pdf',
        hash_arquivo: r.hash_arquivo || '',
        status_validacao: r.status_validacao || 'pronto',
        motivo_pendencia: r.motivo_pendencia || null,
        enviado_anteriormente: r.enviado_anteriormente || false,
        versao: r.versao || 1,
        versao_atual: r.versao_atual !== undefined ? r.versao_atual : true,
        relatorio_anterior_id: r.relatorio_anterior_id || null,
        created_at: r.created_at,
        updated_at: r.updated_at,

        // Deletion fields
        arquivo_excluido: Boolean(r.arquivo_excluido || !r.storage_path),
        arquivo_excluido_em: r.arquivo_excluido_em || null,
        arquivo_exclusao_agendada_para: r.arquivo_exclusao_agendada_para || null,
        arquivo_exclusao_tentativas: r.arquivo_exclusao_tentativas || 0,
        arquivo_exclusao_erro: r.arquivo_exclusao_erro || null,

        cliente_empresa: cli?.empresa || 'Cliente não associado',
        cliente_nome_contato: cli?.nome_contato || null,
        cliente_telefone: cli?.telefone_whatsapp || null,
        cliente_email: cli?.email || null,
        cliente_ativo: cli?.ativo !== false,
        cliente_possui_optin: cli?.possui_optin !== false,

        status_envio,
        ultimo_envio_id: latestQueueItem?.id || null,
        ultimo_envio_data: latestQueueItem?.enviado_em || latestQueueItem?.data_envio || latestQueueItem?.created_at || null,
        ultimo_envio_erro: latestQueueItem?.erro_mensagem || null,
        ultimo_lote_id: latestQueueItem?.lote_id || null,
        tem_envio_ativo
      };
    });
  },

  async excluirPdfManualmente(relatorioId: string, usuarioId?: string): Promise<{ success: boolean; message?: string }> {
    if (!supabase) throw new Error('Conexão com o Supabase indisponível.');

    try {
      const { data: edgeData, error: edgeErr } = await supabase.functions.invoke('limpar-pdfs-enviados', {
        body: { relatorioId, forceManual: true }
      });

      if (edgeErr) {
        console.warn('[relatoriosService.excluirPdfManualmente] Chamada para Edge Function falhou, executando fallback local:', edgeErr);
        const { data: report, error: repErr } = await supabase
          .from('relatorios')
          .select('*')
          .eq('id', relatorioId)
          .single();

        if (repErr || !report) throw new Error('Relatório não encontrado.');

        if (report.storage_path) {
          await supabase.storage.from('relatorios').remove([report.storage_path]);
        }

        const agoraIso = new Date().toISOString();
        await supabase
          .from('relatorios')
          .update({
            arquivo_excluido: true,
            arquivo_excluido_em: agoraIso,
            arquivo_exclusao_erro: null,
            storage_path: null,
            updated_at: agoraIso
          })
          .eq('id', relatorioId);

        if (usuarioId) {
          await auditoriaService.log(usuarioId, 'exclusao_manual_pdf', 'relatorios', relatorioId, null, {
            nome_arquivo: report.nome_arquivo || report.nome_original,
            origem: 'interface_admin_fallback'
          });
        }

        return { success: true };
      }

      if (usuarioId) {
        await auditoriaService.log(usuarioId, 'exclusao_manual_pdf', 'relatorios', relatorioId, null, {
          relatorioId,
          resultado: edgeData
        });
      }

      return { success: true };
    } catch (err: any) {
      handleServiceError(err, 'relatoriosService.excluirPdfManualmente');
      return { success: false, message: err.message || 'Erro ao excluir PDF.' };
    }
  },

  async getHistory(relatorioId: string): Promise<any[]> {
    if (!supabase) throw new Error('Conexão com o Supabase indisponível.');
    const { data, error } = await supabase
      .from('fila_envios')
      .select('*, lotes_envio(nome, status)')
      .eq('relatorio_id', relatorioId)
      .order('created_at', { ascending: false });

    if (error) handleServiceError(error, 'relatoriosService.getHistory');
    return data || [];
  },

  async criarLoteRelatorios(
    reports: DetailedReport[],
    nomeLote: string,
    modalidade: 'imediato' | 'agendado',
    dataProgramada: string | null,
    permitirReenvio: boolean,
    usuarioId: string
  ): Promise<{ loteId: string; totalItens: number; totalEnfileirados: number }> {
    if (!supabase) throw new Error('Conexão com o Supabase indisponível.');

    const relatorioIdsTarget = reports.map(r => r.id);
    const { data: activeQueueItems } = await supabase
      .from('fila_envios')
      .select('relatorio_id')
      .in('relatorio_id', relatorioIdsTarget)
      .in('status', ['pendente', 'agendado', 'processando']);

    const activeReportIdsSet = new Set((activeQueueItems || []).map(q => q.relatorio_id));

    const eligibleReports: DetailedReport[] = [];
    const seenReportIds = new Set<string>();

    for (const r of reports) {
      if (!r.id || seenReportIds.has(r.id)) continue;
      
      if (r.status_validacao !== 'pronto') continue;
      if (!r.cliente_id || r.cliente_ativo === false) continue;
      if (!r.cliente_telefone || r.cliente_telefone.replace(/\D/g, '').length === 0) continue;
      if (r.cliente_possui_optin === false) continue;
      if (!r.storage_path) continue;
      if (activeReportIdsSet.has(r.id)) continue;

      if (!permitirReenvio && (r.status_envio === 'enviado' || r.status_envio === 'entregue' || r.status_envio === 'lido')) {
        continue;
      }

      seenReportIds.add(r.id);
      eligibleReports.push(r);
    }

    if (eligibleReports.length === 0) {
      throw new Error('Nenhum dos relatórios selecionados atende a todas as regras de elegibilidade para envio.');
    }

    const competenciaComp = eligibleReports[0]?.competencia || '07/2026';
    const { data: lote, error: loteErr } = await supabase
      .from('lotes_envio')
      .insert({
        nome: nomeLote,
        competencia: competenciaToDateStr(competenciaComp),
        modalidade,
        data_programada: dataProgramada ? new Date(dataProgramada).toISOString() : null,
        status: modalidade === 'imediato' ? 'aguardando' : 'agendado',
        total_itens: eligibleReports.length,
        total_validos: eligibleReports.length,
        total_enviados: 0,
        total_falhas: 0,
        created_by: usuarioId
      })
      .select()
      .single();

    if (loteErr || !lote) {
      handleServiceError(loteErr || new Error('Erro ao criar lote em public.lotes_envio'), 'relatoriosService.criarLoteRelatorios');
    }

    const queueItemsToInsert = eligibleReports.map(r => ({
      lote_id: lote.id,
      cliente_id: r.cliente_id,
      relatorio_id: r.id,
      telefone_destino: r.cliente_telefone!.replace(/\D/g, ''),
      data_programada: modalidade === 'imediato' ? new Date().toISOString() : (dataProgramada ? new Date(dataProgramada).toISOString() : null),
      status: modalidade === 'imediato' ? 'pendente' : 'agendado',
      tentativas: 0
    }));

    const { error: filaErr } = await supabase.from('fila_envios').insert(queueItemsToInsert);
    if (filaErr) {
      await supabase.from('lotes_envio').delete().eq('id', lote.id);
      handleServiceError(filaErr, 'relatoriosService.criarLoteRelatorios.insertQueue');
    }

    await auditoriaService.log(
      usuarioId,
      'envio_em_lote_relatorios',
      'lotes_envio',
      lote.id,
      null,
      { nome_lote: nomeLote, total_enfileirados: eligibleReports.length, modalidade }
    );

    if (modalidade === 'imediato') {
      try {
        console.log('[relatoriosService] Invocando Edge Function processar-fila-whatsapp para loteId:', lote.id);
        await supabase.functions.invoke('processar-fila-whatsapp', {
          body: { loteId: lote.id }
        });
      } catch (edgeErr) {
        console.warn('Alerta: Edge Function processar-fila-whatsapp respondeu com erro/timeout:', edgeErr);
      }
    }

    return {
      loteId: lote.id,
      totalItens: reports.length,
      totalEnfileirados: eligibleReports.length
    };
  },
  async getByHash(hash: string): Promise<DBReport | null> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    const { data, error } = await supabase
      .from('relatorios')
      .select('*')
      .eq('hash_arquivo', hash)
      .maybeSingle();

    if (error) {
      handleServiceError(error, 'relatoriosService.getByHash');
    }
    return data ? {
      ...data,
      codigo_cliente: data.codigo_extraido || data.codigo_cliente || null
    } : null;
  },

  async getByCombo(clienteId: string, competencia: string, tipo: string): Promise<DBReport | null> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    const { data, error } = await supabase
      .from('relatorios')
      .select('*')
      .eq('cliente_id', clienteId)
      .eq('competencia', competencia)
      .eq('tipo_relatorio', tipo)
      .maybeSingle();

    if (error) {
      handleServiceError(error, 'relatoriosService.getByCombo');
    }
    return data ? {
      ...data,
      codigo_cliente: data.codigo_extraido || data.codigo_cliente || null
    } : null;
  },

  async listAll(): Promise<DBReport[]> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    const { data, error } = await supabase
      .from('relatorios')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      handleServiceError(error, 'relatoriosService.listAll');
    }
    return (data || []).map(r => ({
      ...r,
      codigo_cliente: r.codigo_extraido || r.codigo_cliente || null
    }));
  },

  async listPendentes(): Promise<DBReport[]> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    const { data, error } = await supabase
      .from('relatorios')
      .select('*')
      .neq('status_validacao', 'pronto')
      .order('created_at', { ascending: false });

    if (error) {
      handleServiceError(error, 'relatoriosService.listPendentes');
    }
    return (data || []).map(r => ({
      ...r,
      codigo_cliente: r.codigo_extraido || r.codigo_cliente || null
    }));
  },

  async delete(reportId: string, storagePath?: string): Promise<void> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    const { data: queueItems } = await supabase
      .from('fila_envios')
      .select('status')
      .eq('relatorio_id', reportId);

    const hasActiveQueue = (queueItems || []).some(q => ['pendente', 'processando', 'agendado'].includes(q.status));
    if (hasActiveQueue) {
      throw new Error('Não é possível excluir este relatório pois ele possui envios pendentes ou em processamento na fila.');
    }

    if (storagePath) {
      try {
        await supabase.storage.from('relatorios').remove([storagePath]);
      } catch (err) {
        console.warn('Erro ao remover arquivo do Storage:', err);
      }
    }

    const { error } = await supabase
      .from('relatorios')
      .delete()
      .eq('id', reportId);

    if (error) {
      handleServiceError(error, 'relatoriosService.delete');
    }
  },

  async excluirManualCompleto(reportId: string, usuarioId?: string): Promise<void> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    // Try Edge Function first
    try {
      const { data, error } = await supabase.functions.invoke('excluir-relatorios-enviados-expirados', {
        body: { relatorioId: reportId, usuarioId }
      });

      if (!error && data) {
        const resultadoItem = data?.resultados?.[0];
        if (resultadoItem && resultadoItem.status !== 'excluido') {
          throw new Error(resultadoItem.motivo || `Não foi possível excluir o relatório (status: ${resultadoItem.status}).`);
        }
        return;
      }
      if (error) {
        console.warn('[excluirManualCompleto] Edge function respondeu com erro:', error.message);
      }
    } catch (e: any) {
      console.warn('[excluirManualCompleto] Falha de conexão ao invocar Edge Function, executando rotina direta no banco:', e?.message || String(e));
    }

    // Fallback: Safe 10-step direct execution if Edge Function is unavailable/returns error
    const { data: relatorio, error: relErr } = await supabase
      .from('relatorios')
      .select('*')
      .eq('id', reportId)
      .single();

    if (relErr || !relatorio) {
      throw new Error('Relatório não encontrado no banco de dados.');
    }

    // 1. Fetch related queue items
    const { data: queueItems } = await supabase
      .from('fila_envios')
      .select('id, lote_id, status, enviado_em, created_at')
      .eq('relatorio_id', reportId);

    const items = queueItems || [];
    const queueItemIds = items.map(i => i.id);
    const loteIds = Array.from(new Set(items.map(i => i.lote_id).filter(Boolean)));
    const storagePath = relatorio.storage_path;

    // 2. Audit Log BEFORE deletion
    await auditoriaService.log(
      usuarioId || null,
      'exclusao_manual_relatorio',
      'relatorios',
      reportId,
      null,
      {
        relatorio_id: reportId,
        cliente_id: relatorio.cliente_id,
        nome_arquivo: relatorio.nome_arquivo || relatorio.nome_original,
        competencia: relatorio.competencia,
        storage_path: storagePath,
        lote_ids: loteIds,
        origem: 'Interface Web (Fallback Diretamente via Supabase Service)',
        motivo: 'Exclusão manual solicitada por administrador'
      }
    );

    // 3. Delete historico_status
    if (queueItemIds.length > 0) {
      await supabase
        .from('historico_status')
        .delete()
        .in('fila_envio_id', queueItemIds);
    }

    // 4. Delete fila_envios
    const { error: fErr } = await supabase
      .from('fila_envios')
      .delete()
      .eq('relatorio_id', reportId);

    if (fErr) {
      throw new Error(`Erro ao excluir itens da fila de envios: ${fErr.message}`);
    }

    // 5. Delete PDF from Storage
    if (storagePath) {
      const { error: stErr } = await supabase.storage
        .from('relatorios')
        .remove([storagePath]);

      if (stErr) {
        const msg = stErr.message || String(stErr);
        if (!msg.toLowerCase().includes('not found') && !msg.toLowerCase().includes('404')) {
          console.warn('[excluirManualCompleto] Aviso no Storage:', msg);
        }
      }
    }

    // 6. Delete from public.relatorios
    const { error: rErr } = await supabase
      .from('relatorios')
      .delete()
      .eq('id', reportId);

    if (rErr) {
      throw new Error(`Erro ao excluir registro do relatório: ${rErr.message}`);
    }

    // 7. Recalculate & Archive affected batches if empty
    for (const loteId of loteIds) {
      const { data: remainingQueue } = await supabase
        .from('fila_envios')
        .select('status')
        .eq('lote_id', loteId);

      const rem = remainingQueue || [];
      if (rem.length === 0) {
        await supabase
          .from('lotes_envio')
          .update({
            total_itens: 0,
            total_enviados: 0,
            total_falhas: 0,
            archived_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', loteId);
      } else {
        const totalEnviados = rem.filter(i => ['enviado', 'entregue', 'lido'].includes(i.status)).length;
        const totalFalhas = rem.filter(i => i.status === 'falhou').length;
        await supabase
          .from('lotes_envio')
          .update({
            total_itens: rem.length,
            total_enviados: totalEnviados,
            total_falhas: totalFalhas,
            updated_at: new Date().toISOString()
          })
          .eq('id', loteId);
      }
    }
  },

  async uploadFile(
    file: File,
    folderPath: string,
    reportData: {
      cliente_id: string | null;
      codigo_cliente: string | null;
      competencia: string;
      tipo_relatorio: string;
      nome_arquivo: string;
      tamanho_bytes: number;
      mime_type: string;
      status_validacao: string;
      motivo_pendencia: string | null;
      enviado_anteriormente: boolean;
    }
  ): Promise<{ id: string; storagePath: string }> {
    if (!supabase) {
      throw new Error("Conexão com o Supabase indisponível. O arquivo não foi enviado.");
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      throw new Error('Usuário não autenticado.');
    }
    const user = userData.user;

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      throw new Error('Apenas arquivos PDF são permitidos.');
    }

    const sizeLimit = 10 * 1024 * 1024;
    if (file.size > sizeLimit) {
      throw new Error('O arquivo excede o limite máximo permitido de 10MB.');
    }

    const hashValue = await calculateFileHash(file);

    // Verify duplication by hash
    const { data: dupByHash, error: hashErr } = await supabase
      .from('relatorios')
      .select('id')
      .eq('hash_arquivo', hashValue)
      .maybeSingle();

    if (hashErr) {
      throw new Error(`Erro ao verificar duplicidade por hash: ${hashErr.message}`);
    }
    if (dupByHash) {
      throw new Error('Relatório duplicado detectado: já existe um arquivo cadastrado com o mesmo conteúdo (hash).');
    }

    // Verify duplication by combo
    if (reportData.cliente_id) {
      const { data: dupByCombo, error: comboErr } = await supabase
        .from('relatorios')
        .select('id')
        .eq('cliente_id', reportData.cliente_id)
        .eq('competencia', reportData.competencia)
        .eq('tipo_relatorio', reportData.tipo_relatorio)
        .maybeSingle();

      if (comboErr) {
        throw new Error(`Erro ao verificar duplicidade por cliente/competência/tipo: ${comboErr.message}`);
      }
      if (dupByCombo) {
        throw new Error('Relatório duplicado detectado: já existe um relatório deste tipo para este cliente nesta competência.');
      }
    }

    const yearMonth = reportData.competencia ? reportData.competencia.slice(0, 7) : new Date().toISOString().slice(0, 7);
    const clientCode = reportData.codigo_cliente || 'SEM_CODIGO';
    const uuid = crypto.randomUUID ? crypto.randomUUID() : `uuid-${Date.now()}`;
    const fileName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const storagePath = `${yearMonth}/${clientCode}/${uuid}_${fileName}`;
    const bucketName = 'relatorios';

    // 1. AUDIT LOG: Bucket & storagePath before upload
    console.log('=== [AUDITORIA UPLOAD STORAGE - PASSO 1] ===');
    console.log('[AUDIT 1] Bucket de destino:', bucketName);
    console.log('[AUDIT 1] storagePath calculado antes do upload:', storagePath);
    console.log('[AUDIT 1] Metadados do arquivo:', {
      fileNameOriginal: file.name,
      fileSize: file.size,
      fileType: file.type,
      userAuthenticatedId: user.id
    });

    // 2. AUDIT LOG: Execute upload and log full result (result.data, result.error)
    console.log('=== [AUDITORIA UPLOAD STORAGE - PASSO 2] Executando upload... ===');
    const result = await supabase.storage
      .from(bucketName)
      .upload(storagePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    console.log('[AUDIT 2] Resultado bruto do upload (result.data):', JSON.stringify(result.data, null, 2));
    console.log('[AUDIT 2] Resultado bruto do upload (result.error):', JSON.stringify(result.error, null, 2));

    const uploadData = result.data;
    const uploadError = result.error;

    // 7. AUDIT LOG: Check Policy INSERT in storage.objects
    if (uploadError) {
      console.error('[AUDIT 7] FALHA DE POLICY / RLS / ERRO STORAGE em storage.objects:', uploadError);
      console.error('[AUDIT 8] ABORTANDO: O upload falhou no Storage. NÃO será gravado em public.relatorios.');
      throw new Error(`Falha no upload para o Storage: ${uploadError.message || 'Erro de permissão ou RLS no bucket relatorios'}`);
    }

    if (!uploadData?.path) {
      console.error('[AUDIT 4] ERRO CRÍTICO: uploadData.path não foi retornado pelo Supabase Storage.');
      console.error('[AUDIT 8] ABORTANDO: Caminho inexistente. NÃO será gravado em public.relatorios.');
      throw new Error('Caminho do arquivo (uploadData.path) não retornado pelo Storage.');
    }

    // 5. AUDIT LOG: Confirm if uploadData.path is exactly equal to storagePath
    console.log('[AUDIT 4] uploadData.path retornado:', uploadData.path);
    console.log('[AUDIT 5] Verificação de igualdade (uploadData.path === storagePath):', uploadData.path === storagePath, {
      uploadDataPath: uploadData.path,
      calculatedStoragePath: storagePath
    });

    // 3. AUDIT LOG: Immediately list directory in Storage to verify real existence
    const directory = uploadData.path.substring(0, uploadData.path.lastIndexOf('/'));
    const filename = uploadData.path.substring(uploadData.path.lastIndexOf('/') + 1);

    console.log('=== [AUDITORIA UPLOAD STORAGE - PASSO 3] Verificando existência com list() ===');
    console.log('[AUDIT 3] Parâmetros da busca:', { directory, filename });

    const filesListResult = await supabase.storage
      .from(bucketName)
      .list(directory, {
        search: filename,
        limit: 10
      });

    console.log('[AUDIT 3] Resultado de list() (files.data):', JSON.stringify(filesListResult.data, null, 2));
    console.log('[AUDIT 3] Resultado de list() (files.error):', JSON.stringify(filesListResult.error, null, 2));

    const fileExistsInStorage = filesListResult.data?.some(item => item.name === filename);
    console.log('[AUDIT 4] Confirmado se o arquivo realmente existe no Storage após list():', fileExistsInStorage);

    // 8. AUDIT LOG: If uploadData.path does NOT exist in Storage, do NOT save to public.relatorios
    if (filesListResult.error || !fileExistsInStorage) {
      console.error('[AUDIT 8] ERRO CRÍTICO: Objeto NÃO foi localizado no Storage imediatamente após upload!');
      console.error('[AUDIT 8] Detalhes do erro em list():', JSON.stringify(filesListResult.error, null, 2));
      console.error('[AUDIT 8] ABORTANDO OPERAÇÃO: NÃO será criado registro em public.relatorios.');

      // Attempt cleanup of orphan reference if any
      try {
        await supabase.storage.from(bucketName).remove([uploadData.path]);
      } catch (cleanErr) {
        console.warn('[AUDIT 8] Tentativa de remoção pós-falha:', cleanErr);
      }

      throw new Error('O Storage não confirmou a persistência do arquivo. Registro em public.relatorios CANCELADO.');
    }

    // 9. AUDIT LOG: Recording in public.relatorios
    console.log('=== [AUDITORIA UPLOAD STORAGE - PASSO 9] Gravando registro em public.relatorios ===');
    console.log('[AUDIT 9] Gravação do objeto em public.relatorios com storage_path =', uploadData.path);

    try {
      const { data, error: insertError } = await supabase
        .from('relatorios')
        .insert({
          cliente_id: reportData.cliente_id,
          codigo_extraido: reportData.codigo_cliente,
          competencia: reportData.competencia,
          tipo_relatorio: reportData.tipo_relatorio,
          nome_arquivo: reportData.nome_arquivo,
          nome_original: file.name,
          storage_path: uploadData.path,
          tamanho_bytes: reportData.tamanho_bytes,
          mime_type: reportData.mime_type,
          hash_arquivo: hashValue,
          status_validacao: 'pronto',
          motivo_pendencia: reportData.motivo_pendencia,
          enviado_anteriormente: reportData.enviado_anteriormente,
          created_by: user.id
        })
        .select('id')
        .single();

      if (insertError) {
        console.error('[AUDIT 9] ERRO no INSERT em public.relatorios:', insertError);
        throw insertError;
      }

      console.log('[AUDIT 9] SUCESSO: Registro inserido em public.relatorios com ID:', data.id);

      // Final audit check: verify if object still exists after DB insert
      const postInsertCheck = await supabase.storage
        .from(bucketName)
        .list(directory, { search: filename });

      const stillExists = postInsertCheck.data?.some(i => i.name === filename);
      console.log('[AUDIT 9] Verificação pós-insert na tabela: Objeto continua no Storage?', stillExists, {
        data: postInsertCheck.data,
        error: postInsertCheck.error
      });

      if (!stillExists) {
        console.error('ALERT CRÍTICO [AUDIT 9]: O objeto DESAPARECEU do Storage imediatamente APÓS o insert no banco! Verifique se há Triggers ou Webhooks removendo arquivos.');
      }

      return { id: data.id, storagePath: uploadData.path };
    } catch (insertErr: any) {
      console.error('[AUDIT 9 ROLLBACK] Falha ao inserir em public.relatorios. Executando rollback (remove) no Storage:', uploadData.path);
      try {
        await supabase.storage.from(bucketName).remove([uploadData.path]);
      } catch (removeErr) {
        console.error('[AUDIT 9 ROLLBACK] Falha ao remover arquivo do Storage após erro de insert:', removeErr);
      }
      throw new Error(`Falha no insert em public.relatorios: ${insertErr.message || insertErr}`);
    }
  },

  async getSignedUrl(storagePath: string): Promise<string> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    if (!storagePath) {
      throw new Error('Caminho do arquivo não fornecido.');
    }

    if (storagePath.startsWith('http://') || storagePath.startsWith('https://') || storagePath.startsWith('blob:')) {
      return storagePath;
    }

    const cleanPath = storagePath.startsWith('relatorios/') ? storagePath.replace(/^relatorios\//, '') : storagePath;

    const { data, error } = await supabase.storage
      .from('relatorios')
      .createSignedUrl(cleanPath, 3600);

    if (error || !data?.signedUrl) {
      const { data: pubData } = supabase.storage
        .from('relatorios')
        .getPublicUrl(cleanPath);
      if (pubData?.publicUrl) {
        return pubData.publicUrl;
      }
      throw new Error(`Erro ao obter URL do relatório: ${error?.message || 'URL não gerada'}`);
    }
    return data.signedUrl;
  },

  async verifyDuplicateDetails(hashValue: string, clienteId: string | null, competencia: string, tipoRelatorio: string): Promise<DuplicateReportDetails | null> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    let { data: existing } = await supabase
      .from('relatorios')
      .select('*, clientes(empresa)')
      .eq('hash_arquivo', hashValue)
      .maybeSingle();

    let hashMatches = !!existing;

    if (!existing && clienteId) {
      const { data: comboMatch } = await supabase
        .from('relatorios')
        .select('*, clientes(empresa)')
        .eq('cliente_id', clienteId)
        .eq('competencia', competencia)
        .eq('tipo_relatorio', tipoRelatorio)
        .maybeSingle();

      existing = comboMatch;
      hashMatches = false;
    }

    if (!existing) return null;

    let pdfExistsInStorage = false;
    if (existing.storage_path) {
      const dir = existing.storage_path.substring(0, existing.storage_path.lastIndexOf('/'));
      const fn = existing.storage_path.substring(existing.storage_path.lastIndexOf('/') + 1);
      const { data: files } = await supabase.storage.from('relatorios').list(dir, { search: fn });
      pdfExistsInStorage = !!files?.some(f => f.name === fn);
    }

    const { data: queueItems } = await supabase
      .from('fila_envios')
      .select('status')
      .eq('relatorio_id', existing.id);

    const hasActiveQueue = !!queueItems?.some(q => q.status === 'pendente' || q.status === 'enviando');
    const alreadySent = !!queueItems?.some(q => q.status === 'enviado' || q.status === 'entregue' || q.status === 'lido');

    return {
      existingReportId: existing.id,
      existingFileName: existing.nome_arquivo || existing.nome_original,
      existingCreatedAt: existing.created_at,
      existingCompetencia: existing.competencia,
      existingClientName: existing.clientes?.empresa || 'Cliente Desconhecido',
      hashMatches,
      hasActiveQueue,
      activeQueueStatus: hasActiveQueue ? 'pendente' : undefined,
      alreadySentWhatsApp: alreadySent,
      pdfExistsInStorage,
      existingHash: existing.hash_arquivo,
      currentVersion: existing.versao || 1
    };
  },

  async findDuplicateDetails(hashValue: string, clienteId: string | null, competencia: string, tipoRelatorio: string): Promise<DuplicateReportDetails | null> {
    return this.verifyDuplicateDetails(hashValue, clienteId, competencia, tipoRelatorio);
  },

  async resolverDuplicado(
    acao: 'substituir' | 'nova_versao' | 'reutilizar',
    relatorioExistenteId: string,
    novoArquivoData: {
      file?: File;
      cliente_id?: string;
      codigo_cliente?: string;
      competencia?: string;
      tipo_relatorio?: string;
      nome_arquivo?: string;
      tamanho_bytes?: number;
      mime_type?: string;
    },
    userId?: string
  ): Promise<DBReport> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || '';

      const response = await fetch(`${supabaseUrl}/functions/v1/resolver-relatorio-duplicado`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          acao,
          relatorioExistenteId,
          novoArquivoData
        })
      });

      if (response.ok) {
        const resJson = await response.json();
        return resJson.relatorio;
      }
    } catch (e) {
      console.warn('Edge Function indisponível, executando diretamente no Supabase...');
    }

    const { data: existing, error: extErr } = await supabase
      .from('relatorios')
      .select('*')
      .eq('id', relatorioExistenteId)
      .single();

    if (extErr || !existing) {
      throw new Error('Relatório existente não encontrado.');
    }

    if (acao === 'reutilizar') {
      await auditoriaService.log(
        userId || null,
        'reutilizar_relatorio_existente',
        'relatorios',
        existing.id,
        null,
        { relatorio_id: existing.id }
      );
      return existing;
    } else if (acao === 'substituir') {
      const { data: updated, error: upErr } = await supabase
        .from('relatorios')
        .update({
          nome_arquivo: novoArquivoData.nome_arquivo || existing.nome_arquivo,
          tamanho_bytes: novoArquivoData.tamanho_bytes || existing.tamanho_bytes,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (upErr) handleServiceError(upErr, 'relatoriosService.resolverDuplicado.substituir');
      return updated;
    } else if (acao === 'nova_versao') {
      const newVersionNum = (existing.versao || 1) + 1;

      await supabase
        .from('relatorios')
        .update({ versao_atual: false })
        .eq('id', existing.id);

      const { data: newVer, error: verErr } = await supabase
        .from('relatorios')
        .insert({
          cliente_id: existing.cliente_id,
          codigo_extraido: existing.codigo_extraido,
          competencia: existing.competencia,
          tipo_relatorio: existing.tipo_relatorio,
          nome_arquivo: novoArquivoData.nome_arquivo || existing.nome_arquivo,
          nome_original: existing.nome_original,
          storage_path: existing.storage_path,
          tamanho_bytes: novoArquivoData.tamanho_bytes || existing.tamanho_bytes,
          mime_type: existing.mime_type,
          hash_arquivo: existing.hash_arquivo,
          status_validacao: 'pronto',
          versao: newVersionNum,
          versao_atual: true,
          relatorio_anterior_id: existing.id,
          created_by: userId || null
        })
        .select()
        .single();

      if (verErr) handleServiceError(verErr, 'relatoriosService.resolverDuplicado.nova_versao');
      return newVer;
    }

    throw new Error(`Ação '${acao}' inválida.`);
  },

  async getVersionsHistory(reportId: string): Promise<DBReport[]> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    const { data: current, error: fetchErr } = await supabase
      .from('relatorios')
      .select('cliente_id, competencia, tipo_relatorio')
      .eq('id', reportId)
      .single();

    if (fetchErr || !current) return [];

    const { data, error } = await supabase
      .from('relatorios')
      .select('*')
      .eq('cliente_id', current.cliente_id)
      .eq('competencia', current.competencia)
      .eq('tipo_relatorio', current.tipo_relatorio)
      .order('versao', { ascending: false });

    if (error) handleServiceError(error, 'relatoriosService.getVersionsHistory');
    return (data || []).map(item => ({
      ...item,
      codigo_cliente: item.codigo_extraido || item.codigo_cliente || null
    }));
  },

  async reenviarRelatorio(reportId: string, userId?: string, loteId?: string): Promise<void> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    const { data: report, error: repErr } = await supabase
      .from('relatorios')
      .select('*, clientes(empresa, telefone_whatsapp)')
      .eq('id', reportId)
      .single();

    if (repErr || !report) throw new Error('Relatório não encontrado.');

    const phone = (report.clientes?.telefone_whatsapp || '').replace(/\D/g, '');
    if (!phone) throw new Error('Cliente do relatório não possui telefone WhatsApp cadastrado.');

    const { error: insertErr } = await supabase
      .from('fila_envios')
      .insert({
        lote_id: loteId || null,
        cliente_id: report.cliente_id,
        relatorio_id: report.id,
        telefone_destino: phone,
        status: 'pendente',
        tentativas: 0,
        whatsapp_message_id: null
      });

    if (insertErr) handleServiceError(insertErr, 'relatoriosService.reenviarRelatorio');

    await auditoriaService.log(
      userId || null,
      'reenviar_relatorio',
      'relatorios',
      report.id,
      null,
      { relatorio_id: report.id }
    );
  }
};

/* ==========================================
   4. LOTES SERVICE
   ========================================== */
export const lotesService = {
  async list(): Promise<Batch[]> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    try {
      const { data, error } = await supabase
        .from('lotes_envio')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) handleServiceError(error, 'lotesService.list');

      return (data || []).map(b => {
        let status: 'Pendente' | 'Processando' | 'Concluido' | 'Cancelado' | 'Falha' = 'Pendente';
        if (b.status === 'processando') status = 'Processando';
        else if (b.status === 'concluido') status = 'Concluido';
        else if (b.status === 'cancelado') status = 'Cancelado';
        else if (b.status === 'concluido_com_falhas') status = 'Falha';

        return {
          id: b.id,
          nome: b.nome,
          competencia: dateStrToCompetencia(b.competencia),
          status,
          quantidade: b.total_itens,
          criado_por: 'Administrador',
          created_at: b.created_at
        };
      });
    } catch (err) {
      handleServiceError(err, 'lotesService.list');
    }
  },

  async create(batch: Omit<Batch, 'id' | 'created_at'>, modalidade: 'imediato' | 'agendado' | 'agenda_individual', scheduledDate?: string, userId?: string): Promise<string> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    let dbStatus = 'aguardando';
    if (modalidade === 'agendado' || modalidade === 'agenda_individual') dbStatus = 'agendado';

    const { data, error } = await supabase
      .from('lotes_envio')
      .insert({
        nome: batch.nome,
        competencia: competenciaToDateStr(batch.competencia),
        modalidade,
        data_programada: scheduledDate || null,
        status: dbStatus,
        total_itens: batch.quantidade,
        total_validos: batch.quantidade,
        total_enviados: 0,
        total_falhas: 0,
        created_by: userId || null
      })
      .select('id')
      .single();

    if (error) handleServiceError(error, 'lotesService.create');
    return data.id;
  },

  async criarLoteComFila(
    nome: string,
    competencia: string,
    modalidade: 'imediato' | 'agendado' | 'agenda_individual',
    dataProgramada: string | null,
    relatorioIds: string[],
    usuarioId: string
  ): Promise<{ lote_id: string; total_itens: number; total_validos: number }> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    try {
      const { data, error } = await supabase.rpc('criar_lote_com_fila', {
        p_nome: nome,
        p_competencia: competenciaToDateStr(competencia),
        p_modalidade: modalidade,
        p_data_programada: dataProgramada ? new Date(dataProgramada).toISOString() : null,
        p_relatorio_ids: relatorioIds,
        p_usuario_id: usuarioId
      });

      if (!error && data) {
        return {
          lote_id: data.lote_id,
          total_itens: data.total_itens,
          total_validos: data.total_validos
        };
      }
    } catch (rpcErr) {
      console.warn('RPC criar_lote_com_fila indisponível. Executando via transação do cliente...');
    }

    const { data: rels, error: relsErr } = await supabase
      .from('relatorios')
      .select('id, cliente_id, status_validacao')
      .in('id', relatorioIds);

    if (relsErr) handleServiceError(relsErr, 'lotesService.criarLoteComFila.fetchReports');

    const clientIds = (rels || []).map(r => r.cliente_id).filter(id => !!id) as string[];

    const { data: clis, error: clisErr } = await supabase
      .from('clientes')
      .select('id, telefone_whatsapp, ativo, dia_envio, horario_envio')
      .in('id', clientIds);

    if (clisErr) handleServiceError(clisErr, 'lotesService.criarLoteComFila.fetchClients');

    const validQueueItems: any[] = [];
    const totalItens = relatorioIds.length;

    for (const relId of relatorioIds) {
      const rel = rels.find(r => r.id === relId);
      if (!rel || !rel.cliente_id || rel.status_validacao !== 'pronto') continue;

      const cli = clis.find(c => c.id === rel.cliente_id);
      if (!cli || !cli.ativo) continue;

      const cleanPhone = (cli.telefone_whatsapp || '').replace(/\D/g, '');
      if (!cleanPhone) continue;

      let itemSchedDate: string | null = null;
      let itemStatus = 'pendente';

      if (modalidade === 'imediato') {
        itemSchedDate = new Date().toISOString();
        itemStatus = 'pendente';
      } else if (modalidade === 'agendado') {
        itemSchedDate = dataProgramada ? new Date(dataProgramada).toISOString() : null;
        itemStatus = 'agendado';
      } else if (modalidade === 'agenda_individual') {
        itemStatus = 'agendado';
        const day = cli.dia_envio !== undefined && cli.dia_envio !== null ? cli.dia_envio : 5;
        const time = cli.horario_envio || '09:00:00';
        let tempDate = new Date();
        while (tempDate.getDay() !== day) {
          tempDate.setDate(tempDate.getDate() + 1);
        }
        const dateStr = tempDate.toISOString().split('T')[0];
        itemSchedDate = new Date(`${dateStr}T${time}`).toISOString();
      }

      validQueueItems.push({
        cliente_id: rel.cliente_id,
        relatorio_id: rel.id,
        telefone_destino: cleanPhone,
        data_programada: itemSchedDate,
        status: itemStatus,
        tentativas: 0
      });
    }

    if (validQueueItems.length === 0) {
      throw new Error('Não foi possível agendar nenhum envio válido para este lote. Verifique se os relatórios estão com status "pronto", se os clientes estão ativos e se possuem telefone válido cadastrado.');
    }

    const { data: lote, error: loteError } = await supabase
      .from('lotes_envio')
      .insert({
        nome,
        competencia: competenciaToDateStr(competencia),
        modalidade,
        data_programada: dataProgramada ? new Date(dataProgramada).toISOString() : null,
        status: modalidade === 'imediato' ? 'aguardando' : 'agendado',
        total_itens: totalItens,
        total_validos: validQueueItems.length,
        created_by: usuarioId
      })
      .select()
      .single();

    if (loteError || !lote) {
      handleServiceError(loteError || new Error('Falha ao registrar lote'), 'lotesService.criarLoteComFila.insertBatch');
    }

    const itemsWithLoteId = validQueueItems.map(item => {
      if (!item.relatorio_id) {
        throw new Error(`Item de fila sem relatorio_id persistido não é permitido.`);
      }

      console.log('Item de fila preparado', {
        loteId: lote.id,
        relatorioId: item.relatorio_id,
        clienteId: item.cliente_id
      });

      return {
        ...item,
        lote_id: lote.id
      };
    });

    const { error: filaError } = await supabase
      .from('fila_envios')
      .insert(itemsWithLoteId);

    if (filaError) {
      await supabase.from('lotes_envio').delete().eq('id', lote.id);
      handleServiceError(filaError, 'lotesService.criarLoteComFila.insertQueue');
    }

    return {
      lote_id: lote.id,
      total_itens: totalItens,
      total_validos: validQueueItems.length
    };
  },

  async updateStatus(loteId: string, status: 'cancelado' | 'concluido' | 'processando'): Promise<void> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    const { error } = await supabase
      .from('lotes_envio')
      .update({ status })
      .eq('id', loteId);

    if (error) handleServiceError(error, 'lotesService.updateStatus');

    if (status === 'cancelado') {
      await filaService.cancelItemsForBatch(loteId);
    }
  },

  async getBatchDependencies(loteId: string): Promise<{
    totalItems: number;
    deliveredCount: number;
    failedCount: number;
    pendingCount: number;
  }> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    const { data: items } = await supabase
      .from('fila_envios')
      .select('status')
      .eq('lote_id', loteId);

    const queue = items || [];
    const totalItems = queue.length;
    const deliveredCount = queue.filter(i => i.status === 'entregue' || i.status === 'lido' || i.status === 'enviado').length;
    const failedCount = queue.filter(i => i.status === 'falhou' || i.status === 'erro').length;
    const pendingCount = queue.filter(i => i.status === 'pendente' || i.status === 'agendado' || i.status === 'processando').length;

    return {
      totalItems,
      deliveredCount,
      failedCount,
      pendingCount
    };
  },

  async excluirLoteCompleto(loteId: string, usuarioId?: string): Promise<void> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    try {
      const { error: rpcError } = await supabase.rpc('excluir_lote_completo', { p_lote_id: loteId });
      if (!rpcError) {
        if (usuarioId) {
          await auditoriaService.log(usuarioId, 'excluir_lote_completo', 'lotes_envio', loteId, null, { lote_id: loteId });
        }
        return;
      }
    } catch (e) {
      console.warn('RPC excluir_lote_completo não disponível. Executando cascata no cliente...');
    }

    // 1. Delete queue items for this batch
    await supabase.from('fila_envios').delete().eq('lote_id', loteId);

    // 2. Delete batch row
    const { error: delErr } = await supabase.from('lotes_envio').delete().eq('id', loteId);
    if (delErr) {
      handleServiceError(delErr, 'lotesService.excluirLoteCompleto');
    }

    if (usuarioId) {
      await auditoriaService.log(usuarioId, 'excluir_lote_completo', 'lotes_envio', loteId, null, { lote_id: loteId });
    }
  },

  async reconstruirFila(loteId: string): Promise<number> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    const { data: batch, error: bErr } = await supabase
      .from('lotes_envio')
      .select('*')
      .eq('id', loteId)
      .single();

    if (bErr || !batch) throw new Error('Lote não encontrado.');

    // Buscar relatórios originalmente vinculados a este lote
    const { data: existingQueue } = await supabase
      .from('fila_envios')
      .select('relatorio_id')
      .eq('lote_id', loteId)
      .not('relatorio_id', 'is', null);

    if (!existingQueue || existingQueue.length === 0) {
      throw new Error('Não há relatórios com ID persistido vinculados a este lote.');
    }

    const relatorioIds = Array.from(new Set(existingQueue.map(q => q.relatorio_id)));

    const { data: reports } = await supabase
      .from('relatorios')
      .select('id, cliente_id, status_validacao')
      .in('id', relatorioIds)
      .eq('status_validacao', 'pronto');

    if (!reports || reports.length === 0) return 0;

    const clientIds = reports.map(r => r.cliente_id).filter(id => !!id) as string[];
    const { data: clients } = await supabase
      .from('clientes')
      .select('id, telefone_whatsapp, ativo')
      .in('id', clientIds)
      .eq('ativo', true);

    if (!clients || clients.length === 0) return 0;

    const newQueueItems = [];
    for (const r of reports) {
      if (!r.cliente_id || !r.id) continue;
      const c = clients.find(cli => cli.id === r.cliente_id);
      if (!c) continue;
      const cleanPhone = (c.telefone_whatsapp || '').replace(/\D/g, '');
      if (!cleanPhone) continue;

      newQueueItems.push({
        lote_id: batch.id,
        cliente_id: r.cliente_id,
        relatorio_id: r.id,
        telefone_destino: cleanPhone,
        status: 'pendente',
        tentativas: 0
      });
    }

    if (newQueueItems.length > 0) {
      const { error } = await supabase.from('fila_envios').insert(newQueueItems);
      if (error) handleServiceError(error, 'lotesService.reconstruirFila');
    }

    return newQueueItems.length;
  }
};

/* ==========================================
   5. FILA SERVICE
   ========================================== */
export const filaService = {
  async list(): Promise<QueueItem[]> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    try {
      const { data, error } = await supabase
        .from('fila_envios')
        .select('*, clientes(empresa, telefone_whatsapp), relatorios(nome_arquivo, competencia)')
        .order('created_at', { ascending: false });

      if (error) {
        console.warn(`[filaService.list] Primary join query failed (${error.message}), attempting fallback query without joins...`);
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('fila_envios')
          .select('*')
          .order('created_at', { ascending: false });

        if (fallbackError) {
          handleServiceError(fallbackError, 'filaService.list');
        }

        return (fallbackData || []).map(q => {
          let status: QueueItemStatus = 'Fila';
          if (q.status === 'enviando') status = 'Enviando';
          else if (q.status === 'enviado') status = 'Enviado';
          else if (q.status === 'entregue') status = 'Entregue';
          else if (q.status === 'lido') status = 'Lido';
          else if (q.status === 'falhou' || q.status === 'erro') status = 'Falhou';
          else if (q.status === 'cancelado') status = 'Cancelado';

          return {
            id: q.id,
            lote_id: q.lote_id || '',
            cliente_id: q.cliente_id,
            cliente_nome: 'Cliente',
            telefone: q.telefone_destino || '',
            arquivo_nome: 'Relatório',
            competencia: '07/2026',
            status,
            tentativas: q.tentativas || 0,
            data_envio: q.data_envio || q.created_at,
            message_id: q.whatsapp_message_id,
            updated_at: q.updated_at || q.created_at
          };
        });
      }

      return (data || []).map(q => {
        let status: QueueItemStatus = 'Fila';
        if (q.status === 'enviando') status = 'Enviando';
        else if (q.status === 'enviado') status = 'Enviado';
        else if (q.status === 'entregue') status = 'Entregue';
        else if (q.status === 'lido') status = 'Lido';
        else if (q.status === 'falhou' || q.status === 'erro') status = 'Falhou';
        else if (q.status === 'cancelado') status = 'Cancelado';

        return {
          id: q.id,
          lote_id: q.lote_id || '',
          cliente_id: q.cliente_id,
          cliente_nome: q.clientes?.empresa || 'Cliente',
          telefone: q.telefone_destino || q.clientes?.telefone_whatsapp || '',
          arquivo_nome: q.relatorios?.nome_arquivo || 'Relatório',
          competencia: q.relatorios?.competencia ? dateStrToCompetencia(q.relatorios.competencia) : '07/2026',
          status,
          tentativas: q.tentativas || 0,
          data_envio: q.data_envio || q.created_at,
          message_id: q.whatsapp_message_id,
          updated_at: q.updated_at || q.created_at
        };
      });
    } catch (err) {
      handleServiceError(err, 'filaService.list');
    }
  },

  async cancelItemsForBatch(loteId: string): Promise<void> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    const { error } = await supabase
      .from('fila_envios')
      .update({ status: 'cancelado', updated_at: new Date().toISOString() })
      .eq('lote_id', loteId)
      .in('status', ['pendente', 'agendado', 'enviando']);

    if (error) handleServiceError(error, 'filaService.cancelItemsForBatch');
  },

  async retrySingleItem(itemId: string): Promise<void> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    const { error } = await supabase
      .from('fila_envios')
      .update({
        status: 'pendente',
        tentativas: 0,
        updated_at: new Date().toISOString()
      })
      .eq('id', itemId);

    if (error) handleServiceError(error, 'filaService.retrySingleItem');
  }
};

/* ==========================================
   6. AUDITORIA SERVICE
   ========================================== */
export const auditoriaService = {
  async list(): Promise<AuditLog[]> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    try {
      const { data, error } = await supabase
        .from('logs_auditoria')
        .select('*, perfis(nome)')
        .order('created_at', { ascending: false });

      if (error) {
        console.warn(`[auditoriaService.list] Primary join query failed (${error.message}), attempting fallback query without join...`);
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('logs_auditoria')
          .select('*')
          .order('created_at', { ascending: false });

        if (fallbackError) {
          handleServiceError(fallbackError, 'auditoriaService.list');
        }

        return (fallbackData || []).map(l => ({
          id: l.id,
          usuario_nome: 'Administrador',
          acao: l.acao,
          detalhes: `${l.entidade || ''} ${l.acao}: ID ${l.entidade_id || ''}`,
          created_at: l.created_at
        }));
      }

      return (data || []).map(l => ({
        id: l.id,
        usuario_nome: l.perfis?.nome || 'Administrador',
        acao: l.acao,
        detalhes: `${l.entidade || ''} ${l.acao}: ID ${l.entidade_id || ''}`,
        created_at: l.created_at
      }));
    } catch (err) {
      handleServiceError(err, 'auditoriaService.list');
    }
  },

  async log(userId: string | null, acao: string, entidade?: string, entidadeId?: string, dadosAnteriores?: any, dadosNovos?: any): Promise<void> {
    if (!supabase) return;
    try {
      await supabase
        .from('logs_auditoria')
        .insert({
          usuario_id: userId,
          acao,
          entidade,
          entidade_id: entidadeId,
          dados_anteriores: dadosAnteriores || null,
          dados_novos: dadosNovos || null,
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null
        });
    } catch (err) {
      console.error('Falha ao gravar log de auditoria no Supabase:', err);
    }
  }
};

/* ==========================================
   WORKER SERVICE (STATUS & MANUAL TRIGGER)
   ========================================== */
export const workerService = {
  async getStatus(): Promise<WorkerStatusInfo> {
    if (!supabase) {
      return {
        ativo: false,
        ultimaExecucao: null,
        proximaExecucao: null,
        itensPendentes: 0,
        itensProcessadosHoje: 0
      };
    }

    try {
      // 1. Fetch latest worker execution log
      const { data: workerLogs } = await supabase
        .from('logs_auditoria')
        .select('*')
        .eq('acao', 'Worker Executado')
        .order('created_at', { ascending: false })
        .limit(1);

      const lastLog = workerLogs && workerLogs.length > 0 ? workerLogs[0] : null;
      const ultimaExecucao = lastLog ? lastLog.created_at : null;

      let ativo = true;
      let proximaExecucao: string | null = null;

      if (ultimaExecucao) {
        const lastTime = new Date(ultimaExecucao).getTime();
        const diffMinutes = (Date.now() - lastTime) / (1000 * 60);
        // Active if ran within the last 5 minutes
        ativo = diffMinutes <= 5;

        const nextTime = new Date(lastTime + 60 * 1000);
        proximaExecucao = nextTime > new Date() ? nextTime.toISOString() : new Date(Date.now() + 30 * 1000).toISOString();
      } else {
        proximaExecucao = new Date(Date.now() + 60 * 1000).toISOString();
        ativo = true;
      }

      // 2. Count pending items (pendente, agendado, processando)
      const { count: pendingCount } = await supabase
        .from('fila_envios')
        .select('*', { count: 'exact', head: true })
        .in('status', ['pendente', 'agendado', 'processando'])
        .is('whatsapp_message_id', null);

      // 3. Count items processed today (enviado, entregue, lido, falhou)
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const { count: processedTodayCount } = await supabase
        .from('fila_envios')
        .select('*', { count: 'exact', head: true })
        .in('status', ['enviado', 'entregue', 'lido', 'falhou'])
        .gte('updated_at', todayStart.toISOString());

      const dadosNovos = lastLog?.dados_novos || {};

      return {
        ativo,
        ultimaExecucao,
        proximaExecucao,
        itensPendentes: pendingCount || 0,
        itensProcessadosHoje: processedTodayCount || 0,
        ultimoLog: lastLog ? {
          itensEncontrados: dadosNovos.itensEncontrados ?? 0,
          itensProcessados: dadosNovos.itensProcessados ?? 0,
          sucessos: dadosNovos.sucessos ?? 0,
          falhas: dadosNovos.falhas ?? 0,
          tempoExecucaoMs: dadosNovos.tempoExecucaoMs ?? 0
        } : undefined
      };
    } catch (err) {
      console.error('Erro ao obter status do worker:', err);
      return {
        ativo: false,
        ultimaExecucao: null,
        proximaExecucao: null,
        itensPendentes: 0,
        itensProcessadosHoje: 0
      };
    }
  },

  async triggerManualRun(usuarioId?: string): Promise<any> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    const startTime = Date.now();

    // 1. Try invoking Edge Function worker-fila-envios
    try {
      const { data, error } = await supabase.functions.invoke('worker-fila-envios', {
        body: { forced: true }
      });
      if (!error && data && typeof data === 'object') {
        return data;
      }
      if (error) {
        console.debug('[triggerManualRun] Edge Function indisponível ou em fallback:', error.message);
      }
    } catch (err: any) {
      console.debug('[triggerManualRun] Invocar Edge Function falhou, verificando fila via banco:', err?.message || String(err));
    }

    // 2. Direct fallback queue processor directly in Supabase DB
    const { data: rawCandidates, error: qErr } = await supabase
      .from('fila_envios')
      .select('*')
      .in('status', ['pendente', 'agendado', 'processando'])
      .is('whatsapp_message_id', null)
      .lt('tentativas', 3)
      .order('created_at', { ascending: true })
      .limit(50);

    if (qErr) {
      throw new Error(`Erro ao consultar itens da fila: ${qErr.message}`);
    }

    const candidates = rawCandidates || [];
    if (candidates.length === 0) {
      return {
        success: true,
        worker: 'worker-fila-envios-direct',
        inicio: new Date(startTime).toISOString(),
        tempoExecucaoMs: Date.now() - startTime,
        itensEncontrados: 0,
        itensProcessados: 0,
        sucessos: 0,
        falhas: 0,
        mensagem: 'Nenhum item pendente ou agendado encontrado na fila.'
      };
    }

    let sucessos = 0;
    let falhas = 0;
    const affectedLoteIds = new Set<string>();

    for (const item of candidates) {
      if (item.lote_id) affectedLoteIds.add(item.lote_id);

      // Lock item to processando
      await supabase
        .from('fila_envios')
        .update({ status: 'processando', updated_at: new Date().toISOString() })
        .eq('id', item.id);

      try {
        let relatorio = null;
        if (item.relatorio_id) {
          const { data: r } = await supabase
            .from('relatorios')
            .select('*')
            .eq('id', item.relatorio_id)
            .single();
          relatorio = r;
        }

        let cliente = null;
        if (item.cliente_id) {
          const { data: c } = await supabase
            .from('clientes')
            .select('*')
            .eq('id', item.cliente_id)
            .single();
          cliente = c;
        }

        // Validate report
        if (!relatorio || relatorio.status_validacao !== 'pronto' || !relatorio.storage_path) {
          const reason = !relatorio
            ? 'Relatório não encontrado'
            : relatorio.status_validacao !== 'pronto'
            ? `Relatório não está pronto (${relatorio.status_validacao})`
            : 'Caminho no Storage ausente';

          await supabase
            .from('fila_envios')
            .update({
              status: 'falhou',
              erro_codigo: 'RELATORIO_INVALIDO',
              erro_mensagem: reason,
              tentativas: (item.tentativas || 0) + 1,
              updated_at: new Date().toISOString()
            })
            .eq('id', item.id);

          if (item.relatorio_id) {
            await supabase.from('relatorios').update({
              status_envio: 'falhou',
              ultimo_envio_status: 'falha',
              tem_envio_ativo: false
            }).eq('id', item.relatorio_id);
          }

          falhas++;
          continue;
        }

        // Validate client
        if (!cliente || cliente.ativo === false || cliente.possui_optin === false || (!cliente.telefone_whatsapp && !item.telefone_destino)) {
          const reason = !cliente
            ? 'Cliente não encontrado'
            : !cliente.ativo
            ? 'Cliente inativo'
            : !cliente.possui_optin
            ? 'Cliente sem termo de consentimento (opt-in)'
            : 'Telefone WhatsApp não informado';

          await supabase
            .from('fila_envios')
            .update({
              status: 'falhou',
              erro_codigo: 'CLIENTE_INVALIDO',
              erro_mensagem: reason,
              tentativas: (item.tentativas || 0) + 1,
              updated_at: new Date().toISOString()
            })
            .eq('id', item.id);

          await supabase.from('relatorios').update({
            status_envio: 'falhou',
            ultimo_envio_status: 'falha',
            tem_envio_ativo: false
          }).eq('id', item.relatorio_id);

          falhas++;
          continue;
        }

        const reason = "A Edge Function 'worker-fila-envios' precisa estar ativa e configurada no Supabase para realizar disparos reais via API Oficial da Meta (WhatsApp Cloud API).";
        await supabase
          .from('fila_envios')
          .update({
            status: 'falhou',
            erro_codigo: 'EDGE_FUNCTION_INDISPONIVEL',
            erro_mensagem: reason,
            tentativas: (item.tentativas || 0) + 1,
            updated_at: new Date().toISOString()
          })
          .eq('id', item.id);

        if (item.relatorio_id) {
          await supabase.from('relatorios').update({
            status_envio: 'falhou',
            ultimo_envio_status: 'falha',
            tem_envio_ativo: false
          }).eq('id', item.relatorio_id);
        }

        falhas++;
      } catch (errItem: any) {
        console.error(`Erro ao processar item ${item.id}:`, errItem);
        await supabase
          .from('fila_envios')
          .update({
            status: 'falhou',
            erro_codigo: 'ERRO_PROCESSAMENTO',
            erro_mensagem: errItem?.message || String(errItem),
            tentativas: (item.tentativas || 0) + 1,
            updated_at: new Date().toISOString()
          })
          .eq('id', item.id);
        falhas++;
      }
    }

    // Recalculate batch statuses
    for (const loteId of affectedLoteIds) {
      const { data: queueForBatch } = await supabase
        .from('fila_envios')
        .select('status')
        .eq('lote_id', loteId);

      const q = queueForBatch || [];
      const totalItens = q.length;
      const totalEnviados = q.filter(i => ['enviado', 'entregue', 'lido'].includes(i.status)).length;
      const totalFalhas = q.filter(i => i.status === 'falhou').length;
      const totalPendentes = q.filter(i => ['pendente', 'agendado', 'processando'].includes(i.status)).length;

      let novoStatus = 'aguardando';
      if (totalPendentes > 0) {
        novoStatus = 'processando';
      } else if (totalItens > 0) {
        novoStatus = totalFalhas > 0 ? 'concluido_com_falhas' : 'concluido';
      }

      await supabase
        .from('lotes_envio')
        .update({
          total_itens: totalItens,
          total_enviados: totalEnviados,
          total_falhas: totalFalhas,
          status: novoStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', loteId);
    }

    // Log audit execution
    await supabase.from('logs_auditoria').insert({
      usuario_id: usuarioId || null,
      acao: 'Worker Executado Manualmente',
      entidade: 'worker-fila-envios',
      entidade_id: 'manual-trigger',
      dados_novos: {
        inicio: new Date(startTime).toISOString(),
        itensEncontrados: candidates.length,
        itensProcessados: candidates.length,
        sucessos,
        falhas,
        tempoExecucaoMs: Date.now() - startTime
      },
      user_agent: 'Interface Web Client Worker'
    });

    return {
      success: true,
      worker: 'worker-fila-envios-manual',
      inicio: new Date(startTime).toISOString(),
      tempoExecucaoMs: Date.now() - startTime,
      itensEncontrados: candidates.length,
      itensProcessados: candidates.length,
      sucessos,
      falhas
    };
  }
};

/* ==========================================
   10. INTEGRATION SERVICE
   ========================================== */
export const integracaoService = {
  async listLogs(limit = 100): Promise<IntegrationLog[]> {
    if (!supabase) throw new Error('Conexão com o Supabase indisponível.');
    const { data, error } = await supabase
      .from('logs_integracao_relatorios')
      .select('*')
      .order('recebido_em', { ascending: false })
      .limit(limit);

    if (error) {
      console.warn('[integracaoService.listLogs] Erro ao listar logs:', error);
      return [];
    }
    return data || [];
  },

  async getMetrics(): Promise<IntegrationMetrics> {
    if (!supabase) throw new Error('Conexão com o Supabase indisponível.');

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();

    const { data: logsToday } = await supabase
      .from('logs_integracao_relatorios')
      .select('status, erro_codigo, http_status, recebido_em')
      .gte('recebido_em', todayIso);

    const logs = (logsToday || []) as Array<{ status: string; erro_codigo: string | null; http_status: number; recebido_em: string }>;
    const recebidosHoje = logs.length;
    const duplicadosIgnorados = logs.filter(l => l.status === 'duplicado').length;
    const clientesNaoEncontrados = logs.filter(l => l.erro_codigo === 'CLIENTE_NAO_ENCONTRADO').length;
    const errosProcessamento = logs.filter(l => ((l.http_status && l.http_status >= 400) || (l.status && l.status.startsWith('erro_'))) && l.erro_codigo !== 'CLIENTE_NAO_ENCONTRADO').length;

    const { data: latestLog } = await supabase
      .from('logs_integracao_relatorios')
      .select('recebido_em')
      .eq('status', 'sucesso')
      .order('recebido_em', { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      recebidosHoje,
      duplicadosIgnorados,
      errosProcessamento,
      clientesNaoEncontrados,
      ultimoRelatorioRecebidoEm: latestLog?.recebido_em || null
    };
  },

  async getConfig(): Promise<IntegrationConfig> {
    if (!supabase) throw new Error('Conexão com o Supabase indisponível.');

    const { data: config } = await supabase
      .from('configuracoes_integracao')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const supabaseProjectUrl = ((import.meta as any).env?.VITE_SUPABASE_URL || 'https://[SUPABASE_PROJECT].supabase.co').trim();
    const endpointUrl = `${supabaseProjectUrl.replace(/\/$/, '')}/functions/v1/receber-relatorio-externo`;

    if (!config) {
      return {
        id: '',
        endpointUrl,
        segredoMasked: 'krel_sec_****************',
        segredoAtualCriadoEm: new Date().toISOString(),
        hasPreviousSecret: false,
        updatedAt: new Date().toISOString()
      };
    }

    const sec = config.segredo_atual || '';
    const masked = sec.length > 12 ? `${sec.substring(0, 8)}...${sec.substring(sec.length - 4)}` : 'krel_sec_****';

    return {
      id: config.id,
      endpointUrl,
      segredoMasked: masked,
      segredoAtualCriadoEm: config.segredo_atual_criado_em || config.updated_at,
      hasPreviousSecret: Boolean(config.segredo_anterior),
      updatedAt: config.updated_at
    };
  },

  async generateNewSecret(usuarioId?: string): Promise<{ newSecret: string }> {
    if (!supabase) throw new Error('Conexão com o Supabase indisponível.');

    const { data: currentConfig } = await supabase
      .from('configuracoes_integracao')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Generate secure random secret string
    const randomArray = new Uint8Array(24);
    crypto.getRandomValues(randomArray);
    const hex = Array.from(randomArray).map(b => b.toString(16).padStart(2, '0')).join('');
    const newSecret = `krel_sec_${hex}`;

    const segredoAnterior = currentConfig?.segredo_atual || null;

    if (currentConfig?.id) {
      await supabase
        .from('configuracoes_integracao')
        .update({
          segredo_atual: newSecret,
          segredo_anterior: segredoAnterior,
          segredo_atual_criado_em: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          updated_by: usuarioId || null
        })
        .eq('id', currentConfig.id);
    } else {
      await supabase
        .from('configuracoes_integracao')
        .insert({
          segredo_atual: newSecret,
          segredo_anterior: null,
          segredo_atual_criado_em: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          updated_by: usuarioId || null
        });
    }

    await auditoriaService.log(
      usuarioId || null,
      'geracao_segredo_integracao',
      'configuracoes_integracao',
      currentConfig?.id || null,
      { acao: 'Gerou novo segredo de integração' }
    );

    return { newSecret };
  }
};


