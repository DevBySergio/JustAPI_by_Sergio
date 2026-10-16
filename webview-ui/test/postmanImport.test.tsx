import './setupDOM';
import * as assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { createRequestTab, useRequestStore } from '../src/stores/useRequestStore';
import { useVariableStore } from '../src/stores/useVariableStore';
import { useCollectionStore } from '../src/stores/useCollectionStore';
import { useHistoryStore } from '../src/stores/useHistoryStore';
import { createDefaultRequest } from '../../src/models/Request';
import type { PostmanImportPreview } from '../../src/models/PostmanImport';
import type { WebviewMessage } from '../../src/models/MessageProtocol';
import { host, send, acknowledge } from './setupDOM';

let preview: PostmanImportPreview; let receive: (message: WebviewMessage) => void;
beforeEach(() => {
  preview = { previewId: 'postman-preview', name: 'Migration', fileName: 'postman.json', kind: 'collection', requests: 3, folders: 1, variables: 2, credentials: 2,
    skippedRequests: 1, skippedVariables: 0, diagnosticCount: 1, diagnostics: [{ code: 'REQUEST_SKIPPED', location: 'item[3].request' }] };
  host.state = null; host.messages = [];
  const tab = createRequestTab({ ...createDefaultRequest(), url: 'https://local.test/original', name: 'Original' });
  tab.currentRequest = { ...tab.currentRequest, name: 'Unsaved draft' };
  useRequestStore.getState().initializeTabs([tab], tab.tabId);
  useVariableStore.setState({ variableSets: [], environmentDrafts: {}, environmentUpdate: null, envWatches: [], globalVariables: [] });
  useCollectionStore.setState({ collections: [], activeCollectionId: null }); useHistoryStore.setState({ entries: [] });
  receive = message => {
    if (message.type === 'webviewReady') { send({ type: 'initializationComplete', operationId: message.operationId }); }
    if (message.type === 'previewPostmanImport') { send({ type: 'postmanImportPreview', operationId: message.operationId, preview }); }
    acknowledge(message);
  }; host.receive = receive;
});
afterEach(() => cleanup());
async function openPreview() {
  render(<App />); await screen.findByLabelText('Request name');
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Collections' })); });
  await screen.findByRole('button', { name: 'Import Postman…' });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Import Postman…' })); });
  await screen.findByRole('region', { name: 'Postman import preview' });
}

test('requires explicit acceptance of omissions, confirms the reviewed name and preserves request drafts', async () => {
  await openPreview(); const confirm = screen.getByRole('button', { name: 'Confirm Postman import' }) as HTMLButtonElement;
  assert.equal(confirm.disabled, true); assert.ok(screen.getByText(/3 requests · 1 folders/));
  assert.equal(host.messages.some(message => message.type === 'confirmPostmanImport'), false);
  fireEvent.change(screen.getByLabelText('Imported Postman name'), { target: { value: 'Local collection' } });
  fireEvent.click(screen.getByLabelText('I accept the listed exclusions and behavior changes'));
  await act(async () => { fireEvent.click(confirm); });
  await waitFor(() => assert.equal(screen.queryByRole('region', { name: 'Postman import preview' }), null));
  const sent = host.messages.find(message => message.type === 'confirmPostmanImport'); assert.ok(sent?.type === 'confirmPostmanImport');
  assert.equal(sent.name, 'Local collection'); assert.equal(sent.acceptWarnings, true);
  assert.equal(useRequestStore.getState().tabs.length, 1); assert.equal(useRequestStore.getState().tabs[0].currentRequest.name, 'Unsaved draft');
  assert.doesNotMatch(JSON.stringify(host.state), /postman.json|postman-preview|Local collection/);
});

test('retains a failed import for retry and only closes after its mutation acknowledgement', async () => {
  preview = { ...preview, diagnosticCount: 0, diagnostics: [] }; let confirmation: WebviewMessage | undefined;
  host.receive = message => { if (message.type === 'confirmPostmanImport') { confirmation = message; } else { receive(message); } };
  await openPreview(); fireEvent.click(screen.getByRole('button', { name: 'Confirm Postman import' }));
  await waitFor(() => assert.ok(confirmation)); assert.equal((screen.getByRole('button', { name: 'Confirm Postman import' }) as HTMLButtonElement).disabled, true);
  await act(async () => { send({ type: 'error', operationId: confirmation!.operationId, code: 'IMPORT_ERROR', message: 'Disk failure' }); });
  await waitFor(() => assert.equal((screen.getByRole('button', { name: 'Confirm Postman import' }) as HTMLButtonElement).disabled, false));
  assert.ok(screen.getByRole('region', { name: 'Postman import preview' })); confirmation = undefined;
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Postman import' })); await waitFor(() => assert.ok(confirmation));
  await act(async () => { acknowledge(confirmation!); });
  await waitFor(() => assert.equal(screen.queryByRole('region', { name: 'Postman import preview' }), null));
});

test('cancels without import and replaces a stale preview without carrying over its consent', async () => {
  await openPreview(); fireEvent.click(screen.getByLabelText('I accept the listed exclusions and behavior changes'));
  await act(async () => { send({ type: 'postmanImportPreview', operationId: 'second-preview-op', preview: { ...preview, previewId: 'second-preview', kind: 'environment' } }); });
  await waitFor(() => assert.equal((screen.getByLabelText('I accept the listed exclusions and behavior changes') as HTMLInputElement).checked, false));
  assert.ok(host.messages.some(message => message.type === 'cancelPostmanImport' && message.previewId === 'postman-preview'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel Postman import' })); });
  await waitFor(() => assert.equal(screen.queryByRole('region', { name: 'Postman import preview' }), null));
  assert.equal(host.messages.some(message => message.type === 'confirmPostmanImport'), false);
});

test('offers environment migration alongside dotenv import and leaves the environment selection unchanged', async () => {
  preview = { ...preview, kind: 'environment', diagnosticCount: 1, diagnostics: [{ code: 'SECRET_VARIABLE_SKIPPED', location: 'values[1]' }], skippedVariables: 1 };
  render(<App />); await screen.findByLabelText('Request name');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Manage' })); }); await screen.findByRole('heading', { name: 'Environments' });
  assert.ok(screen.getByRole('button', { name: 'Import .env…' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Import Postman…' })); });
  await screen.findByRole('region', { name: 'Postman import preview' }); assert.ok(screen.getByText(/Secret variable excluded/));
  assert.equal((screen.getByLabelText('Environment', { exact: true }) as HTMLSelectElement).value, '');
});
