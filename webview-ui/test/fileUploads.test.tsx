import './setupDOM';
import * as assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { createRequestTab, useRequestStore } from '../src/stores/useRequestStore';
import { useCollectionStore } from '../src/stores/useCollectionStore';
import { useVariableStore } from '../src/stores/useVariableStore';
import { useHistoryStore } from '../src/stores/useHistoryStore';
import { createDefaultRequest } from '../../src/models/Request';
import type { WebviewMessage } from '../../src/models/MessageProtocol';
import { host, send, acknowledge } from './setupDOM';

const file = { id: 'opaque-local-selection', name: 'payload.bin', size: 4096, lastModified: 1234 };
let pending: Extract<WebviewMessage, { type: 'selectRequestFile' }> | undefined;
let receive: (message: WebviewMessage) => void;
beforeEach(() => {
  host.state = null; host.messages = []; pending = undefined;
  const tabs = ['First', 'Second'].map(name => createRequestTab({ ...createDefaultRequest(), name, url: 'https://local.test', method: 'POST' }));
  useRequestStore.getState().initializeTabs(tabs, tabs[0].tabId);
  useCollectionStore.setState({ collections: [], activeCollectionId: null }); useHistoryStore.setState({ entries: [] });
  useVariableStore.setState({ globalVariables: [], variableSets: [], environmentDrafts: {}, environmentUpdate: null, envWatches: [] });
  receive = message => {
    if (message.type === 'webviewReady') { send({ type: 'initializationComplete', operationId: message.operationId }); }
    if (message.type === 'selectRequestFile') { pending = message; return; }
    acknowledge(message);
  }; host.receive = receive;
});
afterEach(() => cleanup());
async function open(type: 'Binary' | 'Form Data' = 'Binary') {
  render(<App />); await screen.findByRole('tab', { name: /^body$/i }); fireEvent.click(screen.getByRole('tab', { name: /^body$/i }));
  fireEvent.click(await screen.findByRole('radio', { name: type }));
}
async function choose(name = 'Choose local file…') {
  fireEvent.click(screen.getByRole('button', { name })); await waitFor(() => assert.ok(pending)); return pending!;
}
function selected(message = pending!) {
  send({ type: 'requestFileSelected', operationId: message.operationId, requestId: message.requestId, ...(message.fieldId ? { fieldId: message.fieldId } : {}), file }); acknowledge(message);
}

test('uses a control-only native picker, shows metadata and sends only opaque references; cached drafts require reselection', async () => {
  await open(); assert.ok(screen.getByText('No file selected')); const message = await choose();
  assert.deepEqual(Object.keys(message).sort(), ['operationId', 'requestId', 'type']); assert.ok(screen.getByText('Selecting local file…'));
  assert.equal((screen.getByRole('button', { name: 'Choose local file…' }) as HTMLButtonElement).disabled, true);
  await act(async () => selected()); await screen.findByText('payload.bin (4,096 bytes)');
  assert.ok(screen.getByText('Unsaved changes')); assert.equal(useRequestStore.getState().currentRequest.body.file!.id, file.id);
  await waitFor(() => assert.ok(host.state)); assert.doesNotMatch(JSON.stringify(host.state), /opaque-local-selection|payload.bin/);
  fireEvent.change(screen.getByRole('textbox', { name: 'File content type' }), { target: { value: 'image/png' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Send/ })); });
  await waitFor(() => assert.ok(host.messages.some(message => message.type === 'executeRequest')));
  const execute = host.messages.find(message => message.type === 'executeRequest'); assert.ok(execute?.type === 'executeRequest');
  assert.equal(execute.request.body.file!.id, file.id); assert.equal(execute.request.body.contentType, 'image/png');
  assert.doesNotMatch(JSON.stringify(execute.request.body), /path|base64|file:\/\//);
});

test('combines file and text editors, allows disabled/missing parts and removes pending fields without late resurrection', async () => {
  await open('Form Data'); fireEvent.click(screen.getByRole('button', { name: '+ Add file' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'File 1 field name' }), { target: { value: 'upload' } });
  const message = await choose('Choose file 1'); fireEvent.click(screen.getByRole('button', { name: 'Remove file 1' }));
  await act(async () => selected(message)); assert.equal(useRequestStore.getState().currentRequest.body.files!.length, 0);
  fireEvent.click(screen.getByRole('button', { name: '+ Add file' })); fireEvent.click(screen.getByRole('checkbox', { name: 'Enable file 1' }));
  assert.equal(useRequestStore.getState().currentRequest.body.files![0].enabled, false);
  const next = await choose('Choose file 1'); await act(async () => selected(next));
  await screen.findByText('payload.bin (4,096 bytes)'); assert.equal(useRequestStore.getState().currentRequest.body.files![0].enabled, false);
});

test('late selections follow their own tab while body edits discard obsolete picker results', async () => {
  await open(); const message = await choose();
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'POST Second' })); });
  await act(async () => selected(message)); assert.equal(useRequestStore.getState().currentRequest.name, 'Second'); assert.equal(useRequestStore.getState().currentRequest.body.file, undefined);
  assert.equal(useRequestStore.getState().tabs[0].currentRequest.body.file!.id, file.id);
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: /^POST First/ })); });
  fireEvent.click(await screen.findByRole('tab', { name: /^body$/i }));
  await screen.findByText('payload.bin (4,096 bytes)'); pending = undefined; const obsolete = await choose();
  fireEvent.click(screen.getByRole('radio', { name: 'Text' })); fireEvent.change(await screen.findByRole('textbox', { name: 'Request body' }), { target: { value: 'newer body' } });
  await act(async () => selected(obsolete)); assert.equal(useRequestStore.getState().currentRequest.body.type, 'text'); assert.equal(useRequestStore.getState().currentRequest.body.content, 'newer body');
});

test('picker cancellation preserves the previous file, errors allow retry and sending during selection stays blocked', async () => {
  await open(); await choose(); await act(async () => selected());
  pending = undefined; await choose(); await act(async () => acknowledge(pending!));
  assert.equal(useRequestStore.getState().currentRequest.body.file!.id, file.id);
  pending = undefined; await choose(); await act(async () => { send({ type: 'error', operationId: pending!.operationId, code: 'REQUEST_VALIDATION_FAILED', message: 'Select a readable file again.' }); });
  await screen.findByRole('alert'); assert.ok(screen.getByText('Select a readable file again.'));
  pending = undefined; const retry = await choose();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Send/ })); });
  assert.equal(host.messages.some(message => message.type === 'executeRequest'), false);
  await act(async () => selected(retry)); assert.equal(Object.keys(useRequestStore.getState().fileSelections).length, 0);
});

test('closing a tab releases file grants and ignores its delayed selection', async () => {
  await open(); const message = await choose();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close request First' })); });
  // Changing the body type made this draft dirty, so closing requires its existing discard flow.
  fireEvent.click(await screen.findByRole('button', { name: 'Discard and close' }));
  await waitFor(() => assert.equal(useRequestStore.getState().tabs.length, 1));
  assert.ok(host.messages.some(value => value.type === 'releaseRequestFiles' && value.requestId === message.requestId));
  await act(async () => selected(message)); assert.equal(useRequestStore.getState().currentRequest.body.file, undefined);
});
