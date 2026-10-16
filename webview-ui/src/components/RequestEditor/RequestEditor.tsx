import { lazy, useState, useRef } from 'react';
import { useRequestStore } from '../../stores/useRequestStore';
import { useCollectionStore } from '../../stores/useCollectionStore';
import { useVariableStore } from '../../stores/useVariableStore';
import { UrlBar } from './UrlBar';
import { KeyValueEditor } from '../Common/KeyValueEditor';
import { PathParameterEditor } from './PathParameterEditor';
import { DeferredPanel } from '../Common/DeferredPanel';
import { postMessage } from '../../utils/vscodeApi';
import { nextTabIndex } from '../../../../src/webview/WebviewState';

const BodyEditor = lazy(() => import(/* webpackChunkName: "request-body" */ './BodyEditor').then(module => ({ default: module.BodyEditor })));
const ActiveVariablesPanel = lazy(() => import(/* webpackChunkName: "request-variables" */ './ActiveVariablesPanel').then(module => ({ default: module.ActiveVariablesPanel })));
const AuthEditor = lazy(() => import(/* webpackChunkName: "request-auth" */ './AuthEditor').then(module => ({ default: module.AuthEditor })));
const SettingsEditor = lazy(() => import(/* webpackChunkName: "request-settings" */ './SettingsEditor').then(module => ({ default: module.SettingsEditor })));

interface RequestEditorProps {
  onSend: () => void;
  onSave: () => void;
  onNew: () => void;
  onPrepare: () => Promise<void>;
  isDirty: boolean;
  isSaved: boolean;
  onNotification: (text: string, type: 'info' | 'error' | 'success') => void;
}

type EditorTab = 'headers' | 'params' | 'body' | 'auth' | 'settings' | 'variables';

const EDITOR_TABS: EditorTab[] = ['headers', 'params', 'body', 'auth', 'settings', 'variables'];

