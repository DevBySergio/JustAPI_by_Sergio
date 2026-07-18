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

export function postMessage(message: WebviewMessageInput): WebviewMessage {
  const candidate = {
    ...message,
    operationId: createIdentifier('operation'),
  };
  const validation = validateWebviewMessage(candidate);
  if (!validation.ok) {
    throw new Error('The webview attempted to send an invalid protocol message.');
  }

  correlationTracker.record(validation.value.type, validation.value.operationId);
  getVscodeApi().postMessage(validation.value);
  return validation.value;
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
