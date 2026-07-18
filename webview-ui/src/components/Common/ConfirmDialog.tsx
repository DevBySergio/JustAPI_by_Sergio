import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    cancelButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancelRef.current();
      } else if (event.key === 'Tab') {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]'
        ) ?? []);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (first && last && event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (first && last && !event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div
      role="presentation"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 210,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) {
          onCancel();
        }
      }}
    >
      <section
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="discard-dialog-title"
        aria-describedby="discard-dialog-description"
        style={{
          width: 'min(440px, 100%)',
          padding: '16px',
          border: '1px solid var(--vscode-panel-border)',
          borderRadius: '6px',
          background: 'var(--vscode-editor-background)',
          color: 'var(--vscode-foreground)',
          boxShadow: '0 10px 32px rgba(0, 0, 0, 0.4)',
        }}
      >
        <h2 id="discard-dialog-title" style={{ margin: 0, fontSize: '14px' }}>{title}</h2>
        <p id="discard-dialog-description" style={{ margin: '8px 0 16px', fontSize: '12px', lineHeight: 1.5 }}>
          {message}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button ref={cancelButtonRef} type="button" onClick={onCancel}>Keep editing</button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              padding: '4px 10px',
              border: '1px solid transparent',
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
