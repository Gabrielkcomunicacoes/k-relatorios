import React from 'react';
import { AuthUser } from '../types';
import Logo from './Logo';
import {
  LayoutDashboard,
  Users,
  UploadCloud,
  Layers,
  History,
  Settings,
  LogOut,
  Sparkles,
  Terminal,
  Shield,
  Key,
  Sun,
  Moon
} from 'lucide-react';

export type SidebarTab =
  | 'dashboard'
  | 'clientes'
  | 'upload'
  | 'lotes'
  | 'historico'
  | 'configuracoes';

interface SidebarProps {
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  user: AuthUser;
  onLogout: () => void;
}

export default function Sidebar({
  activeTab,
  onTabChange,
  user,
  onLogout
}: SidebarProps) {
  const menuItems = [
    { id: 'dashboard' as SidebarTab, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'clientes' as SidebarTab, label: 'Clientes', icon: Users },
    { id: 'upload' as SidebarTab, label: 'Upload & Conferência', icon: UploadCloud },
    { id: 'lotes' as SidebarTab, label: 'Lotes de Envio', icon: Layers },
    { id: 'historico' as SidebarTab, label: 'Histórico & Fila', icon: History },
    { id: 'configuracoes' as SidebarTab, label: 'WhatsApp API', icon: Settings, adminOnly: true }
  ];

  return (
    <aside id="sidebar_wrapper" className="w-64 bg-slate-900 text-slate-300 flex flex-col h-screen border-r border-slate-800 shrink-0">
      {/* Brand Header */}
      <div className="p-6 border-b border-slate-800 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Logo size="md" className="text-white" />
        </div>
        <span className="text-[10px] text-slate-500 font-semibold tracking-wider uppercase mt-1 block">
          WhatsApp Business SaaS
        </span>
      </div>

      {/* User Card */}
      <div className="p-4 mx-3 my-4 bg-slate-800/40 border border-slate-800/60 rounded-xl flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-semibold text-slate-200">
          {user.nome.charAt(0)}
        </div>
        <div className="overflow-hidden min-w-0 flex-1">
          <p className="text-xs font-semibold text-slate-200 truncate leading-tight">
            {user.nome}
          </p>
          <div className="flex items-center gap-1 mt-1">
            {user.role === 'Administrador' ? (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Shield className="w-2.5 h-2.5" />
                Admin
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Key className="w-2.5 h-2.5" />
                Operador
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto">
        {menuItems.map((item) => {
          // Hide settings for Operator
          if (item.adminOnly && user.role !== 'Administrador') {
            return null;
          }

          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <button
              id={`nav_btn_${item.id}`}
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                isActive
                  ? 'bg-blue-600 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
              <span className="truncate">{item.label}</span>
              {isActive && (
                <div className="ml-auto w-1 h-3 rounded bg-white" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer / Logout */}
      <div className="p-3 border-t border-slate-800 space-y-1.5">
        <button
          id="logout_btn"
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span>Sair do Sistema</span>
        </button>
      </div>
    </aside>
  );
}
