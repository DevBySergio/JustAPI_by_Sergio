import { useRequestStore } from '../../stores/useRequestStore';
import { KeyValueEditor } from '../Common/KeyValueEditor';
import { VariableAutocomplete } from '../Common/VariableAutocomplete';
import { HighlightedInput } from '../Common/HighlightedInput';
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
  const { currentRequest, setBodyType, setBodyContent, setFormData } = useRequestStore();
  const { body } = currentRequest;

  const getPlaceholder = () => {
    if (body.type === 'json') return '{\n  "key": "value"\n}';
    if (body.type === 'xml') return '<root>\n  <item>value</item>\n</root>';
    return 'Enter request body...';
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '8px' }}>
        {BODY_TYPES.map((bt) => (
          <button
            key={bt.value}
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

      {body.type === 'form-data' && (
        <KeyValueEditor
          pairs={body.formData || []}
          onChange={setFormData}
          namePlaceholder="Field name"
          valuePlaceholder="Field value"
        />
      )}

      {body.type === 'x-www-form-urlencoded' && (
        <KeyValueEditor
          pairs={body.formData || []}
          onChange={setFormData}
          namePlaceholder="Parameter name"
          valuePlaceholder="Parameter value"
        />
      )}

      {body.type !== 'none' && body.type !== 'form-data' && body.type !== 'x-www-form-urlencoded' && (
        <VariableAutocomplete value={body.content} onChange={setBodyContent}>
          {({ onInput, onKeyDown, onBlur }) => (
            <HighlightedInput
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
