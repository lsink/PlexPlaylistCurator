import { useEffect, RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open modals, topmost last — only the topmost reacts to Escape / Tab
const modalStack: HTMLElement[] = [];

/**
 * Focus trap + Escape-to-close + focus restore for modal dialogs.
 * Attach `ref` to the dialog overlay element (with role="dialog" aria-modal="true").
 */
export function useModalA11y(ref: RefObject<HTMLElement | null>, isOpen: boolean, onClose?: () => void) {
  useEffect(() => {
    const node = ref.current;
    if (!isOpen || !node) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    modalStack.push(node);

    if (!node.contains(document.activeElement)) {
      const first = node.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? node).focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== node) return;

      if (e.key === 'Escape' && onClose) {
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) {
          e.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || !node.contains(document.activeElement))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !node.contains(document.activeElement))) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const idx = modalStack.indexOf(node);
      if (idx !== -1) modalStack.splice(idx, 1);
      previouslyFocused?.focus?.();
    };
    // Re-run only when the modal opens or closes; onClose is read at event time via closure of that render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
}
