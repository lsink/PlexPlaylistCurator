import React, { useState, useEffect } from 'react';
import { X, History, Trash2, CheckCircle2, AlertCircle, RefreshCw, Loader2 } from 'lucide-react';
import { SyncLog } from '../types';
import { api } from '../api/client';

interface SyncLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SyncLogsModal: React.FC<SyncLogsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadLogs();
    }
  }, [isOpen]);

  const loadLogs = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getLogs();
      setLogs(data);
    } catch (err: any) {
      console.error('Failed to load logs:', err);
      setError(err.message || 'Failed to load sync logs');
    } finally {
      setLoading(false);
    }
  };

  const handleClearLogs = async () => {
    if (!confirm('Clear all sync history logs?')) return;
    try {
      await api.clearLogs();
      setLogs([]);
    } catch (err: any) {
      console.error('Failed to clear logs:', err);
      setError(err.message || 'Failed to clear logs');
    }
  };

  const renderStatus = (status: string) => {
    if (status === 'success') {
      return (
        <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Success
        </span>
      );
    }
    if (status === 'running') {
      return (
        <span className="inline-flex items-center gap-1 text-amber-400 font-medium">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Running
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-red-400 font-medium">
        <AlertCircle className="w-3.5 h-3.5" />
        Error
      </span>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#1b1e22] border border-[#2e343b] rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#2e343b] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <History className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-bold text-white">Sync History &amp; Audit Logs</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-[#282d33] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Log table */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {error && (
            <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {loading ? (
            <div className="h-64 flex flex-col items-center justify-center space-y-3 text-gray-400">
              <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-sm">Loading logs...</p>
            </div>
          ) : logs.length === 0 && !error ? (
            <div className="h-64 flex flex-col items-center justify-center text-gray-500">
              <History className="w-12 h-12 mb-2 opacity-30" />
              <p className="text-sm">No sync logs recorded yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-gray-300" aria-label="Sync history logs">
                <thead className="bg-[#16181b] uppercase text-[10px] tracking-wider text-gray-400 font-semibold border-b border-[#2d3238]">
                  <tr>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Time</th>
                    <th className="py-2.5 px-3">Playlist</th>
                    <th className="py-2.5 px-3">Trigger</th>
                    <th className="py-2.5 px-3 text-right">Episodes</th>
                    <th className="py-2.5 px-3">Message</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#262b30]">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-[#22272d]">
                      <td className="py-2.5 px-3">{renderStatus(log.status)}</td>
                      <td className="py-2.5 px-3 font-mono text-gray-400 whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-white">
                        {log.playlist_name || 'All'}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded text-[10px] uppercase font-mono bg-[#282d33] text-gray-300 border border-[#373e47]">
                          {log.trigger_type}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-400">
                        {log.episodes_synced}
                      </td>
                      <td className="py-2.5 px-3 text-gray-300 max-w-xs truncate" title={log.message}>
                        {log.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#2e343b] bg-[#16181b] flex items-center justify-between">
          <button
            onClick={loadLogs}
            disabled={loading}
            className="flex items-center space-x-1.5 text-xs text-gray-300 hover:text-white bg-[#252a30] hover:bg-[#313740] px-3.5 py-2 rounded-lg border border-[#3a414b] transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleClearLogs}
              disabled={logs.length === 0}
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear History</span>
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-[#272d33] hover:bg-[#343b44] text-sm text-gray-300 font-medium transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
