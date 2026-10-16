import { useRequestStore } from '../../stores/useRequestStore';
import { KeyValueEditor } from '../Common/KeyValueEditor';
import { VariableAutocomplete } from '../Common/VariableAutocomplete';
import { HighlightedInput } from '../Common/HighlightedInput';
import { LocalButton } from '../Common/LocalButton';
import { postMessageWithAck } from '../../utils/vscodeApi';
import { FILE_UPLOAD_LIMITS, type RequestFile } from '../../../../src/models/RequestFile';
import { BodyType } from '../../../../src/models/Request';

const BODY_TYPES: { value: BodyType; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'json', label: 'JSON' },
  { value: 'text', label: 'Text' },
  { value: 'xml', label: 'XML' },
  { value: 'form-data', label: 'Form Data' },
  { value: 'x-www-form-urlencoded', label: 'URL Encoded' },
  { value: 'binary', label: 'Binary' },
];

export function BodyEditor() {
  const { currentRequest, tabId, setBodyType, setBodyContent, setFormData, setBodyFiles, setFileContentType, fileSelections, fileSelectionError } = useRequestStore();
  const { body } = currentRequest;
  const pending = Object.keys(fileSelections).length > 0;
  const selectFile = (fieldId?: string) => {
    let operationId: string | undefined;
    void postMessageWithAck({ type: 'selectRequestFile', requestId: currentRequest.id, ...(fieldId ? { fieldId } : {}) }, message => {
      operationId = message.operationId;
      useRequestStore.getState().beginFileSelection(tabId, message.operationId, fieldId);
    }, { timeoutMs: 0 }).catch(error => { if (operationId) { useRequestStore.getState().endFileSelection(operationId, String(error)); } });
  };
  const fileLabel = (file?: RequestFile) => file ? `${file.name} (${file.size.toLocaleString()} bytes)` : 'No file selected';
  const inputStyle = { width: '100%', minWidth: 0, boxSizing: 'border-box' as const, padding: '4px', fontSize: '11px', background: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)', border: '1px solid var(--vscode-input-border, var(--vscode-panel-border))' };
  const updateFile = (id: string, change: Partial<NonNullable<typeof body.files>[number]>) => setBodyFiles((body.files ?? []).map(field => field.id === id ? { ...field, ...change } : field));

  const getPlaceholder = () => {
    if (body.type === 'json') { return '{\n  "key": "value"\n}'; }
    if (body.type === 'xml') { return '<root>\n  <item>value</item>\n</root>'; }
    return 'Enter request body...';
  };

  return (
    <div>
      <div role="radiogroup" aria-label="Request body type" style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '8px' }}>
        {BODY_TYPES.map((bt) => (
          <button
            key={bt.value}
            role="radio"
            aria-checked={body.type === bt.value}
            onClick={() => setBodyType(bt.value)}
            style={{
              padding: '3px 8px',
              border: '1px solid var(--vscode-panel-border)',
              background: body.type === bt.value ? 'var(--vscode-button-background)' : 'transparent',
              color: body.type === bt.value ? 'var(--vscode-button-foreground)' : 'var(--vscode-foreground)',
              cursor: 'pointer',
              fontSize: '11px',
              borderRadius: '2px',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {bt.label}
          </button>
        ))}
      </div>

      {body.type === 'form-data' && <>
        <KeyValueEditor
          pairs={body.formData || []}
          onChange={setFormData}
          namePlaceholder="Field name"
          valuePlaceholder="Field value"
        />
        <div style={{ marginTop: '10px' }}>
          <div style={{ fontSize: '11px', marginBottom: '6px' }}>Files</div>
          {(body.files ?? []).map((field, index) => <fieldset key={field.id} style={{ minWidth: 0, margin: '0 0 8px', padding: '8px', border: '1px solid var(--vscode-panel-border)' }}>
            <legend style={{ fontSize: '11px' }}>File {index + 1}</legend>
            <label style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '11px' }}>
              <input type="checkbox" aria-label={`Enable file ${index + 1}`} checked={field.enabled} onChange={event => updateFile(field.id, { enabled: event.target.checked })} />
              Include this file
            </label>
            <input aria-label={`File ${index + 1} field name`} placeholder="Field name" value={field.key} onChange={event => updateFile(field.id, { key: event.target.value })} style={{ ...inputStyle, marginTop: '6px' }} />
            <input aria-label={`File ${index + 1} content type`} placeholder="application/octet-stream" value={field.contentType ?? ''} onChange={event => updateFile(field.id, { contentType: event.target.value })} style={{ ...inputStyle, marginTop: '6px' }} />
            <div style={{ fontSize: '11px', overflowWrap: 'anywhere', margin: '6px 0' }}>{fileLabel(field.file)}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              <LocalButton disabled={pending} onClick={() => selectFile(field.id)} aria-label={`Choose file ${index + 1}`}>Choose local file…</LocalButton>
              <LocalButton onClick={() => setBodyFiles((body.files ?? []).filter(value => value.id !== field.id))} aria-label={`Remove file ${index + 1}`}>Remove</LocalButton>
            </div>
          </fieldset>)}
          <LocalButton disabled={(body.files?.length ?? 0) >= FILE_UPLOAD_LIMITS.maximumFiles} onClick={() => setBodyFiles([...(body.files ?? []), { id: crypto.randomUUID(), key: '', enabled: true }])}>+ Add file</LocalButton>
        </div>
      </>}

      {body.type === 'binary' && <div style={{ display: 'grid', gap: '6px' }}>
        {body.binarySource !== 'file' && <div style={{ fontSize: '11px' }}>This existing body sends literal UTF-8 text. Choosing a file replaces that text with the file bytes.</div>}
        {body.binarySource === 'file' && <div style={{ fontSize: '11px', overflowWrap: 'anywhere' }}>{fileLabel(body.file)}</div>}
        <LocalButton disabled={pending} onClick={() => selectFile()} style={{ justifySelf: 'start' }}>Choose local file…</LocalButton>
        <label style={{ fontSize: '11px' }}>File content type
          <input aria-label="File content type" placeholder="application/octet-stream" value={body.contentType ?? ''} onChange={event => setFileContentType(event.target.value)} style={{ ...inputStyle, marginTop: '4px' }} />
        </label>
      </div>}
      {(body.type === 'binary' || body.type === 'form-data') && <div style={{ fontSize: '11px', opacity: 0.8, marginTop: '8px', lineHeight: 1.5 }}>
        Up to 10 MiB per file; 25 MiB per multipart body. Choose files again after reloading or importing. File paths and bytes stay out of collections and generated examples.
      </div>}
      {pending && <div role="status" style={{ fontSize: '11px', marginTop: '6px' }}>Selecting local file…</div>}
      {fileSelectionError && <div role="alert" style={{ fontSize: '11px', color: 'var(--vscode-errorForeground)', marginTop: '6px' }}>{fileSelectionError}</div>}

      {body.type === 'x-www-form-urlencoded' && body.formData !== undefined && (
        <KeyValueEditor
          pairs={body.formData || []}
          onChange={setFormData}
          namePlaceholder="Parameter name"
          valuePlaceholder="Parameter value"
        />
      )}

      {body.type !== 'none' && body.type !== 'form-data' && !(body.type === 'binary' && body.binarySource === 'file') && (body.type !== 'x-www-form-urlencoded' || body.formData === undefined) && (
        <VariableAutocomplete value={body.content} onChange={setBodyContent}>
          {({ onInput, onKeyDown, onBlur }) => (
            <HighlightedInput
              ariaLabel="Request body"
              value={body.content}
              onChange={(v) => {
                setBodyContent(v);
              }}
              multiline
              minHeight="120px"
              placeholder={getPlaceholder()}
              onCursorMove={(v, pos) => onInput(v, pos)}
              onKeyDown={onKeyDown}
              onBlur={onBlur}
            />
          )}
        </VariableAutocomplete>
      )}
    </div>
  );
}
