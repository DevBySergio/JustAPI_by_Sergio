import './setupDOM';
import * as assert from 'node:assert/strict';
import { beforeEach, afterEach, describe, test } from 'node:test';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { createRequestTab, useRequestStore } from '../src/stores/useRequestStore';
import { useVariableStore } from '../src/stores/useVariableStore';
import { useCollectionStore } from '../src/stores/useCollectionStore';
import { useHistoryStore } from '../src/stores/useHistoryStore';
import { createDefaultRequest } from '../../src/models/Request';
import type { VariableSet } from '../../src/models/VariableSet';
import type { EnvImportPreview } from '../../src/models/Environment';
import type { WebviewMessage } from '../../src/models/MessageProtocol';
import { host, send, acknowledge } from './setupDOM';

const env = (id: string, active = false): VariableSet => ({ id, name: id, kind: 'environment', active, variables: [], linkedCollectionIds: [], created: 1, updated: 1 });
let sets: VariableSet[]; let preview: EnvImportPreview; let receive: (message: WebviewMessage) => void;
beforeEach(() => {
  sets = [env('Dev', true), env('Prod'), { ...env('Shared'), kind: undefined, active: undefined }];
  preview = { previewId: 'env-preview', fileName: '.env.local', variables: [{ id: 'host', key: 'HOST', value: 'synthetic-env-secret', enabled: true, scope: 'collection' }], diagnostics: [] };
  host.state = null; host.messages = [];
  const tab = createRequestTab({ ...createDefaultRequest(), url: 'https://{{HOST}}/items' });
  useRequestStore.getState().initializeTabs([tab], tab.tabId);
  useVariableStore.setState({ variableSets: sets, environmentDrafts: {}, environmentUpdate: null, envWatches: [], globalVariables: [] });
  useCollectionStore.setState({ collections: [], activeCollectionId: null }); useHistoryStore.setState({ entries: [] });
  receive = message => {
    if (message.type === 'webviewReady') { send({ type: 'initializationComplete', operationId: message.operationId }); }
    if (message.type === 'selectEnvironment') { sets = sets.map(set => set.kind === 'environment' ? { ...set, active: set.id === message.setId } : set); }
    if (message.type === 'previewEnvFile') { send({ type: 'envImportPreview', operationId: message.operationId, preview: { ...preview, ...(message.setId ? { targetSetId: message.setId } : {}) } }); }
    if (message.type === 'createVariableSet') { sets = [...sets, env(message.name)]; }
    if (message.type === 'confirmEnvImport') { sets = [...sets, { ...env(message.name), variables: preview.variables }]; }
    if (message.type === 'updateVariableSet') { sets = sets.map(set => set.id === message.set.id ? { ...message.set, updated: set.updated + 1 } : set); }
    if (message.type === 'deleteVariableSet') { sets = sets.filter(set => set.id !== message.setId); }
    if (['selectEnvironment', 'createVariableSet', 'confirmEnvImport', 'updateVariableSet', 'deleteVariableSet'].includes(message.type)) {
      send({ type: 'variableSets', operationId: message.operationId, sets });
    }
    acknowledge(message);
  }; host.receive = receive;
});
afterEach(() => cleanup());
async function open() { render(<App />); await screen.findByLabelText('Request name'); }
async function manage() { await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Manage' })); }); await screen.findByRole('heading', { name: 'Environments' }); }
async function pick() { await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Import .env…' })); }); await screen.findByRole('region', { name: 'Environment import preview' }); }

describe('environment selection and local import UI', () => {
  test('lists only environments and waits for selection acknowledgement before sending', async () => {
    let selection: Extract<WebviewMessage, { type: 'selectEnvironment' }> | undefined;
    host.receive = message => { if (message.type === 'selectEnvironment') { selection = message; } else { receive(message); } };
    await open(); assert.equal(screen.queryByRole('option', { name: 'Shared' }), null);
    fireEvent.change(screen.getByLabelText('Environment', { exact: true }), { target: { value: 'Prod' } });
    await waitFor(() => assert.ok(selection));
    assert.equal((screen.getByLabelText('Environment', { exact: true }) as HTMLSelectElement).disabled, true);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => { await Promise.resolve(); });
    assert.equal(host.messages.some(message => message.type === 'executeRequest'), false);
    await act(async () => { receive(selection!); });
    await waitFor(() => assert.ok(host.messages.some(message => message.type === 'executeRequest')));
    assert.equal((screen.getByLabelText('Environment', { exact: true }) as HTMLSelectElement).value, 'Prod');
    assert.equal(useRequestStore.getState().tabs.length, 1);
  });
  test('keeps a failed selection unchanged and prevents its waiting send', async () => {
    let selection: WebviewMessage | undefined;
    host.receive = message => { if (message.type === 'selectEnvironment') { selection = message; } else { receive(message); } };
    await open(); fireEvent.change(screen.getByLabelText('Environment', { exact: true }), { target: { value: 'Prod' } });
    await waitFor(() => assert.ok(selection)); fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => { send({ type: 'error', operationId: selection!.operationId, code: 'OPERATION_FAILED', message: 'Disk unavailable' }); });
    await waitFor(() => assert.equal(useVariableStore.getState().environmentUpdate, null));
    assert.equal((screen.getByLabelText('Environment', { exact: true }) as HTMLSelectElement).value, 'Dev');
    assert.equal(host.messages.some(message => message.type === 'executeRequest'), false);
  });
  test('masks preview values, requires confirmation and keeps source data out of webview persistence', async () => {
    await open(); await manage(); await pick();
    assert.equal(screen.queryByText('synthetic-env-secret'), null); assert.doesNotMatch(JSON.stringify(host.state), /synthetic-env-secret/);
    assert.equal(host.messages.some(message => message.type === 'confirmEnvImport'), false);
    fireEvent.click(screen.getByLabelText('Show imported values')); assert.ok(screen.getByText(/synthetic-env-secret/));
    fireEvent.change(screen.getByLabelText('Imported environment name'), { target: { value: 'Local' } });
    fireEvent.click(screen.getByLabelText('Watch this file during this session'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm environment import' })); });
    await waitFor(() => assert.equal(screen.queryByRole('region', { name: 'Environment import preview' }), null));
    const imported = host.messages.find(message => message.type === 'confirmEnvImport'); assert.ok(imported?.type === 'confirmEnvImport');
    assert.equal(imported.watch, true); assert.equal(imported.name, 'Local');
    assert.equal((screen.getByLabelText('Environment', { exact: true }) as HTMLSelectElement).value, 'Dev');
    assert.doesNotMatch(JSON.stringify(host.state), /synthetic-env-secret/);
  });
  test('blocks invalid previews and cancel never writes an environment', async () => {
    preview = { ...preview, diagnostics: [{ line: 2, code: 'DUPLICATE_NAME' }] };
    await open(); await manage(); await pick(); assert.ok(screen.getByText(/Line 2: DUPLICATE_NAME/));
    assert.equal((screen.getByRole('button', { name: 'Confirm environment import' }) as HTMLButtonElement).disabled, true);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel environment import' })); });
    await waitFor(() => assert.equal(screen.queryByRole('region', { name: 'Environment import preview' }), null));
    assert.equal(sets.length, 3); assert.equal(host.messages.some(message => message.type === 'confirmEnvImport'), false);
  });
  test('retains unsaved environment edits across navigation and failed saves, then saves or discards explicitly', async () => {
    await open(); await manage(); fireEvent.change(screen.getByLabelText('Edit environment'), { target: { value: 'Dev' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }));
    fireEvent.change(screen.getByLabelText('Environment variable 1 name'), { target: { value: 'HOST' } });
    fireEvent.change(screen.getByLabelText('Environment variable 1 value'), { target: { value: 'draft-secret' } });
    assert.equal((screen.getByLabelText('Environment variable 1 value') as HTMLInputElement).type, 'password');
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Request' })); });
    await screen.findByLabelText('Request name'); await manage(); fireEvent.change(screen.getByLabelText('Edit environment'), { target: { value: 'Dev' } });
    assert.equal((screen.getByLabelText('Environment variable 1 value') as HTMLInputElement).value, 'draft-secret');
    assert.doesNotMatch(JSON.stringify(host.state), /draft-secret/);
    let fail = true;
    host.receive = message => { if (message.type === 'updateVariableSet' && fail) { send({ type: 'error', operationId: message.operationId, code: 'OPERATION_FAILED', message: 'Disk failure' }); } else { receive(message); } };
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save environment' })); });
    await waitFor(() => assert.equal(useVariableStore.getState().environmentUpdate, null));
    assert.ok(useVariableStore.getState().environmentDrafts.Dev); assert.equal(sets[0].variables.length, 0);
    fail = false; await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save environment' })); });
    await waitFor(() => assert.equal(useVariableStore.getState().environmentDrafts.Dev, undefined)); assert.equal(sets[0].variables[0].value, 'draft-secret');
  });
  test('watch previews survive section changes, do not overwrite pending edits and can be stopped', async () => {
    await open(); await manage(); fireEvent.change(screen.getByLabelText('Edit environment'), { target: { value: 'Dev' } });
    fireEvent.change(screen.getByLabelText('Environment name'), { target: { value: 'Pending name' } });
    await act(async () => {
      send({ type: 'envWatches', operationId: 'watch-state', watches: [{ setId: 'Dev', fileName: '.env' }] });
      send({ type: 'envImportPreview', operationId: 'watch-preview', preview: { ...preview, targetSetId: 'Dev' } });
    });
    assert.equal((screen.getByRole('button', { name: 'Confirm environment import' }) as HTMLButtonElement).disabled, true);
    assert.equal((screen.getByLabelText('Environment name') as HTMLInputElement).value, 'Pending name');
    fireEvent.click(screen.getByRole('button', { name: 'Discard edits' }));
    assert.equal((screen.getByRole('button', { name: 'Confirm environment import' }) as HTMLButtonElement).disabled, false);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop watching' })); });
    assert.ok(host.messages.some(message => message.type === 'stopEnvWatch' && message.setId === 'Dev'));
  });
});
