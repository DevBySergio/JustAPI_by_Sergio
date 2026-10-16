import type { RequestFile, MultipartFile } from '../../../src/models/RequestFile';
import { create } from 'zustand';
import { JustRequest, HttpMethod, BodyType, createDefaultRequest } from '../../../src/models/Request';
import { KeyValuePair, PathParam } from '../../../src/models/KeyValuePair';
import { Variable } from '../../../src/models/Variable';
import { AuthConfig } from '../../../src/models/Auth';
import type { JustResponse } from '../../../src/models/Response';
import { requestsDiffer, REQUEST_WORKSPACE_LIMITS } from '../../../src/webview/WebviewState';

export const MAX_REQUEST_TABS = REQUEST_WORKSPACE_LIMITS.maximumTabs;

export interface ResponseDownloadState {
  responseId: string; operationId: string; status: 'saving' | 'saved' | 'cancelled' | 'error'; message: string;
}

export interface RequestTab {
  downloadState: ResponseDownloadState | undefined;
  fileSelections: Record<string, string>;
  fileSelectionError: string | null;
  tabId: string;
  currentRequest: JustRequest;
  baselineRequest: JustRequest;
  collectionId: string | null;
  baselineCollectionId: string | null;
  authPending: boolean;
  authRevision: number;
  authUpdate: Promise<void> | null;
  isExecuting: boolean;
  activeExecutionId: string | null;
  response: JustResponse | null;
  code: string;
  error: string | null;
  loading: boolean;
  loadFailed: boolean;
  closing: boolean;
  saving: boolean;
}

export function createRequestTab(request = createDefaultRequest(), collectionId: string | null = null): RequestTab {
  return { fileSelections: {}, fileSelectionError: null, downloadState: undefined, tabId: `tab-${crypto.randomUUID()}`, currentRequest: request, baselineRequest: request, collectionId, baselineCollectionId: collectionId,
    authPending: false, authRevision: 0, authUpdate: null, isExecuting: false, activeExecutionId: null,
    response: null, code: '', error: null, loading: false, loadFailed: false, closing: false, saving: false };
}

export function isRequestTabDirty(tab: RequestTab): boolean {
  return tab.authPending || tab.authUpdate !== null || tab.collectionId !== tab.baselineCollectionId || requestsDiffer(tab.currentRequest, tab.baselineRequest);
}

interface RequestState extends RequestTab {
  tabs: RequestTab[];
  initializeTabs: (tabs: RequestTab[], activeTabId: string) => void;
  openTab: (request: JustRequest, collectionId: string | null, loading?: boolean) => string;
  activateTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  patchTab: (tabId: string, patch: Partial<Omit<RequestTab, 'tabId'>>) => void;
  getTab: (tabId: string) => RequestTab | undefined;
  setCollectionId: (collectionId: string | null) => void;
  setMethod: (method: HttpMethod) => void;
  setUrl: (url: string) => void;
  setName: (name: string) => void;
  setHeaders: (headers: KeyValuePair[]) => void;
  setQueryParams: (params: KeyValuePair[]) => void;
  setPathParams: (params: PathParam[]) => void;
  setVariables: (variables: Variable[]) => void;
  setAuth: (auth: AuthConfig, pending?: boolean, tabId?: string) => void;
  setAuthUpdate: (update: Promise<void>, tabId?: string) => void;
  acceptSavedRequest: (tabId: string, saved: JustRequest, submitted: JustRequest, authRevision: number, collectionId: string) => void;
  setBodyType: (type: BodyType) => void;
  setBodyContent: (content: string) => void;
  setBodyFiles: (files: MultipartFile[]) => void;
  setFileContentType: (contentType: string) => void;
  beginFileSelection: (tabId: string, operationId: string, fieldId?: string) => void;
  acceptFileSelection: (operationId: string, requestId: string, file: RequestFile, fieldId?: string) => void;
  endFileSelection: (operationId: string, error?: string) => void;
  setFormData: (formData: KeyValuePair[]) => void;
  setRequest: (request: JustRequest) => void;
  beginExecution: (executionId: string, tabId?: string) => void;
  setExecutionState: (executionId: string, executing: boolean) => void;
  releaseResponseBodies: (responseIds: string[]) => void;
  setResponseDownloadState: (tabId: string, download: ResponseDownloadState) => void;
  setResponse: (executionId: string, response: JustResponse) => void;
}

