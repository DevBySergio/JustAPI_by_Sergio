import { useState } from 'react';
import type { EnvImportPreview } from '../../../src/models/Environment';
import type { VariableSet } from '../../../src/models/VariableSet';
import { useVariableStore } from '../stores/useVariableStore';
import { postMessageWithAck, type WebviewMessageInput } from '../utils/vscodeApi';
import { LocalButton } from './Common/LocalButton';

const inputStyle = { minWidth: 0, padding: '4px', background: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)', border: '1px solid var(--vscode-input-border)' };

export function EnvironmentPanel({ preview, onClosePreview, onError }: {
  preview: EnvImportPreview | null; onClosePreview: (id: string) => void; onError: (message: string) => void;
}) {
  const state = useVariableStore();
  const environments = state.variableSets.filter(set => set.kind === 'environment');
  const [selected, setSelected] = useState(''); const [newName, setNewName] = useState('');
  const [showValues, setShowValues] = useState(false); const [confirmDelete, setConfirmDelete] = useState(false);
  const saved = environments.find(set => set.id === selected);
  const draft = saved ? state.environmentDrafts[saved.id] ?? saved : undefined;
  const busy = state.environmentUpdate !== null;
  const run = async (message: WebviewMessageInput, done?: () => void) => {
    const promise = postMessageWithAck(message); state.setEnvironmentUpdate(promise);
    try { await promise; done?.(); } catch (error) { onError(String(error)); }
  };
  const edit = (patch: Partial<VariableSet>) => { if (draft) { state.setEnvironmentDraft({ ...draft, ...patch }); } };
  return <div style={{ padding: '8px', fontSize: '11px', overflowWrap: 'anywhere' }}>
    <h3 style={{ fontSize: '13px', margin: '0 0 8px' }}>Environments</h3>
    <p>Global → linked sets → active environment → collection → request. Only the active environment is used, across all tabs.</p>
    <p>Values are saved locally. Use Auth Builder for secure credentials. Unsaved edits stay in this session; Save keeps them.</p>
    <form onSubmit={event => { event.preventDefault(); if (newName.trim()) { void run({ type: 'createVariableSet', name: newName.trim(), kind: 'environment' }, () => setNewName('')); } }}
      style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
      <input aria-label="New environment name" placeholder="New environment name" disabled={busy} value={newName} onChange={event => setNewName(event.target.value)} maxLength={1024} style={{ ...inputStyle, flex: 1 }} />
      <LocalButton primary disabled={busy || !newName.trim()} type="submit">Create</LocalButton>
    </form>
    <LocalButton disabled={busy} type="button" onClick={() => { void run({ type: 'previewEnvFile' }); }}>Import .env…</LocalButton>
    <LocalButton disabled={busy} type="button" onClick={() => { void run({ type: 'previewPostmanImport' }); }} style={{ marginLeft: '6px' }}>Import Postman…</LocalButton>
    {preview && <EnvPreview key={preview.previewId} preview={preview} busy={busy} run={run} onClose={onClosePreview}
      watching={state.envWatches.some(watch => watch.setId === preview.targetSetId)} />}
    <div style={{ marginTop: '12px' }}>
      <label htmlFor="edit-environment">Edit environment</label>
      <select id="edit-environment" value={selected} disabled={busy} onChange={event => { setSelected(event.target.value); setShowValues(false); setConfirmDelete(false); }} style={{ ...inputStyle, width: '100%' }}>
        <option value="">Select an environment</option>
        {environments.map(set => <option key={set.id} value={set.id}>{set.name}{state.environmentDrafts[set.id] ? ' ●' : ''}</option>)}
      </select>
    </div>
    {draft && saved && <fieldset disabled={busy} style={{ margin: '8px 0', padding: '6px', minWidth: 0, border: '1px solid var(--vscode-panel-border)' }}>
      <legend>{saved.active ? 'Active environment' : 'Inactive environment'}</legend>
      <input aria-label="Environment name" value={draft.name} maxLength={1024} onChange={event => edit({ name: event.target.value })} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
      <label style={{ display: 'block', margin: '6px 0' }}><input type="checkbox" checked={showValues} onChange={event => setShowValues(event.target.checked)} /> Show environment values</label>
      {draft.variables.map((variable, index) => <div key={variable.id} style={{ display: 'flex', gap: '3px', marginBottom: '4px', alignItems: 'center' }}>
        <input type="checkbox" aria-label={`Enable environment variable ${index + 1}`} checked={variable.enabled}
          onChange={event => edit({ variables: draft.variables.map(value => value.id === variable.id ? { ...value, enabled: event.target.checked } : value) })} />
        <input aria-label={`Environment variable ${index + 1} name`} value={variable.key} maxLength={128} style={{ ...inputStyle, flex: 1 }}
          onChange={event => edit({ variables: draft.variables.map(value => value.id === variable.id ? { ...value, key: event.target.value } : value) })} />
        <input aria-label={`Environment variable ${index + 1} value`} type={showValues ? 'text' : 'password'} value={variable.value} maxLength={65536} style={{ ...inputStyle, flex: 1 }}
          onChange={event => edit({ variables: draft.variables.map(value => value.id === variable.id ? { ...value, value: event.target.value } : value) })} />
        <LocalButton type="button" aria-label={`Remove environment variable ${index + 1}`} onClick={() => edit({ variables: draft.variables.filter(value => value.id !== variable.id) })}>×</LocalButton>
      </div>)}
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', margin: '6px 0' }}>
        <LocalButton type="button" disabled={draft.variables.length >= 1000} onClick={() => edit({ variables: [...draft.variables, { id: crypto.randomUUID(), key: '', value: '', enabled: true, scope: 'collection' }] })}>Add variable</LocalButton>
        <LocalButton primary type="button" disabled={!draft.name.trim() || !state.environmentDrafts[draft.id]} onClick={() => { void run({ type: 'updateVariableSet', set: draft }, () => state.clearEnvironmentDraft(draft.id)); }}>Save environment</LocalButton>
        <LocalButton type="button" disabled={!state.environmentDrafts[draft.id]} onClick={() => state.clearEnvironmentDraft(draft.id)}>Discard edits</LocalButton>
      </div>
      {draft.updated !== saved.updated && <p role="status">The stored environment changed. Discard edits to reload it, or copy your pending values before retrying.</p>}
      <LocalButton type="button" disabled={Boolean(state.environmentDrafts[draft.id])} onClick={() => { void run({ type: 'previewEnvFile', setId: draft.id }); }}>Replace from .env…</LocalButton>
      {state.envWatches.some(watch => watch.setId === draft.id) && <div style={{ marginTop: '6px' }}>
        Watching {state.envWatches.find(watch => watch.setId === draft.id)?.fileName}. Changes require confirmation.
        <LocalButton type="button" onClick={() => { void run({ type: 'stopEnvWatch', setId: draft.id }, () => { if (preview?.targetSetId === draft.id) { onClosePreview(preview.previewId); } }); }}>Stop watching</LocalButton>
      </div>}
      <div style={{ marginTop: '8px' }}>
        <LocalButton type="button" onClick={() => setConfirmDelete(true)}>Delete environment</LocalButton>
        {confirmDelete && <span> Discard this environment and its pending edits?
          <LocalButton type="button" onClick={() => { void run({ type: 'deleteVariableSet', setId: draft.id }, () => { state.clearEnvironmentDraft(draft.id); setSelected(''); setConfirmDelete(false); if (preview?.targetSetId === draft.id) { onClosePreview(preview.previewId); } }); }}>Confirm delete environment</LocalButton>
          <LocalButton type="button" onClick={() => setConfirmDelete(false)}>Keep environment</LocalButton>
        </span>}
      </div>
    </fieldset>}
  </div>;
}

