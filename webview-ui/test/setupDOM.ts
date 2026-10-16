import { JSDOM } from 'jsdom';
import type { ExtensionMessage, WebviewMessage } from '../../src/models/MessageProtocol';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://justapi.test', pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
  HTMLTextAreaElement: dom.window.HTMLTextAreaElement, KeyboardEvent: dom.window.KeyboardEvent,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async () => undefined } });

export const host = {
  state: null as unknown,
  messages: [] as WebviewMessage[],
  receive: (_message: WebviewMessage): void => undefined,
  postMessage(message: WebviewMessage): void {
    host.messages.push(message);
    queueMicrotask(() => host.receive(message));
  },
  getState(): unknown { return host.state; },
  setState(state: unknown): void { host.state = state; },
};
Object.assign(globalThis, { acquireVsCodeApi: () => host });

export function send(message: ExtensionMessage): void {
  window.dispatchEvent(new dom.window.MessageEvent('message', { data: message }));
}
export function acknowledge(message: WebviewMessage): void {
  send({ type: 'acknowledgement', operationId: message.operationId, action: message.type, status: 'completed' });
}
