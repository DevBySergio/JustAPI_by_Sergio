import { useRef } from 'react';
import { SearchResult } from '../../../../src/models/MessageProtocol';
import { nextTabIndex } from '../../../../src/webview/WebviewState';

interface SearchResultsProps {
  results: SearchResult[];
  query: string;
  loading: boolean;
  onClose: () => void;
  onSelect: (result: SearchResult) => void;
}

export function SearchResults({ results, query, loading, onClose, onSelect }: SearchResultsProps) {
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const closeAndRestoreFocus = () => {
    onClose();
    document.getElementById('global-search-input')?.focus();
  };

  return (
    <div
      id="global-search-results"
      role="listbox"
      aria-label={`Search results for ${query}`}
      aria-busy={loading}
      style={{
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
      }}
    >
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '4px 8px',
        fontSize: '10px',
        color: 'var(--vscode-descriptionForeground)',
        borderBottom: '1px solid var(--vscode-panel-border)',
      }}>
        <span>{loading ? 'Searching…' : `${results.length} result${results.length === 1 ? '' : 's'}`}</span>
        <button
          onClick={closeAndRestoreFocus}
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
      {!loading && results.length === 0 && (
        <div role="status" style={{ padding: '12px 8px', fontSize: '11px', color: 'var(--vscode-descriptionForeground)' }}>
          No requests, collections, or history entries match “{query}”.
        </div>
      )}
      {results.map((r, i) => (
        <button
          type="button"
          role="option"
          aria-selected="false"
          key={`${r.id}-${i}`}
          ref={(element) => { resultRefs.current[i] = element; }}
          onClick={() => onSelect(r)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              closeAndRestoreFocus();
              return;
            }
            const nextIndex = nextTabIndex(i, event.key, results.length);
            if (nextIndex !== null) {
              event.preventDefault();
              resultRefs.current[nextIndex]?.focus();
            }
          }}
          className="search-result-item"
          style={{
            padding: '6px 8px',
            fontSize: '11px',
            cursor: 'pointer',
            borderBottom: '1px solid var(--vscode-panel-border)',
            display: 'flex',
            width: '100%',
            textAlign: 'left',
            border: 'none',
            background: 'transparent',
            color: 'var(--vscode-foreground)',
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
              : r.type === 'history' ? 'var(--vscode-charts-purple)'
              : 'var(--vscode-testing-iconPassedForeground)',
            color: '#fff',
            textTransform: 'uppercase',
          }}>
            {r.type === 'collection' ? 'COL' : r.type === 'folder' ? 'DIR' : r.type === 'history' ? 'HIST' : 'REQ'}
          </span>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
            {r.url && <div style={{ fontSize: '9px', color: 'var(--vscode-descriptionForeground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.url}</div>}
          </div>
        </button>
      ))}
    </div>
  );
}
