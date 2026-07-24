import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Client, PDFReport, Batch, QueueItem, QueueItemStatus, AuditLog, AuthUser, WhatsAppConfig, UserRole, DuplicateReportDetails } from '../types';

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
  if (error?.message === 'Failed to fetch' || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    throw new Error('Sem conexão com o servidor. Verifique sua conexão de internet e tente novamente.');
  }
  throw new Error(error?.message || `Erro de conexão em ${context}`);
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

    const { data, error } = await supabase
      .from('clientes')
      .select('*')
      .order('empresa', { ascending: true });

    if (error) {
      handleServiceError(error, 'clientesService.list');
    }
    return data || [];
  },

  async getById(id: string): Promise<Client | null> {
    if (!supabase) {
      throw new Error('Conexão com o Supabase indisponível.');
    }

    const { data, error } = await supabase
      .from('clientes')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      handleServiceError(error, 'clientesService.getById');
    }
    return data;
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
}

export const relatoriosService = {
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

    const { data, error } = await supabase.storage
      .from('relatorios')
      .createSignedUrl(storagePath, 3600);

    if (error || !data?.signedUrl) {
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

    const { data, error } = await supabase
      .from('fila_envios')
      .select('*, clientes(empresa, telefone_whatsapp), relatorios(nome_arquivo, competencia)')
      .order('created_at', { ascending: false });

    if (error) handleServiceError(error, 'filaService.list');

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

    const { data, error } = await supabase
      .from('logs_auditoria')
      .select('*, perfis(nome)')
      .order('created_at', { ascending: false });

    if (error) handleServiceError(error, 'auditoriaService.list');

    return (data || []).map(l => ({
      id: l.id,
      usuario_nome: l.perfis?.nome || 'Administrador',
      acao: l.acao,
      detalhes: `${l.entidade || ''} ${l.acao}: ID ${l.entidade_id || ''}`,
      created_at: l.created_at
    }));
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
