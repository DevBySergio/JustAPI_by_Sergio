import { useState } from 'react';
import type { PostmanImportPreview as Preview, PostmanImportDiagnostic } from '../../../src/models/PostmanImport';
import { LocalButton } from './Common/LocalButton';
import { postMessageWithAck } from '../utils/vscodeApi';

const explanations: Record<PostmanImportDiagnostic['code'], string> = {
  SCRIPTS_OMITTED: 'Pre-request and test scripts are omitted and never executed.',
  EXAMPLES_OMITTED: 'Saved response examples are omitted.',
  DESCRIPTION_OMITTED: 'Request descriptions are omitted.',
  SETTINGS_OMITTED: 'Postman-specific settings are omitted; JustAPI request defaults apply.',
  REQUEST_SKIPPED: 'Request excluded: unsupported or invalid method, URL, authentication, body or fields. No partial request is imported.',
  VARIABLE_SKIPPED: 'Variable excluded: invalid, duplicate or oversized name/value.',
  SECRET_VARIABLE_SKIPPED: 'Secret variable excluded. Configure its credential in Auth Builder; environment variables use ordinary local storage.',
  AUTH_PLACEHOLDER: 'Redacted authentication placeholder omitted. Re-enter the credential in Auth Builder.',
  VARIABLE_PRECEDENCE: 'JustAPI collection variables override the active environment. Postman gives environments priority; review overlapping names.',
  COOKIES_OMITTED: 'Stored Postman cookies are omitted.',
};
export function PostmanImportPreview({ preview, onClose, onError, onImported }: {
  preview: Preview; onClose: (id: string) => void; onError: (message: string) => void; onImported: () => void;
}) {
  const [name, setName] = useState(preview.name); const [accepted, setAccepted] = useState(false); const [busy, setBusy] = useState(false);
  const run = async (cancel: boolean) => {
    setBusy(true);
    try {
      await postMessageWithAck(cancel ? { type: 'cancelPostmanImport', previewId: preview.previewId }
        : { type: 'confirmPostmanImport', previewId: preview.previewId, name: name.trim(), acceptWarnings: accepted });
      onClose(preview.previewId); if (!cancel) { onImported(); }
    } catch (error) { onError(String(error)); } finally { setBusy(false); }
  };
  return <section aria-label="Postman import preview" style={{ margin: '8px', padding: '10px', border: '1px solid var(--vscode-focusBorder)',
    fontSize: '11px', overflowWrap: 'anywhere', minWidth: 0, maxHeight: '65vh', overflowY: 'auto', flexShrink: 0 }}>
    <h3 style={{ margin: '0 0 8px', fontSize: '13px' }}>Import Postman {preview.kind}</h3>
    <p>{preview.fileName}</p>
    <label>Imported name<input aria-label="Imported Postman name" value={name} maxLength={1024} disabled={busy} onChange={event => setName(event.target.value)}
      style={{ display: 'block', boxSizing: 'border-box', width: '100%', minWidth: 0, marginTop: '4px', padding: '4px', background: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)', border: '1px solid var(--vscode-input-border)' }} /></label>
    <p>{preview.requests} requests · {preview.folders} folders · {preview.variables} variable entries · {preview.credentials} requests with credentials</p>
    <p>Excluded: {preview.skippedRequests} requests · {preview.skippedVariables} variables</p>
    <p>A new {preview.kind} will be added. Existing data and request tabs are preserved. Imported environments stay inactive.</p>
    <p>Recognized authentication credentials use VS Code SecretStorage. Other variable and body values use local files. Source values are hidden in this preview.</p>
    {preview.diagnosticCount > 0 && <>
      <h4>Review limitations ({preview.diagnosticCount})</h4>
      <ul style={{ paddingLeft: '18px' }}>{preview.diagnostics.map((diagnostic, index) => <li key={index} style={{ marginBottom: '6px' }}>
        {explanations[diagnostic.code]} <code>{diagnostic.location}</code>
      </li>)}</ul>
      {preview.diagnosticCount > preview.diagnostics.length && <p>Showing the first {preview.diagnostics.length} limitations. Total: {preview.diagnosticCount}.</p>}
      <label style={{ display: 'block', margin: '8px 0' }}><input type="checkbox" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)} /> I accept the listed exclusions and behavior changes</label>
    </>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
      <LocalButton primary type="button" disabled={busy || !name.trim() || (preview.diagnosticCount > 0 && !accepted)} onClick={() => { void run(false); }}>Confirm Postman import</LocalButton>
      <LocalButton type="button" disabled={busy} onClick={() => { void run(true); }}>Cancel Postman import</LocalButton>
    </div>
  </section>;
}
