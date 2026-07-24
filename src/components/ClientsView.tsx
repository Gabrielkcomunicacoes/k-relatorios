import React, { useState, useRef } from 'react';
import { Client } from '../types';
import {
  Search,
  Plus,
  FileDown,
  Upload,
  Check,
  AlertCircle,
  Edit2,
  Trash2,
  UserCheck,
  UserX,
  Calendar,
  X,
  FileSpreadsheet,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ClientsViewProps {
  clients: Client[];
  onAddClient: (client: Omit<Client, 'id' | 'created_at' | 'updated_at'>) => void;
  onUpdateClient: (id: string, updates: Partial<Client>) => void;
  onDeleteClient: (id: string) => void;
  onImportClients: (newClients: Omit<Client, 'id' | 'created_at' | 'updated_at'>[]) => void;
}

export default function ClientsView({
  clients,
  onAddClient,
  onUpdateClient,
  onDeleteClient,
  onImportClients
}: ClientsViewProps) {
  // Search and filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | 'ativos' | 'inativos'>('todos');
  const [optinFilter, setOptinFilter] = useState<'todos' | 'optin' | 'no-optin'>('todos');

  // Form states
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [formData, setFormData] = useState({
    codigo_cliente: '',
    empresa: '',
    nome_contato: '',
    telefone_whatsapp: '',
    email: '',
    ativo: true,
    possui_optin: true,
    dia_envio: 5,
    horario_envio: '09:00',
    observacoes: ''
  });

  // CSV Import States
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [csvContent, setCsvContent] = useState('');
  const [importAnalysis, setImportAnalysis] = useState<{
    newClients: any[];
    duplicates: any[];
    invalid: any[];
    analyzed: boolean;
  }>({ newClients: [], duplicates: [], invalid: [], analyzed: false });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filter clients
  const filteredClients = clients.filter((client) => {
    const matchesSearch =
      client.empresa.toLowerCase().includes(searchTerm.toLowerCase()) ||
      client.nome_contato.toLowerCase().includes(searchTerm.toLowerCase()) ||
      client.codigo_cliente.toLowerCase().includes(searchTerm.toLowerCase()) ||
      client.email.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus =
      statusFilter === 'todos' ||
      (statusFilter === 'ativos' && client.ativo) ||
      (statusFilter === 'inativos' && !client.ativo);

    const matchesOptin =
      optinFilter === 'todos' ||
      (optinFilter === 'optin' && client.possui_optin) ||
      (optinFilter === 'no-optin' && !client.possui_optin);

    return matchesSearch && matchesStatus && matchesOptin;
  });

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const totalPages = Math.ceil(filteredClients.length / itemsPerPage);
  const activePage = Math.min(currentPage, Math.max(1, totalPages));
  const paginatedClients = filteredClients.slice(
    (activePage - 1) * itemsPerPage,
    activePage * itemsPerPage
  );

  // Handle open modal for ADD
  const handleOpenAdd = () => {
    // Generate next unique client code automatically for convenience
    const codes = clients.map((c) => {
      const match = c.codigo_cliente.match(/\d+/);
      return match ? parseInt(match[0], 10) : 0;
    });
    const maxCode = codes.length > 0 ? Math.max(...codes) : 0;
    const nextCodeStr = `CLI${String(maxCode + 1).padStart(4, '0')}`;

    setEditingClient(null);
    setFormData({
      codigo_cliente: nextCodeStr,
      empresa: '',
      nome_contato: '',
      telefone_whatsapp: '+55',
      email: '',
      ativo: true,
      possui_optin: true,
      dia_envio: 5,
      horario_envio: '09:00',
      observacoes: ''
    });
    setIsFormOpen(true);
  };

  // Handle open modal for EDIT
  const handleOpenEdit = (client: Client) => {
    setEditingClient(client);
    setFormData({
      codigo_cliente: client.codigo_cliente,
      empresa: client.empresa,
      nome_contato: client.nome_contato,
      telefone_whatsapp: client.telefone_whatsapp,
      email: client.email,
      ativo: client.ativo,
      possui_optin: client.possui_optin,
      dia_envio: client.dia_envio,
      horario_envio: client.horario_envio,
      observacoes: client.observacoes || ''
    });
    setIsFormOpen(true);
  };

  // Handle Save
  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingClient) {
      onUpdateClient(editingClient.id, formData);
    } else {
      // Validate unique client code
      const codeExists = clients.some(
        (c) => c.codigo_cliente.trim().toUpperCase() === formData.codigo_cliente.trim().toUpperCase()
      );
      if (codeExists) {
        alert(`O código de cliente ${formData.codigo_cliente} já está cadastrado.`);
        return;
      }
      onAddClient(formData);
    }
    setIsFormOpen(false);
  };

  // Sample CSV generator for download
  const downloadTemplate = () => {
    const csvContent =
      "codigo_cliente,empresa,nome_contato,telefone_whatsapp,email,ativo,possui_optin,dia_envio,horario_envio,observacoes\n" +
      "CLI0006,Posto Shell Centro,Marcos Dias,+5511977778888,marcos@posto.com,true,true,10,09:30,Enviar antes do meio dia\n" +
      "CLI0007,Farmacia Vida,Julia Melo,+5521911112222,julia@farmaciavida.com,true,true,5,11:00,Cliente muito exigente\n" +
      "CLI0001,Duplicado Teste,Joao Silva,+5511999991111,joao@acme.com,true,true,5,09:00,Empresa ja existente\n" +
      "CLI0008,,Nome Sem Empresa,,email_invalido.com,true,false,15,10:00,Cliente incompleto";

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'modelo_importacao_clientes.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Process CSV File Select or Text Area
  const analyzeCSV = (content: string) => {
    setCsvContent(content);
    if (!content.trim()) {
      setImportAnalysis({ newClients: [], duplicates: [], invalid: [], analyzed: false });
      return;
    }

    const lines = content.split('\n');
    if (lines.length <= 1) return;

    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());

    const newClients: any[] = [];
    const duplicates: any[] = [];
    const invalid: any[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Handle simple CSV splitting (no quote parsing required for this helper template)
      const values = line.split(',').map((v) => v.trim());

      // Create object
      const row: any = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });

      // Basic fields
      const code = row.codigo_cliente || '';
      const empresa = row.empresa || '';
      const nome = row.nome_contato || '';
      const telefone = row.telefone_whatsapp || '';
      const email = row.email || '';
      const dia = parseInt(row.dia_envio || '5', 10);
      const horario = row.horario_envio || '09:00';
      const obs = row.observacoes || '';

      const isAtivo = row.ativo === 'true' || row.ativo === '1' || row.ativo === '';
      const hasOptin = row.possui_optin === 'true' || row.possui_optin === '1' || row.possui_optin === '';

      // VALIDATION
      if (!code || !empresa || !nome || !telefone) {
        invalid.push({
          row: i + 1,
          client: { ...row, codigo_cliente: code, empresa, nome_contato: nome, telefone_whatsapp: telefone },
          reason: 'Campos obrigatórios ausentes (Código, Empresa, Contato ou WhatsApp)'
        });
        continue;
      }

      // Check Duplicates in database
      const dbDuplicated = clients.some((c) => c.codigo_cliente === code);
      // Check Duplicates in current import queue
      const batchDuplicated = newClients.some((c) => c.codigo_cliente === code);

      if (dbDuplicated || batchDuplicated) {
        duplicates.push({
          row: i + 1,
          client: {
            codigo_cliente: code,
            empresa,
            nome_contato: nome,
            telefone_whatsapp: telefone,
            email,
            ativo: isAtivo,
            possui_optin: hasOptin,
            dia_envio: isNaN(dia) ? 5 : dia,
            horario_envio: horario,
            observacoes: obs
          },
          reason: dbDuplicated ? 'Código de cliente já existente no sistema' : 'Código duplicado no arquivo'
        });
      } else {
        newClients.push({
          codigo_cliente: code,
          empresa,
          nome_contato: nome,
          telefone_whatsapp: telefone,
          email,
          ativo: isAtivo,
          possui_optin: hasOptin,
          dia_envio: isNaN(dia) ? 5 : dia,
          horario_envio: horario,
          observacoes: obs
        });
      }
    }

    setImportAnalysis({
      newClients,
      duplicates,
      invalid,
      analyzed: true
    });
  };

  // Confirm import
  const confirmImport = () => {
    if (importAnalysis.newClients.length === 0) {
      alert('Nenhum cliente válido para importar.');
      return;
    }
    onImportClients(importAnalysis.newClients);
    setIsImportOpen(false);
    setCsvContent('');
    setImportAnalysis({ newClients: [], duplicates: [], invalid: [], analyzed: false });
  };

  // Trigger file upload selection
  const handleCSVFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      analyzeCSV(text);
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6">
      {/* View Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-950 tracking-tight">
            Base de Clientes
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Gerencie perfis, agendamentos padrão, status de opt-in e importação via planilha.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            id="clients_open_import_btn"
            onClick={() => setIsImportOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg shadow-subtle transition-all bg-white"
          >
            <Upload className="w-3.5 h-3.5 text-slate-500" />
            Importar CSV
          </button>
          <button
            id="clients_open_add_btn"
            onClick={handleOpenAdd}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            Adicionar Cliente
          </button>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-subtle flex flex-col md:flex-row gap-3 items-center justify-between">
        {/* Search */}
        <div className="relative w-full md:w-80">
          <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-slate-400">
            <Search className="w-4 h-4" />
          </span>
          <input
            id="client_search_input"
            type="text"
            placeholder="Pesquisar por empresa, código, contato..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:bg-white transition-all text-slate-900"
          />
        </div>

        {/* Dropdowns */}
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          {/* Status Filter */}
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span>Status:</span>
            <select
              id="filter_status"
              value={statusFilter}
              onChange={(e: any) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-md text-xs font-medium text-slate-700 focus:outline-none"
            >
              <option value="todos">Todos</option>
              <option value="ativos">Ativos</option>
              <option value="inativos">Inativos</option>
            </select>
          </div>

          {/* Optin Filter */}
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span>Opt-In:</span>
            <select
              id="filter_optin"
              value={optinFilter}
              onChange={(e: any) => setOptinFilter(e.target.value)}
              className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-md text-xs font-medium text-slate-700 focus:outline-none"
            >
              <option value="todos">Todos</option>
              <option value="optin">Autorizado (Opt-In)</option>
              <option value="no-optin">Sem Autorização</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Grid / Table */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-subtle overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-4">Código</th>
                <th className="py-3 px-4">Empresa</th>
                <th className="py-3 px-4">Contato Principal</th>
                <th className="py-3 px-4">WhatsApp</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-center">Opt-In</th>
                <th className="py-3 px-4">Agendamento Padrão</th>
                <th className="py-3 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredClients.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-xs text-slate-400 italic">
                    Nenhum cliente correspondente encontrado na base de dados.
                  </td>
                </tr>
              ) : (
                paginatedClients.map((client) => (
                  <tr key={client.id} className="text-xs hover:bg-slate-50/60 transition-all">
                    {/* Code */}
                    <td className="py-3 px-4 font-mono font-medium text-blue-600">
                      {client.codigo_cliente}
                    </td>

                    {/* Company */}
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      {client.empresa}
                    </td>

                    {/* Contact */}
                    <td className="py-3 px-4 text-slate-600">
                      <div className="font-medium">{client.nome_contato}</div>
                      <div className="text-[10px] text-slate-400">{client.email}</div>
                    </td>

                    {/* Phone */}
                    <td className="py-3 px-4 font-mono text-slate-600">
                      {client.telefone_whatsapp ? (
                        client.telefone_whatsapp
                      ) : (
                        <span className="text-rose-500 font-sans italic inline-flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          Telefone ausente
                        </span>
                      )}
                    </td>

                    {/* Active Toggle Status */}
                    <td className="py-3 px-4 text-center">
                      <button
                        id={`client_status_toggle_${client.id}`}
                        onClick={() => onUpdateClient(client.id, { ativo: !client.ativo })}
                        title="Clique para alternar o status de atividade"
                        className="mx-auto block cursor-pointer"
                      >
                        {client.ativo ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <UserCheck className="w-2.5 h-2.5" />
                            Ativo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-50 text-slate-500 border border-slate-200">
                            <UserX className="w-2.5 h-2.5" />
                            Inativo
                          </span>
                        )}
                      </button>
                    </td>

                    {/* Opt In status */}
                    <td className="py-3 px-4 text-center">
                      <button
                        id={`client_optin_toggle_${client.id}`}
                        onClick={() => onUpdateClient(client.id, { possui_optin: !client.possui_optin })}
                        title="Clique para alternar autorização de envio"
                        className="mx-auto block cursor-pointer"
                      >
                        {client.possui_optin ? (
                          <span className="inline-flex items-center gap-0.5 text-emerald-600 font-semibold" title="Sim">
                            <Check className="w-4 h-4 stroke-[3]" />
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 text-amber-500 font-semibold" title="Pendente">
                            <X className="w-4 h-4 stroke-[3]" />
                          </span>
                        )}
                      </button>
                    </td>

                    {/* Schedule preferred */}
                    <td className="py-3 px-4 text-slate-600">
                      <div className="flex items-center gap-1 text-[11px] font-medium">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        Dia {client.dia_envio} às {client.horario_envio}
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          id={`edit_client_btn_${client.id}`}
                          onClick={() => handleOpenEdit(client)}
                          className="p-1 text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded transition-all"
                          title="Editar"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          id={`delete_client_btn_${client.id}`}
                          onClick={() => {
                            if (confirm(`Tem certeza que deseja excluir o cliente ${client.empresa}?`)) {
                              onDeleteClient(client.id);
                            }
                          }}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-all"
                          title="Excluir"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="p-3.5 bg-slate-50 border-t border-slate-200 text-slate-400 text-[10px] font-medium flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Mostrando {paginatedClients.length} de {filteredClients.length} clientes filtrados (Total: {clients.length})</span>
          
          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={activePage === 1}
                className="px-2 py-1 border border-slate-200 bg-white rounded-md text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                Anterior
              </button>
              <span className="text-xs text-slate-500 font-medium px-2">
                Página {activePage} de {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={activePage === totalPages}
                className="px-2 py-1 border border-slate-200 bg-white rounded-md text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                Próxima
              </button>
            </div>
          )}
          
          <span className="italic shrink-0">* Dica: Clique nos badges de Status ou Opt-In para alterná-los rapidamente.</span>
        </div>
      </div>

      {/* MODAL: ADD / EDIT CLIENT */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-lg bg-white rounded-xl border border-slate-200 shadow-premium overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-sm font-semibold text-slate-900">
                {editingClient ? 'Editar Perfil do Cliente' : 'Adicionar Novo Cliente'}
              </h2>
              <button
                onClick={() => setIsFormOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Código do Cliente (Único)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="ex: CLI0001"
                    disabled={!!editingClient} // Don't change code after setup to prevent dangling files
                    value={formData.codigo_cliente}
                    onChange={(e) => setFormData({ ...formData, codigo_cliente: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:bg-white text-slate-900 font-mono disabled:opacity-60"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Empresa / Razão Social
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="ex: Acme LTDA"
                    value={formData.empresa}
                    onChange={(e) => setFormData({ ...formData, empresa: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:bg-white text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Nome do Contato Principal
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="ex: João Silva"
                    value={formData.nome_contato}
                    onChange={(e) => setFormData({ ...formData, nome_contato: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:bg-white text-slate-900"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    WhatsApp (DDI + DDD + Número)
                  </label>
                  <input
                    type="text"
                    placeholder="ex: +5511999998888"
                    value={formData.telefone_whatsapp}
                    onChange={(e) => setFormData({ ...formData, telefone_whatsapp: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:bg-white text-slate-900 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Email para contato
                </label>
                <input
                  type="email"
                  placeholder="ex: contato@empresa.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:bg-white text-slate-900"
                />
              </div>

              {/* Day / Time preferred config */}
              <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">
                    Dia do Envio Padrão
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={formData.dia_envio}
                    onChange={(e) => setFormData({ ...formData, dia_envio: parseInt(e.target.value, 10) || 5 })}
                    className="w-full px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-md focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-400">Dia do mês do relatório</span>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">
                    Horário Padrão de Envio
                  </label>
                  <input
                    type="text"
                    placeholder="09:00"
                    value={formData.horario_envio}
                    onChange={(e) => setFormData({ ...formData, horario_envio: e.target.value })}
                    className="w-full px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-md focus:outline-none font-mono"
                  />
                  <span className="text-[10px] text-slate-400">Formato HH:MM (São Paulo)</span>
                </div>
              </div>

              {/* Checkboxes row */}
              <div className="flex gap-6 pt-1">
                <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={formData.ativo}
                    onChange={(e) => setFormData({ ...formData, ativo: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                  />
                  Cliente Ativo no Sistema
                </label>

                <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={formData.possui_optin}
                    onChange={(e) => setFormData({ ...formData, possui_optin: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                  />
                  Possui Opt-In Autorizado
                </label>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Observações de Despacho
                </label>
                <textarea
                  rows={2}
                  placeholder="Informações adicionais para despacho de relatórios..."
                  value={formData.observacoes}
                  onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:bg-white text-slate-900 resize-none"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-3 py-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-semibold rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  id="client_save_btn"
                  type="submit"
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm"
                >
                  Salvar Alterações
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* MODAL: CSV IMPORT DIALOG */}
      {isImportOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-2xl bg-white rounded-xl border border-slate-200 shadow-premium overflow-hidden"
          >
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-blue-600" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Importação de Clientes via Planilha CSV
                </h2>
              </div>
              <button
                onClick={() => setIsImportOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between bg-blue-50/50 border border-blue-100 p-3.5 rounded-lg gap-3">
                <div className="flex gap-2.5 items-start">
                  <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <div className="text-[11px] text-blue-800 leading-tight">
                    <strong>Estrutura da planilha recomendada:</strong> Seu arquivo CSV deve conter o cabeçalho idêntico ao modelo para correta correspondência dos dados.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="shrink-0 inline-flex items-center gap-1 py-1 px-2.5 bg-white border border-blue-200 hover:bg-blue-50 text-blue-700 text-[10px] font-bold rounded-md transition-all shadow-subtle"
                >
                  <FileDown className="w-3 h-3" />
                  Baixar Modelo CSV
                </button>
              </div>

              {/* Paste CSV or File Drag drop */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Manual text block paste */}
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Cole o conteúdo do CSV abaixo:
                  </label>
                  <textarea
                    rows={6}
                    value={csvContent}
                    onChange={(e) => analyzeCSV(e.target.value)}
                    placeholder="codigo_cliente,empresa,nome_contato,telefone_whatsapp,email&#10;CLI0006,Nova Loja,Maria Flores,+5511999990001,flores@nova.com"
                    className="w-full px-3 py-2 text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:bg-white text-slate-950 resize-none leading-relaxed"
                  />
                </div>

                {/* File input drag drops */}
                <div className="flex flex-col justify-between">
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      Ou faça o upload do arquivo:
                    </label>
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-slate-200 hover:border-blue-400 rounded-xl p-8 text-center cursor-pointer bg-slate-50/40 hover:bg-blue-50/10 transition-all flex flex-col items-center justify-center gap-2"
                    >
                      <Upload className="w-8 h-8 text-slate-400" />
                      <span className="text-xs text-slate-700 font-semibold">Clique para selecionar o arquivo</span>
                      <span className="text-[10px] text-slate-400">Apenas arquivos .csv suportados</span>
                      <input
                        type="file"
                        ref={fileInputRef}
                        accept=".csv"
                        onChange={handleCSVFileUpload}
                        className="hidden"
                      />
                    </div>
                  </div>

                  {/* Summary of analysis */}
                  {importAnalysis.analyzed && (
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="p-1 bg-emerald-50 rounded border border-emerald-100 text-emerald-800">
                        <div className="font-bold">{importAnalysis.newClients.length}</div>
                        <div className="text-[9px] font-medium text-emerald-600">Válidos</div>
                      </div>
                      <div className="p-1 bg-amber-50 rounded border border-amber-100 text-amber-800">
                        <div className="font-bold">{importAnalysis.duplicates.length}</div>
                        <div className="text-[9px] font-medium text-amber-600">Duplicados</div>
                      </div>
                      <div className="p-1 bg-red-50 rounded border border-red-100 text-red-800">
                        <div className="font-bold">{importAnalysis.invalid.length}</div>
                        <div className="text-[9px] font-medium text-red-600">Inválidos</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Analysis Lists detail preview if any duplicates or invalid records occur */}
              {importAnalysis.analyzed && (importAnalysis.duplicates.length > 0 || importAnalysis.invalid.length > 0) && (
                <div className="border border-slate-200 rounded-lg p-3 max-h-32 overflow-y-auto space-y-1 bg-slate-50/50 text-[10px] font-medium">
                  <div className="text-slate-500 font-bold uppercase mb-1">Relatório de Diagnóstico:</div>
                  {importAnalysis.duplicates.map((item, index) => (
                    <div key={`dup-${index}`} className="flex items-center gap-1.5 text-amber-700">
                      <AlertCircle className="w-3 h-3 text-amber-500 shrink-0" />
                      <span>Linha {item.row}: Cliente {item.client.codigo_cliente} ({item.client.empresa}) - {item.reason}</span>
                    </div>
                  ))}
                  {importAnalysis.invalid.map((item, index) => (
                    <div key={`inv-${index}`} className="flex items-center gap-1.5 text-red-600">
                      <AlertCircle className="w-3 h-3 text-red-500 shrink-0" />
                      <span>Linha {item.row}: {item.reason}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsImportOpen(false)}
                  className="px-3 py-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-semibold rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  id="confirm_import_btn"
                  type="button"
                  disabled={!importAnalysis.analyzed || importAnalysis.newClients.length === 0}
                  onClick={confirmImport}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold rounded-lg shadow-sm"
                >
                  Confirmar Importação de ({importAnalysis.newClients.length})
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
