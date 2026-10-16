import { useRequestStore } from '../../stores/useRequestStore';
import { HighlightedInput } from '../Common/HighlightedInput';

export function PathParameterEditor() {
  const parameters = useRequestStore(state => state.currentRequest.pathParams);
  const setParameters = useRequestStore(state => state.setPathParams);
  return <div role="group" aria-label="Path parameters" style={{ marginTop: '12px', fontSize: '11px' }}>
    <p>Path parameters: use <code>/:name</code> in the URL, for example <code>/users/:id</code>.
      Values accept <code>{'{{variables}}'}</code> and are encoded as one path segment. Each used name needs a nonempty value.</p>
    {parameters.map((parameter, index) => <div key={parameter.id} style={{ display: 'flex', gap: '4px', alignItems: 'center', marginBottom: '4px' }}>
      <input aria-label={`Path name ${index + 1}`} placeholder="id" value={parameter.name}
        onChange={event => setParameters(parameters.map(value => value.id === parameter.id ? { ...value, name: event.target.value } : value))}
        style={{ minWidth: 0, width: '30%', padding: '3px', color: 'var(--vscode-input-foreground)', background: 'var(--vscode-input-background)', border: '1px solid var(--vscode-input-border)' }} />
      <div style={{ flex: 1, minWidth: 0 }}><HighlightedInput ariaLabel={`Path value ${index + 1}`} value={parameter.value}
        onChange={value => setParameters(parameters.map(candidate => candidate.id === parameter.id ? { ...candidate, value } : candidate))} /></div>
      <button type="button" aria-label={`Remove path parameter ${index + 1}`}
        onClick={() => setParameters(parameters.filter(value => value.id !== parameter.id))}>×</button>
    </div>)}
    <button type="button" onClick={() => setParameters([...parameters, { id: crypto.randomUUID(), name: '', value: '' }])}>+ Add path parameter</button>
  </div>;
}
