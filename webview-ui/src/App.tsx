import { lazy, useEffect, useState, useCallback, useRef } from 'react';
import {
  createExecutionId,
  completeStartupAction,
  getVscodeApi,
  isCurrentOperation,
  onMessage,
  postMessage,
  postMessageWithAck,
} from './utils/vscodeApi';
import { VariableAutosave } from './utils/VariableAutosave';
import { JustRequest } from '../../src/models/Request';
import { emit } from './utils/eventBus';
import { useRequestStore, createRequestTab, isRequestTabDirty } from './stores/useRequestStore';
import { useCollectionStore } from './stores/useCollectionStore';
import { useHistoryStore } from './stores/useHistoryStore';
import { useVariableStore } from './stores/useVariableStore';
import type { RemoveCollectionItems } from './components/CollectionTree';
import { SearchBar } from './components/Common/SearchBar';
import { SearchResults } from './components/Common/SearchResults';
import { ConfirmDialog } from './components/Common/ConfirmDialog';
import { DeferredPanel } from './components/Common/DeferredPanel';
import { RequestTabs } from './components/RequestTabs';
import { SearchResult } from '../../src/models/MessageProtocol';
import type { CurlImportParseResult } from '../../src/models/CurlImport';
import type { HistoryEntry } from '../../src/models/HistoryEntry';
import { createDefaultRequest } from '../../src/models/Request';
import {
  createPersistedRequestWorkspace,
  nextTabIndex,
  restoreRequestWorkspace,
  type WebviewTab,
} from '../../src/webview/WebviewState';

const CollectionPanel = lazy(() => import(/* webpackChunkName: "collectionpanel" */ './components/CollectionPanel').then(module => ({ default: module.CollectionPanel })));
const RequestEditor = lazy(() => import(/* webpackChunkName: "request-editor" */ './components/RequestEditor/RequestEditor').then(module => ({ default: module.RequestEditor })));

const HistoryPanel = lazy(() => import(/* webpackChunkName: "historypanel" */ './components/HistoryPanel').then(module => ({ default: module.HistoryPanel })));

const VariableEditor = lazy(() => import(/* webpackChunkName: "variableeditor" */ './components/VariableEditor').then(module => ({ default: module.VariableEditor })));

const VariableSetPanel = lazy(() => import(/* webpackChunkName: "variablesetpanel" */ './components/VariableSetPanel').then(module => ({ default: module.VariableSetPanel })));

const CodeGenPanel = lazy(() => import(/* webpackChunkName: "codegenpanel" */ './components/CodeGenPanel').then(module => ({ default: module.CodeGenPanel })));

const CurlImportPreview = lazy(() => import(/* webpackChunkName: "curlimportpreview" */ './components/CurlImportPreview').then(module => ({ default: module.CurlImportPreview })));
const ResponseViewer = lazy(() => import(/* webpackChunkName: "response-viewer" */ './components/ResponseViewer/ResponseViewer').then(module => ({ default: module.ResponseViewer })));

type TabView = WebviewTab;

const TABS: TabView[] = ['editor', 'collections', 'history', 'variables', 'codegen'];

function hasSavedRequest(
  items: ReturnType<typeof useCollectionStore.getState>['collections'][number]['items'],
  requestId: string
): boolean {
  return items.some(item => (
    (item.type === 'request' && item.requestId === requestId)
    || (item.type === 'folder' && item.items ? hasSavedRequest(item.items, requestId) : false)
  ));
}

interface PendingConfirmation {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel?: () => void;
  onSave?: () => void;
}

