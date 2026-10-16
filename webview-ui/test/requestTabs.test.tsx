import './setupDOM';
import * as assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App';
import { createRequestTab, isRequestTabDirty, useRequestStore } from '../src/stores/useRequestStore';
import { useCollectionStore } from '../src/stores/useCollectionStore';
import { useHistoryStore } from '../src/stores/useHistoryStore';
import { useVariableStore } from '../src/stores/useVariableStore';
import { createDefaultRequest, type JustRequest } from '../../src/models/Request';
import { createPersistedRequestWorkspace } from '../../src/webview/WebviewState';
import type { WebviewMessage } from '../../src/models/MessageProtocol';
import type { JustResponse } from '../../src/models/Response';
import { acknowledge, host, send } from './setupDOM';

const alpha = { ...createDefaultRequest(), id: 'alpha', name: 'Alpha', url: 'https://alpha.test/items' };
const beta = { ...createDefaultRequest(), id: 'beta', name: 'Beta', url: 'https://beta.test/items' };
const gamma = { ...createDefaultRequest(), id: 'gamma', name: 'Gamma', url: 'https://gamma.test/items' };
const first = { id: 'first', name: 'First collection', variables: [], created: 1, updated: 1,
  items: [alpha, gamma].map(request => ({ id: request.id, requestId: request.id, name: request.name, type: 'request' as const })) };
const second = { ...first, id: 'second', name: 'Second collection', items: [{ id: beta.id, requestId: beta.id, name: beta.name, type: 'request' as const }] };
let defaultReceive: (message: WebviewMessage) => void;

beforeEach(() => {
  host.state = null; host.messages = [];
  const tab = createRequestTab(alpha, first.id);
  useRequestStore.getState().initializeTabs([tab], tab.tabId);
  useCollectionStore.setState({ collections: [first, second], activeCollectionId: first.id });
  useVariableStore.setState({ globalVariables: [], variableSets: [] });
  useHistoryStore.setState({ entries: [] });
  defaultReceive = message => {
    if (message.type === 'webviewReady') { send({ type: 'initializationComplete', operationId: message.operationId }); }
    if (message.type === 'getRequest') {
      const request = [alpha, beta, gamma].find(request => request.id === message.requestId)!;
      send({ type: 'requestLoaded', operationId: message.operationId, request });
    }
    if (message.type === 'saveRequest') { send({ type: 'requestSaved', operationId: message.operationId, request: { ...message.request } }); }
    if (message.type === 'configureAuth') {
      send({ type: 'requestAuthUpdated', operationId: message.operationId, requestId: message.requestId, auth: { type: 'bearer', configured: true }, pending: true });
    }
    if (message.type === 'deleteCollection') {
      send({ type: 'collections', operationId: message.operationId, collections: [first, second].filter(collection => collection.id !== message.collectionId) });
    }
    acknowledge(message);
  };
  host.receive = defaultReceive;
});
afterEach(() => { cleanup(); });
async function openApp() { render(<App />); await waitFor(() => assert.ok(screen.getByLabelText('Request name'))); }
function tabs() { return within(screen.getByRole('tablist', { name: 'Open requests' })); }
function select(name: string) { fireEvent.click(tabs().getByRole('tab', { name: new RegExp(`GET ${name}(,|$)`) })); }
async function openSaved(name: string, collection: string) {
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Collections' })); });
  await waitFor(() => assert.ok(screen.getByRole('button', { name: collection })));
  fireEvent.click(screen.getByRole('button', { name: collection }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: `➜ ${name}` })); });
}
function response(body: string): JustResponse {
  return { statusCode: 200, statusText: 'OK', httpVersion: 'HTTP/1.1', headers: {}, body, bodyType: 'text',
    size: body.length, duration: 1, timings: { total: 1 }, cookies: [], redirected: false };
}
async function respond(execution: Extract<WebviewMessage, { type: 'executeRequest' }>, body: string) {
  await act(async () => {
    send({ type: 'response', operationId: execution.operationId, executionId: execution.executionId, response: response(body) });
    send({ type: 'requestExecuting', operationId: execution.operationId, executionId: execution.executionId, executing: false });
  });
}
async function sendCurrent() {
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => assert.ok(host.messages.some(message => message.type === 'executeRequest' && message.request.id === useRequestStore.getState().currentRequest.id)));
  return host.messages.filter((message): message is Extract<WebviewMessage, { type: 'executeRequest' }> => message.type === 'executeRequest').at(-1)!;
}

