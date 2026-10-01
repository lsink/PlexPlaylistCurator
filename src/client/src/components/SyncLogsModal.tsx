import React, { useState, useEffect, useRef } from 'react';
import { X, History, Trash2, CheckCircle2, AlertCircle, RefreshCw, Loader2, Radio, MinusCircle } from 'lucide-react';
import { SyncLog, WebhookEvent, WebhookOutcome } from '../types';
import { api } from '../api/client';
import { parseDbTimestamp } from '../utils/format';
import { useModalA11y } from '../hooks/useModalA11y';
import { useConfirm } from './ConfirmDialog';

interface SyncLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'syncs' | 'webhooks';

export const SyncLogsModal: React.FC<SyncLogsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>('syncs');
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [webhookEvents, setWebhookEvents] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    loadActiveTab();
    return () => {
      requestIdRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, tab]);

  const loadActiveTab = async () => {
    const requestId = ++requestIdRef.current;
    try {
      setLoading(true);
      setError(null);
      if (tab === 'syncs') {
        const data = await api.getLogs();
        if (requestId === requestIdRef.current) setLogs(data);
      } else {
        const data = await api.getWebhookEvents();
        if (requestId === requestIdRef.current) setWebhookEvents(data);
      }
    } catch (err: any) {
      console.error('Failed to load logs:', err);
      if (requestId === requestIdRef.current) setError(err.message || 'Failed to load logs');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  };

  const handleClear = async () => {
    const isSyncs = tab === 'syncs';
    const choice = await confirm({
      title: isSyncs ? 'Clear sync history?' : 'Clear webhook activity?',
      message: isSyncs
        ? 'This permanently removes all sync log entries.'
        : 'This permanently removes all recorded webhook activity.',
      confirmLabel: 'Clear history',
      destructive: true,
    });
    if (choice !== 'confirm') return;
    try {
      if (isSyncs) {
        await api.clearLogs();
        setLogs([]);
      } else {
        await api.clearWebhookEvents();
        setWebhookEvents([]);
      }
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

  const renderOutcome = (outcome: WebhookOutcome) => {
    switch (outcome) {
      case 'synced':
        return (
          <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Synced
          </span>
        );
      case 'syncing':
        return (
          <span className="inline-flex items-center gap-1 text-amber-400 font-medium">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Syncing
          </span>
        );
      case 'ignored':
        return (
          <span className="inline-flex items-center gap-1 text-gray-400 font-medium">
            <MinusCircle className="w-3.5 h-3.5" />
            Ignored
          </span>
        );
      case 'no_playlist':
        return (
          <span className="inline-flex items-center gap-1 text-amber-400 font-medium">
            <AlertCircle className="w-3.5 h-3.5" />
            No playlist
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 text-red-400 font-medium">
            <AlertCircle className="w-3.5 h-3.5" />
            Rejected
          </span>
        );
      case 'invalid':
        return (
          <span className="inline-flex items-center gap-1 text-red-400 font-medium">
            <AlertCircle className="w-3.5 h-3.5" />
            Invalid
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-red-400 font-medium">
            <AlertCircle className="w-3.5 h-3.5" />
            Error
          </span>
        );
    }
  };

  useModalA11y(dialogRef, isOpen, onClose);

  if (!isOpen) return null;

  const isEmpty = tab === 'syncs' ? logs.length === 0 : webhookEvents.length === 0;

  const tabClass = (active: boolean) =>
    `flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
      active ? 'border-amber-500 text-amber-400' : 'border-transparent text-gray-400 hover:text-gray-200'
    }`;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Sync history"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm animate-fade-in"
    >
      <div className="bg-[#1b1e22] border border-[#2e343b] rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-4 border-b border-[#2e343b]">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <History className="w-5 h-5 text-amber-500" />
              <h2 className="text-lg font-bold text-white">Sync History &amp; Audit Logs</h2>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-[#282d33] transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div role="tablist" aria-label="Log type" className="flex gap-1 -mb-px">
            <button
              role="tab"
              id="tab-syncs"
              aria-selected={tab === 'syncs'}
              aria-controls="panel-logs"
              onClick={() => setTab('syncs')}
              className={tabClass(tab === 'syncs')}
            >
              <History className="w-3.5 h-3.5" />
              Syncs
            </button>
            <button
              role="tab"
              id="tab-webhooks"
              aria-selected={tab === 'webhooks'}
              aria-controls="panel-logs"
              onClick={() => setTab('webhooks')}
              className={tabClass(tab === 'webhooks')}
            >
              <Radio className="w-3.5 h-3.5" />
              Webhook activity
            </button>
          </div>
        </div>

        {/* Log table */}
        <div
          role="tabpanel"
          id="panel-logs"
          aria-labelledby={tab === 'syncs' ? 'tab-syncs' : 'tab-webhooks'}
          className="flex-1 overflow-y-auto p-4 sm:p-6"
        >
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
          ) : isEmpty && !error ? (
            tab === 'syncs' ? (
              <div className="h-64 flex flex-col items-center justify-center text-gray-500">
                <History className="w-12 h-12 mb-2 opacity-30" />
                <p className="text-sm">No sync logs recorded yet.</p>
              </div>
            ) : (
              <div className="h-64 flex flex-col items-center justify-center text-gray-500 text-center px-6">
                <Radio className="w-12 h-12 mb-2 opacity-30" />
                <p className="text-sm">No webhook calls received yet.</p>
                <p className="text-xs text-gray-500 mt-1 max-w-md">
                  Once the webhook is set up in Plex, every event Plex sends (play, pause, stop, finished) shows up here, even
                  the ones that don't trigger a sync. If you play something and nothing appears, Plex isn't reaching this app.
                </p>
              </div>
            )
          ) : tab === 'syncs' ? (
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
                        {parseDbTimestamp(log.created_at).toLocaleString()}
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
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-gray-300" aria-label="Webhook activity">
                <thead className="bg-[#16181b] uppercase text-[10px] tracking-wider text-gray-400 font-semibold border-b border-[#2d3238]">
                  <tr>
                    <th className="py-2.5 px-3">Result</th>
                    <th className="py-2.5 px-3">Time</th>
                    <th className="py-2.5 px-3">Event</th>
                    <th className="py-2.5 px-3">Show</th>
                    <th className="py-2.5 px-3">Account / Player</th>
                    <th className="py-2.5 px-3">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#262b30]">
                  {webhookEvents.map((ev) => (
                    <tr key={ev.id} className="hover:bg-[#22272d]">
                      <td className="py-2.5 px-3 whitespace-nowrap">{renderOutcome(ev.outcome)}</td>
                      <td className="py-2.5 px-3 font-mono text-gray-400 whitespace-nowrap">
                        {parseDbTimestamp(ev.received_at).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#282d33] text-gray-300 border border-[#373e47]">
                          {ev.event || '—'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-medium text-white max-w-[10rem] truncate" title={ev.show_title || ''}>
                        {ev.show_title || '—'}
                      </td>
                      <td className="py-2.5 px-3 text-gray-400 max-w-[10rem] truncate" title={[ev.account, ev.player].filter(Boolean).join(' / ')}>
                        {[ev.account, ev.player].filter(Boolean).join(' / ') || '—'}
                      </td>
                      <td className="py-2.5 px-3 text-gray-300 max-w-xs truncate" title={ev.detail || ''}>
                        {ev.detail || ''}
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
            onClick={loadActiveTab}
            disabled={loading}
            className="flex items-center space-x-1.5 text-xs text-gray-300 hover:text-white bg-[#252a30] hover:bg-[#313740] px-3.5 py-2 rounded-lg border border-[#3a414b] transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleClear}
              disabled={isEmpty}
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
