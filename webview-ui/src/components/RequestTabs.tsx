import { useRef } from 'react';
import { isRequestTabDirty, type RequestTab } from '../stores/useRequestStore';
import { nextTabIndex } from '../../../src/webview/WebviewState';

export function RequestTabs({ tabs, activeTabId, onSelect, onClose, onNew }: {
  tabs: RequestTab[]; activeTabId: string;
  onSelect: (tabId: string) => void; onClose: (tabId: string) => void; onNew: () => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  return <div style={{ display: 'flex', borderBottom: '1px solid var(--vscode-panel-border)', minHeight: '34px', flexShrink: 0 }}>
    <div role="tablist" aria-label="Open requests" style={{ display: 'flex', overflowX: 'auto', minWidth: 0, flex: 1 }}>
      {tabs.map((tab, index) => {
        const name = tab.currentRequest.name || 'Untitled request';
        const dirty = isRequestTabDirty(tab);
        return <div key={tab.tabId} data-request-tab={tab.tabId} style={{ display: 'flex', alignItems: 'center', flexShrink: 0,
          maxWidth: '240px', borderRight: '1px solid var(--vscode-panel-border)',
          background: tab.tabId === activeTabId ? 'var(--vscode-tab-activeBackground)' : 'var(--vscode-tab-inactiveBackground)' }}>
          <button type="button" role="tab" ref={element => { refs.current[index] = element; }} id={`request-session-${tab.tabId}`}
            aria-selected={tab.tabId === activeTabId} aria-controls="request-workspace-panel" tabIndex={tab.tabId === activeTabId ? 0 : -1}
            aria-label={`${tab.currentRequest.method} ${name}${dirty ? ', unsaved changes' : ''}${tab.isExecuting ? ', running' : ''}${tab.error ? ', error' : ''}`}
            title={`${tab.currentRequest.method} ${name}`} onClick={() => onSelect(tab.tabId)}
            onKeyDown={event => {
              if (event.key === 'Delete') { event.preventDefault(); onClose(tab.tabId); return; }
              const next = nextTabIndex(index, event.key, tabs.length);
              if (next !== null) { event.preventDefault(); onSelect(tabs[next].tabId); refs.current[next]?.focus(); }
            }}
            style={{ border: 0, background: 'transparent', color: 'var(--vscode-foreground)', cursor: 'pointer', fontSize: '11px',
              padding: '7px 5px 7px 8px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              borderBottom: tab.tabId === activeTabId ? '2px solid var(--vscode-focusBorder)' : '2px solid transparent' }}>
            {tab.isExecuting || tab.loading ? '◌ ' : ''}{tab.error ? '! ' : ''}{tab.currentRequest.method} {name}{dirty ? ' ●' : ''}
          </button>
          <button type="button" aria-label={`Close request ${name}`} disabled={tab.closing}
            onClick={() => onClose(tab.tabId)} style={{ border: 0, background: 'transparent', color: 'var(--vscode-foreground)', cursor: 'pointer', padding: '4px 6px' }}>×</button>
        </div>;
      })}
    </div>
    <button type="button" aria-label="New request tab" onClick={onNew}
      style={{ border: 0, padding: '4px 10px', color: 'var(--vscode-textLink-foreground)', background: 'transparent', cursor: 'pointer' }}>+</button>
  </div>;
}
