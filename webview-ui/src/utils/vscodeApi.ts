import type { WebviewMessage, ExtensionMessage } from '../../../src/models/MessageProtocol';

interface VSCodeAPI {
  postMessage(message: WebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VSCodeAPI;

let vscodeApi: VSCodeAPI | null = null;

export function getVscodeApi(): VSCodeAPI {
  if (!vscodeApi) {
    vscodeApi = acquireVsCodeApi();
  }
  return vscodeApi;
}

export function postMessage(message: WebviewMessage): void {
  getVscodeApi().postMessage(message);
}

type MessageHandler = (message: ExtensionMessage) => void;

const handlers = new Set<MessageHandler>();

window.addEventListener('message', (event: MessageEvent<ExtensionMessage>) => {
  for (const handler of handlers) {
    handler(event.data);
  }
});

export function onMessage(handler: MessageHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}