export function RequestEditor({ onSend, onSave, onNew, onPrepare, isDirty, isSaved, onNotification }: RequestEditorProps) {
  const [activeTab, setActiveTab] = useState<EditorTab>('headers');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const {
    currentRequest,
    isExecuting,
    activeExecutionId,
    setUrl,
    setMethod,
    setName,
    setHeaders,
    setQueryParams,
  } = useRequestStore();

  const collections = useCollectionStore((s) => s.collections);
  const activeCollectionId = useCollectionStore((s) => s.activeCollectionId);
  const selectCollection = useCollectionStore((s) => s.selectCollection);

  // Count active variables
  const globalVars = useVariableStore((s) => s.globalVariables);
  const variableSets = useVariableStore((s) => s.variableSets);
  const activeGlobal = globalVars.filter(v => v.enabled).length;
  const selectedCol = collections.find(c => c.id === activeCollectionId);
  const activeColl = selectedCol?.variables.filter(v => v.enabled).length || 0;
  const linkedSets = variableSets.filter(s => activeCollectionId && s.linkedCollectionIds.includes(activeCollectionId));
  const activeSetVars = linkedSets.reduce((sum, s) => sum + s.variables.filter(v => v.enabled).length, 0);
  const totalActiveVars = activeGlobal + activeColl + activeSetVars + currentRequest.variables.filter(variable => variable.enabled && variable.key).length;

  const handleSendClick = () => {
    if (isExecuting && activeExecutionId) {
      postMessage({ type: 'cancelRequest', executionId: activeExecutionId });
      return;
    }
    onSend();
  };

  return (
    <div style={{ padding: '8px' }}>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' }}>
        <input
          id="request-name-input"
          aria-label="Request name"
          type="text"
          value={currentRequest.name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Request name (optional)"
          style={{
            flex: 1,
            minWidth: 0,
            padding: '4px 8px',
            background: 'var(--vscode-input-background)',
            color: 'var(--vscode-input-foreground)',
            border: '1px solid var(--vscode-input-border)',
            fontSize: '12px',
            fontWeight: 600,
            fontFamily: 'var(--vscode-font-family)',
          }}
        />
        <span
          role="status"
          aria-live="polite"
          style={{
            fontSize: '10px',
            color: isDirty ? 'var(--vscode-inputValidation-warningForeground)' : 'var(--vscode-descriptionForeground)',
            whiteSpace: 'nowrap',
          }}
        >
          {isDirty ? 'Unsaved changes' : isSaved ? 'Saved' : 'Draft'}
        </span>
      </div>

      <div style={{
        display: 'flex', gap: '4px', alignItems: 'center',
        marginBottom: '6px', fontSize: '10px',
      }}>
        <span style={{ color: 'var(--vscode-descriptionForeground)', whiteSpace: 'nowrap' }}>Collection:</span>
        <select
          aria-label="Request collection"
          value={activeCollectionId || ''}
          onChange={(e) => {
            const id = e.target.value;
            selectCollection(id || null);
          }}
          style={{
            flex: 1,
            padding: '2px 4px',
            background: 'var(--vscode-input-background)',
            color: 'var(--vscode-input-foreground)',
            border: '1px solid var(--vscode-input-border)',
            fontSize: '10px',
            borderRadius: '2px',
          }}
        >
          <option value="">-- None (global vars only) --</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <UrlBar
            url={currentRequest.url}
            method={currentRequest.method}
            onUrlChange={setUrl}
            onMethodChange={setMethod}
          />
        </div>
        <div
          style={{
            display: 'flex',
            gap: '2px',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => {
              // Copy {{}} to clipboard and focus URL
              navigator.clipboard.writeText('{{}}').catch(() => {});
              onNotification('{{}} copied to clipboard. Paste in URL, headers, or body.', 'info');
            }}
            title="Insert variable syntax {{}}"
            style={{
              padding: '4px 6px',
              background: 'none',
              border: '1px solid var(--vscode-panel-border)',
              color: 'var(--vscode-textLink-foreground)',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 700,
              borderRadius: '2px',
              fontFamily: 'var(--vscode-editor-font-family)',
              lineHeight: 1,
            }}
          >
            {'{}'}
          </button>
          <span
            title={`${totalActiveVars} active variable${totalActiveVars !== 1 ? 's' : ''}`}
            style={{
              padding: '2px 6px',
              fontSize: '9px',
              color: totalActiveVars > 0 ? 'var(--vscode-testing-iconPassedForeground)' : 'var(--vscode-descriptionForeground)',
              border: '1px solid var(--vscode-panel-border)',
              borderRadius: '2px',
              cursor: 'default',
            }}
          >
            {totalActiveVars} var{totalActiveVars !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
        <button
          onClick={handleSendClick}
          disabled={!currentRequest.url && !isExecuting}
          className="send-btn"
          style={{
            flex: 1,
            padding: '6px 16px',
            background: isExecuting ? 'var(--vscode-button-secondaryBackground)' : 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            cursor: (isExecuting || !currentRequest.url) ? 'default' : 'pointer',
            fontWeight: 600,
            fontSize: '12px',
            opacity: (!currentRequest.url && !isExecuting) ? 0.6 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
          }}
        >
          {isExecuting && <span className="spinner" />}
          {isExecuting ? 'Cancel' : 'Send'}
        </button>

        <button
          onClick={() => {
            onNew();
          }}
          style={{
            padding: '6px 8px',
            background: 'transparent',
            color: 'var(--vscode-textLink-foreground)',
            border: '1px solid var(--vscode-panel-border)',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: 600,
            borderRadius: '2px',
          }}
          title="New request"
        >
          + New
        </button>

        <button
          onClick={() => {
            if (activeCollectionId) {
              onSave();
            } else {
              onNotification('Select a collection in the Collection selector above first', 'info');
            }
          }}
          style={{
            padding: '6px 12px',
            background: 'var(--vscode-button-secondaryBackground)',
            color: 'var(--vscode-button-secondaryForeground)',
            border: 'none',
            cursor: 'pointer',
            fontSize: '11px',
          }}
        >
          Save
        </button>
      </div>

      <div
        role="tablist"
        aria-label="Request editor sections"
        style={{
        display: 'flex',
        gap: '2px',
        marginTop: '12px',
        borderBottom: '1px solid var(--vscode-panel-border)',
        }}
      >
        {EDITOR_TABS.map((tab, index) => (
          <button
            key={tab}
            ref={(element) => { tabRefs.current[index] = element; }}
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`request-panel-${tab}`}
            id={`request-tab-${tab}`}
            tabIndex={activeTab === tab ? 0 : -1}
            onClick={() => setActiveTab(tab)}
            onKeyDown={(event) => {
              const nextIndex = nextTabIndex(index, event.key, EDITOR_TABS.length);
              if (nextIndex === null) {
                return;
              }
              event.preventDefault();
              setActiveTab(EDITOR_TABS[nextIndex]);
              tabRefs.current[nextIndex]?.focus();
            }}
            className="editor-tab-btn"
            style={{
              padding: '4px 10px',
              border: 'none',
              background: 'none',
              color: activeTab === tab ? 'var(--vscode-textLink-foreground)' : 'var(--vscode-foreground)',
              cursor: 'pointer',
              fontSize: '11px',
              borderBottom: activeTab === tab ? '2px solid var(--vscode-textLink-foreground)' : '2px solid transparent',
              textTransform: 'capitalize',
              transition: 'border-color 0.15s, color 0.15s',
            }}
          >
            {tab === 'params' ? 'Params' : tab === 'variables' ? 'Vars' : tab}
          </button>
        ))}
      </div>

      <div
        id={`request-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`request-tab-${activeTab}`}
        tabIndex={0}
        style={{ marginTop: '8px' }}
      >
        <DeferredPanel panelKey={activeTab}>
        {activeTab === 'headers' && (
          <KeyValueEditor
            pairs={currentRequest.headers}
            onChange={setHeaders}
            namePlaceholder="Header name"
            valuePlaceholder="Header value"
            showVariables
          />
        )}

        {activeTab === 'params' && (
          <>
          <p style={{ fontSize: '11px' }}>Query parameters</p>
          <KeyValueEditor
            pairs={currentRequest.queryParams}
            onChange={setQueryParams}
            namePlaceholder="Parameter name"
            valuePlaceholder="Parameter value"
            showVariables
          />
          <PathParameterEditor />
          </>
        )}

        {activeTab === 'body' && <BodyEditor />}

        {activeTab === 'auth' && <AuthEditor onNotification={onNotification} />}

        {activeTab === 'settings' && <SettingsEditor />}
        {activeTab === 'variables' && <>
          <div role="group" aria-label="Request variables">
            <p style={{ fontSize: '11px' }}>Request variables override collection, linked set and global variables.
              They are saved with this request. Disabled variables fall back to lower scopes.</p>
            <KeyValueEditor pairs={currentRequest.variables} namePlaceholder="Variable name" valuePlaceholder="Variable value" showVariables
              onChange={variables => useRequestStore.getState().setVariables(variables.map(variable => ({ ...variable, scope: 'request' })))} />
          </div>
          <ActiveVariablesPanel prepare={onPrepare} onError={error => onNotification(error, 'error')} />
        </>}
        </DeferredPanel>
      </div>
    </div>
  );
}
