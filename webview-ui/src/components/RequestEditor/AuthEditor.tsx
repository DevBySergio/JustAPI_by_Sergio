import { useEffect, useState } from 'react';
import { useRequestStore } from '../../stores/useRequestStore';
import { postMessageWithAck } from '../../utils/vscodeApi';

export function AuthEditor({ onNotification }: { onNotification: (text: string, type: 'info' | 'error' | 'success') => void }) {
  const { currentRequest, tabId } = useRequestStore();
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
    const auth = authType === 'none' ? { type: 'none' as const }
      : authType === 'bearer' && bearerToken ? { type: 'bearer' as const, token: bearerToken }
      : authType === 'basic' ? { type: 'basic' as const, username: basicUser, password: basicPass }
      : authType === 'apiKey' && apiKeyName && apiKeyValue ? { type: 'apiKey' as const, name: apiKeyName, in: apiKeyIn, value: apiKeyValue }
      : undefined;
    if (!auth) { return; }
    const update = postMessageWithAck({ type: 'configureAuth', requestId: currentRequest.id, auth });
    useRequestStore.getState().setAuthUpdate(update, tabId);
    void update.then(() => {
      setBearerToken(''); setBasicUser(''); setBasicPass(''); setApiKeyValue('');
    }).catch(error => onNotification(String(error), 'error'));
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
          {useRequestStore.getState().authPending
            ? 'Authentication is pending. Save the request to keep this change.'
            : 'A credential is stored securely. Enter a new value only to replace it.'}
        </div>
      )}
    </div>
  );
}