const initialTab = createRequestTab();

export const useRequestStore = create<RequestState>((set, get) => {
  // Tabs are authoritative. The active projection keeps existing editor selectors stable;
  // every transition publishes both atomically through this function.
  const updateTab = (tabId: string, change: (tab: RequestTab) => RequestTab) => set(state => {
    const tab = state.tabs.find(candidate => candidate.tabId === tabId);
    if (!tab) { return state; }
    const next = change(tab);
    return { tabs: state.tabs.map(candidate => candidate.tabId === tabId ? next : candidate),
      ...(state.tabId === tabId ? next : {}) };
  });
  const editRequest = (change: (request: JustRequest) => JustRequest) => updateTab(get().tabId, tab => ({
    ...tab, fileSelections: {}, currentRequest: { ...change(tab.currentRequest), updated: Date.now() }, error: null,
  }));
  return {
    ...initialTab, tabs: [initialTab],
    getTab: tabId => get().tabs.find(tab => tab.tabId === tabId),
    initializeTabs: (tabs, activeTabId) => {
      if (!tabs.length || tabs.length > MAX_REQUEST_TABS) { throw new Error('Invalid request tab count.'); }
      const active = tabs.find(tab => tab.tabId === activeTabId) ?? tabs[0];
      set({ tabs, ...active });
    },
    openTab: (request, collectionId, loading = false) => {
      const existing = get().tabs.find(tab => tab.currentRequest.id === request.id);
      if (existing) { get().activateTab(existing.tabId); return existing.tabId; }
      if (get().tabs.length >= MAX_REQUEST_TABS) { throw new Error(`Close a request tab before opening another (maximum ${MAX_REQUEST_TABS}).`); }
      const tab = { ...createRequestTab(request, collectionId), loading };
      set(state => ({ tabs: [...state.tabs, tab], ...tab }));
      return tab.tabId;
    },
    activateTab: tabId => {
      const tab = get().getTab(tabId);
      if (tab) { set({ ...tab }); }
    },
    closeTab: tabId => set(state => {
      const index = state.tabs.findIndex(tab => tab.tabId === tabId);
      if (index < 0) { return state; }
      let tabs = state.tabs.filter(tab => tab.tabId !== tabId);
      if (!tabs.length) { tabs = [createRequestTab(undefined, state.collectionId)]; }
      const active = state.tabId === tabId ? tabs[Math.max(0, index - 1)] : tabs.find(tab => tab.tabId === state.tabId)!;
      return { tabs, ...active };
    }),
    patchTab: (tabId, patch) => updateTab(tabId, tab => ({ ...tab, ...patch })),
    setCollectionId: collectionId => updateTab(get().tabId, tab => ({ ...tab, collectionId, code: '' })),
    setMethod: method => editRequest(request => ({ ...request, method })),
    setUrl: url => editRequest(request => ({ ...request, url })),
    setName: name => editRequest(request => ({ ...request, name })),
    setHeaders: headers => editRequest(request => ({ ...request, headers })),
    setQueryParams: queryParams => editRequest(request => ({ ...request, queryParams })),
    setPathParams: pathParams => editRequest(request => ({ ...request, pathParams })),
    setVariables: variables => editRequest(request => ({ ...request, variables })),
    setAuth: (auth, pending = true, tabId = get().tabId) => updateTab(tabId, tab => ({
      ...tab, currentRequest: { ...tab.currentRequest, auth, updated: Date.now() },
      authPending: pending, authRevision: tab.authRevision + 1,
    })),
    setAuthUpdate: (update, tabId = get().tabId) => {
      updateTab(tabId, tab => ({ ...tab, authUpdate: update }));
      void update.finally(() => updateTab(tabId, tab => tab.authUpdate === update ? { ...tab, authUpdate: null } : tab)).catch(() => undefined);
    },
    acceptSavedRequest: (tabId, saved, submitted, revision, collectionId) => updateTab(tabId, tab => {
      if (tab.currentRequest.id !== submitted.id) { return tab; }
      const current = { ...tab.currentRequest };
      for (const key of Object.keys(saved) as Array<keyof JustRequest>) {
        if (JSON.stringify(current[key]) === JSON.stringify(submitted[key])) { Object.assign(current, { [key]: saved[key] }); }
      }
      return { ...tab, currentRequest: current, baselineRequest: saved, baselineCollectionId: collectionId,
        authPending: tab.authRevision === revision ? false : tab.authPending, error: null };
    }),
    setBodyType: type => editRequest(request => ({ ...request, body: { ...request.body, type, ...(type === 'binary' && request.body.type !== 'binary' ? { binarySource: 'file' as const } : {}),
      ...(type === 'x-www-form-urlencoded' && request.body.type !== type ? { formData: request.body.formData ?? [] } : {}) } })),
    setBodyContent: content => editRequest(request => ({ ...request, body: { ...request.body, content } })),
    setBodyFiles: files => editRequest(request => ({ ...request, body: { ...request.body, files } })),
    setFileContentType: contentType => editRequest(request => ({ ...request, body: { ...request.body, contentType } })),
    beginFileSelection: (tabId, operationId, fieldId) => updateTab(tabId, tab => ({ ...tab, fileSelectionError: null, fileSelections: { ...tab.fileSelections, [fieldId ?? 'binary']: operationId } })),
    acceptFileSelection: (operationId, requestId, file, fieldId) => {
      const tab = get().tabs.find(candidate => candidate.currentRequest.id === requestId && candidate.fileSelections[fieldId ?? 'binary'] === operationId);
      if (!tab) { return; }
      updateTab(tab.tabId, current => {
        const body = current.currentRequest.body;
        if (fieldId ? body.type !== 'form-data' || !body.files?.some(field => field.id === fieldId) : body.type !== 'binary') { return current; }
        const next = fieldId ? { ...body, files: body.files!.map(field => field.id === fieldId ? { ...field, file } : field) }
          : { ...body, binarySource: 'file' as const, file, content: '' };
        return { ...current, currentRequest: { ...current.currentRequest, body: next, updated: Date.now() } };
      });
    },
    endFileSelection: (operationId, error) => {
      for (const tab of get().tabs) {
        if (Object.values(tab.fileSelections).includes(operationId)) { updateTab(tab.tabId, current => ({ ...current,
          fileSelections: Object.fromEntries(Object.entries(current.fileSelections).filter(([, value]) => value !== operationId)), fileSelectionError: error ?? null })); }
      }
    },
    setFormData: formData => editRequest(request => ({ ...request, body: { ...request.body, formData } })),
    setRequest: request => editRequest(() => request),
    beginExecution: (executionId, tabId = get().tabId) => updateTab(tabId, tab => ({
      ...tab, activeExecutionId: executionId, isExecuting: true, response: null, downloadState: undefined, error: null,
    })),
    setExecutionState: (executionId, executing) => {
      const tab = get().tabs.find(candidate => candidate.activeExecutionId === executionId);
      if (tab) { updateTab(tab.tabId, current => ({ ...current, isExecuting: executing, activeExecutionId: executing ? executionId : null })); }
    },
    setResponseDownloadState: (tabId, download) => updateTab(tabId, tab => {
      if (tab.response?.download?.responseId !== download.responseId
        || (download.status !== 'saving' && tab.downloadState?.operationId !== download.operationId)) { return tab; }
      return { ...tab, downloadState: download };
    }),
    releaseResponseBodies: responseIds => set(state => {
      const tabs = state.tabs.map(tab => tab.response?.download && responseIds.includes(tab.response.download.responseId)
        ? { ...tab, response: { ...tab.response, download: { ...tab.response.download, available: false } } } : tab);
      return { tabs, ...tabs.find(tab => tab.tabId === state.tabId)! };
    }),
    setResponse: (executionId, response) => {
      const tab = get().tabs.find(candidate => candidate.activeExecutionId === executionId);
      if (tab) { updateTab(tab.tabId, current => ({ ...current, response })); }
    },
  };
});
