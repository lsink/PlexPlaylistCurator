import React, { useState, useRef } from 'react';
import { Lock, KeyRound, Play } from 'lucide-react';
import { api } from '../api/client';
import { useModalA11y } from '../hooks/useModalA11y';

interface LoginModalProps {
  isOpen: boolean;
  onSuccess: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  onSuccess,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('Please enter your password');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await api.login(password);
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Invalid password');
    } finally {
      setLoading(false);
    }
  };

  useModalA11y(dialogRef, isOpen);

  if (!isOpen) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Sign in"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in"
    >
      <div className="bg-[#1b1e22] border border-[#2e343b] rounded-2xl w-full max-w-md p-6 sm:p-8 shadow-2xl text-center">
        <div className="w-14 h-14 rounded-2xl bg-amber-500/20 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-amber-500/10">
          <Lock className="w-6 h-6" />
        </div>

        <h2 className="text-xl font-bold text-white mb-1">Plex Playlist Creator</h2>
        <p className="text-xs text-gray-400 mb-6">
          Enter your admin password to access the playlist manager.
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs text-left">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <KeyRound className="w-4 h-4 text-gray-400 absolute left-3.5 top-3" />
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Admin password"
              className="w-full bg-[#22262b] border border-[#343b42] text-white rounded-xl pl-10 pr-3.5 py-2.5 text-sm focus:outline-none focus:border-amber-500 placeholder-gray-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold text-sm transition-colors shadow-lg shadow-amber-500/10 cursor-pointer"
          >
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
};
