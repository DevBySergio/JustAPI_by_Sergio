import { useRef, useCallback } from 'react';
import { HttpMethod } from '../../../../src/models/Request';
import { VariableAutocomplete } from '../Common/VariableAutocomplete';
import { HighlightedInput } from '../Common/HighlightedInput';

interface UrlBarProps {
  url: string;
  method: HttpMethod;
  onUrlChange: (url: string) => void;
  onMethodChange: (method: HttpMethod) => void;
}

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: '#61affe',
  POST: '#49cc90',
  PUT: '#fca130',
  PATCH: '#50e3c2',
  DELETE: '#f93e3e',
  OPTIONS: '#0d5aa7',
  HEAD: '#9012fe',
};

export function UrlBar({ url, method, onUrlChange, onMethodChange }: UrlBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{ display: 'flex', gap: '4px' }}>
      <select
        aria-label="HTTP method"
        value={method}
        onChange={(e) => onMethodChange(e.target.value as HttpMethod)}
        style={{
          padding: '4px 6px',
          background: METHOD_COLORS[method],
          color: '#fff',
          border: 'none',
          fontWeight: 700,
          fontSize: '11px',
          cursor: 'pointer',
          borderRadius: '2px',
          minWidth: '70px',
        }}
      >
        {METHODS.map((m) => (
          <option key={m} value={m} style={{ background: '#fff', color: '#000' }}>{m}</option>
        ))}
      </select>

      <div style={{ flex: 1, position: 'relative' }}>
        <VariableAutocomplete value={url} onChange={onUrlChange}>
          {({ onInput, onKeyDown, onBlur }) => (
            <HighlightedInput
              ariaLabel="Request URL"
              value={url}
              onChange={(v) => {
                onUrlChange(v);
                // cursor position is tracked via onCursorMove
              }}
              placeholder="https://api.example.com/endpoint"
              inputRef={inputRef}
              onCursorMove={(v, pos) => onInput(v, pos)}
              onKeyDown={onKeyDown}
              onBlur={onBlur}
            />
          )}
        </VariableAutocomplete>
      </div>
    </div>
  );
}
