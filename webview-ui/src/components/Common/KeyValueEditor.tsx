import { KeyValuePair } from '../../../../src/models/KeyValuePair';
import { HighlightedInput } from './HighlightedInput';

interface KeyValueEditorProps {
  pairs: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
  namePlaceholder?: string;
  valuePlaceholder?: string;
  readOnly?: boolean;
  showVariables?: boolean;
}

export function KeyValueEditor({ pairs, onChange, namePlaceholder = 'Key', valuePlaceholder = 'Value', readOnly, showVariables }: KeyValueEditorProps) {
  const addRow = () => {
    onChange([...pairs, { id: crypto.randomUUID(), key: '', value: '', enabled: true }]);
  };

  const updateRow = (id: string, field: 'key' | 'value', val: string) => {
    onChange(pairs.map(p => p.id === id ? { ...p, [field]: val } : p));
  };

  const toggleRow = (id: string) => {
    onChange(pairs.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p));
  };

  const removeRow = (id: string) => {
    onChange(pairs.filter(p => p.id !== id));
  };

  return (
    <div style={{ width: '100%' }}>
      {pairs.map((pair, idx) => (
        <div key={pair.id} style={{ display: 'flex', gap: '4px', marginBottom: '4px', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={pair.enabled}
            onChange={() => toggleRow(pair.id)}
            style={{ margin: 0, flexShrink: 0 }}
            disabled={readOnly}
          />
          <input
            type="text"
            value={pair.key}
            onChange={(e) => updateRow(pair.id, 'key', e.target.value)}
            placeholder={namePlaceholder}
            readOnly={readOnly}
            style={{
              flex: 1,
              padding: '3px 6px',
              background: 'var(--vscode-input-background)',
              color: 'var(--vscode-input-foreground)',
              border: '1px solid var(--vscode-input-border)',
              fontSize: '12px',
              fontFamily: 'var(--vscode-font-family)',
            }}
          />
          {showVariables ? (
            <div style={{ flex: 2 }}>
              <HighlightedInput
                value={pair.value}
                onChange={(v) => updateRow(pair.id, 'value', v)}
                placeholder={valuePlaceholder}
                inputRef={undefined}
              />
            </div>
          ) : (
            <input
              type="text"
              value={pair.value}
              onChange={(e) => updateRow(pair.id, 'value', e.target.value)}
              placeholder={valuePlaceholder}
              readOnly={readOnly}
              style={{
                flex: 2,
                padding: '3px 6px',
                background: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
                fontSize: '12px',
                fontFamily: 'var(--vscode-font-family)',
              }}
            />
          )}
          {!readOnly && (
            <button
              onClick={() => removeRow(pair.id)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--vscode-errorForeground)',
                cursor: 'pointer',
                padding: '2px 4px',
                fontSize: '14px',
                lineHeight: 1,
                flexShrink: 0,
              }}
              title="Remove"
            >
              ×
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button
          onClick={addRow}
          style={{
            background: 'none',
            border: '1px dashed var(--vscode-input-border)',
            color: 'var(--vscode-textLink-foreground)',
            cursor: 'pointer',
            padding: '4px 8px',
            fontSize: '11px',
            width: '100%',
            marginTop: '2px',
          }}
        >
          + Add
        </button>
      )}
    </div>
  );
}