export function App() {
  const [restoredState] = useState(() => restoreRequestWorkspace(getVscodeApi().getState()));
  const [activeTab, setActiveTab] = useState<TabView>(restoredState?.activeTab ?? 'editor');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [notification, setNotification] = useState<{ text: string; type: 'info' | 'error' | 'success' } | null>(null);
  const [varSubTab, setVarSubTab] = useState<'vars' | 'sets'>(restoredState?.variableSubTab ?? 'vars');
  const [curlImportPreview, setCurlImportPreview] = useState<CurlImportParseResult | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [stateRestored, setStateRestored] = useState(restoredState === null);
  const saveSnapshots = useRef(new Map<string, { tabId: string; request: JustRequest; authRevision: number; collectionId: string }>());
  const pendingSaves = useRef(new Map<string, Promise<void>>());
  const loadOperations = useRef(new Map<string, string>());
  const codeOperations = useRef(new Map<string, string>());
  const notifTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acknowledgementNotifications = useRef(new Map<string, { message: string; onSuccess?: () => void }>());
  const curlImportPreviewRef = useRef<CurlImportParseResult | null>(null);
  const searchOperationIdRef = useRef<string | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const variableTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = useRequestStore();
  const currentRequest = current.currentRequest;
  const collections = useCollectionStore(state => state.collections);

  const showNotification = useCallback((text: string, type: 'info' | 'error' | 'success' = 'info') => {
    setNotification({ text, type });
    if (notifTimer.current) { clearTimeout(notifTimer.current); }
    notifTimer.current = setTimeout(() => setNotification(null), 3000);
  }, []);
  useEffect(() => () => { if (notifTimer.current) { clearTimeout(notifTimer.current); } }, []);
  const [autosave] = useState(() => new VariableAutosave(postMessageWithAck, () => {
    showNotification('Variables could not be saved. Your pending edits are retained; retry before sending.', 'error');
  }));
  const changeTab = useCallback((tab: TabView) => {
    void autosave.flush().then(() => setActiveTab(tab)).catch(error => showNotification(String(error), 'error'));
  }, [autosave, showNotification]);
  const selectCollection = useCollectionStore(state => state.selectCollection);

  const registerAcknowledgement = useCallback((operationId: string, message: string, onSuccess?: () => void) => {
    acknowledgementNotifications.current.set(operationId, { message, onSuccess });
  }, []);

  const activateRequestTab = useCallback((tabId: string) => {
    const tab = useRequestStore.getState().getTab(tabId);
    if (!tab) { return; }
    useRequestStore.getState().activateTab(tabId);
    selectCollection(tab.collectionId);
    void autosave.flush().catch(error => showNotification(String(error), 'error'));
  }, [autosave, selectCollection, showNotification]);

  const openNewTab = useCallback((request = createDefaultRequest(), collectionId = useRequestStore.getState().collectionId) => {
    const tabId = useRequestStore.getState().openTab(request, collectionId);
    selectCollection(collectionId);
    setActiveTab('editor');
    return tabId;
  }, [selectCollection]);

  const saveRequestTab = useCallback((tabId: string): Promise<void> => {
    const pending = pendingSaves.current.get(tabId);
    if (pending) { return pending; }
    useRequestStore.getState().patchTab(tabId, { saving: true });
    const saving = (async () => {
      await autosave.flush();
      await useRequestStore.getState().getTab(tabId)?.authUpdate;
      const tab = useRequestStore.getState().getTab(tabId);
      if (!tab) { throw new Error('The request tab was closed.'); }
      if (tab.loading || tab.loadFailed) { throw new Error('Wait for the request to load before saving.'); }
      if (!tab.collectionId) { throw new Error('Select a collection before saving this request.'); }
      const request = tab.currentRequest;
      await postMessageWithAck({ type: 'saveRequest', request, collectionId: tab.collectionId }, operation => {
        saveSnapshots.current.set(operation.operationId, { tabId, request, authRevision: tab.authRevision, collectionId: tab.collectionId! });
      });
    })();
    pendingSaves.current.set(tabId, saving);
    void saving.finally(() => {
      if (pendingSaves.current.get(tabId) === saving) { pendingSaves.current.delete(tabId); }
      useRequestStore.getState().patchTab(tabId, { saving: false });
    }).catch(() => undefined);
    return saving;
  }, [autosave]);

  const cancelTabExecution = useCallback((tabId: string) => {
    const state = useRequestStore.getState();
    const executionId = state.getTab(tabId)?.activeExecutionId;
    if (executionId) {
      postMessage({ type: 'cancelRequest', executionId });
      state.setExecutionState(executionId, false);
    }
  }, []);

  const releaseTab = useCallback(async (tabId: string) => {
    await pendingSaves.current.get(tabId)?.catch(() => undefined);
    await useRequestStore.getState().getTab(tabId)?.authUpdate?.catch(() => undefined);
    const state = useRequestStore.getState();
    const tab = state.getTab(tabId);
    if (!tab) { return; }
    await postMessageWithAck({ type: 'discardRequestChanges', requestId: tab.currentRequest.id });
    const latest = state.getTab(tabId);
    if (latest) {
      state.patchTab(tabId, { currentRequest: { ...latest.currentRequest, auth: { ...latest.baselineRequest.auth } }, authPending: false });
    }
    cancelTabExecution(tabId);
    for (const [operationId, owner] of loadOperations.current) { if (owner === tabId) { loadOperations.current.delete(operationId); } }
    for (const [operationId, owner] of codeOperations.current) { if (owner === tabId) { codeOperations.current.delete(operationId); } }
  }, [cancelTabExecution]);

  const closeRequestTab = useCallback((tabId: string) => {
    const tab = useRequestStore.getState().getTab(tabId);
    if (!tab || tab.closing) { return; }
    const close = async (save: boolean) => {
      useRequestStore.getState().patchTab(tabId, { closing: true });
      try {
        cancelTabExecution(tabId);
        await autosave.flush();
        if (save) {
          await saveRequestTab(tabId);
          const saved = useRequestStore.getState().getTab(tabId);
          if (saved && isRequestTabDirty(saved)) { throw new Error('Newer changes are still pending. Review the request before closing.'); }
        }
        await releaseTab(tabId);
        useRequestStore.getState().closeTab(tabId);
        selectCollection(useRequestStore.getState().collectionId);
        requestAnimationFrame(() => {
          const focused = document.activeElement;
          if (focused === document.body || (focused instanceof HTMLElement
            && focused.closest('[data-request-tab]')?.getAttribute('data-request-tab') === tabId)) {
            document.getElementById(`request-session-${useRequestStore.getState().tabId}`)?.focus();
          }
        });
      } catch (error) {
        useRequestStore.getState().patchTab(tabId, { closing: false, error: String(error) });
        showNotification(String(error), 'error');
      }
    };
    if (isRequestTabDirty(tab)) {
      setPendingConfirmation({ title: 'Close request with unsaved changes?',
        message: `“${tab.currentRequest.name || 'Untitled request'}” has unsaved changes. Closing stops its running request.`,
        confirmLabel: 'Discard and close', onConfirm: () => { void close(false); },
        onSave: tab.collectionId && !tab.loading ? () => { void close(true); } : undefined });
    } else { void close(false); }
  }, [autosave, cancelTabExecution, releaseTab, saveRequestTab, selectCollection, showNotification]);

  const removeCollectionItems: RemoveCollectionItems = useCallback((requestIds, remove) => {
    const affected = useRequestStore.getState().tabs.filter(tab => requestIds.includes(tab.currentRequest.id));
    const perform = async () => {
      try {
        for (const tab of affected) {
          useRequestStore.getState().patchTab(tab.tabId, { closing: true }); cancelTabExecution(tab.tabId);
        }
        await autosave.flush();
        for (const tab of affected) { await releaseTab(tab.tabId); }
        await remove();
        for (const tab of affected) { useRequestStore.getState().closeTab(tab.tabId); }
      } catch (error) {
        for (const tab of affected) { useRequestStore.getState().patchTab(tab.tabId, { closing: false, error: String(error) }); }
        showNotification(String(error), 'error');
      }
    };
    if (affected.some(isRequestTabDirty)) {
      setPendingConfirmation({ title: 'Discard unsaved request changes?',
        message: `Deleting this item also closes ${affected.length} open request tab(s), including their unsaved edits.`,
        confirmLabel: 'Discard and delete', onConfirm: () => { void perform(); } });
    } else { void perform(); }
  }, [autosave, cancelTabExecution, releaseTab, showNotification]);

  const loadSavedRequest = useCallback((tabId: string) => {
    const tab = useRequestStore.getState().getTab(tabId);
    if (!tab) { return; }
    useRequestStore.getState().patchTab(tabId, { loading: true, loadFailed: false, error: null });
    postMessage({ type: 'getRequest', requestId: tab.currentRequest.id }, operation => loadOperations.current.set(operation.operationId, tabId));
  }, []);

  const openSavedRequest = useCallback((requestId: string, collectionId?: string) => {
    try {
      const existing = useRequestStore.getState().tabs.find(tab => tab.currentRequest.id === requestId);
      if (existing) { activateRequestTab(existing.tabId); setActiveTab('editor'); return; }
      const placeholder = { ...createDefaultRequest(), id: requestId, name: 'Loading request…' };
      const tabId = useRequestStore.getState().openTab(placeholder, collectionId ?? null, true);
      selectCollection(collectionId ?? null);
      setActiveTab('editor');
      loadSavedRequest(tabId);
    } catch (error) { showNotification(String(error), 'error'); }
  }, [activateRequestTab, loadSavedRequest, selectCollection, showNotification]);

  const handleNewRequest = useCallback(() => {
    try { openNewTab(); }
    catch (error) { showNotification(String(error), 'error'); }
  }, [openNewTab, showNotification]);

  const replayHistoryEntry = useCallback((entry: HistoryEntry) => {
    if (entry.requestId) { openSavedRequest(entry.requestId, entry.collectionId); return; }
    try {
      openNewTab({ ...createDefaultRequest(), name: `History: ${entry.method} request`, method: entry.method, url: entry.url }, entry.collectionId ?? null);
      showNotification('Sensitive values and the body were intentionally not retained in history.', 'info');
    } catch (error) { showNotification(String(error), 'error'); }
  }, [openNewTab, openSavedRequest, showNotification]);

  useEffect(() => {
    if (!restoredState) { return; }
    const tabs = restoredState.tabs.map(tab => ({ ...createRequestTab(tab.currentRequest, tab.collectionId),
      tabId: tab.tabId, baselineRequest: tab.baselineRequest, baselineCollectionId: tab.baselineCollectionId }));
    useRequestStore.getState().initializeTabs(tabs, restoredState.activeRequestTabId);
    selectCollection(useRequestStore.getState().collectionId);
    setStateRestored(true);
    if (restoredState.redactedValues) {
      showNotification('Sensitive, oversized, or unsaved authentication values were not restored. Review the request before sending.', 'info');
    }
  }, []);

  useEffect(() => {
    if (!stateRestored) { return; }
    const tabs = current.tabs.filter(tab => !tab.loading && !tab.loadFailed);
    if (!tabs.length) { return; }
    getVscodeApi().setState(createPersistedRequestWorkspace({ activeTab, variableSubTab: varSubTab,
      activeRequestTabId: tabs.some(tab => tab.tabId === current.tabId) ? current.tabId : tabs[0].tabId,
      tabs: tabs.map(tab => ({ tabId: tab.tabId, currentRequest: tab.currentRequest, baselineRequest: tab.baselineRequest,
        collectionId: tab.collectionId, baselineCollectionId: tab.baselineCollectionId, pendingAuth: tab.authPending || tab.authUpdate !== null })) }));
  }, [activeTab, current.tabs, current.tabId, stateRestored, varSubTab]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      void autosave.flush().catch(() => undefined);
      if (useRequestStore.getState().tabs.some(isRequestTabDirty)) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  useEffect(() => {
    const updateCollections = (next: typeof collections, operationId?: string) => {
      const previous = useCollectionStore.getState().collections;
      const state = useRequestStore.getState();
      for (const tab of state.tabs) {
        const oldOwner = previous.find(collection => hasSavedRequest(collection.items, tab.currentRequest.id));
        const owner = next.find(collection => hasSavedRequest(collection.items, tab.currentRequest.id));
        if (oldOwner && owner && oldOwner.id !== owner.id) {
          const ownSave = operationId && saveSnapshots.current.get(operationId)?.tabId === tab.tabId;
          state.patchTab(tab.tabId, { baselineCollectionId: owner.id,
            collectionId: !ownSave && tab.baselineCollectionId !== owner.id && tab.collectionId === oldOwner.id ? owner.id : tab.collectionId, code: '' });
        } else if (tab.collectionId && !next.some(collection => collection.id === tab.collectionId)) {
          state.patchTab(tab.tabId, { collectionId: null, baselineCollectionId: null });
        }
      }
      useCollectionStore.getState().setCollections(autosave.overlayCollections(next));
      const activeId = useCollectionStore.getState().activeCollectionId;
      if (activeId && !next.some(collection => collection.id === activeId)) { selectCollection(null); }
      if (state.collectionId !== useRequestStore.getState().collectionId) { selectCollection(useRequestStore.getState().collectionId); }
    };
    return onMessage(message => {
      if (!isCurrentOperation(message.operationId)) { return; }
      const state = useRequestStore.getState();
      switch (message.type) {
        case 'initialState':
          updateCollections(message.state.collections);
          useHistoryStore.getState().setEntries(message.state.history);
          useVariableStore.getState().setGlobalVariables(autosave.overlayGlobal(message.state.variables));
          useVariableStore.getState().setVariableSets(message.state.variableSets || []);
          setIsReady(true);
          break;
        case 'initializationComplete': setIsReady(true); break;
        case 'collections': updateCollections(message.collections, message.operationId); break;
        case 'response': state.setResponse(message.executionId, message.response); break;
        case 'history': useHistoryStore.getState().setEntries(message.entries); break;
        case 'historyEntry':
          if (state.tabs.some(tab => tab.activeExecutionId === message.executionId)) { useHistoryStore.getState().addEntry(message.entry); }
          break;
        case 'variables': useVariableStore.getState().setGlobalVariables(autosave.overlayGlobal(message.variables)); break;
        case 'requestExecuting': state.setExecutionState(message.executionId, message.executing); break;
        case 'curlImportResult':
          if (curlImportPreviewRef.current && curlImportPreviewRef.current.request.id !== message.request.id) {
            postMessage({ type: 'cancelCurlImport', requestId: curlImportPreviewRef.current.request.id });
          }
          curlImportPreviewRef.current = { request: message.request, warnings: message.warnings };
          setCurlImportPreview(curlImportPreviewRef.current);
          break;
        case 'requestLoaded': {
          const tabId = loadOperations.current.get(message.operationId);
          loadOperations.current.delete(message.operationId);
          if (tabId && state.getTab(tabId)?.currentRequest.id === message.request.id) {
            state.patchTab(tabId, { currentRequest: message.request, baselineRequest: message.request, loading: false, loadFailed: false, error: null });
          }
          break;
        }
        case 'requestSaved': {
          const submitted = saveSnapshots.current.get(message.operationId);
          saveSnapshots.current.delete(message.operationId);
          if (submitted) {
            state.acceptSavedRequest(submitted.tabId, message.request, submitted.request, submitted.authRevision, submitted.collectionId);
          }
          break;
        }
        case 'requestAuthUpdated': {
          const tab = state.tabs.find(tab => tab.currentRequest.id === message.requestId);
          if (tab) { state.setAuth(message.auth, message.pending, tab.tabId); }
          break;
        }
        case 'error': {
          const owner = saveSnapshots.current.get(message.operationId)?.tabId
            ?? loadOperations.current.get(message.operationId) ?? codeOperations.current.get(message.operationId)
            ?? state.tabs.find(tab => tab.activeExecutionId === message.executionId)?.tabId;
          saveSnapshots.current.delete(message.operationId); loadOperations.current.delete(message.operationId);
          codeOperations.current.delete(message.operationId); acknowledgementNotifications.current.delete(message.operationId);
          if (searchOperationIdRef.current === message.operationId) {
            searchOperationIdRef.current = null; setSearchLoading(false); setSearchOpen(true);
          }
          const text = [message.message || 'An error occurred', message.details?.join('; ')].filter(Boolean).join(' ');
          if (owner) { state.patchTab(owner, { error: text, loading: false, loadFailed: state.getTab(owner)?.loading || state.getTab(owner)?.loadFailed || false }); }
          if (!message.executionId || owner) { showNotification(text, 'error'); }
          break;
        }
        case 'searchResults':
          if (searchOperationIdRef.current === message.operationId) {
            setSearchResults(message.results); searchOperationIdRef.current = null; setSearchLoading(false); setSearchOpen(true);
          }
          break;
        case 'codeGenerationResult': {
          const tabId = codeOperations.current.get(message.operationId);
          codeOperations.current.delete(message.operationId);
          if (tabId) { state.patchTab(tabId, { code: message.code }); }
          break;
        }
        case 'variableSets': useVariableStore.getState().setVariableSets(message.sets); break;
        case 'resolutionPreview': emit('resolutionPreview', message); break;
        case 'startupAction':
          switch (message.action.type) {
            case 'newRequest': handleNewRequest(); break;
            case 'importCurl':
              if (curlImportPreviewRef.current && curlImportPreviewRef.current.request.id !== message.action.request.id) {
                postMessage({ type: 'cancelCurlImport', requestId: curlImportPreviewRef.current.request.id });
              }
              curlImportPreviewRef.current = { request: message.action.request, warnings: message.action.warnings };
              setCurlImportPreview(curlImportPreviewRef.current); setActiveTab('editor'); break;
            case 'showCollections':
              if (message.action.collectionId) { selectCollection(message.action.collectionId); }
              setActiveTab('collections'); break;
            case 'showHistory': setActiveTab('history'); break;
            case 'showVariables': setVarSubTab('vars'); setActiveTab('variables'); break;
            case 'showCodeGeneration': setActiveTab('codegen'); break;
          }
          completeStartupAction(message.operationId, message.action.type);
          break;
        case 'acknowledgement': {
          const acknowledgement = acknowledgementNotifications.current.get(message.operationId);
          if (acknowledgement) {
            acknowledgementNotifications.current.delete(message.operationId); acknowledgement.onSuccess?.();
            showNotification(acknowledgement.message, 'success');
          }
          break;
        }
      }
    });
  }, []);

  useEffect(() => { if (!isReady) { postMessage({ type: 'webviewReady' }); } }, [isReady]);

  const handleSend = useCallback(() => {
    const tabId = useRequestStore.getState().tabId;
    void (async () => {
      await autosave.flush();
      await useRequestStore.getState().getTab(tabId)?.authUpdate;
      const tab = useRequestStore.getState().getTab(tabId);
      if (!tab || tab.isExecuting || tab.loading || tab.loadFailed || tab.closing) { return; }
      if (!tab.currentRequest.url) { showNotification('Please enter a URL', 'error'); return; }
      const executionId = createExecutionId();
      useRequestStore.getState().beginExecution(executionId, tabId);
      try { postMessage({ type: 'executeRequest', executionId, request: tab.currentRequest, collectionId: tab.collectionId ?? undefined }); }
      catch (error) { useRequestStore.getState().setExecutionState(executionId, false); throw error; }
    })().catch(error => showNotification(String(error), 'error'));
  }, [autosave, showNotification]);

  const handleSave = useCallback(() => {
    const tabId = useRequestStore.getState().tabId;
    void saveRequestTab(tabId).then(() => showNotification('Request saved', 'success'))
      .catch(error => { useRequestStore.getState().patchTab(tabId, { error: String(error) }); showNotification(String(error), 'error'); });
  }, [saveRequestTab, showNotification]);

  const handleSearchSelection = useCallback((result: SearchResult) => {
    setSearchOpen(false);
    setSearchResults([]);
    if (result.type === 'request') {
      openSavedRequest(result.id, result.collectionId);
      return;
    }
    if (result.type === 'history') {
      const entry = useHistoryStore.getState().entries.find(item => item.id === result.id);
      if (entry) {
        replayHistoryEntry(entry);
      } else if (result.requestId) {
        openSavedRequest(result.requestId, result.collectionId);
      } else {
        showNotification('That history entry is no longer available.', 'error');
      }
      return;
    }
    selectCollection(result.collectionId ?? result.id);
    setActiveTab('collections');
    requestAnimationFrame(() => document.getElementById('main-panel-collections')?.focus());
  }, [openSavedRequest, replayHistoryEntry, selectCollection, showNotification]);

  if (!isReady) {
    return <div role={notification?.type === 'error' ? 'alert' : 'status'} style={{ padding: '16px' }}>
      {notification?.text ?? 'Loading local data…'}
    </div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', position: 'relative' }}>
      <style>{`
        button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, [tabindex="0"]:focus-visible {
          outline: 2px solid var(--vscode-focusBorder) !important;
          outline-offset: 2px;
        }
      `}</style>
      {notification && (
        <div
          role={notification.type === 'error' ? 'alert' : 'status'}
          aria-live={notification.type === 'error' ? 'assertive' : 'polite'}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            padding: '6px 12px',
            fontSize: '11px',
            background: notification.type === 'error' ? 'var(--vscode-inputValidation-errorBackground)'
              : notification.type === 'success' ? 'var(--vscode-testing-iconPassedForeground)'
              : 'var(--vscode-inputValidation-infoBackground)',
            color: notification.type === 'error' ? 'var(--vscode-errorForeground)'
              : notification.type === 'success' ? '#fff'
              : 'var(--vscode-foreground)',
            zIndex: 100,
            textAlign: 'center',
            animation: 'slideDown 0.2s ease',
          }}
        >
          {notification.text}
        </div>
      )}

      {curlImportPreview && (
        <DeferredPanel panelKey="curl-import"><CurlImportPreview
          request={curlImportPreview.request}
          warnings={curlImportPreview.warnings}
          onCancel={() => {
            postMessage({ type: 'cancelCurlImport', requestId: curlImportPreview.request.id });
            curlImportPreviewRef.current = null;
            setCurlImportPreview(null);
            showNotification('cURL import cancelled', 'info');
          }}
          onConfirm={() => {
            try {
              openNewTab(curlImportPreview.request);
              curlImportPreviewRef.current = null;
              setCurlImportPreview(null);
              showNotification('cURL imported in a new request tab', 'success');
            } catch (error) { showNotification(String(error), 'error'); }
          }}
        /></DeferredPanel>
      )}

      {pendingConfirmation && (
        <ConfirmDialog
          title={pendingConfirmation.title}
          message={pendingConfirmation.message}
          confirmLabel={pendingConfirmation.confirmLabel}
          onCancel={() => {
            const cancellation = pendingConfirmation.onCancel;
            setPendingConfirmation(null);
            cancellation?.();
          }}
          onSave={pendingConfirmation.onSave ? () => {
            const save = pendingConfirmation.onSave;
            setPendingConfirmation(null);
            save?.();
          } : undefined}
          onConfirm={() => {
            const confirmation = pendingConfirmation.onConfirm;
            setPendingConfirmation(null);
            confirmation();
          }}
        />
      )}

      <SearchBar
        value={searchQuery}
        resultsOpen={searchOpen}
        onDismiss={() => {
          searchOperationIdRef.current = null;
          setSearchOpen(false);
          setSearchResults([]);
          setSearchLoading(false);
        }}
        onChange={(value) => {
          setSearchQuery(value);
          if (!value.trim()) {
            searchOperationIdRef.current = null;
            setSearchOpen(false);
            setSearchResults([]);
            setSearchLoading(false);
          }
        }}
        onSearch={(q) => {
          setSearchResults([]);
          setSearchOpen(true);
          setSearchLoading(true);
          const operation = postMessage({ type: 'search', query: q });
          searchOperationIdRef.current = operation.operationId;
        }}
      />

      {searchOpen && (
        <SearchResults
          results={searchResults}
          query={searchQuery}
          loading={searchLoading}
          onClose={() => {
            searchOperationIdRef.current = null;
            setSearchOpen(false);
            setSearchResults([]);
          }}
          onSelect={handleSearchSelection}
        />
      )}

      <div
        role="tablist"
        aria-label="JustAPI sections"
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--vscode-panel-border)',
          background: 'var(--vscode-tab-activeBackground)',
        }}
      >
        {TABS.map((tab, index) => (
          <button
            key={tab}
            ref={(element) => { tabRefs.current[index] = element; }}
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`main-panel-${tab}`}
            id={`main-tab-${tab}`}
            tabIndex={activeTab === tab ? 0 : -1}
            onClick={() => changeTab(tab)}
            onKeyDown={(event) => {
              const nextIndex = nextTabIndex(index, event.key, TABS.length);
              if (nextIndex === null) {
                return;
              }
              event.preventDefault();
              changeTab(TABS[nextIndex]);
              tabRefs.current[nextIndex]?.focus();
            }}
            className="tab-btn"
            style={{
              flex: 1,
              padding: '8px 4px',
              border: 'none',
              background: activeTab === tab ? 'var(--vscode-tab-activeBackground)' : 'transparent',
              color: activeTab === tab ? 'var(--vscode-tab-activeForeground)' : 'var(--vscode-tab-inactiveForeground)',
              cursor: 'pointer',
              fontSize: '10px',
              fontWeight: activeTab === tab ? 600 : 400,
              textTransform: 'uppercase',
              letterSpacing: '0.3px',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {tab === 'editor' ? 'Request' : tab === 'codegen' ? 'Code' : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <RequestTabs tabs={current.tabs} activeTabId={current.tabId} onSelect={activateRequestTab} onClose={closeRequestTab} onNew={handleNewRequest} />

      <div id="request-workspace-panel" role="tabpanel" aria-labelledby={`request-session-${current.tabId}`}
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}>
      {current.error && <div role="alert" style={{ padding: '6px 8px', fontSize: '11px', color: 'var(--vscode-errorForeground)' }}>{current.error}</div>}
      <div
        id={`main-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`main-tab-${activeTab}`}
        tabIndex={0}
        style={{ flex: 1, overflow: 'auto' }}
      >
        <DeferredPanel panelKey={activeTab}>
        {activeTab === 'editor' && (current.loading || current.closing || current.loadFailed ? <div role="status" style={{ padding: '12px' }}>
          {current.loadFailed ? <button type="button" onClick={() => loadSavedRequest(current.tabId)}>Retry loading request</button>
            : current.closing ? 'Closing request…' : 'Loading request…'}</div> :
          <RequestEditor
            key={current.tabId}
            onSend={handleSend}
            onSave={handleSave}
            onNew={handleNewRequest}
            onPrepare={async () => { await autosave.flush(); await useRequestStore.getState().getTab(current.tabId)?.authUpdate; }}
            isDirty={isRequestTabDirty(current)}
            isSaved={collections.some(collection => hasSavedRequest(collection.items, currentRequest.id))}
            onNotification={showNotification}
          />
        )}
        {activeTab === 'collections' && <CollectionPanel onOpenRequest={openSavedRequest} onRemove={removeCollectionItems} />}
        {activeTab === 'history' && (
          <HistoryPanel
            onNotification={showNotification}
            onReplay={replayHistoryEntry}
            onAcknowledge={registerAcknowledgement}
          />
        )}
        {activeTab === 'variables' && (
          <div>
            <div
              role="tablist"
              aria-label="Variable sections"
              style={{ display: 'flex', gap: '2px', borderBottom: '1px solid var(--vscode-panel-border)', padding: '0 8px' }}
            >
              {(['vars', 'sets'] as const).map((st, index, subTabs) => (
                <button
                  key={st}
                  ref={(element) => { variableTabRefs.current[index] = element; }}
                  role="tab"
                  aria-selected={varSubTab === st}
                  aria-controls={`variables-panel-${st}`}
                  id={`variables-tab-${st}`}
                  tabIndex={varSubTab === st ? 0 : -1}
                  onClick={() => setVarSubTab(st)}
                  onKeyDown={(event) => {
                    const nextIndex = nextTabIndex(index, event.key, subTabs.length);
                    if (nextIndex === null) {
                      return;
                    }
                    event.preventDefault();
                    setVarSubTab(subTabs[nextIndex]);
                    variableTabRefs.current[nextIndex]?.focus();
                  }}
                  style={{
                    padding: '4px 10px',
                    border: 'none',
                    background: 'none',
                    color: varSubTab === st ? 'var(--vscode-textLink-foreground)' : 'var(--vscode-foreground)',
                    cursor: 'pointer',
                    fontSize: '10px',
                    borderBottom: varSubTab === st ? '2px solid var(--vscode-textLink-foreground)' : '2px solid transparent',
                    textTransform: 'uppercase',
                    letterSpacing: '0.3px',
                  }}
                >
                  {st === 'vars' ? 'Variables' : 'Sets'}
                </button>
              ))}
            </div>
            <div
              id={`variables-panel-${varSubTab}`}
              role="tabpanel"
              aria-labelledby={`variables-tab-${varSubTab}`}
              tabIndex={0}
            >
              {varSubTab === 'vars' ? <VariableEditor autosave={autosave} /> : <VariableSetPanel />}
            </div>
          </div>
        )}
        {activeTab === 'codegen' && <CodeGenPanel
          key={current.tabId}
          code={current.code}
          onOperation={(operationId, tabId) => codeOperations.current.set(operationId, tabId)}
          prepare={async () => { await autosave.flush(); await useRequestStore.getState().getTab(current.tabId)?.authUpdate; }}
          onError={message => showNotification(message, 'error')}
        />}
        </DeferredPanel>
      </div>

      <DeferredPanel panelKey="response">
        {current.response ? <ResponseViewer key={current.tabId} /> : <div style={{ borderTop: '1px solid var(--vscode-panel-border)', padding: '16px', textAlign: 'center', color: 'var(--vscode-descriptionForeground)', fontSize: '12px' }}>Execute a request to see the response</div>}
      </DeferredPanel>
      </div>
    </div>
  );
}
