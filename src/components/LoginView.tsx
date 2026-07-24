import React, { useState } from 'react';
import { AuthUser } from '../types';
import { authService } from '../services/supabaseService';
import { Eye, EyeOff, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import Logo from './Logo';

interface LoginViewProps {
  onLoginSuccess: (user: AuthUser) => void;
}

export default function LoginView({ onLoginSuccess }: LoginViewProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const loggedUser = await authService.login(email, password);
      onLoginSuccess(loggedUser);
    } catch (err: any) {
      setError(err.message || 'Falha ao autenticar com o Supabase. Verifique suas credenciais.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div id="login_container" className="min-h-screen flex items-center justify-center bg-[#fafafa] dark:bg-slate-950 font-sans px-4 relative overflow-hidden transition-colors duration-300">
      {/* Decorative background grid and ambient lighting */}
      <div className="absolute inset-0 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] dark:bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] opacity-70 pointer-events-none" />
      <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-blue-50 dark:bg-blue-950/20 rounded-full blur-[120px] opacity-40 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-indigo-50 dark:bg-indigo-950/20 rounded-full blur-[120px] opacity-40 pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="w-full max-w-[440px] bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xl p-8 relative z-10 transition-colors"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="mb-4">
            <Logo size="xl" className="text-blue-600 dark:text-blue-400" />
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 text-center font-semibold uppercase tracking-wider">
            Sistema de Envio de Relatórios via WhatsApp
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
              E-mail Comercial
            </label>
            <input
              id="login_email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="seu-email@dominio.com"
              className="w-full px-3 py-2 text-sm bg-slate-50/50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:border-blue-500 focus:bg-white dark:focus:bg-slate-950 transition-all text-slate-900 dark:text-white"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
              Senha
            </label>
            <div className="relative">
              <input
                id="login_password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="Sua senha do Supabase Auth"
                className="w-full px-3 py-2 pr-10 text-sm bg-slate-50/50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:border-blue-500 focus:bg-white dark:focus:bg-slate-950 transition-all text-slate-900 dark:text-white"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/50 p-2.5 rounded-lg">
              {error}
            </div>
          )}

          <button
            id="login_submit_btn"
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-all shadow-sm flex items-center justify-center gap-2 mt-2"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Iniciando sessão...
              </>
            ) : (
              'Acessar Painel'
            )}
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-slate-100 dark:border-slate-800 text-center">
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Conectado ao Supabase Real.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
