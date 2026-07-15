import { useEffect, useState } from 'react';
import type { CurlImportWarning } from '../../../src/models/CurlImport';
import type { JustRequest } from '../../../src/models/Request';

interface CurlImportPreviewProps {
  request: JustRequest;
  warnings: CurlImportWarning[];
  onConfirm: () => void;
  onCancel: () => void;
}

function authSummary(request: JustRequest): string {
  switch (request.auth.type) {
    case 'none':
      return 'None';
    case 'basic':
      return 'Basic credentials (stored securely)';
    case 'bearer':
      return 'Bearer token (stored securely)';
    case 'apiKey':
      return `API key in ${request.auth.in}`;
  }
}

export function CurlImportPreview({ request, warnings, onConfirm, onCancel }: CurlImportPreviewProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => setAcknowledged(false), [request.id]);
  const mustAcknowledge = warnings.length > 0;

  return (
    <div
      role="presentation"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 200,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '14px',
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="curl-import-preview-title"
        style={{
          width: 'min(640px, 100%)',
          maxHeight: 'calc(100vh - 28px)',
          overflow: 'auto',
          border: '1px solid var(--vscode-panel-border)',
          borderRadius: '6px',
          background: 'var(--vscode-editor-background)',
          color: 'var(--vscode-foreground)',
          boxShadow: '0 10px 32px rgba(0, 0, 0, 0.4)',
        }}
      >
        <header style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--vscode-panel-border)' }}>
          <h2 id="curl-import-preview-title" style={{ margin: 0, fontSize: '14px' }}>
            Review cURL import
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: '11px', opacity: 0.8 }}>
            This is the normalized request that will be loaded into the editor.
          </p>
        </header>

        <div style={{ padding: '12px 16px', display: 'grid', gap: '12px', fontSize: '11px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px', alignItems: 'center' }}>
            <code style={{ fontWeight: 700, color: 'var(--vscode-textLink-foreground)' }}>{request.method}</code>
            <code style={{ overflowWrap: 'anywhere' }}>{request.url}</code>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px 12px' }}>
            <span>Body: <strong>{request.body.type}</strong></span>
            <span>Headers: <strong>{request.headers.length}</strong></span>
            <span>Redirects: <strong>{request.settings.followRedirects ? 'follow' : 'do not follow'}</strong></span>
            <span>TLS verification: <strong>{request.settings.verifySSL ? 'on' : 'off'}</strong></span>
            <span style={{ gridColumn: '1 / -1' }}>Authentication: <strong>{authSummary(request)}</strong></span>
          </div>

          {request.headers.length > 0 && (
            <details>
              <summary style={{ cursor: 'pointer' }}>Normalized headers</summary>
              <div style={{ marginTop: '6px', display: 'grid', gap: '4px' }}>
                {request.headers.map((header) => (
                  <code key={header.id} style={{ overflowWrap: 'anywhere' }}>
                    {header.key}: {header.value}
                  </code>
                ))}
              </div>
            </details>
          )}

          {request.body.type !== 'none' && (
            <details>
              <summary style={{ cursor: 'pointer' }}>Normalized body</summary>
              <pre style={{
                margin: '6px 0 0',
                padding: '8px',
                maxHeight: '150px',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                background: 'var(--vscode-textCodeBlock-background)',
              }}>
                {request.body.type === 'form-data'
                  ? request.body.formData?.map(field => `${field.key}=${field.value}`).join('\n')
                  : request.body.content}
              </pre>
            </details>
          )}

          {warnings.length > 0 && (
            <div
              role="alert"
              style={{
                padding: '9px 10px',
                border: '1px solid var(--vscode-inputValidation-warningBorder)',
                background: 'var(--vscode-inputValidation-warningBackground)',
              }}
            >
              <strong>{warnings.length} import warning{warnings.length === 1 ? '' : 's'}</strong>
              <ul style={{ margin: '7px 0 0', paddingLeft: '18px', display: 'grid', gap: '5px' }}>
                {warnings.map((warning, index) => (
                  <li key={`${warning.tokenIndex}-${warning.code}-${index}`}>
                    <code>{warning.token}</code>: {warning.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {mustAcknowledge && (
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>I reviewed the warnings and want to import this normalized request.</span>
            </label>
          )}
        </div>

        <footer style={{
          padding: '10px 16px',
          borderTop: '1px solid var(--vscode-panel-border)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '8px',
        }}>
          <button type="button" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={mustAcknowledge && !acknowledged}
            style={{
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
              border: '1px solid transparent',
              padding: '4px 10px',
              cursor: mustAcknowledge && !acknowledged ? 'not-allowed' : 'pointer',
              opacity: mustAcknowledge && !acknowledged ? 0.6 : 1,
            }}
          >
            Import request
          </button>
        </footer>
      </section>
    </div>
  );
}
