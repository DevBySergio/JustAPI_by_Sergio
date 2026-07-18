import { useState, useCallback, useEffect, useRef } from 'react';
import { useRequestStore } from '../../stores/useRequestStore';
import { useCollectionStore } from '../../stores/useCollectionStore';
import { useVariableStore } from '../../stores/useVariableStore';
import { UrlBar } from './UrlBar';
import { KeyValueEditor } from '../Common/KeyValueEditor';
import { BodyEditor } from './BodyEditor';
import { ActiveVariablesPanel } from './ActiveVariablesPanel';
import { postMessage } from '../../utils/vscodeApi';
import { nextTabIndex } from '../../../../src/webview/WebviewState';

interface RequestEditorProps {
  onSend: () => void;
  onSave: () => void;
  onNew: () => void;
  isDirty: boolean;
  isSaved: boolean;
  onNotification: (text: string, type: 'info' | 'error' | 'success') => void;
}

type EditorTab = 'headers' | 'params' | 'body' | 'auth' | 'settings' | 'variables';

const EDITOR_TABS: EditorTab[] = ['headers', 'params', 'body', 'auth', 'settings', 'variables'];

export function RequestEditor({ onSend, onSave, onNew, isDirty, isSaved, onNotification }: RequestEditorProps) {
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
  const totalActiveVars = activeGlobal + activeColl + activeSetVars;

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
          <KeyValueEditor
            pairs={currentRequest.queryParams}
            onChange={setQueryParams}
            namePlaceholder="Parameter name"
            valuePlaceholder="Parameter value"
            showVariables
          />
        )}

        {activeTab === 'body' && <BodyEditor />}

        {activeTab === 'auth' && <AuthEditor />}

        {activeTab === 'settings' && <SettingsEditor />}
        {activeTab === 'variables' && <ActiveVariablesPanel />}
      </div>
    </div>
  );
}

