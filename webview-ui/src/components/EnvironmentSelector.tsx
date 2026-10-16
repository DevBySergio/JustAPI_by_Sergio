import { useVariableStore } from '../stores/useVariableStore';
import { postMessageWithAck } from '../utils/vscodeApi';
import { LocalButton } from './Common/LocalButton';

export function EnvironmentSelector({ onManage, onError }: { onManage: () => void; onError: (error: string) => void }) {
  const sets = useVariableStore(state => state.variableSets);
  const pending = useVariableStore(state => state.environmentUpdate);
  const environments = sets.filter(set => set.kind === 'environment');
  return <div style={{ display: 'flex', gap: '6px', alignItems: 'center', padding: '5px 8px', fontSize: '11px', borderBottom: '1px solid var(--vscode-panel-border)' }}>
    <label htmlFor="active-environment">Environment</label>
    <select id="active-environment" disabled={pending !== null} value={environments.find(set => set.active)?.id ?? ''}
      title="Shared by all request tabs. Running requests keep their original environment values."
      onChange={event => {
        const update = postMessageWithAck({ type: 'selectEnvironment', setId: event.target.value || null });
        useVariableStore.getState().setEnvironmentUpdate(update); void update.catch(error => onError(String(error)));
      }} style={{ minWidth: 0, flex: 1, background: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)' }}>
      <option value="">No environment</option>
      {environments.map(set => <option key={set.id} value={set.id}>{set.name}</option>)}
    </select>
    <LocalButton type="button" onClick={onManage}>Manage</LocalButton>
  </div>;
}
