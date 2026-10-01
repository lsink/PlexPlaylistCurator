import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { SettingsData } from '../types';
import { api } from '../api/client';

interface SettingsContextValue {
  /** null until loaded (or after sign-out / session expiry) */
  settings: SettingsData | null;
  /** null = not checked yet / not applicable */
  plexConnected: boolean | null;
  /** Fetch settings from the server and store them; resolves with the fresh values */
  refreshSettings: () => Promise<SettingsData>;
  /** Drop cached settings (sign-out, session expiry) — also stops the Plex health polling */
  clearSettings: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const HEALTH_POLL_MS = 45000;

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>');
  return ctx;
}

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [plexConnected, setPlexConnected] = useState<boolean | null>(null);

  const refreshSettings = useCallback(async () => {
    const data = await api.getSettings();
    setSettings(data);
    return data;
  }, []);

  const clearSettings = useCallback(() => {
    setSettings(null);
    setPlexConnected(null);
  }, []);

  // Plex connection health: only polls while settings are loaded (i.e. we're signed in) and Plex is configured
  const plexConfigured = Boolean(settings?.isConfigured);
  useEffect(() => {
    if (!plexConfigured) {
      setPlexConnected(null);
      return;
    }
    let cancelled = false;
    const check = async () => {
      try {
        const res = await api.getPlexStatus();
        if (!cancelled) setPlexConnected(res.connected);
      } catch {
        if (!cancelled) setPlexConnected(false);
      }
    };
    check();
    const timer = setInterval(check, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [plexConfigured]);

  const value = useMemo(
    () => ({ settings, plexConnected, refreshSettings, clearSettings }),
    [settings, plexConnected, refreshSettings, clearSettings]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};
