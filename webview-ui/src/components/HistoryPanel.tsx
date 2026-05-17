import { useEffect } from 'react';
import { useHistoryStore } from '../stores/useHistoryStore';
import { useRequestStore } from '../stores/useRequestStore';
import { postMessage } from '../utils/vscodeApi';

export function HistoryPanel() {
  const entries = useHistoryStore((s) => s.entries);
  const filterText = useHistoryStore((s) => s.filterText);
  const setFilterText = useHistoryStore((s) => s.setFilterText);
  const setRequest = useRequestStore((s) => s.setRequest);

  useEffect(() => {
    postMessage({ type: 'getHistory' });
  }, []);

  const handleClear = () => {
    postMessage({ type: 'clearHistory' });
  };

  const handleReplay = (entry: typeof entries[0]) => {
    setRequest(entry.request);
  };

  const handleDelete = (entryId: string) => {
    postMessage({ type: 'deleteHistoryEntry', entryId });
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
        <button
          onClick={handleClear}
          style={{
            padding: '4px 8px',
            background: 'none',
            color: 'var(--vscode-errorForeground)',
            border: '1px solid var(--vscode-errorForeground)',
            cursor: 'pointer',
            fontSize: '10px',
          }}
        >
          Clear
        </button>
      </div>

      {filteredEntries.length === 0 && (
        <div style={{ color: 'var(--vscode-descriptionForeground)', fontSize: '11px', textAlign: 'center', padding: '16px' }}>
          No history yet. Execute requests to see them here.
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
            cursor: 'pointer',
          }}
          onClick={() => handleReplay(entry)}
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

          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ fontSize: '10px', color: 'var(--vscode-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {entry.url}
            </div>
            <div style={{ fontSize: '9px', color: 'var(--vscode-descriptionForeground)' }}>
              {new Date(entry.timestamp).toLocaleString()} · {entry.duration.toFixed(0)}ms · {entry.statusCode}
            </div>
          </div>

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
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
