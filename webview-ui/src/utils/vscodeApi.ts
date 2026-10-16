import type {
  ExtensionMessage,
  StartupActionName,
  WebviewMessage,
} from '../../../src/models/MessageProtocol';
import {
  protocolFailure,
  validateExtensionMessage,
  validateWebviewMessage,
} from '../../../src/protocol/MessageValidator';
import { OperationCorrelationTracker } from '../../../src/protocol/CorrelationTracker';

interface VSCodeAPI {
  postMessage(message: WebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VSCodeAPI;

type WithoutOperationId<T> = T extends { operationId: string } ? Omit<T, 'operationId'> : never;
export type WebviewMessageInput = WithoutOperationId<WebviewMessage>;

let vscodeApi: VSCodeAPI | null = null;
const correlationTracker = new OperationCorrelationTracker();
const acknowledgements = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();

export function getVscodeApi(): VSCodeAPI {
  if (!vscodeApi) {
    vscodeApi = acquireVsCodeApi();
  }
  return vscodeApi;
}

function createIdentifier(prefix: 'operation' | 'execution'): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function createExecutionId(): string {
  return createIdentifier('execution');
}

function prepareMessage(message: WebviewMessageInput): WebviewMessage {
  const candidate = {
    ...message,
    operationId: createIdentifier('operation'),
  };
  const validation = validateWebviewMessage(candidate);
  if (!validation.ok) {
    throw new Error('The webview attempted to send an invalid protocol message.');
  }

  const validated = validation.value;
  const scope = validated.type === 'getRequest' ? validated.requestId
    : validated.type === 'generateCode' || validated.type === 'previewResolution' ? validated.request?.id : undefined;
  correlationTracker.record(validated.type, validated.operationId, scope);
  return validation.value;
}

export function postMessage(message: WebviewMessageInput, onPrepared?: (message: WebviewMessage) => void): WebviewMessage {
  const prepared = prepareMessage(message);
  onPrepared?.(prepared);
  getVscodeApi().postMessage(prepared);
  return prepared;
}

export function postMessageWithAck(message: WebviewMessageInput, onPrepared?: (message: WebviewMessage) => void, options: { timeoutMs?: number } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const prepared = prepareMessage(message);
    const timeout = options.timeoutMs === 0 ? undefined : setTimeout(() => {
      acknowledgements.delete(prepared.operationId);
      reject(new Error('The operation was not confirmed. Your pending changes have been retained.'));
    }, options.timeoutMs ?? 30_000);
    acknowledgements.set(prepared.operationId, {
      resolve: () => { clearTimeout(timeout); resolve(); },
      reject: error => { clearTimeout(timeout); reject(error); },
    });
    try { onPrepared?.(prepared); getVscodeApi().postMessage(prepared); }
    catch (error) {
      acknowledgements.delete(prepared.operationId);
      clearTimeout(timeout);
      reject(error);
    }
  });
}

export function completeStartupAction(
  operationId: string,
  action: StartupActionName
): void {
  const candidate: WebviewMessage = {
    type: 'startupActionHandled',
    operationId,
    action,
  };
  const validation = validateWebviewMessage(candidate);
  if (!validation.ok) {
    throw new Error('The webview attempted to acknowledge an invalid startup action.');
  }
  getVscodeApi().postMessage(validation.value);
}

export function isCurrentOperation(operationId: string): boolean {
  return correlationTracker.isCurrent(operationId);
}

type MessageHandler = (message: ExtensionMessage) => void;

const handlers = new Set<MessageHandler>();

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const validation = validateExtensionMessage(event.data);
  if (validation.ok) {
    const acknowledgement = acknowledgements.get(validation.value.operationId);
    if (acknowledgement && (validation.value.type === 'acknowledgement' || validation.value.type === 'error')) {
      acknowledgements.delete(validation.value.operationId);
      if (validation.value.type === 'error') { acknowledgement.reject(new Error(validation.value.message)); }
      else { acknowledgement.resolve(); }
    }
    if (!correlationTracker.isCurrent(validation.value.operationId)) {
      return;
    }
    for (const handler of handlers) {
      handler(validation.value);
    }
    return;
  }

  const failure = protocolFailure('INVALID_MESSAGE');
  const error: ExtensionMessage = {
    type: 'error',
    operationId: createIdentifier('operation'),
    code: failure.code,
    message: failure.message,
  };
  for (const handler of handlers) {
    handler(error);
  }
});

export function onMessage(handler: MessageHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}