function EnvPreview({ preview, busy, run, onClose, watching }: {
  preview: EnvImportPreview; busy: boolean; run: (message: WebviewMessageInput, done?: () => void) => Promise<void>;
  onClose: (id: string) => void; watching: boolean;
}) {
  const savedName = useVariableStore(state => state.variableSets.find(set => set.id === preview.targetSetId)?.name);
  const [name, setName] = useState(savedName ?? preview.fileName); const [show, setShow] = useState(false); const [watch, setWatch] = useState(watching);
  const drafts = useVariableStore(state => state.environmentDrafts);
  const pendingEdits = Boolean(preview.targetSetId && drafts[preview.targetSetId]);
  return <section aria-label="Environment import preview" style={{ marginTop: '8px', padding: '8px', border: '1px solid var(--vscode-focusBorder)', overflowWrap: 'anywhere' }}>
    <h4 style={{ margin: '0 0 6px' }}>{preview.targetSetId ? 'Replace environment variables' : 'Import environment'}: {preview.fileName}</h4>
    <label>Imported environment name<input aria-label="Imported environment name" disabled={busy} value={name} maxLength={1024} onChange={event => setName(event.target.value)} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} /></label>
    <label style={{ display: 'block', marginTop: '6px' }}><input type="checkbox" checked={show} onChange={event => setShow(event.target.checked)} /> Show imported values</label>
    <div style={{ maxHeight: '200px', overflow: 'auto', margin: '6px 0' }}>{preview.variables.map(variable => <div key={variable.id}><code>{variable.key}</code>: <span style={{ whiteSpace: 'pre-wrap' }}>{show ? variable.value || '(empty)' : '••••••'}</span></div>)}</div>
    {preview.diagnostics.map((diagnostic, index) => <p role="alert" key={index}>Line {diagnostic.line}: {diagnostic.code}</p>)}
    {!preview.variables.length && <p role="status">This file contains no assignments. Confirming imports an empty environment.</p>}
    {pendingEdits && <p role="alert">Save or discard the pending environment edits before replacing its variables.</p>}
    <label style={{ display: 'block', margin: '6px 0' }}><input type="checkbox" disabled={busy} checked={watch} onChange={event => setWatch(event.target.checked)} /> Watch this file during this session</label>
    <p>File changes require review. They never apply variables or send requests automatically. Importing keeps the current environment selected.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
      <LocalButton primary type="button" disabled={busy || pendingEdits || !name.trim() || preview.diagnostics.length > 0}
        onClick={() => { void run({ type: 'confirmEnvImport', previewId: preview.previewId, name: name.trim(), watch }, () => onClose(preview.previewId)); }}>Confirm environment import</LocalButton>
      <LocalButton type="button" disabled={busy} onClick={() => { void run({ type: 'cancelEnvImport', previewId: preview.previewId }, () => onClose(preview.previewId)); }}>Cancel environment import</LocalButton>
    </div>
  </section>;
}
