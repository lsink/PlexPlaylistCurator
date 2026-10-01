import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useModalA11y } from '../hooks/useModalA11y';

export interface ConfirmOptions {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Optional third choice (e.g. "Delete from app only") */
  secondaryLabel?: string;
  /** Hide the cancel button — used for plain notices that replace alert() */
  hideCancel?: boolean;
  destructive?: boolean;
}

export type ConfirmResult = 'confirm' | 'secondary' | 'cancel';

type ConfirmFn = (options: ConfirmOptions) => Promise<ConfirmResult>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return ctx;
}

interface DialogState extends ConfirmOptions {
  resolve: (result: ConfirmResult) => void;
}

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const dialogStateRef = useRef<DialogState | null>(null);
  dialogStateRef.current = dialog;

  const confirm = useCallback<ConfirmFn>(
    (options) => new Promise<ConfirmResult>((resolve) => setDialog({ ...options, resolve })),
    []
  );

  const close = useCallback((result: ConfirmResult) => {
    dialogStateRef.current?.resolve(result);
    setDialog(null);
  }, []);

  useModalA11y(dialogRef, dialog !== null, () => close('cancel'));

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {dialog && (
        <div
          ref={dialogRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby="confirm-dialog-message"
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
        >
          <div className="bg-[#1b1e22] border border-[#2e343b] rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className={`w-5 h-5 mt-0.5 shrink-0 ${dialog.destructive ? 'text-red-400' : 'text-amber-400'}`} />
              <div className="space-y-1.5">
                <h2 id="confirm-dialog-title" className="text-base font-bold text-white">{dialog.title}</h2>
                <div id="confirm-dialog-message" className="text-sm text-gray-400 whitespace-pre-line">{dialog.message}</div>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {!dialog.hideCancel && (
                <button
                  onClick={() => close('cancel')}
                  className="px-4 py-2 rounded-lg bg-[#272d33] hover:bg-[#343b44] text-sm text-gray-300 font-medium cursor-pointer"
                >
                  {dialog.cancelLabel || 'Cancel'}
                </button>
              )}
              {dialog.secondaryLabel && (
                <button
                  onClick={() => close('secondary')}
                  className="px-4 py-2 rounded-lg bg-[#272d33] hover:bg-[#343b44] border border-[#3a414b] text-sm text-gray-200 font-medium cursor-pointer"
                >
                  {dialog.secondaryLabel}
                </button>
              )}
              <button
                onClick={() => close('confirm')}
                className={`px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer ${
                  dialog.destructive
                    ? 'bg-red-500 hover:bg-red-400 text-white'
                    : 'bg-amber-500 hover:bg-amber-400 text-black'
                }`}
              >
                {dialog.confirmLabel || 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
};
