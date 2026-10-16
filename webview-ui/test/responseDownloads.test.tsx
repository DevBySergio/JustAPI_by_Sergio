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
import type { JustResponse } from '../../src/models/Response';
import type { WebviewMessage } from '../../src/models/MessageProtocol';
import { host, send, acknowledge } from './setupDOM';

const response = (responseId: string): JustResponse => ({ statusCode: 200, statusText: 'OK', httpVersion: 'HTTP/1.1', body: 'synthetic-response-body\r\n', bodyType: 'text', size: 200035,
  duration: 1, timings: { total: 1 }, headers: {}, cookies: [], redirected: false, download: { responseId, available: true } });
let receive: (message: WebviewMessage) => void;
beforeEach(() => {
  host.state = null; host.messages = [];
  const first = { ...createRequestTab({ ...createDefaultRequest(), name: 'First', url: 'https://local.test/first' }), response: response('first-body') };
  const second = { ...createRequestTab({ ...createDefaultRequest(), name: 'Second', url: 'https://local.test/second' }), response: { ...response('second-body'), body: 'AQID', bodyType: 'binary' as const, size: 3 } };
  useRequestStore.getState().initializeTabs([first, second], first.tabId);
  useCollectionStore.setState({ collections: [], activeCollectionId: null }); useHistoryStore.setState({ entries: [] });
  useVariableStore.setState({ globalVariables: [], variableSets: [], environmentDrafts: {}, environmentUpdate: null, envWatches: [] });
  receive = message => {
    if (message.type === 'webviewReady') { send({ type: 'initializationComplete', operationId: message.operationId }); }
    if (message.type === 'saveResponseBody') { send({ type: 'responseDownloadResult', operationId: message.operationId, responseId: message.responseId, status: 'saved', fileName: 'body.bin', bytes: message.responseId === 'first-body' ? 200035 : 3 }); }
    acknowledge(message);
  }; host.receive = receive;
});
afterEach(() => cleanup());
async function open() { render(<App />); await screen.findByRole('button', { name: 'Save response body…' }); }

test('saves the complete body through an ID-only message even when its preview is limited and never persists the response', async () => {
  const state = useRequestStore.getState(); const first = state.tabs[0];
  state.patchTab(first.tabId, { response: { ...first.response!, body: first.response!.body + 'x'.repeat(200010) } });
  await open(); assert.ok(screen.getByText(/Preview limited to/)); assert.ok(screen.getByText(/Preview limits and formatting do not change the file/));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save response body…' })); });
  await screen.findByText('Saved 200035 bytes to body.bin');
  const saved = host.messages.find(message => message.type === 'saveResponseBody'); assert.ok(saved?.type === 'saveResponseBody');
  assert.deepEqual(Object.keys(saved).sort(), ['operationId', 'responseId', 'type']); assert.equal(saved.responseId, 'first-body');
  assert.equal(host.messages.some(message => message.type === 'executeRequest'), false);
  assert.doesNotMatch(JSON.stringify(host.state), /synthetic-response-body|first-body|second-body|body.bin/);
});

test('cancel leaves the response available and a failed save can be retried without a success message', async () => {
  let attempt = 0;
  host.receive = message => {
    if (message.type !== 'saveResponseBody') { receive(message); return; }
    if (++attempt === 1) { send({ type: 'responseDownloadResult', operationId: message.operationId, responseId: message.responseId, status: 'cancelled' }); acknowledge(message); }
    else if (attempt === 2) { send({ type: 'error', operationId: message.operationId, code: 'OPERATION_FAILED', message: 'Disk unavailable' }); }
    else { receive(message); }
  };
  await open(); await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save response body…' })); });
  await screen.findByText('Save cancelled. No file was written.'); assert.equal((screen.getByRole('button', { name: 'Save response body…' }) as HTMLButtonElement).disabled, false);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save response body…' })); });
  await screen.findByText('Disk unavailable'); assert.equal(screen.queryByText(/Saved 200035/), null);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save response body…' })); }); await screen.findByText('Saved 200035 bytes to body.bin');
});

test('pending downloads survive tab navigation and late results update only their owning response', async () => {
  let pending: Extract<WebviewMessage, { type: 'saveResponseBody' }> | undefined;
  host.receive = message => { if (message.type === 'saveResponseBody') { pending = message; } else { receive(message); } };
  await open(); fireEvent.click(screen.getByRole('button', { name: 'Save response body…' })); await waitFor(() => assert.ok(pending));
  assert.equal((screen.getByRole('button', { name: 'Save response body…' }) as HTMLButtonElement).disabled, true);
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'GET Second' })); });
  await screen.findByText(/Binary body shown as base64/); assert.equal(Boolean(screen.queryByText(/Choose a local file/)), false);
  await act(async () => { receive(pending!); }); assert.equal(Boolean(screen.queryByText('Saved 200035 bytes to body.bin')), false);
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'GET First' })); }); await screen.findByText('Saved 200035 bytes to body.bin');
});

test('expired bodies are disabled across inactive tabs', async () => {
  await open(); await act(async () => { send({ type: 'responseBodiesReleased', operationId: 'expire', responseIds: ['first-body', 'second-body'] }); });
  await screen.findByText(/Original body no longer available/); assert.equal((screen.getByRole('button', { name: 'Save response body…' }) as HTMLButtonElement).disabled, true);
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'GET Second' })); });
  await screen.findByText(/Original body no longer available/); assert.equal((screen.getByRole('button', { name: 'Save response body…' }) as HTMLButtonElement).disabled, true);
});

test('closing a response tab releases its host bytes and a stale acknowledgement cannot alter a replacement response', async () => {
  let pending: Extract<WebviewMessage, { type: 'saveResponseBody' }> | undefined;
  host.receive = message => { if (message.type === 'saveResponseBody') { pending = message; } else { receive(message); } };
  await open(); fireEvent.click(screen.getByRole('button', { name: 'Save response body…' })); await waitFor(() => assert.ok(pending));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close request First' })); });
  await screen.findByText(/Binary body shown as base64/);
  assert.ok(host.messages.some(message => message.type === 'releaseResponseBody' && message.responseId === 'first-body'));
  await act(async () => { receive(pending!); }); assert.equal(Boolean(screen.queryByText('Saved 200035 bytes to body.bin')), false);
});

test('resending clears the previous save state and ignores its result when a newer response arrives', async () => {
  let pending: Extract<WebviewMessage, { type: 'saveResponseBody' }> | undefined;
  host.receive = message => { if (message.type === 'saveResponseBody') { pending = message; } else { receive(message); } };
  await open(); fireEvent.click(screen.getByRole('button', { name: 'Save response body…' })); await waitFor(() => assert.ok(pending));
  await act(async () => {
    const state = useRequestStore.getState(); state.beginExecution('new-execution');
    send({ type: 'response', operationId: 'new-request', executionId: 'new-execution', response: { ...response('new-body'), body: 'new response' } });
    send({ type: 'requestExecuting', operationId: 'new-request', executionId: 'new-execution', executing: false });
    receive(pending!);
  });
  await screen.findByText('new response'); assert.equal(useRequestStore.getState().downloadState, undefined);
  assert.equal(useRequestStore.getState().response!.download!.responseId, 'new-body'); assert.equal(Boolean(screen.queryByText('Saved 200035 bytes to body.bin')), false);
});
