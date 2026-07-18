import { useEffect, useState } from 'react';
import { useHistoryStore } from '../stores/useHistoryStore';
import { postMessage } from '../utils/vscodeApi';
import type { HistoryEntry } from '../../../src/models/HistoryEntry';

interface HistoryPanelProps {
  onNotification: (text: string, type?: 'info' | 'error' | 'success') => void;
  onReplay: (entry: HistoryEntry) => void;
  onAcknowledge: (operationId: string, message: string) => void;
}

export function HistoryPanel({ onNotification, onReplay, onAcknowledge }: HistoryPanelProps) {
  const entries = useHistoryStore((s) => s.entries);
  const filterText = useHistoryStore((s) => s.filterText);
  const setFilterText = useHistoryStore((s) => s.setFilterText);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    postMessage({ type: 'getHistory' });
  }, []);

  const handleClear = () => {
    const operation = postMessage({ type: 'clearHistory' });
    onAcknowledge(operation.operationId, 'History cleared');
    setConfirmClear(false);
  };

  const handleReplay = (entry: typeof entries[0]) => {
    onReplay(entry);
  };

  const handleDelete = (entryId: string) => {
    const operation = postMessage({ type: 'deleteHistoryEntry', entryId });
    onAcknowledge(operation.operationId, 'History entry deleted');
  };

  const filteredEntries = filterText
    ? entries.filter(e => {
        const lower = filterText.toLowerCase();
        return (
          e.url.toLowerCase().includes(lower) ||
          e.method.toLowerCase().includes(lower) ||
          e.statusCode.toString().includes(lower)
        );
      })
    : entries;

  return (
    <div style={{ padding: '8px' }}>
      <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
        <input
          aria-label="Filter request history"
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setFilterText('');
            }
          }}
          placeholder="Filter history..."
          style={{
            flex: 1,
            padding: '4px 6px',
            background: 'var(--vscode-input-background)',
            color: 'var(--vscode-input-foreground)',
            border: '1px solid var(--vscode-input-border)',
            fontSize: '11px',
          }}
        />
        {confirmClear ? (
          <div role="group" aria-label="Confirm clearing history" style={{ display: 'flex', gap: '4px' }}>
            <button type="button" onClick={handleClear}>Clear all</button>
            <button type="button" onClick={() => setConfirmClear(false)}>Cancel</button>
          </div>
        ) : <button
          onClick={() => {
            if (entries.length === 0) {
              onNotification('History is already empty', 'info');
              return;
            }
            setConfirmClear(true);
          }}
          style={{
            padding: '4px 8px',
            background: 'none',
            color: 'var(--vscode-errorForeground)',
            border: '1px solid var(--vscode-errorForeground)',
            cursor: 'pointer',
            fontSize: '10px',
          }}
          disabled={entries.length === 0}
        >
          Clear
        </button>}
      </div>

      {filteredEntries.length === 0 && (
        <div style={{ color: 'var(--vscode-descriptionForeground)', fontSize: '11px', textAlign: 'center', padding: '16px' }}>
          {entries.length === 0
            ? 'No history yet. Execute requests to see them here.'
            : `No history entries match “${filterText}”.`}
        </div>
      )}

      {filteredEntries.map((entry) => (
        <div
          key={entry.id}
          style={{
            display: 'flex',
            gap: '6px',
            alignItems: 'center',
            padding: '6px 4px',
            borderBottom: '1px solid var(--vscode-panel-border)',
          }}
        >
          <span style={{
            fontSize: '10px',
            fontWeight: 700,
            padding: '1px 4px',
            borderRadius: '2px',
            background: entry.statusCode >= 200 && entry.statusCode < 300 ? '#49cc90' : entry.statusCode >= 400 ? '#f93e3e' : '#fca130',
            color: '#fff',
            minWidth: '36px',
            textAlign: 'center',
          }}>
            {entry.method}
          </span>

          <button
            type="button"
            onClick={() => handleReplay(entry)}
            aria-label={`Replay ${entry.method} ${entry.url}`}
            style={{
              flex: 1,
              overflow: 'hidden',
              border: 'none',
              background: 'transparent',
              color: 'inherit',
              textAlign: 'left',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <div style={{ fontSize: '10px', color: 'var(--vscode-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {entry.url}
            </div>
            <div style={{ fontSize: '9px', color: 'var(--vscode-descriptionForeground)' }}>
              {new Date(entry.timestamp).toLocaleString()} · {entry.duration.toFixed(0)}ms · {entry.statusCode}
            </div>
          </button>

          <button
            onClick={(e) => { e.stopPropagation(); handleDelete(entry.id); }}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--vscode-descriptionForeground)',
              cursor: 'pointer',
              fontSize: '12px',
              padding: '2px',
              flexShrink: 0,
            }}
            title="Delete"
            aria-label={`Delete history entry ${entry.method} ${entry.url}`}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