describe('independent request tabs', () => {
  test('retains drafts, collection scopes and out-of-order responses while switching without discarding', async () => {
    await openApp();
    fireEvent.change(screen.getByLabelText('Request name'), { target: { value: 'Alpha draft' } });
    const a = await sendCurrent();
    fireEvent.click(screen.getByLabelText('New request tab'));
    assert.equal(screen.queryByRole('alertdialog'), null);
    fireEvent.change(screen.getByLabelText('Request name'), { target: { value: 'Other draft' } });
    fireEvent.change(screen.getByLabelText('Request URL'), { target: { value: 'https://other.test/path' } });
    fireEvent.change(screen.getByLabelText('Request collection'), { target: { value: second.id } });
    const b = await sendCurrent();
    select('Alpha draft');
    assert.equal(useRequestStore.getState().collectionId, first.id);
    assert.equal(useRequestStore.getState().isExecuting, true);
    await respond(b, 'OTHER RESPONSE');
    assert.equal(useRequestStore.getState().response, null);
    await respond(a, 'ALPHA RESPONSE');
    assert.equal(useRequestStore.getState().response?.body, 'ALPHA RESPONSE');
    select('Other draft');
    assert.equal((screen.getByLabelText('Request URL') as HTMLInputElement).value, 'https://other.test/path');
    assert.equal(useRequestStore.getState().collectionId, second.id);
    assert.equal(useRequestStore.getState().response?.body, 'OTHER RESPONSE');
    assert.equal(host.messages.some(message => message.type === 'discardRequestChanges' || message.type === 'cancelRequest'), false);
    assert.equal(useRequestStore.getState().tabs.filter(isRequestTabDirty).length, 2);
  });

  test('deduplicates an already open saved request without replacing its draft', async () => {
    await openApp();
    fireEvent.change(screen.getByLabelText('Request name'), { target: { value: 'Alpha edited' } });
    await openSaved('Alpha', first.name);
    await waitFor(() => assert.equal((screen.getByLabelText('Request name') as HTMLInputElement).value, 'Alpha edited'));
    assert.equal(useRequestStore.getState().tabs.length, 1);
    assert.equal(host.messages.some(message => message.type === 'getRequest'), false);
  });

  test('routes an authentication reply and a send suspended in preparation to their original inactive tab', async () => {
    let configure: Extract<WebviewMessage, { type: 'configureAuth' }> | undefined;
    host.receive = message => { if (message.type === 'configureAuth') { configure = message; } else { defaultReceive(message); } };
    await openApp();
    fireEvent.click(screen.getByRole('tab', { name: /^auth$/i }));
    await waitFor(() => assert.ok(screen.getByRole('radio', { name: /bearer/i })));
    fireEvent.click(screen.getByRole('radio', { name: /bearer/i }));
    fireEvent.change(screen.getByLabelText('Bearer token'), { target: { value: 'synthetic-alpha-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => assert.ok(configure));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.click(screen.getByLabelText('New request tab'));
    const otherId = useRequestStore.getState().currentRequest.id;
    await act(async () => { defaultReceive(configure!); });
    await waitFor(() => assert.ok(host.messages.some(message => message.type === 'executeRequest')));
    const execution = host.messages.find(message => message.type === 'executeRequest')!;
    assert.ok(execution.type === 'executeRequest');
    assert.equal(execution.request.id, alpha.id);
    assert.equal(execution.collectionId, first.id);
    assert.equal(useRequestStore.getState().currentRequest.id, otherId);
    assert.equal(useRequestStore.getState().authPending, false);
    assert.equal(useRequestStore.getState().tabs.find(tab => tab.currentRequest.id === alpha.id)?.authPending, true);
    assert.doesNotMatch(JSON.stringify(host.state), /synthetic-alpha-token/);
  });

  test('applies a late save to its inactive tab without overwriting newer edits', async () => {
    let save: Extract<WebviewMessage, { type: 'saveRequest' }> | undefined;
    host.receive = message => { if (message.type === 'saveRequest') { save = message; } else { defaultReceive(message); } };
    await openApp();
    fireEvent.change(screen.getByLabelText('Request name'), { target: { value: 'Alpha submitted' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => assert.ok(save));
    fireEvent.change(screen.getByLabelText('Request name'), { target: { value: 'Alpha newer' } });
    fireEvent.click(screen.getByLabelText('New request tab'));
    const other = useRequestStore.getState().tabId;
    await act(async () => { defaultReceive(save!); });
    const savedTab = useRequestStore.getState().tabs.find(tab => tab.currentRequest.id === alpha.id)!;
    assert.equal(savedTab.currentRequest.name, 'Alpha newer');
    assert.equal(savedTab.baselineRequest.name, 'Alpha submitted');
    assert.equal(isRequestTabDirty(savedTab), true);
    assert.equal(useRequestStore.getState().tabId, other);
    assert.equal((screen.getByLabelText('Request name') as HTMLInputElement).value, 'New Request');
  });

  test('cancels only a closed tab, leaving another execution alive and ignoring closed-tab responses', async () => {
    await openApp();
    const a = await sendCurrent();
    await openSaved('Beta', second.name);
    await waitFor(() => assert.equal((screen.getByLabelText('Request name') as HTMLInputElement).value, beta.name));
    const b = await sendCurrent();
    await act(async () => { fireEvent.click(screen.getByLabelText('Close request Alpha')); });
    await waitFor(() => assert.equal(useRequestStore.getState().tabs.length, 1));
    assert.equal(useRequestStore.getState().activeExecutionId, b.executionId);
    assert.deepEqual(host.messages.filter(message => message.type === 'cancelRequest').map(message => message.executionId), [a.executionId]);
    await respond(a, 'CLOSED RESPONSE');
    assert.equal(useRequestStore.getState().response, null);
    await respond(b, 'BETA RESPONSE');
    assert.equal(useRequestStore.getState().response?.body, 'BETA RESPONSE');
  });

  test('keeps a dirty tab after cancel or failed save and closes it only after a successful retry', async () => {
    await openApp();
    fireEvent.change(screen.getByLabelText('Request name'), { target: { value: 'Alpha changed' } });
    fireEvent.click(screen.getByLabelText('Close request Alpha changed'));
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    assert.equal(useRequestStore.getState().currentRequest.name, 'Alpha changed');
    host.receive = message => {
      if (message.type === 'saveRequest') { send({ type: 'error', operationId: message.operationId, code: 'OPERATION_FAILED', message: 'Disk full' }); }
      else { defaultReceive(message); }
    };
    fireEvent.click(screen.getByLabelText('Close request Alpha changed'));
    fireEvent.click(screen.getByRole('button', { name: 'Save and close' }));
    await waitFor(() => assert.equal(useRequestStore.getState().closing, false));
    assert.equal(useRequestStore.getState().currentRequest.name, 'Alpha changed');
    assert.equal(isRequestTabDirty(useRequestStore.getState()), true);
    assert.equal(host.messages.some(message => message.type === 'discardRequestChanges'), false);
    host.receive = defaultReceive;
    fireEvent.click(screen.getByLabelText('Close request Alpha changed'));
    fireEvent.click(screen.getByRole('button', { name: 'Save and close' }));
    await waitFor(() => assert.notEqual(useRequestStore.getState().currentRequest.id, alpha.id));
    assert.equal(useRequestStore.getState().tabs.length, 1);
  });

  test('loads separate saved requests independently, reports failed loads, and retries without focus stealing', async () => {
    const loads: Array<Extract<WebviewMessage, { type: 'getRequest' }>> = [];
    host.receive = message => { if (message.type === 'getRequest') { loads.push(message); } else { defaultReceive(message); } };
    await openApp();
    await openSaved('Beta', second.name);
    await waitFor(() => assert.equal(loads.length, 1));
    await openSaved('Gamma', first.name);
    await waitFor(() => assert.equal(loads.length, 2));
    const activeId = useRequestStore.getState().tabId;
    await act(async () => { defaultReceive(loads[0]); });
    assert.equal(useRequestStore.getState().tabId, activeId);
    assert.equal(useRequestStore.getState().tabs.find(tab => tab.currentRequest.id === beta.id)?.loading, false);
    await act(async () => { send({ type: 'error', operationId: loads[1].operationId, code: 'OPERATION_FAILED', message: 'Load failed' }); });
    assert.ok(screen.getByRole('button', { name: 'Retry loading request' }));
    assert.equal(screen.queryByLabelText('Request name'), null);
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading request' }));
    await waitFor(() => assert.equal(loads.length, 3));
    await act(async () => { defaultReceive(loads[2]); });
    assert.equal((screen.getByLabelText('Request name') as HTMLInputElement).value, gamma.name);
  });

  test('ignores a saved-request load after closing and reopening that request with a new tab identity', async () => {
    const loads: Array<Extract<WebviewMessage, { type: 'getRequest' }>> = [];
    host.receive = message => { if (message.type === 'getRequest') { loads.push(message); } else { defaultReceive(message); } };
    await openApp();
    await openSaved('Beta', second.name);
    await waitFor(() => assert.equal(loads.length, 1));
    const oldId = useRequestStore.getState().tabId;
    fireEvent.click(screen.getByLabelText('Close request Loading request…'));
    await waitFor(() => assert.equal(useRequestStore.getState().tabs.length, 1));
    await openSaved('Beta', second.name);
    await waitFor(() => assert.equal(loads.length, 2));
    assert.notEqual(useRequestStore.getState().tabId, oldId);
    await act(async () => { defaultReceive(loads[0]); });
    assert.equal(useRequestStore.getState().loading, true);
    await act(async () => { defaultReceive(loads[1]); });
    assert.equal(useRequestStore.getState().currentRequest.id, beta.id);
    assert.equal(useRequestStore.getState().loading, false);
  });

  test('protects dirty inactive descendants when deleting a collection and preserves unrelated tabs', async () => {
    await openApp();
    fireEvent.change(screen.getByLabelText('Request name'), { target: { value: 'Alpha pending' } });
    await openSaved('Beta', second.name);
    await waitFor(() => assert.equal(useRequestStore.getState().currentRequest.id, beta.id));
    fireEvent.change(screen.getByLabelText('Request name'), { target: { value: 'Beta pending' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Collections' }));
    await waitFor(() => assert.ok(screen.getByLabelText(`Delete collection ${first.name}`)));
    fireEvent.click(screen.getByLabelText(`Delete collection ${first.name}`));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    assert.ok(screen.getByRole('alertdialog'));
    assert.equal(host.messages.some(message => message.type === 'deleteCollection'), false);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Discard and delete' })); });
    await waitFor(() => assert.equal(useRequestStore.getState().tabs.length, 1));
    assert.equal(useRequestStore.getState().currentRequest.name, 'Beta pending');
    assert.deepEqual(host.messages.filter(message => message.type === 'discardRequestChanges').map(message => message.requestId), [alpha.id]);
  });

  test('restores all sanitized drafts and the active tab without resurrecting executions or pending credentials', async () => {
    const a = createRequestTab({ ...alpha, name: 'Alpha restored', auth: { type: 'bearer', configured: true } }, first.id);
    const b = createRequestTab({ ...beta, name: 'Beta restored' }, second.id);
    host.state = createPersistedRequestWorkspace({ activeTab: 'editor', variableSubTab: 'vars', activeRequestTabId: b.tabId,
      tabs: [a, b].map(tab => ({ tabId: tab.tabId, currentRequest: tab.currentRequest,
        baselineRequest: tab.currentRequest.id === alpha.id ? alpha : beta, collectionId: tab.collectionId,
        baselineCollectionId: tab.collectionId, pendingAuth: tab.currentRequest.id === alpha.id })) });
    await openApp();
    assert.equal((screen.getByLabelText('Request name') as HTMLInputElement).value, 'Beta restored');
    assert.equal(useRequestStore.getState().tabs.length, 2);
    select('Alpha restored');
    assert.equal(useRequestStore.getState().currentRequest.auth.type, 'none');
    assert.equal(useRequestStore.getState().authPending, false);
    assert.equal(useRequestStore.getState().isExecuting, false);
    assert.equal(useRequestStore.getState().response, null);
    assert.ok(screen.getByText(/were not restored/));
  });

  test('navigates request tabs with arrow keys and guards Delete on the focused dirty tab', async () => {
    await openApp();
    fireEvent.click(screen.getByLabelText('New request tab'));
    const newTab = tabs().getByRole('tab', { name: 'GET New Request' });
    fireEvent.keyDown(newTab, { key: 'ArrowLeft' });
    assert.equal(useRequestStore.getState().currentRequest.id, alpha.id);
    fireEvent.change(screen.getByLabelText('Request name'), { target: { value: 'Alpha keyboard' } });
    fireEvent.keyDown(tabs().getByRole('tab', { name: /GET Alpha keyboard/ }), { key: 'Delete' });
    assert.ok(screen.getByRole('alertdialog'));
    fireEvent.keyDown(document, { key: 'Escape' });
    assert.equal(screen.queryByRole('alertdialog'), null);
    assert.equal(useRequestStore.getState().tabs.length, 2);
  });

  test('keeps generated code in its owner tab when another tab issues a newer generation', async () => {
    const generations: Array<Extract<WebviewMessage, { type: 'generateCode' }>> = [];
    host.receive = message => { if (message.type === 'generateCode') { generations.push(message); } else { defaultReceive(message); } };
    await openApp();
    fireEvent.click(screen.getByRole('tab', { name: 'Code' }));
    await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Generate Code' })));
    fireEvent.click(screen.getByRole('button', { name: 'Generate Code' }));
    await waitFor(() => assert.equal(generations.length, 1));
    await openSaved('Beta', second.name);
    await waitFor(() => assert.equal((screen.getByLabelText('Request name') as HTMLInputElement).value, beta.name));
    fireEvent.click(screen.getByRole('tab', { name: 'Code' }));
    await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Generate Code' })));
    fireEvent.click(screen.getByRole('button', { name: 'Generate Code' }));
    await waitFor(() => assert.equal(generations.length, 2));
    await act(async () => {
      send({ type: 'codeGenerationResult', operationId: generations[0].operationId, language: 'javascript', code: 'ALPHA CODE' });
    });
    assert.equal(useRequestStore.getState().code, '');
    await act(async () => {
      send({ type: 'codeGenerationResult', operationId: generations[1].operationId, language: 'javascript', code: 'BETA CODE' });
    });
    assert.equal(useRequestStore.getState().code, 'BETA CODE');
    select('Alpha');
    assert.ok(screen.getByDisplayValue('ALPHA CODE'));
  });

  test('retains all existing tabs when the tab limit is reached', async () => {
    const list = Array.from({ length: 20 }, (_, index) => createRequestTab({ ...alpha, id: `limit-${index}`, name: `Request ${index}` }, first.id));
    useRequestStore.getState().initializeTabs(list, list[0].tabId);
    await openApp();
    fireEvent.click(screen.getByLabelText('New request tab'));
    assert.equal(useRequestStore.getState().tabs.length, 20);
    assert.equal(useRequestStore.getState().tabId, list[0].tabId);
    assert.ok(screen.getByText(/maximum 20/));
  });

  test('allows discard-and-close even when an in-flight authentication update fails', async () => {
    let configure: Extract<WebviewMessage, { type: 'configureAuth' }> | undefined;
    host.receive = message => { if (message.type === 'configureAuth') { configure = message; } else { defaultReceive(message); } };
    await openApp();
    fireEvent.click(screen.getByRole('tab', { name: /^auth$/i }));
    await waitFor(() => assert.ok(screen.getByRole('radio', { name: /bearer/i })));
    fireEvent.click(screen.getByRole('radio', { name: /bearer/i }));
    fireEvent.change(screen.getByLabelText('Bearer token'), { target: { value: 'synthetic-failed-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => assert.ok(configure));
    fireEvent.click(screen.getByLabelText('Close request Alpha'));
    fireEvent.click(screen.getByRole('button', { name: 'Discard and close' }));
    await act(async () => { send({ type: 'error', operationId: configure!.operationId, code: 'OPERATION_FAILED', message: 'Secret storage unavailable' }); });
    await waitFor(() => assert.notEqual(useRequestStore.getState().currentRequest.id, alpha.id));
    assert.ok(host.messages.some(message => message.type === 'discardRequestChanges' && message.requestId === alpha.id));
  });

  test('returns keyboard focus to the adjacent tab after closing the active clean tab', async () => {
    await openApp();
    fireEvent.click(screen.getByLabelText('New request tab'));
    const fresh = tabs().getByRole('tab', { name: 'GET New Request' });
    fresh.focus();
    fireEvent.keyDown(fresh, { key: 'Delete' });
    await waitFor(() => assert.equal(document.activeElement?.id, tabs().getByRole('tab', { name: 'GET Alpha' }).id));
    assert.equal(useRequestStore.getState().tabs.length, 1);
  });

  test('keeps a newer collection selection when an older save moves the saved request', async () => {
    let saved: Extract<WebviewMessage, { type: 'saveRequest' }> | undefined;
    host.receive = message => { if (message.type === 'saveRequest') { saved = message; } else { defaultReceive(message); } };
    await openApp();
    fireEvent.change(screen.getByLabelText('Request collection'), { target: { value: second.id } });
    assert.ok(screen.getByText('Unsaved changes'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => assert.ok(saved));
    fireEvent.change(screen.getByLabelText('Request collection'), { target: { value: first.id } });
    await act(async () => {
      send({ type: 'collections', operationId: saved!.operationId, collections: [
        { ...first, items: first.items.filter(item => item.requestId !== alpha.id) },
        { ...second, items: [...second.items, first.items[0]] },
      ] });
      defaultReceive(saved!);
    });
    assert.equal(useRequestStore.getState().collectionId, first.id);
    assert.equal(useRequestStore.getState().baselineCollectionId, second.id);
    assert.equal(isRequestTabDirty(useRequestStore.getState()), true);
  });

  test('restores focus after saving and closing a dirty inactive tab', async () => {
    const a = createRequestTab(alpha, first.id);
    const b = createRequestTab({ ...beta, name: 'Beta changed' }, second.id);
    b.baselineRequest = beta;
    useRequestStore.getState().initializeTabs([a, b], a.tabId);
    await openApp();
    const close = screen.getByLabelText('Close request Beta changed');
    close.focus();
    fireEvent.click(close);
    fireEvent.click(screen.getByRole('button', { name: 'Save and close' }));
    await waitFor(() => assert.equal(document.activeElement?.id, tabs().getByRole('tab', { name: 'GET Alpha' }).id));
    assert.equal(useRequestStore.getState().tabs.length, 1);
    assert.equal(useRequestStore.getState().currentRequest.id, alpha.id);
  });
});
