import type { ButtonHTMLAttributes } from 'react';

export function LocalButton({ primary = false, style, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return <button {...props} style={{ padding: '4px 8px', fontSize: '11px', border: '1px solid var(--vscode-panel-border)', borderRadius: '2px',
    background: primary ? 'var(--vscode-button-background)' : 'var(--vscode-button-secondaryBackground)',
    color: primary ? 'var(--vscode-button-foreground)' : 'var(--vscode-button-secondaryForeground)',
    cursor: props.disabled ? 'default' : 'pointer', opacity: props.disabled ? 0.55 : 1, ...style }} />;
}
