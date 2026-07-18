import { useRef, useMemo } from 'react';

interface HighlightedInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  multiline?: boolean;
  minHeight?: string;
  spellCheck?: boolean;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onMouseUp?: (e: React.MouseEvent) => void;
  onBlur?: () => void;
  inputRef?: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  /** Callback for cursor position tracking (for autocomplete) */
  onCursorMove?: (value: string, cursorPos: number) => void;
}

function highlightVariables(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  const regex = /\{\{(\$?\w+)\}\}/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Text before match
    if (match.index > lastIdx) {
      parts.push(<span key={`t-${lastIdx}`}>{text.slice(lastIdx, match.index)}</span>);
    }
    // The variable match
    parts.push(
      <span
        key={`v-${match.index}`}
        style={{
          background: 'rgba(86, 156, 214, 0.2)',
          color: 'var(--vscode-textLink-foreground)',
          borderRadius: '2px',
          padding: '0 1px',
          fontWeight: 500,
        }}
        title={`Variable: ${match[1]}`}
      >
        {match[0]}
      </span>
    );
    lastIdx = match.index + match[0].length;
  }

  // Remaining text
  if (lastIdx < text.length) {
    parts.push(<span key={`t-${lastIdx}`}>{text.slice(lastIdx)}</span>);
  }

  return parts;
}

export function HighlightedInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  multiline,
  minHeight,
  spellCheck,
  onKeyDown,
  onMouseUp,
  onBlur,
  inputRef: externalRef,
  onCursorMove,
}: HighlightedInputProps) {
  const internalRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const activeRef = externalRef || internalRef;
  const mirrorRef = useRef<HTMLDivElement>(null);

  const highlighted = useMemo(() => highlightVariables(value), [value]);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    onChange(e.target.value);

    // Sync scroll position between input/textarea and mirror
    if (mirrorRef.current) {
      mirrorRef.current.scrollTop = e.target.scrollTop;
      mirrorRef.current.scrollLeft = e.target.scrollLeft;
    }
  };

  const handleSelect = () => {
    const el = activeRef.current;
    if (el && onCursorMove) {
      onCursorMove(value, el.selectionStart ?? 0);
    }
  };

  const commonStyle: React.CSSProperties = {
    width: '100%',
    padding: '4px 8px',
    fontFamily: 'var(--vscode-editor-font-family)',
    fontSize: '12px',
    lineHeight: '1.4',
    border: '1px solid var(--vscode-input-border)',
    borderRadius: '2px',
    outline: 'none',
    resize: multiline ? 'vertical' : 'none',
    overflow: 'auto',
    whiteSpace: multiline ? 'pre-wrap' : 'nowrap',
    wordBreak: 'break-all',
    minHeight: minHeight || 'auto',
  };

  if (multiline) {
    return (
      <div style={{ position: 'relative', width: '100%' }}>
        {/* Mirror layer */}
        <div
          ref={mirrorRef}
          style={{
            ...commonStyle,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            color: 'var(--vscode-editor-foreground)',
            background: 'transparent',
            borderColor: 'transparent',
            pointerEvents: 'none',
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
            wordWrap: 'break-word',
          }}
          aria-hidden
        >
          {highlighted.length > 0 ? highlighted : <span style={{ opacity: 0.4 }}>{placeholder}</span>}
        </div>

        {/* Actual textarea (transparent text) */}
        <textarea
          aria-label={ariaLabel}
          ref={activeRef as React.RefObject<HTMLTextAreaElement>}
          value={value}
          onChange={handleInput}
          onKeyDown={onKeyDown}
          onMouseUp={(e) => { onMouseUp?.(e); handleSelect(); }}
          onKeyUp={handleSelect}
          onBlur={onBlur}
          onClick={handleSelect}
          spellCheck={spellCheck ?? false}
          style={{
            ...commonStyle,
            position: 'relative',
            zIndex: 1,
            color: 'transparent',
            caretColor: 'var(--vscode-editor-foreground)',
            background: 'transparent',
          }}
        />
      </div>
    );
  }

  // Single-line input
  const handleScroll = (e: React.UIEvent<HTMLInputElement>) => {
    if (mirrorRef.current) {
      mirrorRef.current.scrollTop = e.currentTarget.scrollTop;
      mirrorRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {/* Mirror */}
      <div
        ref={mirrorRef}
        style={{
          ...commonStyle,
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          color: 'var(--vscode-editor-foreground)',
          background: 'transparent',
          borderColor: 'transparent',
          pointerEvents: 'none',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          wordBreak: 'normal',
        }}
        aria-hidden
      >
        {highlighted.length > 0 ? highlighted : <span style={{ opacity: 0.4 }}>{placeholder}</span>}
      </div>

      {/* Actual input */}
      <input
        aria-label={ariaLabel}
        ref={activeRef as React.RefObject<HTMLInputElement>}
        type="text"
        value={value}
        onChange={handleInput}
        onScroll={handleScroll}
        onKeyDown={onKeyDown}
        onMouseUp={(e) => { onMouseUp?.(e); handleSelect(); }}
        onKeyUp={handleSelect}
        onBlur={onBlur}
        onClick={handleSelect}
        spellCheck={spellCheck ?? false}
        style={{
          ...commonStyle,
          position: 'relative',
          zIndex: 1,
          color: 'transparent',
          caretColor: 'var(--vscode-editor-foreground)',
          background: 'transparent',
          overflow: 'auto',
          whiteSpace: 'nowrap',
          wordBreak: 'normal',
        }}
      />
    </div>
  );
}
