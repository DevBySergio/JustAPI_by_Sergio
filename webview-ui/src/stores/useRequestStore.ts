import { create } from 'zustand';
import { JustRequest, HttpMethod, BodyType, createDefaultRequest } from '../../../src/models/Request';
import { KeyValuePair } from '../../../src/models/KeyValuePair';
import { AuthConfig } from '../../../src/models/Auth';

interface RequestState {
  currentRequest: JustRequest;
  isExecuting: boolean;
  activeExecutionId: string | null;
  setMethod: (method: HttpMethod) => void;
  setUrl: (url: string) => void;
  setName: (name: string) => void;
  setHeaders: (headers: KeyValuePair[]) => void;
  setQueryParams: (params: KeyValuePair[]) => void;
  setAuth: (auth: AuthConfig) => void;
  setBodyType: (type: BodyType) => void;
  setBodyContent: (content: string) => void;
  setFormData: (formData: KeyValuePair[]) => void;
  setRequest: (request: JustRequest) => void;
  resetRequest: () => void;
  beginExecution: (executionId: string) => void;
  setExecutionState: (executionId: string, executing: boolean) => void;
}

export const useRequestStore = create<RequestState>((set) => ({
  currentRequest: createDefaultRequest(),
  isExecuting: false,
  activeExecutionId: null,

  setMethod: (method) =>
    set((state) => ({
      currentRequest: { ...state.currentRequest, method, updated: Date.now() },
    })),

  setUrl: (url) =>
    set((state) => ({
      currentRequest: { ...state.currentRequest, url, updated: Date.now() },
    })),

  setName: (name) =>
    set((state) => ({
      currentRequest: { ...state.currentRequest, name, updated: Date.now() },
    })),

  setHeaders: (headers) =>
    set((state) => ({
      currentRequest: { ...state.currentRequest, headers, updated: Date.now() },
    })),

  setQueryParams: (queryParams) =>
    set((state) => ({
      currentRequest: { ...state.currentRequest, queryParams, updated: Date.now() },
    })),

  setAuth: (auth) =>
    set((state) => ({
      currentRequest: { ...state.currentRequest, auth, updated: Date.now() },
    })),

  setBodyType: (type) =>
    set((state) => ({
      currentRequest: {
        ...state.currentRequest,
        body: { ...state.currentRequest.body, type },
        updated: Date.now(),
      },
    })),

  setBodyContent: (content) =>
    set((state) => ({
      currentRequest: {
        ...state.currentRequest,
        body: { ...state.currentRequest.body, content },
        updated: Date.now(),
      },
    })),

  setFormData: (formData) =>
    set((state) => ({
      currentRequest: {
        ...state.currentRequest,
        body: { ...state.currentRequest.body, formData },
        updated: Date.now(),
      },
    })),

  setRequest: (request) =>
    set({ currentRequest: request }),

  resetRequest: () =>
    set({ currentRequest: createDefaultRequest() }),

  beginExecution: (executionId) =>
    set({ activeExecutionId: executionId, isExecuting: true }),

  setExecutionState: (executionId, executing) =>
    set((state) => {
      if (state.activeExecutionId !== executionId) {
        return state;
      }
      return {
        ...state,
        isExecuting: executing,
        activeExecutionId: executing ? executionId : null,
      };
    }),
}));
