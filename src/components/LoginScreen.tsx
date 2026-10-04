/**
 * Sign-in screen, shown when the server has authentication enabled (a database is
 * configured) and there is no valid session.
 */
import React, { useState } from 'react';
import { Lock, LogIn, ShieldCheck } from 'lucide-react';
import { authApi, type SessionUser } from '../services/authApi';

interface LoginScreenProps {
  onSignedIn: (user: SessionUser) => void;
  notice?: string;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onSignedIn, notice }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await authApi.login(email, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center space-x-2 mb-6">
          <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center shadow-md">
            <ShieldCheck className="w-6 h-6 text-slate-950" />
          </div>
          <div>
            <div className="text-lg font-black text-slate-900 leading-tight">NW OS</div>
            <div className="text-[11px] text-slate-500 font-medium">Company Operating System</div>
          </div>
        </div>

        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-2xl shadow-xl p-6 space-y-4">
          <div>
            <h1 className="text-base font-bold text-slate-900">Sign in</h1>
            <p className="text-xs text-slate-500 mt-0.5">Use your NW OS account.</p>
          </div>

          {notice && !error && (
            <div className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2">{notice}</div>
          )}
          {error && (
            <div role="alert" className="text-xs bg-rose-50 border border-rose-200 text-rose-800 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <label className="block">
            <span className="block text-xs font-bold text-slate-700 mb-1">Email</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
            />
          </label>

          <label className="block">
            <span className="block text-xs font-bold text-slate-700 mb-1">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            className="w-full flex items-center justify-center space-x-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white font-bold text-sm rounded-xl py-2.5 transition-colors"
          >
            <LogIn className="w-4 h-4 text-amber-400" />
            <span>{busy ? 'Signing in…' : 'Sign in'}</span>
          </button>

          <p className="flex items-center space-x-1.5 text-[11px] text-slate-400">
            <Lock className="w-3 h-3" />
            <span>Access is checked on the server for every request.</span>
          </p>
        </form>
      </div>
    </div>
  );
};