function AuthEditor() {
  const { currentRequest } = useRequestStore();
  const [authType, setAuthType] = useState<'none' | 'bearer' | 'basic' | 'apiKey'>('none');
  const [bearerToken, setBearerToken] = useState('');
  const [basicUser, setBasicUser] = useState('');
  const [basicPass, setBasicPass] = useState('');
  const [apiKeyName, setApiKeyName] = useState('');
  const [apiKeyValue, setApiKeyValue] = useState('');
  const [apiKeyIn, setApiKeyIn] = useState<'header' | 'query'>('header');

  useEffect(() => {
    setAuthType(currentRequest.auth.type);
    setBearerToken('');
    setBasicUser('');
    setBasicPass('');
    setApiKeyValue('');
    if (currentRequest.auth.type === 'apiKey') {
      setApiKeyName(currentRequest.auth.name);
      setApiKeyIn(currentRequest.auth.in);
    } else {
      setApiKeyName('');
      setApiKeyIn('header');
    }
  }, [currentRequest.id, currentRequest.auth]);

  const applyAuth = () => {
    if (authType === 'none') {
      postMessage({ type: 'configureAuth', requestId: currentRequest.id, auth: { type: 'none' } });
    } else if (authType === 'bearer' && bearerToken) {
      postMessage({
        type: 'configureAuth',
        requestId: currentRequest.id,
        auth: { type: 'bearer', token: bearerToken },
      });
      setBearerToken('');
    } else if (authType === 'basic' && basicUser) {
      postMessage({
        type: 'configureAuth',
        requestId: currentRequest.id,
        auth: { type: 'basic', username: basicUser, password: basicPass },
      });
      setBasicUser('');
      setBasicPass('');
    } else if (authType === 'apiKey' && apiKeyName && apiKeyValue) {
      postMessage({
        type: 'configureAuth',
        requestId: currentRequest.id,
        auth: { type: 'apiKey', name: apiKeyName, in: apiKeyIn, value: apiKeyValue },
      });
      setApiKeyValue('');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
      <div role="radiogroup" aria-label="Authentication type" style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
        {(['none', 'bearer', 'basic', 'apiKey'] as const).map((t) => (
          <button
            key={t}
            role="radio"
            aria-checked={authType === t}
            onClick={() => { setAuthType(t); }}
            style={{
              padding: '3px 8px',
              border: '1px solid var(--vscode-panel-border)',
              background: authType === t ? 'var(--vscode-button-background)' : 'transparent',
              color: authType === t ? 'var(--vscode-button-foreground)' : 'var(--vscode-foreground)',
              cursor: 'pointer',
              fontSize: '11px',
              borderRadius: '2px',
              textTransform: 'capitalize',
            }}
          >
            {t === 'apiKey' ? 'API Key' : t}
          </button>
        ))}
      </div>

      {authType === 'bearer' && (
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <span style={{ minWidth: '50px' }}>Token:</span>
          <input
            aria-label="Bearer token"
            type="password"
            value={bearerToken}
            onChange={(e) => { setBearerToken(e.target.value); }}
            placeholder="Bearer token..."
            style={{
              flex: 1,
              padding: '3px 6px',
              background: 'var(--vscode-input-background)',
              color: 'var(--vscode-input-foreground)',
              border: '1px solid var(--vscode-input-border)',
            }}
          />
          <button onClick={applyAuth} style={{ padding: '3px 8px', background: 'var(--vscode-button-background)', color: 'var(--vscode-button-foreground)', border: 'none', cursor: 'pointer', fontSize: '10px' }}>Apply</button>
        </div>
      )}

      {authType === 'basic' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <span style={{ minWidth: '50px' }}>Username:</span>
            <input
              aria-label="Basic authentication username"
              type="text"
              value={basicUser}
              onChange={(e) => setBasicUser(e.target.value)}
              placeholder="Username"
              style={{ flex: 1, padding: '3px 6px', background: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)', border: '1px solid var(--vscode-input-border)' }}
            />
          </div>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <span style={{ minWidth: '50px' }}>Password:</span>
            <input
              aria-label="Basic authentication password"
              type="password"
              value={basicPass}
              onChange={(e) => setBasicPass(e.target.value)}
              placeholder="Password"
              style={{ flex: 1, padding: '3px 6px', background: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)', border: '1px solid var(--vscode-input-border)' }}
            />
          </div>
          <button onClick={applyAuth} style={{ padding: '3px 8px', background: 'var(--vscode-button-background)', color: 'var(--vscode-button-foreground)', border: 'none', cursor: 'pointer', fontSize: '10px', alignSelf: 'flex-end' }}>Apply</button>
        </div>
      )}

      {authType === 'apiKey' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <span style={{ minWidth: '50px' }}>Key:</span>
            <input
              aria-label="API key name"
              type="text"
              value={apiKeyName}
              onChange={(e) => setApiKeyName(e.target.value)}
              placeholder="X-API-Key"
              style={{ flex: 1, padding: '3px 6px', background: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)', border: '1px solid var(--vscode-input-border)' }}
            />
          </div>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <span style={{ minWidth: '50px' }}>Value:</span>
            <input
              aria-label="API key value"
              type="password"
              value={apiKeyValue}
              onChange={(e) => setApiKeyValue(e.target.value)}
              placeholder="API key value"
              style={{ flex: 1, padding: '3px 6px', background: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)', border: '1px solid var(--vscode-input-border)' }}
            />
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input type="radio" checked={apiKeyIn === 'header'} onChange={() => setApiKeyIn('header')} /> Header
            </label>
            <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input type="radio" checked={apiKeyIn === 'query'} onChange={() => setApiKeyIn('query')} /> Query param
            </label>
          </div>
          <button onClick={applyAuth} style={{ padding: '3px 8px', background: 'var(--vscode-button-background)', color: 'var(--vscode-button-foreground)', border: 'none', cursor: 'pointer', fontSize: '10px', alignSelf: 'flex-end' }}>Apply</button>
        </div>
      )}

      {authType === 'none' && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--vscode-descriptionForeground)', fontSize: '11px' }}>
            No authentication configured.
          </span>
          <button onClick={applyAuth} style={{ padding: '3px 8px', background: 'var(--vscode-button-background)', color: 'var(--vscode-button-foreground)', border: 'none', cursor: 'pointer', fontSize: '10px' }}>Apply</button>
        </div>
      )}

      {currentRequest.auth.type !== 'none' && (
        <div style={{ color: 'var(--vscode-descriptionForeground)', fontSize: '10px' }}>
          A credential is stored securely. Enter a new value only to replace it.
        </div>
      )}
    </div>
  );
}

function SettingsEditor() {
  const { currentRequest, setRequest } = useRequestStore();
  const mebibyte = 1024 * 1024;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ minWidth: '120px' }}>Timeout (ms):</span>
        <input
          type="number"
          value={currentRequest.settings.timeout}
          onChange={(e) =>
            setRequest({
              ...currentRequest,
              settings: { ...currentRequest.settings, timeout: parseInt(e.target.value) || 30000 },
            })
          }
          style={{
            flex: 1,
            padding: '3px 6px',
            background: 'var(--vscode-input-background)',
            color: 'var(--vscode-input-foreground)',
            border: '1px solid var(--vscode-input-border)',
          }}
        />
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ minWidth: '120px' }}>Response limit (MiB):</span>
        <input
          type="number"
          min={1 / 1024}
          max={100}
          step={1 / 1024}
          value={currentRequest.settings.maxResponseBytes / mebibyte}
          onChange={(e) => {
            const requested = Math.round(Number(e.target.value) * mebibyte);
            const maxResponseBytes = Number.isFinite(requested)
              ? Math.min(100 * mebibyte, Math.max(1024, requested))
              : 10 * mebibyte;
            setRequest({
              ...currentRequest,
              settings: { ...currentRequest.settings, maxResponseBytes },
            });
          }}
          style={{
            flex: 1,
            padding: '3px 6px',
            background: 'var(--vscode-input-background)',
            color: 'var(--vscode-input-foreground)',
            border: '1px solid var(--vscode-input-border)',
          }}
        />
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ minWidth: '120px' }}>Follow redirects:</span>
        <input
          type="checkbox"
          checked={currentRequest.settings.followRedirects}
          onChange={(e) =>
            setRequest({
              ...currentRequest,
              settings: { ...currentRequest.settings, followRedirects: e.target.checked },
            })
          }
        />
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ minWidth: '120px' }}>Verify SSL:</span>
        <input
          type="checkbox"
          checked={currentRequest.settings.verifySSL}
          onChange={(e) =>
            setRequest({
              ...currentRequest,
              settings: { ...currentRequest.settings, verifySSL: e.target.checked },
            })
          }
        />
      </label>
    </div>
  );
}
