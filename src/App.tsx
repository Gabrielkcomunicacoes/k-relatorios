import React, { useState, useEffect } from 'react';
import { AuthUser, Client, Batch, QueueItem, QueueItemStatus, WhatsAppConfig, AuditLog } from './types';
import { supabase, isSupabaseConfigured, SUPABASE_SQL_SETUP } from './lib/supabase';
import {
  authService,
  clientesService,
  relatoriosService,
  lotesService,
  filaService,
  auditoriaService,
  competenciaToDateStr,
  workerService
} from './services/supabaseService';

// Component views
import LoginView from './components/LoginView';
import Sidebar, { SidebarTab } from './components/Sidebar';
import DashboardView from './components/DashboardView';
import ClientsView from './components/ClientsView';
import UploadAndReviewView from './components/UploadAndReviewView';
import ReportsView from './components/ReportsView';
import BatchesView from './components/BatchesView';
import HistoryView from './components/HistoryView';
import SettingsView from './components/SettingsView';
import IntegrationsView from './components/IntegrationsView';

import { Shield, Sparkles, Terminal } from 'lucide-react';

export default function App() {
  // Theme state - locked to dark theme
  const theme = 'dark';

  useEffect(() => {
    localStorage.setItem('k-relatorios-theme', 'dark');
    const root = document.documentElement;
    root.classList.add('dark');
  }, []);

  // Session states
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeTab, setActiveTab] = useState<SidebarTab>('dashboard');

  // Database tables in local states
  const [clients, setClients] = useState<Client[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [config, setConfig] = useState<WhatsAppConfig>({
    accessToken: '',
    phoneNumberId: '',
    businessAccountId: '',
    verifyToken: '',
    appSecret: '',
    templateName: '',
    language: 'pt_BR'
  });
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  const isSupabaseActive = isSupabaseConfigured;
  const [isLoadingSupabase, setIsLoadingSupabase] = useState(false);
  const [supabaseError, setSupabaseError] = useState<string | null>(null);

  // Load Supabase data
  const loadAllData = async () => {
    if (!isSupabaseConfigured || !supabase) return;
    setIsLoadingSupabase(true);
    setSupabaseError(null);
    let hasError = false;
    let lastErrorMessage = '';

    try {
      // Restore user session first if any
      try {
        const currentUser = await authService.getCurrentUser();
        if (currentUser) {
          setUser(currentUser);
        }
      } catch (e) {
        console.warn('Erro ao restaurar sessão:', e);
      }

      // 1. Clients
      try {
        const dbClients = await clientesService.list();
        setClients(dbClients || []);
      } catch (err: any) {
        console.warn('Erro ao carregar clientes:', err);
        hasError = true;
        lastErrorMessage = err?.message || 'Falha ao carregar lista de clientes';
      }

      // 2. Batches
      try {
        const dbBatches = await lotesService.list();
        setBatches(dbBatches || []);
      } catch (err: any) {
        console.warn('Erro ao carregar lotes:', err);
        hasError = true;
        lastErrorMessage = err?.message || 'Falha ao carregar lotes de envio';
      }

      // 3. Queue Items
      try {
        const dbQueueItems = await filaService.list();
        setQueueItems(dbQueueItems || []);
      } catch (err: any) {
        console.warn('Erro ao carregar fila:', err);
        hasError = true;
        lastErrorMessage = err?.message || 'Falha ao carregar fila de envios';
      }

      // 4. Config
      try {
        const { data: dbConfig } = await supabase
          .from('whatsapp_configs')
          .select('*')
          .eq('id', 'default')
          .maybeSingle();
        if (dbConfig) {
          setConfig({
            accessToken: dbConfig.access_token,
            phoneNumberId: dbConfig.phone_number_id,
            businessAccountId: dbConfig.business_account_id,
            verifyToken: dbConfig.verify_token,
            appSecret: dbConfig.app_secret,
            templateName: dbConfig.template_name,
            language: dbConfig.language,
          });
        }
      } catch (e) {
        console.warn('Erro ao carregar configurações do WhatsApp:', e);
      }

      // 5. Audit Logs
      try {
        const dbLogs = await auditoriaService.list();
        setAuditLogs(dbLogs || []);
      } catch (err: any) {
        console.warn('Erro ao carregar auditoria:', err);
      }

      if (hasError) {
        const cleanMsg = lastErrorMessage.includes('Failed to fetch')
          ? 'Falha na conexão com o Supabase. Verifique sua conexão de internet ou as credenciais do Supabase.'
          : lastErrorMessage;
        setSupabaseError(cleanMsg);
      }
    } catch (err: any) {
      console.error('Erro ao sincronizar dados com o Supabase:', err);
      const rawMsg = err?.message || String(err);
      const cleanMsg = rawMsg.includes('Failed to fetch')
        ? 'Falha na conexão com o Supabase. Verifique sua conexão de internet ou as credenciais do Supabase.'
        : rawMsg;
      setSupabaseError(cleanMsg);
    } finally {
      setIsLoadingSupabase(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  // Automated background worker loop - runs workerService automatically in the background
  useEffect(() => {
    if (!isSupabaseConfigured || !user) return;

    let isWorkerRunning = false;

    const runWorkerSilently = async () => {
      if (isWorkerRunning) return;
      isWorkerRunning = true;
      try {
        const res = await workerService.triggerManualRun(user.id);
        if (res && (res.sucessos > 0 || res.itensProcessados > 0)) {
          // Perform a safe silent refresh without triggering app-wide error state
          const [dbBatches, dbQueue, dbClients] = await Promise.allSettled([
            lotesService.list(),
            filaService.list(),
            clientesService.list()
          ]);
          if (dbBatches.status === 'fulfilled') setBatches(dbBatches.value || []);
          if (dbQueue.status === 'fulfilled') setQueueItems(dbQueue.value || []);
          if (dbClients.status === 'fulfilled') setClients(dbClients.value || []);
        }
      } catch (err) {
        // Suppress background errors cleanly
      } finally {
        isWorkerRunning = false;
      }
    };

    // Run worker immediately when user is authenticated
    runWorkerSilently();

    // Auto-run every 15 seconds in background
    const interval = setInterval(runWorkerSilently, 15000);
    return () => clearInterval(interval);
  }, [user, isSupabaseConfigured]);

  // Auto-sync batch statuses based on children queue item statuses for high-fidelity state tracking
  useEffect(() => {
    setBatches((prevBatches) =>
      prevBatches.map((batch) => {
        // Skip updating terminated batches (Completed, Cancelled)
        if (batch.status === 'Cancelado' || batch.status === 'Concluido' || batch.status === 'Falha') {
          return batch;
        }

        const items = queueItems.filter((i) => i.lote_id === batch.id);
        if (items.length === 0) return batch;

        const hasFalha = items.some((i) => i.status === 'Falhou');
        const hasPending = items.some((i) => i.status === 'Fila' || i.status === 'Enviando');
        const allCompleted = items.every((i) => i.status === 'Entregue' || i.status === 'Lido' || i.status === 'Enviado');

        let newStatus = batch.status;
        if (allCompleted) {
          newStatus = 'Concluido';
        } else if (hasFalha && !hasPending) {
          newStatus = 'Falha';
        } else if (hasPending) {
          newStatus = 'Processando';
        }

        if (newStatus !== batch.status) {
          // Add system audit log silently
          addAuditLog(
            'Sistema Automatizado',
            'Sincronização de Lote',
            `Status do lote "${batch.nome}" atualizado automaticamente para ${newStatus.toUpperCase()} devido à atualização de itens da fila.`
          );
          return { ...batch, status: newStatus };
        }

        return batch;
      })
    );
  }, [queueItems]);

  // Helper to append audit logs
  const addAuditLog = async (usuario: string, acao: string, detalhes: string) => {
    const newLog: AuditLog = {
      id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      usuario_nome: usuario,
      acao,
      detalhes,
      created_at: new Date().toISOString()
    };
    setAuditLogs((prev) => [newLog, ...prev]);

    if (isSupabaseConfigured && supabase) {
      try {
        await auditoriaService.log(user?.id || null, acao, 'app', undefined, null, { detalhes });
      } catch (err) {
        console.warn('Falha ao registrar log de auditoria:', err);
      }
    }
  };

  // Auth Handlers
  const handleLogin = (authenticatedUser: AuthUser) => {
    setUser(authenticatedUser);
    addAuditLog(authenticatedUser.nome, 'Login', `Efetuou login no sistema como ${authenticatedUser.role}.`);
  };

  const handleLogout = () => {
    if (user) {
      addAuditLog(user.nome, 'Logout', 'Encerrou sessão no sistema.');
      setUser(null);
      setActiveTab('dashboard');
    }
  };

  // Clients Handlers
  const handleAddClient = async (newClientData: Omit<Client, 'id' | 'created_at' | 'updated_at'>) => {
    try {
      if (!isSupabaseActive || !supabase) throw new Error('Conexão com o Supabase indisponível.');
      const created = await clientesService.create(newClientData, user?.id);
      setClients((prev) => [created, ...prev]);
      if (user) {
        await addAuditLog(user.nome, 'Cadastro de Cliente', `Cadastrou o cliente "${created.empresa}" (${created.codigo_cliente}).`);
      }
    } catch (err: any) {
      alert(err.message || 'Erro ao cadastrar cliente');
    }
  };

  const handleUpdateClient = async (id: string, updates: Partial<Client>) => {
    try {
      if (!isSupabaseActive || !supabase) throw new Error('Conexão com o Supabase indisponível.');
      const oldClient = clients.find((c) => c.id === id);
      await clientesService.update(id, updates);
      const dbClients = await clientesService.list();
      setClients(dbClients);
      const clientName = oldClient?.empresa || id;
      if (user) {
        await addAuditLog(user.nome, 'Edição de Cliente', `Alterou informações de cadastro do cliente "${clientName}".`);
      }
    } catch (err: any) {
      alert(err.message || 'Erro ao atualizar cliente');
    }
  };

  const handleDeleteClient = async (id: string) => {
    try {
      if (!isSupabaseActive || !supabase) throw new Error('Conexão com o Supabase indisponível.');
      const client = clients.find((c) => c.id === id);
      const result = await clientesService.deleteOrInactivate(id);
      const dbClients = await clientesService.list();
      setClients(dbClients);
      if (user && client) {
        const actionText = result.action === 'inactivated' ? 'Inativação de Cliente' : 'Exclusão de Cliente';
        await addAuditLog(user.nome, actionText, `Removeu ou desativou o cliente "${client.empresa}" (${client.codigo_cliente}) da base de dados.`);
      }
      if (result.action === 'inactivated') {
        alert('O cliente possui relatórios ou disparos associados. Por segurança, ele foi apenas inativado.');
      } else {
        alert('Cliente excluído com sucesso.');
      }
    } catch (err: any) {
      alert(err.message || 'Erro ao deletar cliente');
    }
  };

  const handleImportClients = async (newClientsList: Omit<Client, 'id' | 'created_at' | 'updated_at'>[]) => {
    try {
      if (!isSupabaseActive || !supabase) throw new Error('Conexão com o Supabase indisponível.');
      for (const c of newClientsList) {
        await clientesService.create(c, user?.id);
      }
      const dbClients = await clientesService.list();
      setClients(dbClients);
      if (user) {
        await addAuditLog(user.nome, 'Importação de Clientes', `Importou ${newClientsList.length} clientes com sucesso via planilha CSV.`);
      }
    } catch (err: any) {
      alert(err.message || 'Erro ao importar clientes');
    }
  };

  // Batches & Dispatch Handlers
  const handleCreateBatch = async (name: string, competencia: string, reportsToDispatch: any[], scheduledDateStr?: string) => {
    try {
      if (!isSupabaseActive || !supabase) throw new Error('Conexão com o Supabase indisponível.');
      
      const relatorioIds: string[] = [];

      // 1. Upload files and register in relatorios table, saving their real DB IDs
      for (const report of reportsToDispatch) {
        if (report.fileObject) {
          const compDateStr = competenciaToDateStr(competencia);
          
          // Upload to Supabase Storage and register in relatorios table with real user session
          const uploadResult = await relatoriosService.uploadFile(report.fileObject, '', {
            cliente_id: report.client_id,
            codigo_cliente: report.extractedCode,
            competencia: compDateStr,
            tipo_relatorio: 'desempenho',
            nome_arquivo: report.fileName,
            tamanho_bytes: report.fileSize,
            mime_type: 'application/pdf',
            status_validacao: 'pronto',
            motivo_pendencia: null,
            enviado_anteriormente: false
          });

          if (!uploadResult || !uploadResult.id) {
            throw new Error(`Falha ao registrar relatório ${report.fileName} na base de dados.`);
          }

          report.relatorio_id = uploadResult.id;
          report.storage_path = uploadResult.storagePath;

          console.log('Relatório persistido', {
            fileName: report.fileName,
            relatorioId: report.relatorio_id,
            storagePath: report.storage_path
          });
        } else if (report.duplicateInfo?.existingReportId) {
          report.relatorio_id = report.duplicateInfo.existingReportId;
        }

        // Validação estrita do ID persistido antes de criar a fila
        if (!report.relatorio_id) {
          throw new Error(`Não foi possível criar a fila para ${report.fileName}: relatorio_id ausente.`);
        }

        relatorioIds.push(report.relatorio_id);
      }

      if (relatorioIds.length === 0) {
        throw new Error('Nenhum relatório com ID persistido válido foi encontrado.');
      }

      // 2. Map scheduling modalidade
      const modalidade = scheduledDateStr === 'PRESET_CLIENTE'
        ? 'agenda_individual'
        : scheduledDateStr
          ? 'agendado'
          : 'imediato';

      const scheduledDate = scheduledDateStr && scheduledDateStr !== 'PRESET_CLIENTE'
        ? scheduledDateStr
        : null;

      // 3. Create real Batch and Queue items via transaction (RPC or Fallback)
      const result = await lotesService.criarLoteComFila(
        name,
        competencia,
        modalidade,
        scheduledDate,
        relatorioIds,
        user ? user.id : ''
      );

      // 4. Trigger queue processing if modalidade is 'imediato'
      if (modalidade === 'imediato' && result && result.lote_id) {
        console.log(`Acionando processamento da fila para lote imediato ID: ${result.lote_id}`);
        try {
          await handleProcessQueueNow(result.lote_id);
        } catch (procErr) {
          console.error('Erro ao processar lote imediato:', procErr);
        }
      } else {
        // Refresh local states if not processed inline
        const [dbBatches, dbQueue] = await Promise.all([
          lotesService.list(),
          filaService.list()
        ]);
        setBatches(dbBatches || []);
        setQueueItems(dbQueue || []);
      }

      if (user) {
        await addAuditLog(
          user.nome,
          'Criação de Lote',
          `Criou o lote "${name}" contendo ${result.total_validos} relatórios válidos para competência ${competencia}.`
        );
      }
    } catch (err: any) {
      console.error('Erro na criação do lote:', err);
      alert(err.message || 'Erro ao criar lote de envios');
      throw err;
    }
  };

  const handleProcessQueueNow = async (batchId?: string) => {
    try {
      if (!isSupabaseActive || !supabase) throw new Error('Conexão com o Supabase indisponível.');
      
      let processed = false;
      let resultData = null;

      try {
        const { data, error } = await supabase.functions.invoke('processar-fila-whatsapp', {
          body: batchId ? { loteId: batchId } : {}
        });
        if (!error && data) {
          processed = true;
          resultData = data;
        }
      } catch (efErr) {
        console.warn('Edge Function processar-fila-whatsapp falhou, usando workerService diretamente:', efErr);
      }

      if (!processed) {
        resultData = await workerService.triggerManualRun(user?.id);
      }

      await loadAllData();
      return resultData;
    } catch (err: any) {
      console.error('Erro no processamento manual da fila:', err);
      throw err;
    }
  };

  const handleCancelBatch = async (batchId: string) => {
    try {
      await lotesService.updateStatus(batchId, 'cancelado');
      await filaService.cancelItemsForBatch(batchId);

      const dbBatches = await lotesService.list();
      const dbQueue = await filaService.list();
      setBatches(dbBatches || []);
      setQueueItems(dbQueue || []);

      const batchName = dbBatches.find((b) => b.id === batchId)?.nome || batchId;
      if (user) {
        await addAuditLog(
          user.nome,
          'Cancelamento de Lote',
          `Cancelou o lote "${batchName}" e suspendeu envios em fila.`
        );
      }
    } catch (err: any) {
      alert(err.message || 'Erro ao cancelar o lote de envios');
    }
  };

  const handleRetryFailedItems = async (batchId: string) => {
    try {
      if (!isSupabaseActive || !supabase) throw new Error('Conexão com o Supabase indisponível.');
      const failedItems = queueItems.filter((i) => i.lote_id === batchId && i.status === 'Falhou');
      if (failedItems.length === 0) return;

      const batchName = batches.find((b) => b.id === batchId)?.nome || batchId;
      if (user) {
        await addAuditLog(user.nome, 'Reenvio de Falhas', `Iniciou reprocessamento de ${failedItems.length} falhas do lote "${batchName}".`);
      }

      // 1. Transition batch status to 'aguardando'
      await supabase.from('lotes_envio').update({ status: 'aguardando', updated_at: new Date().toISOString() }).eq('id', batchId);

      // 2. Transition failed items: falhou -> pendente (DO NOT set directly to processando or erase error codes)
      for (const item of failedItems) {
        await supabase
          .from('fila_envios')
          .update({
            status: 'pendente',
            updated_at: new Date().toISOString()
          })
          .eq('id', item.id);
      }

      // 3. Process the queue now that items are marked 'pendente'
      await handleProcessQueueNow(batchId);

      const [dbBatches, dbQueue] = await Promise.all([
        lotesService.list(),
        filaService.list()
      ]);
      setBatches(dbBatches || []);
      setQueueItems(dbQueue || []);
    } catch (err: any) {
      alert(err.message || 'Erro ao reprocessar falhas.');
    }
  };

  const handleRebuildQueue = async (batchId: string) => {
    try {
      if (!isSupabaseActive || !supabase) throw new Error('Conexão com o Supabase indisponível.');
      
      const count = await lotesService.reconstruirFila(batchId);
      
      // Reload states
      const [dbBatches, dbQueue] = await Promise.all([
        lotesService.list(),
        filaService.list()
      ]);
      setBatches(dbBatches);
      setQueueItems(dbQueue);
      
      if (user) {
        await addAuditLog(
          user.nome,
          'Reconstrução de Fila',
          `Reconstruiu a fila do lote ID "${batchId}", gerando ${count} novos itens de envio.`
        );
      }
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao reconstruir fila do lote');
    }
  };

  const [sendingId, setSendingId] = useState<string | null>(null);

  const handleRetrySingleItem = async (itemId: string) => {
    try {
      if (!isSupabaseActive || !supabase) throw new Error('Conexão com o Supabase indisponível.');

      const item = queueItems.find((i) => i.id === itemId);
      if (!item) {
        throw new Error('Item da fila não encontrado.');
      }

      if (!item.relatorio_id) {
        throw new Error('Não é possível disparar um envio para registro inválido sem relatório associado.');
      }

      setSendingId(itemId);

      // Transition item status: falhou -> pendente (Rule 4)
      await supabase
        .from('fila_envios')
        .update({
          status: 'pendente',
          updated_at: new Date().toISOString()
        })
        .eq('id', itemId);

      if (user && item) {
        await addAuditLog(user.nome, 'Envio de Mensagem', `Solicitou disparo individual de relatório para ${item.cliente_nome}.`);
      }

      console.log(`Invocando Edge Function enviar-relatorio-whatsapp para filaEnvioId: ${itemId}, relatorio_id: ${item.relatorio_id}`);
      const { data, error } = await supabase.functions.invoke('enviar-relatorio-whatsapp', {
        body: { filaEnvioId: itemId }
      });

      if (error) {
        throw new Error(error.message || 'Erro ao invocar a Edge Function no Supabase.');
      }

      if (data && data.success === false) {
        throw new Error(data.error || 'Ocorreu um erro no processamento do disparo pelo WhatsApp.');
      }

      // Reload databases on success
      const [dbBatches, dbQueue, dbLogs] = await Promise.all([
        lotesService.list(),
        filaService.list(),
        auditoriaService.list()
      ]);
      setBatches(dbBatches);
      setQueueItems(dbQueue);
      setAuditLogs(dbLogs || []);
    } catch (err: any) {
      console.error('Erro no disparo individual:', err);
      alert(err.message || 'Erro ao reprocessar item.');
      
      // Reload in case database status updated to failed
      const [dbBatches, dbQueue] = await Promise.all([
        lotesService.list(),
        filaService.list()
      ]);
      setBatches(dbBatches);
      setQueueItems(dbQueue);
    } finally {
      setSendingId(null);
    }
  };

  const handleResendReport = async (relatorioId: string) => {
    try {
      await relatoriosService.reenviarRelatorio(relatorioId);

      const [dbBatches, dbQueue, dbLogs] = await Promise.all([
        lotesService.list(),
        filaService.list(),
        auditoriaService.list()
      ]);
      setBatches(dbBatches);
      setQueueItems(dbQueue);
      setAuditLogs(dbLogs || []);
    } catch (err: any) {
      alert(err.message || 'Erro ao re-enfileirar relatório para reenvio.');
    }
  };

  // Config Handlers
  const handleSaveConfig = async (updates: Partial<WhatsAppConfig>) => {
    try {
      if (!isSupabaseActive || !supabase) throw new Error('Conexão com o Supabase indisponível.');
      setConfig((prev) => ({ ...prev, ...updates }));
      if (user) {
        await addAuditLog(user.nome, 'Alteração de Configuração', 'Atualizou credenciais e tokens da API Oficial da Meta.');
      }

      const mapped = {
        id: 'default',
        access_token: updates.accessToken !== undefined ? updates.accessToken : config.accessToken,
        phone_number_id: updates.phoneNumberId !== undefined ? updates.phoneNumberId : config.phoneNumberId,
        business_account_id: updates.businessAccountId !== undefined ? updates.businessAccountId : config.businessAccountId,
        verify_token: updates.verifyToken !== undefined ? updates.verifyToken : config.verifyToken,
        app_secret: updates.appSecret !== undefined ? updates.appSecret : config.appSecret,
        template_name: updates.templateName !== undefined ? updates.templateName : config.templateName,
        language: updates.language !== undefined ? updates.language : config.language,
        updated_at: new Date().toISOString()
      };

      await supabase.from('whatsapp_configs').upsert(mapped);
    } catch (err: any) {
      alert(err.message || 'Erro ao salvar configurações.');
    }
  };

  // Render Page Content based on selected tab
  const renderTabContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <DashboardView
            user={user!}
            clients={clients}
            batches={batches}
            queueItems={queueItems}
            onDataChange={loadAllData}
            onNavigateToTab={(tab) => {
              if (tab === 'upload') setActiveTab('upload');
              if (tab === 'historico') setActiveTab('historico');
              if (tab === 'clientes') setActiveTab('clientes');
            }}
          />
        );
      case 'clientes':
        return (
          <ClientsView
            user={user!}
            clients={clients}
            onAddClient={handleAddClient}
            onUpdateClient={handleUpdateClient}
            onDeleteClient={handleDeleteClient}
            onImportClients={handleImportClients}
            onDataChange={loadAllData}
          />
        );
      case 'upload':
        // Generate light representation of items currently in queue to allow UploadView to detect previously uploaded records
        const historicalRecordPairs = queueItems.map((i) => ({
          competencia: i.competencia,
          cliente_id: i.cliente_id
        }));

        return (
          <UploadAndReviewView
            clients={clients}
            historyQueue={historicalRecordPairs}
            onCreateBatch={handleCreateBatch}
            onNavigateToTab={(tab) => setActiveTab(tab)}
          />
        );
      case 'relatorios':
        return (
          <ReportsView
            user={user!}
            clients={clients}
            onNavigateToTab={(tab) => setActiveTab(tab)}
            onDataChange={loadAllData}
          />
        );
      case 'lotes':
        return (
          <BatchesView
            user={user!}
            batches={batches}
            queueItems={queueItems}
            onCancelBatch={handleCancelBatch}
            onRetryFailedItems={handleRetryFailedItems}
            onRebuildQueue={handleRebuildQueue}
            onProcessQueueNow={handleProcessQueueNow}
            onDataChange={loadAllData}
          />
        );
      case 'historico':
        return (
          <HistoryView
            queueItems={queueItems}
            clients={clients}
            onRetrySingleItem={handleRetrySingleItem}
            onResendReport={handleResendReport}
            sendingId={sendingId}
          />
        );
      case 'integracoes':
        return (
          <IntegrationsView
            user={user!}
          />
        );
      case 'configuracoes':
        return (
          <SettingsView
            config={config}
            onSaveConfig={handleSaveConfig}
            auditLogs={auditLogs}
            user={user!}
          />
        );
      default:
        return <div>Em breve...</div>;
    }
  };

  // Render App
  if (!user) {
    return <LoginView onLoginSuccess={handleLogin} />;
  }

  return (
    <div className="flex h-screen bg-[#fafafa] dark:bg-slate-950 font-sans overflow-hidden transition-colors duration-300">
      {/* Sidebar Panel */}
      <Sidebar
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab)}
        user={user}
        onLogout={handleLogout}
      />

      {/* Main Content Pane */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#fafafa] dark:bg-slate-950">
        {/* Dynamic Tab Body */}
        <div className="flex-1 overflow-y-auto p-8 max-w-7xl w-full mx-auto">
          {supabaseError && (
            <div className="mb-6 p-5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all animate-fade-in">
              <div className="flex gap-3.5 items-start">
                <div className="p-2 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-lg shrink-0 mt-0.5">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-semibold text-amber-900 dark:text-amber-300 text-sm">
                    Banco de Dados Supabase Incompleto (Tabelas Faltando)
                  </h4>
                  <p className="text-amber-700 dark:text-amber-400 text-xs mt-1 leading-relaxed">
                    Sua conexão com o Supabase está ativa, mas as tabelas necessárias não foram encontradas ou estão desatualizadas.
                    Isso é esperado se você configurou o projeto recentemente! Clique no botão ao lado para copiar o script de criação de tabelas e execute-o no <strong>SQL Editor</strong> do seu console do Supabase.
                  </p>
                  <span className="text-[10.5px] font-mono text-amber-600 dark:text-amber-500 block mt-2">
                    Erro técnico: {supabaseError}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 self-end md:self-center">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(SUPABASE_SQL_SETUP);
                    alert('Script SQL de configuração copiado com sucesso! Execute-o no SQL Editor do painel do seu Supabase.');
                  }}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-medium text-xs rounded-lg transition shadow-sm active:scale-95 flex items-center gap-1.5 cursor-pointer"
                >
                  <Terminal className="w-3.5 h-3.5" />
                  Copiar Script SQL
                </button>
                <button
                  onClick={() => setSupabaseError(null)}
                  className="px-3.5 py-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-amber-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium text-xs rounded-lg transition cursor-pointer"
                >
                  Dispensar
                </button>
              </div>
            </div>
          )}

          {renderTabContent()}
        </div>
      </main>
    </div>
  );
}
