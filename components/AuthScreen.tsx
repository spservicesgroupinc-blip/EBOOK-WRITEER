import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { CloudService, BACKEND_URL } from '../services/cloud';
import { Feather, Loader2, Lock, User as UserIcon, Link } from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';

interface AuthScreenProps {
  onLogin: (user: User) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize URL: Prioritize the constant from code, then localStorage, then empty
  const [backendUrl, setBackendUrl] = useState('');
  
  useEffect(() => {
    if (BACKEND_URL && BACKEND_URL.trim() !== "") {
      setBackendUrl(BACKEND_URL);
    } else {
      setBackendUrl(localStorage.getItem('ebookai_backend_url') || '');
    }
  }, []);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!backendUrl) {
      setError("Please enter the Google Apps Script Web App URL.");
      return;
    }
    setError(null);
    setIsLoading(true);

    try {
      // Save URL for future convenience if it wasn't hardcoded
      if (!BACKEND_URL) {
        localStorage.setItem('ebookai_backend_url', backendUrl);
      }

      let user: User;
      if (isLogin) {
        user = await CloudService.login(backendUrl, username, password);
      } else {
        user = await CloudService.signup(backendUrl, username, password);
      }
      onLogin(user);
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-slate-50 flex flex-col pt-safe pb-safe">
      <PWAInstallButton variant="banner" />
      <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="bg-white max-w-md w-full p-6 sm:p-8 rounded-2xl shadow-xl border border-slate-100">
          <div className="text-center mb-6 sm:mb-8">
            <img
              src="/icon.svg"
              alt="Ebook.AI Logo"
              className="w-16 h-16 rounded-2xl mx-auto mb-4 shadow-lg shadow-blue-900/20"
            />
            <h1 className="text-2xl sm:text-3xl font-serif font-bold text-slate-900">
              Ebook<span className="text-blue-600">.AI</span>
            </h1>
            <p className="text-sm text-slate-500 mt-1.5">Sync your stories &amp; manuscripts across devices</p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Only show URL input if NOT hardcoded in source code */}
            {(!BACKEND_URL || BACKEND_URL === "") && (
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Backend URL</label>
                <div className="relative">
                  <div className="absolute left-3.5 top-3.5 text-slate-400"><Link size={16} /></div>
                  <input 
                    type="url" 
                    value={backendUrl}
                    onChange={(e) => setBackendUrl(e.target.value)}
                    placeholder="https://script.google.com/..."
                    className="w-full min-h-[48px] pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-base"
                    required
                  />
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Deploy the provided Google Apps Script and paste the Web App URL here.
                </p>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Username</label>
              <div className="relative">
                <div className="absolute left-3.5 top-3.5 text-slate-400"><UserIcon size={16} /></div>
                <input 
                  type="text" 
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Storyteller"
                  autoComplete="username"
                  className="w-full min-h-[48px] pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-base"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Password</label>
              <div className="relative">
                <div className="absolute left-3.5 top-3.5 text-slate-400"><Lock size={16} /></div>
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  className="w-full min-h-[48px] pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-base"
                  required
                />
              </div>
            </div>

            <button 
              type="submit" 
              disabled={isLoading}
              className="w-full min-h-[48px] bg-blue-900 hover:bg-blue-800 active:scale-[0.99] text-white font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-blue-900/20 flex items-center justify-center gap-2 mt-2"
            >
              {isLoading ? <Loader2 className="animate-spin" size={20} /> : (isLogin ? 'Login' : 'Create Account')}
            </button>
          </form>

          <div className="mt-4">
            <PWAInstallButton variant="card" />
          </div>

          <div className="mt-5 text-center">
            <button 
              onClick={() => { setIsLogin(!isLogin); setError(null); }}
              className="min-h-[44px] px-4 text-sm text-slate-500 hover:text-blue-600 font-medium"
            >
              {isLogin ? "Need an account? Sign up" : "Already have an account? Login"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

