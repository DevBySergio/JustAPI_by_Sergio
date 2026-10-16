import { create } from 'zustand';
import { JustRequest, HttpMethod, BodyType, createDefaultRequest } from '../../../src/models/Request';
import { KeyValuePair, PathParam } from '../../../src/models/KeyValuePair';
import { Variable } from '../../../src/models/Variable';
import { AuthConfig } from '../../../src/models/Auth';

interface RequestState {
  currentRequest: JustRequest;
  authPending: boolean;
  authRevision: number;
  authUpdate: Promise<void> | null;
  isExecuting: boolean;
  activeExecutionId: string | null;
  setMethod: (method: HttpMethod) => void;
  setUrl: (url: string) => void;
  setName: (name: string) => void;
  setHeaders: (headers: KeyValuePair[]) => void;
  setQueryParams: (params: KeyValuePair[]) => void;
  setPathParams: (params: PathParam[]) => void;
  setVariables: (variables: Variable[]) => void;
  setAuth: (auth: AuthConfig, pending?: boolean) => void;
  markAuthClean: () => void;
  setAuthUpdate: (update: Promise<void>) => void;
  acceptSavedRequest: (saved: JustRequest, submitted: JustRequest, authRevision: number) => void;
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
  authPending: false,
  authRevision: 0,
  authUpdate: null,
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

  setAuth: (auth, pending = true) =>
    set((state) => ({
      currentRequest: { ...state.currentRequest, auth, updated: Date.now() },
      authPending: pending,
      authRevision: state.authRevision + 1,
    })),

  setPathParams: (pathParams) => set(state => ({ currentRequest: { ...state.currentRequest, pathParams, updated: Date.now() } })),
  setVariables: (variables) => set(state => ({ currentRequest: { ...state.currentRequest, variables, updated: Date.now() } })),

  markAuthClean: () => set(state => ({ authPending: false, authRevision: state.authRevision + 1 })),

  setAuthUpdate: (update) => {
    set({ authUpdate: update });
    void update.finally(() => set(state => state.authUpdate === update ? { authUpdate: null } : {})).catch(() => undefined);
  },

  acceptSavedRequest: (saved, submitted, revision) => set(state => {
    if (state.currentRequest.id !== submitted.id) { return state; }
    const current = { ...state.currentRequest };
    for (const key of Object.keys(saved) as Array<keyof JustRequest>) {
      if (JSON.stringify(current[key]) === JSON.stringify(submitted[key])) {
        Object.assign(current, { [key]: saved[key] });
      }
    }
    return { currentRequest: current, authPending: state.authRevision === revision ? false : state.authPending };
  }),

  setBodyType: (type) =>
    set((state) => ({
      currentRequest: {
        ...state.currentRequest,
        body: {
          ...state.currentRequest.body, type,
          ...(type === 'x-www-form-urlencoded' && state.currentRequest.body.type !== type
            ? { formData: state.currentRequest.body.formData ?? [] } : {}),
        },
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
