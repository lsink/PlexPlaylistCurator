import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Server,
  Clock,
  Radio,
  CheckCircle2,
  AlertCircle,
  Copy,
  Shield,
  HelpCircle,
  Download,
  Upload,
} from 'lucide-react';
import { SettingsData } from '../types';
import { api } from '../api/client';
import { useModalA11y } from '../hooks/useModalA11y';

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
  const dialogRef = useRef<HTMLDivElement>(null);
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
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [hasWebhookSecret, setHasWebhookSecret] = useState(false);
  const [webhookSecretInput, setWebhookSecretInput] = useState('');
  const [clearWebhookSecret, setClearWebhookSecret] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [backupMessage, setBackupMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setSettingsLoaded(false);
    setTestResult(null);
    setSaveSuccess(false);
    setError(null);
    setBackupMessage(null);
    setWebhookSecretInput('');
    setClearWebhookSecret(false);
    setRevealedSecret(null);
    loadSettings(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const loadSettings = async (isCancelled: () => boolean) => {
    try {
      const data = await api.getSettings();
      if (isCancelled()) return;
      setAppVersion(data.appVersion || '1.0.0');
      setPlexUrl(data.plexUrl || '');
      setMaskedToken(data.plexTokenMasked || '');
      setHasToken(data.hasToken);
      setHasWebhookSecret(Boolean(data.hasWebhookSecret));
      setAutoSyncInterval(data.autoSyncIntervalMinutes ?? 30);
      setSettingsLoaded(true);
    } catch (err: any) {
      if (!isCancelled()) setError(err.message || 'Failed to load settings');
    }
  };

  const handleExport = async () => {
    setBackupMessage(null);
    try {
      const data = await api.exportPlaylists();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `plex-playlist-curator-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupMessage({ text: `Exported ${data.playlists.length} playlist(s).`, ok: true });
    } catch (err: any) {
      setBackupMessage({ text: err.message || 'Export failed', ok: false });
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBackupMessage(null);
    try {
      const parsed = JSON.parse(await file.text());
      const res = await api.importPlaylists(parsed);
      setBackupMessage({ text: `Imported ${res.imported} playlist(s). They were added alongside your existing ones.`, ok: true });
      onSaved();
    } catch (err: any) {
      setBackupMessage({ text: err.message || 'Import failed — is this a valid backup file?', ok: false });
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
        // undefined = keep the current secret; '' = remove it
        webhookSecret: webhookSecretInput.trim() ? webhookSecretInput.trim() : clearWebhookSecret ? '' : undefined,
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

  // The secret that will be active after saving: a newly typed one, otherwise the revealed existing one
  const effectiveSecret = webhookSecretInput.trim() || (clearWebhookSecret ? '' : revealedSecret || '');
  const webhookBaseUrl = `${window.location.origin}/api/webhook/plex`;
  // The secret goes in the path, not a query string: Plex strips query strings from webhook URLs
  const webhookUrl = effectiveSecret ? `${webhookBaseUrl}/${effectiveSecret}` : webhookBaseUrl;
  const secretPending = hasWebhookSecret && !clearWebhookSecret && !webhookSecretInput.trim() && revealedSecret === null;

  const generateWebhookSecret = () => {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    setWebhookSecretInput(Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''));
    setClearWebhookSecret(false);
  };

  const revealWebhookSecret = async () => {
    try {
      const res = await api.getWebhookSecret();
      setRevealedSecret(res.secret);
    } catch (err: any) {
      setError(err.message || 'Failed to load webhook secret');
    }
  };

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

  useModalA11y(dialogRef, isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm animate-fade-in"
    >
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
        <div className="flex-1 overflow-y-auto p-6 space-y-6" aria-busy={!settingsLoaded}>
          {!settingsLoaded && !error && (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
              <span>Loading current settings...</span>
            </div>
          )}
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

            {secretPending && (
              <p className="text-[11px] text-amber-300/90">
                A secret is set, so Plex needs the URL that ends with it (<code className="font-mono">/plex/&lt;secret&gt;</code>).{' '}
                <button type="button" onClick={revealWebhookSecret} className="underline hover:text-amber-200 cursor-pointer">
                  Reveal it to copy the full URL
                </button>
              </p>
            )}

            <div>
              <label htmlFor="webhook-secret" className="block text-xs font-semibold text-gray-300 mb-1">
                Webhook secret (optional)
              </label>
              <div className="flex items-center space-x-2">
                <input
                  id="webhook-secret"
                  type="text"
                  value={webhookSecretInput}
                  onChange={(e) => {
                    setWebhookSecretInput(e.target.value);
                    setClearWebhookSecret(false);
                  }}
                  placeholder={
                    clearWebhookSecret
                      ? 'Secret will be removed on save'
                      : hasWebhookSecret
                      ? 'A secret is set — type or generate to replace it'
                      : 'None — anyone on your network can trigger syncs'
                  }
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 bg-[#22262b] border border-[#343b42] text-white font-mono text-xs rounded-lg px-3.5 py-2 focus:outline-none focus:border-amber-500 placeholder-gray-500"
                />
                <button
                  type="button"
                  onClick={generateWebhookSecret}
                  className="px-3 py-2 rounded-lg bg-[#252a30] hover:bg-[#343b44] border border-[#373e47] text-xs font-semibold text-gray-200 cursor-pointer shrink-0"
                >
                  Generate
                </button>
                {hasWebhookSecret && !clearWebhookSecret && (
                  <button
                    type="button"
                    onClick={() => {
                      setClearWebhookSecret(true);
                      setWebhookSecretInput('');
                      setRevealedSecret(null);
                    }}
                    className="px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-xs font-semibold text-red-400 cursor-pointer shrink-0"
                  >
                    Remove
                  </button>
                )}
              </div>
              <p className="text-[11px] text-gray-500 mt-1">
                8–128 letters, numbers, <code className="font-mono">-</code> or <code className="font-mono">_</code>. Save, then paste the full URL above (it ends with the secret) into Plex, replacing any older webhook entry.
              </p>
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

          {/* Section: Backup & Restore */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
              <Download className="w-4 h-4" />
              <span>Backup &amp; Restore Playlists</span>
            </h3>
            <p className="text-[11px] text-gray-500">
              Export your playlist configurations to a JSON file, or import them into this (or another) install. Imports are added as new playlists and are not synced until you sync them.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleExport}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#252a30] hover:bg-[#313740] border border-[#3a414b] text-xs text-gray-200 font-semibold cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export playlists</span>
              </button>
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#252a30] hover:bg-[#313740] border border-[#3a414b] text-xs text-gray-200 font-semibold cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Import playlists</span>
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleImportFile}
                className="hidden"
                aria-label="Import playlists JSON file"
              />
            </div>
            {backupMessage && (
              <p className={`text-xs ${backupMessage.ok ? 'text-emerald-400' : 'text-red-400'}`}>{backupMessage.text}</p>
            )}
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
            disabled={saving || !settingsLoaded}
            className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-sm font-semibold text-black transition-colors shadow-md shadow-amber-500/10 cursor-pointer"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
};
