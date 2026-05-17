import { SearchResult } from '../../../../src/models/MessageProtocol';

interface SearchResultsProps {
  results: SearchResult[];
  onClose: () => void;
  onSelect: (result: SearchResult) => void;
}

export function SearchResults({ results, onClose, onSelect }: SearchResultsProps) {
  if (results.length === 0) return null;

  return (
    <div style={{
      position: 'absolute',
      top: 36,
      left: 0,
      right: 0,
      zIndex: 99,
      background: 'var(--vscode-dropdown-background)',
      border: '1px solid var(--vscode-focusBorder)',
      borderTop: 'none',
      maxHeight: '200px',
      overflow: 'auto',
      boxShadow: '0 4px 8px rgba(0,0,0,0.15)',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '4px 8px',
        fontSize: '10px',
        color: 'var(--vscode-descriptionForeground)',
        borderBottom: '1px solid var(--vscode-panel-border)',
      }}>
        <span>{results.length} result{results.length > 1 ? 's' : ''}</span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--vscode-descriptionForeground)',
            cursor: 'pointer',
            fontSize: '12px',
            padding: '2px 4px',
          }}
          aria-label="Close search results"
        >
          ×
        </button>
      </div>
      {results.map((r, i) => (
        <div
          key={`${r.id}-${i}`}
          onClick={() => onSelect(r)}
          className="search-result-item"
          style={{
            padding: '6px 8px',
            fontSize: '11px',
            cursor: 'pointer',
            borderBottom: '1px solid var(--vscode-panel-border)',
            display: 'flex',
            gap: '6px',
            alignItems: 'center',
          }}
        >
          <span style={{
            fontSize: '9px',
            fontWeight: 600,
            padding: '1px 4px',
            borderRadius: '2px',
            background: r.type === 'collection' ? 'var(--vscode-textLink-foreground)'
              : r.type === 'folder' ? 'var(--vscode-descriptionForeground)'
              : 'var(--vscode-testing-iconPassedForeground)',
            color: '#fff',
            textTransform: 'uppercase',
          }}>
            {r.type === 'collection' ? 'COL' : r.type === 'folder' ? 'DIR' : 'REQ'}
          </span>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
            {r.url && <div style={{ fontSize: '9px', color: 'var(--vscode-descriptionForeground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.url}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
