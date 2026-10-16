import './setupDOM';
import * as assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App';
import { VariableEditor } from '../src/components/VariableEditor';
import { VariableAutosave } from '../src/utils/VariableAutosave';
import { useCollectionStore } from '../src/stores/useCollectionStore';
import { useRequestStore } from '../src/stores/useRequestStore';
import { useVariableStore } from '../src/stores/useVariableStore';
import { useResponseStore } from '../src/stores/useResponseStore';
import { useHistoryStore } from '../src/stores/useHistoryStore';
import { createDefaultRequest } from '../../src/models/Request';
import { createPersistedWebviewState } from '../../src/webview/WebviewState';
import type { WebviewMessage } from '../../src/models/MessageProtocol';
import type { Collection } from '../../src/models/Collection';
import { acknowledge, host, send } from './setupDOM';

const collection = { id: 'collection-ui', name: 'UI collection', variables: [], items: [], created: 1, updated: 1 };

beforeEach(() => {
  host.state = null;
  host.messages = [];
  useRequestStore.setState({ currentRequest: { ...createDefaultRequest(), url: 'https://example.test', name: 'Original' }, authPending: false, authRevision: 0, authUpdate: null, isExecuting: false, activeExecutionId: null });
  useCollectionStore.setState({ collections: [collection], activeCollectionId: collection.id });
  useVariableStore.setState({ globalVariables: [], variableSets: [] });
  useResponseStore.getState().clearResponse();
  useHistoryStore.setState({ entries: [] });
  host.receive = message => {
    if (message.type === 'webviewReady') { send({ type: 'initializationComplete', operationId: message.operationId }); }
    if (message.type === 'configureAuth') {
      send({ type: 'requestAuthUpdated', operationId: message.operationId, requestId: message.requestId, auth: { type: 'bearer', configured: true }, pending: true });
    }
    acknowledge(message);
  };
});

