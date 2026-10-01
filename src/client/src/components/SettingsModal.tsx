import React, { useState, useEffect } from 'react';
import {
  X,
  Server,
  Key,
  Clock,
  Radio,
  CheckCircle2,
  AlertCircle,
  Copy,
  ExternalLink,
  Shield,
  HelpCircle,
} from 'lucide-react';
import { SettingsData } from '../types';
import { api } from '../api/client';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onSaved,
}) => {
  const [plexUrl, setPlexUrl] = useState('');
  const [plexToken, setPlexToken] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [maskedToken, setMaskedToken] = useState('');
  const [autoSyncInterval, setAutoSyncInterval] = useState(30);
  const [newPassword, setNewPassword] = useState('');
  const [appVersion, setAppVersion] = useState('1.0.0');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    info?: any;
    libraries?: any[];
    error?: string;
  } | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
      setTestResult(null);
      setSaveSuccess(false);
      setError(null);
    }
  }, [isOpen]);

  const loadSettings = async () => {
    try {
      const data = await api.getSettings();
      setAppVersion(data.appVersion || '1.0.0');
      setPlexUrl(data.plexUrl || 'http://192.168.1.100:32400');
      setMaskedToken(data.plexTokenMasked || '');
      setHasToken(data.hasToken);
      setAutoSyncInterval(data.autoSyncIntervalMinutes ?? 30);
    } catch (err: any) {
      setError(err.message || 'Failed to load settings');
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testConnection(plexUrl, plexToken);
      setTestResult({
        success: true,
        info: res.info,
        libraries: res.libraries,
      });
    } catch (err: any) {
      setTestResult({
        success: false,
        error: err.message || 'Connection failed',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.saveSettings({
        plexUrl,
        plexToken: plexToken.trim() ? plexToken.trim() : undefined,
        autoSyncIntervalMinutes: Number(autoSyncInterval),
      });

      if (newPassword.trim()) {
        await api.setupAuth(newPassword.trim());
      }

      setSaveSuccess(true);
      onSaved();
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err: any) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const webhookUrl = `${window.location.origin}/api/webhook/plex`;

  const copyToClipboard = async (text: string) => {
    let copied = false;

    // Try modern Async Clipboard API first (works in HTTPS / localhost)
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        copied = false;
      }
    }

    // Fallback for non-secure contexts (e.g. HTTP on local LAN IP like http://192.168.x.x)
    if (!copied) {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.top = '-9999px';
        textArea.style.left = '-9999px';
        textArea.setAttribute('readonly', '');
        document.body.appendChild(textArea);
        textArea.select();
        textArea.setSelectionRange(0, 99999);
        copied = document.execCommand('copy');
        document.body.removeChild(textArea);
      } catch (e) {
        console.error('Failed to copy to clipboard', e);
      }
    }

    if (copied) {
      setCopiedWebhook(true);
      setTimeout(() => setCopiedWebhook(false), 2000);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#1b1e22] border border-[#2e343b] rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#2e343b] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Server className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-bold text-white">Settings & Plex Connection</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-[#282d33] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              {error}
            </div>
          )}

          {saveSuccess && (
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>Settings saved successfully!</span>
            </div>
          )}

          {/* Section 1: Plex Server Connection */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
              <Server className="w-4 h-4" />
              <span>Plex Media Server</span>
            </h3>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">
                Plex Server IP / URL
              </label>
              <input
                type="text"
                value={plexUrl}
                onChange={(e) => setPlexUrl(e.target.value)}
                placeholder="http://192.168.1.100:32400"
                className="w-full bg-[#22262b] border border-[#343b42] text-white rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:border-amber-500 font-mono"
              />
              <p className="text-[11px] text-gray-500 mt-1">
                IP and port of your Plex Media Server (e.g. <code className="text-gray-400">http://192.168.1.50:32400</code>).
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-gray-300">
                  Plex Authentication Token (X-Plex-Token)
                </label>
                <a
                  href="https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-amber-400/80 hover:text-amber-400 flex items-center gap-1"
                >
                  <HelpCircle className="w-3 h-3" />
                  <span>How to find your token</span>
                </a>
              </div>
              <input
                type="password"
                value={plexToken}
                onChange={(e) => setPlexToken(e.target.value)}
                placeholder={hasToken ? `Configured (${maskedToken}) - leave blank to keep` : 'Enter X-Plex-Token'}
                className="w-full bg-[#22262b] border border-[#343b42] text-white rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:border-amber-500 font-mono placeholder-gray-500"
              />
            </div>

            {/* Test Connection Button & Result */}
            <div>
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testing}
                className="flex items-center space-x-2 bg-[#2a3036] hover:bg-[#343b43] text-gray-200 text-xs font-semibold px-4 py-2 rounded-lg border border-[#3e4650] transition-colors cursor-pointer"
              >
                <span>{testing ? 'Testing Connection...' : 'Test Plex Connection'}</span>
              </button>

              {testResult && (
                <div
                  className={`mt-3 p-3.5 rounded-xl border text-xs ${
                    testResult.success
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-red-500/10 border-red-500/30 text-red-300'
                  }`}
                >
                  {testResult.success ? (
                    <div>
                      <p className="font-bold flex items-center gap-1.5 text-sm">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        Connected to {testResult.info?.friendlyName || 'Plex'}!
                      </p>
                      <p className="mt-1 text-gray-300">
                        Version: <span className="font-mono">{testResult.info?.version}</span> • Platform:{' '}
                        {testResult.info?.platform}
                      </p>
                      {testResult.libraries && (
                        <p className="mt-1 text-gray-400">
                          Detected {testResult.libraries.length} TV libraries:{' '}
                          {testResult.libraries.map((l: any) => l.title).join(', ')}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                      <span>{testResult.error}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <hr className="border-[#2b3036]" />

          {/* Section 2: Automation & Sync Schedule */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              <span>Automated Background Sync</span>
            </h3>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">
                Periodic Sync Interval
              </label>
              <select
                value={autoSyncInterval}
                onChange={(e) => setAutoSyncInterval(Number(e.target.value))}
                className="w-full sm:w-64 bg-[#22262b] border border-[#343b42] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
              >
                <option value={0}>Disabled (Manual / Webhook Only)</option>
                <option value={15}>Every 15 minutes</option>
                <option value={30}>Every 30 minutes (Default)</option>
                <option value={60}>Every 1 hour</option>
                <option value={180}>Every 3 hours</option>
                <option value={360}>Every 6 hours</option>
              </select>
              <p className="text-[11px] text-gray-500 mt-1">
                Background cron job periodically checks for watched episodes and rotates playlists.
              </p>
            </div>
          </div>

          <hr className="border-[#2b3036]" />

          {/* Section 3: Plex Webhook Setup */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
              <Radio className="w-4 h-4" />
              <span>Real-Time Webhook (Instant Sync)</span>
            </h3>

            <p className="text-xs text-gray-400 leading-relaxed">
              If you have Plex Pass, add this Webhook URL into your Plex Settings (Settings &rarr; Webhooks &rarr; Add Webhook). Whenever an episode finishes playing (<code className="text-amber-300">media.scrobble</code>), this app instantly updates and advances your playlist!
            </p>

            <div className="flex items-center space-x-2">
              <input
                type="text"
                readOnly
                value={webhookUrl}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                className="flex-1 bg-[#16181b] border border-[#2d3238] text-gray-300 text-xs font-mono rounded-lg px-3 py-2 select-all focus:outline-none focus:border-amber-500 cursor-pointer"
                title="Click to select all"
              />
              <button
                type="button"
                onClick={() => copyToClipboard(webhookUrl)}
                className={`flex items-center space-x-1.5 px-3 py-2 rounded-lg border transition-colors cursor-pointer shrink-0 text-xs font-semibold ${
                  copiedWebhook
                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                    : 'bg-[#252a30] hover:bg-[#343b44] text-gray-200 border-[#373e47]'
                }`}
              >
                {copiedWebhook ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <hr className="border-[#2b3036]" />

          {/* Section 4: Security Password */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
              <Shield className="w-4 h-4" />
              <span>Security & App Password</span>
            </h3>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">
                Set / Change Admin Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Leave blank to keep current password"
                className="w-full bg-[#22262b] border border-[#343b42] text-white rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:border-amber-500 placeholder-gray-500"
              />
              <p className="text-[11px] text-gray-500 mt-1">
                Minimum 8 characters. Protects your dashboard on your local network.
              </p>
            </div>
          </div>

          <hr className="border-[#2b3036]" />

          {/* Section 5: Version & In-Container Updates */}
          <div className="bg-[#16181b] p-4 rounded-xl border border-[#2d3238] space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400">
                  Application Version
                </h4>
                <p className="text-xs text-gray-300 mt-0.5">
                  Currently installed: <span className="font-mono font-bold text-white bg-[#22262b] px-2 py-0.5 rounded border border-[#343b42]">v{appVersion}</span>
                </p>
              </div>
            </div>
            <p className="text-[11px] text-gray-400 leading-relaxed">
              To update this app inside your Proxmox container, simply run <code className="text-amber-300 font-mono">update</code> or <code className="text-amber-300 font-mono">plex-update</code> in your container console.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#2e343b] bg-[#16181b] flex items-center justify-end space-x-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#272d33] hover:bg-[#343b44] text-sm text-gray-300 font-medium transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-sm font-semibold text-black transition-colors shadow-md shadow-amber-500/10 cursor-pointer"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
};