describe('daily workflow components', () => {
  test('creates and renames folders through forms and retains failed edits for retry', async () => {
    let tree: Collection = { ...collection, items: [] };
    const original = host.receive;
    let rejectCreate = true;
    host.receive = message => {
      if (message.type === 'createFolder') {
        if (rejectCreate) {
          send({ type: 'error', operationId: message.operationId, code: 'OPERATION_FAILED', message: 'Disk unavailable' });
          return;
        }
        tree = { ...tree, items: [{ id: 'folder-ui', type: 'folder', name: message.name, items: [] }] };
        send({ type: 'collections', operationId: message.operationId, collections: [tree] });
      }
      if (message.type === 'renameFolder') {
        tree = { ...tree, items: tree.items.map(item => ({ ...item, name: message.name })) };
        send({ type: 'collections', operationId: message.operationId, collections: [tree] });
      }
      original(message);
    };
    await openApp();
    fireEvent.click(screen.getByRole('tab', { name: 'Collections' }));
    await waitFor(() => assert.ok(screen.getByLabelText(`New folder in ${collection.name}`)));
    fireEvent.click(screen.getByLabelText(`New folder in ${collection.name}`));
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Nested API' } });
    fireEvent.submit(screen.getByLabelText('Folder name').closest('form')!);
    await waitFor(() => assert.ok(screen.getAllByText('Error: Disk unavailable').length));
    assert.equal((screen.getByLabelText('Folder name') as HTMLInputElement).value, 'Nested API');
    rejectCreate = false;
    await waitFor(() => assert.equal((screen.getByRole('button', { name: 'Create folder' }) as HTMLButtonElement).disabled, false));
    fireEvent.submit(screen.getByLabelText('Folder name').closest('form')!);
    await waitFor(() => assert.ok(screen.getByLabelText('Organize folder Nested API')));
    fireEvent.click(screen.getByLabelText('Organize folder Nested API'));
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Renamed API' } });
    fireEvent.submit(screen.getByLabelText('Folder name').closest('form')!);
    await waitFor(() => assert.ok(screen.getByLabelText('Organize folder Renamed API')));
    assert.equal(host.messages.filter(message => message.type === 'renameFolder').length, 1);
  });

  test('offers valid destinations and preserves the active request collection after a folder move', async () => {
    const request = useRequestStore.getState().currentRequest;
    const parent = { id: 'parent-ui', name: 'Parent', type: 'folder' as const, items: [
      { id: 'child-ui', name: 'Child', type: 'folder' as const, items: [{ id: request.id, requestId: request.id, name: request.name, type: 'request' as const }] },
    ] };
    const first = { ...collection, items: [parent] };
    const second = { ...collection, id: 'second-ui', name: 'Destination', items: [{ id: 'destination-folder', name: 'Target folder', type: 'folder' as const, items: [] }] };
    useCollectionStore.setState({ collections: [first, second] });
    const original = host.receive;
    host.receive = message => {
      if (message.type === 'moveItem') {
        send({ type: 'collections', operationId: message.operationId, collections: [
          { ...first, items: [] }, { ...second, items: [{ ...second.items[0], items: [parent] }] },
        ] });
      }
      original(message);
    };
    await openApp();
    fireEvent.click(screen.getByRole('tab', { name: 'Collections' }));
    await waitFor(() => assert.ok(screen.getByLabelText('Organize folder Parent')));
    fireEvent.click(screen.getByLabelText('Organize folder Parent'));
    fireEvent.click(screen.getByRole('button', { name: 'Move…' }));
    assert.deepEqual(within(screen.getByLabelText('Destination folder')).getAllByRole('option').map(option => option.textContent), ['Collection root']);
    fireEvent.change(screen.getByLabelText('Destination collection'), { target: { value: second.id } });
    fireEvent.change(screen.getByLabelText('Destination folder'), { target: { value: 'destination-folder' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move here' }));
    await waitFor(() => assert.equal(useCollectionStore.getState().activeCollectionId, second.id));
    const moved = host.messages.find(message => message.type === 'moveItem');
    assert.ok(moved?.type === 'moveItem');
    assert.equal(moved.targetParentId, 'destination-folder');
    assert.equal(moved.targetIndex, 0);
    fireEvent.click(screen.getByRole('tab', { name: 'Request' }));
    await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Save' })));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => assert.ok(host.messages.some(message => message.type === 'saveRequest' && message.collectionId === second.id)));
  });

  test('protects dirty descendants on deletion, cancels execution and resets the editor after confirmation', async () => {
    const request = useRequestStore.getState().currentRequest;
    const tree = { ...collection, items: [{ id: 'delete-folder', name: 'Delete folder', type: 'folder' as const, items: [
      { id: request.id, requestId: request.id, name: request.name, type: 'request' as const },
    ] }] };
    useCollectionStore.setState({ collections: [tree] });
    const original = host.receive;
    host.receive = message => {
      if (message.type === 'deleteFolder') { send({ type: 'collections', operationId: message.operationId, collections: [collection] }); }
      original(message);
    };
    await openApp();
    fireEvent.change(screen.getByLabelText('Request name'), { target: { value: 'Unsaved name' } });
    await act(async () => { useRequestStore.getState().beginExecution('deletion-execution'); });
    fireEvent.click(screen.getByRole('tab', { name: 'Collections' }));
    await waitFor(() => assert.ok(screen.getByLabelText('Organize folder Delete folder')));
    fireEvent.click(screen.getByLabelText('Organize folder Delete folder'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    assert.ok(screen.getByRole('alertdialog'));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Keep editing' }));
    assert.equal(host.messages.some(message => message.type === 'deleteFolder'), false);
    assert.equal(useRequestStore.getState().currentRequest.name, 'Unsaved name');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard and delete' }));
    await waitFor(() => assert.notEqual(useRequestStore.getState().currentRequest.id, request.id));
    assert.equal(useRequestStore.getState().activeExecutionId, null);
    assert.ok(host.messages.some(message => message.type === 'cancelRequest' && message.executionId === 'deletion-execution'));
    assert.equal(host.messages.filter(message => message.type === 'deleteFolder').length, 1);
  });

  test('edits request variables and path values as a draft and includes them when saving and sending', async () => {
    await openApp();
    fireEvent.click(screen.getByRole('tab', { name: 'Vars' }));
    await waitFor(() => assert.ok(screen.getByRole('group', { name: 'Request variables' })));
    const variables = within(screen.getByRole('group', { name: 'Request variables' }));
    fireEvent.click(variables.getByRole('button', { name: '+ Add' }));
    fireEvent.change(variables.getByLabelText('Variable name 1'), { target: { value: 'user' } });
    fireEvent.change(variables.getByLabelText('Variable value 1'), { target: { value: 'local user' } });
    assert.ok(screen.getByText('Unsaved changes'));
    fireEvent.click(screen.getByRole('tab', { name: 'Params' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add path parameter' }));
    fireEvent.change(screen.getByLabelText('Path name 1'), { target: { value: 'id' } });
    fireEvent.change(screen.getByLabelText('Path value 1'), { target: { value: '{{user}}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => assert.equal(host.messages.filter(message => message.type === 'saveRequest' || message.type === 'executeRequest').length, 2));
    for (const message of host.messages) {
      if (message.type !== 'saveRequest' && message.type !== 'executeRequest') { continue; }
      assert.deepEqual(message.request.variables.map(variable => [variable.key, variable.value, variable.scope]), [['user', 'local user', 'request']]);
      assert.deepEqual(message.request.pathParams.map(parameter => [parameter.name, parameter.value]), [['id', '{{user}}']]);
    }
  });

  test('discards a late variable preview after the draft changes', async () => {
    await openApp();
    fireEvent.click(screen.getByRole('tab', { name: 'Vars' }));
    await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Preview Resolved Variables' })));
    fireEvent.click(screen.getByRole('button', { name: 'Preview Resolved Variables' }));
    await waitFor(() => assert.ok(host.messages.some(message => message.type === 'previewResolution')));
    const preview = host.messages.find(message => message.type === 'previewResolution')!;
    fireEvent.change(screen.getByLabelText('Request name'), { target: { value: 'New draft' } });
    await act(async () => { send({ type: 'resolutionPreview', operationId: preview.operationId, resolvedUrl: 'https://obsolete.test',
      resolvedHeaders: '[]', resolvedQueryParams: '[]', resolvedBody: '', diagnostics: [], canExecute: true }); });
    assert.equal(screen.queryByText('Ready to execute'), null);
    assert.equal(screen.queryByText('https://obsolete.test'), null);
  });
});
afterEach(() => { cleanup(); });

async function openApp(waitForReady = true): Promise<void> {
  render(<App />);
  await waitFor(() => assert.ok(host.messages.some(message => message.type === 'webviewReady')));
  if (waitForReady) { await waitFor(() => assert.ok(screen.getByLabelText('Request name'))); }
}

describe('editor component regressions', () => {
  test('withholds the editor until every initial domain has been confirmed', async () => {
    host.receive = message => acknowledge(message);
    await openApp(false);
    assert.equal(screen.queryByLabelText('Request name'), null);
    assert.ok(screen.getByText('Loading local data…'));
    const ready = host.messages.find(message => message.type === 'webviewReady');
    assert.ok(ready);
    await act(async () => { send({ type: 'initializationComplete', operationId: ready.operationId }); });
    assert.ok(screen.getByLabelText('Request name'));
  });

  test('does not save remote snapshots and retains a variable edit across unmount', async () => {
    const sent: unknown[] = [];
    const autosave = new VariableAutosave(async message => { sent.push(message); }, error => { throw error; });
    useVariableStore.setState({ globalVariables: [{ id: 'variable-ui', key: 'host', value: 'old', enabled: true, scope: 'global' }] });
    const view = render(<VariableEditor autosave={autosave} />);
    await act(async () => {
      useCollectionStore.getState().setCollections(JSON.parse(JSON.stringify([collection])));
      await autosave.flush();
    });
    assert.equal(sent.length, 0);
    fireEvent.change(screen.getByDisplayValue('old'), { target: { value: 'new' } });
    view.unmount();
    await autosave.flush();
    assert.deepEqual(sent, [{ type: 'setGlobalVariables', variables: [{ id: 'variable-ui', key: 'host', value: 'new', enabled: true, scope: 'global' }] }]);
  });

  test('keeps edits made after a save was submitted', async () => {
    let saved: Extract<WebviewMessage, { type: 'saveRequest' }> | undefined;
    const original = host.receive;
    host.receive = message => { if (message.type === 'saveRequest') { saved = message; } else { original(message); } };
    await openApp();
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => assert.ok(saved));
    fireEvent.change(screen.getByLabelText('Request name'), { target: { value: 'Typed during save' } });
    await act(async () => {
      assert.ok(saved);
      send({ type: 'requestSaved', operationId: saved.operationId, request: { ...saved.request, updated: saved.request.updated + 1 } });
      acknowledge(saved);
    });
    assert.equal((screen.getByLabelText('Request name') as HTMLInputElement).value, 'Typed during save');
    assert.ok(screen.getByText('Unsaved changes'));
  });

  test('marks token replacement dirty, protects navigation, and discards before replacing a request', async () => {
    const current = useRequestStore.getState().currentRequest;
    useRequestStore.setState({ currentRequest: { ...current, auth: { type: 'bearer', configured: true } } });
    await openApp();
    fireEvent.click(screen.getByRole('tab', { name: /^auth$/i }));
    await waitFor(() => assert.ok(screen.getByLabelText('Bearer token')));
    fireEvent.change(screen.getByLabelText('Bearer token'), { target: { value: 'synthetic-replacement' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => assert.equal(useRequestStore.getState().authPending, true));
    assert.ok(screen.getByText('Unsaved changes'));
    fireEvent.click(screen.getByTitle('New request'));
    assert.ok(screen.getByRole('alertdialog'));
    fireEvent.click(screen.getByRole('button', { name: 'Discard and create' }));
    await waitFor(() => assert.notEqual(useRequestStore.getState().currentRequest.id, current.id));
    assert.ok(host.messages.some(message => message.type === 'discardRequestChanges' && message.requestId === current.id));
    assert.equal(useRequestStore.getState().authPending, false);
  });

  test('clears and cancels an old execution when opening a new request and ignores its late response', async () => {
    await openApp();
    await act(async () => { useRequestStore.getState().beginExecution('execution-old'); });
    fireEvent.click(screen.getByTitle('New request'));
    await waitFor(() => assert.equal(useRequestStore.getState().activeExecutionId, null));
    assert.ok(host.messages.some(message => message.type === 'cancelRequest' && message.executionId === 'execution-old'));
    await act(async () => {
      send({ type: 'response', operationId: 'old-operation', executionId: 'execution-old', response: { statusCode: 200, statusText: 'OK', httpVersion: 'HTTP/1.1', headers: {}, body: 'old', bodyType: 'text', size: 3, duration: 1, timings: { total: 1 }, cookies: [], redirected: false } });
    });
    assert.equal(useResponseStore.getState().response, null);
  });

  test('flushes variable edits before leaving the panel and sending a request', async () => {
    useVariableStore.setState({ globalVariables: [{ id: 'v', key: 'base', value: 'old', enabled: true, scope: 'global' }] });
    await openApp();
    fireEvent.click(screen.getByRole('tab', { name: /^Variables$/ }));
    await waitFor(() => assert.ok(screen.getByDisplayValue('old')));
    fireEvent.change(screen.getByDisplayValue('old'), { target: { value: 'new' } });
    fireEvent.click(screen.getByRole('tab', { name: /^Request$/ }));
    await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Send' })));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => assert.ok(host.messages.some(message => message.type === 'executeRequest')));
    assert.ok(host.messages.findIndex(message => message.type === 'setGlobalVariables') < host.messages.findIndex(message => message.type === 'executeRequest'));
    assert.equal(host.messages.filter(message => message.type === 'setGlobalVariables').length, 1);
  });

  test('drops unsaved authentication on restoration and announces the omitted values', async () => {
    const baseline = useRequestStore.getState().currentRequest;
    host.state = createPersistedWebviewState({ activeTab: 'editor', variableSubTab: 'vars', activeCollectionId: collection.id, currentRequest: { ...baseline, auth: { type: 'bearer', configured: true } }, baselineRequest: baseline, pendingAuth: true });
    await openApp();
    assert.equal(useRequestStore.getState().currentRequest.auth.type, 'none');
    assert.ok(screen.getByText(/were not restored/));
  });
});
