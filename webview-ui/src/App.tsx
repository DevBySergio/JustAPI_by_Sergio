import { lazy, useEffect, useState, useCallback, useRef } from 'react';
import {
  createExecutionId,
  completeStartupAction,
  getVscodeApi,
  isCurrentOperation,
  onMessage,
  postMessage,
  postMessageWithAck,
  invalidateEditorResults,
} from './utils/vscodeApi';
import { VariableAutosave } from './utils/VariableAutosave';
import { JustRequest } from '../../src/models/Request';
import { emit } from './utils/eventBus';
import { useRequestStore } from './stores/useRequestStore';
import { useResponseStore } from './stores/useResponseStore';
import { useCollectionStore } from './stores/useCollectionStore';
import { useHistoryStore } from './stores/useHistoryStore';
import { useVariableStore } from './stores/useVariableStore';
import { RequestEditor } from './components/RequestEditor/RequestEditor';
import type { RemoveCollectionItems } from './components/CollectionTree';
import { SearchBar } from './components/Common/SearchBar';
import { SearchResults } from './components/Common/SearchResults';
import { ConfirmDialog } from './components/Common/ConfirmDialog';
import { DeferredPanel } from './components/Common/DeferredPanel';
import { SearchResult } from '../../src/models/MessageProtocol';
import type { CurlImportParseResult } from '../../src/models/CurlImport';
import type { HistoryEntry } from '../../src/models/HistoryEntry';
import { createDefaultRequest } from '../../src/models/Request';
import { isActiveExecution } from '../../src/protocol/CorrelationTracker';
import {
  createPersistedWebviewState,
  nextTabIndex,
  requestsDiffer,
  restorePersistedWebviewState,
  type WebviewTab,
} from '../../src/webview/WebviewState';

const CollectionPanel = lazy(() => import(/* webpackChunkName: "collectionpanel" */ './components/CollectionPanel').then(module => ({ default: module.CollectionPanel })));

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
}

export function App() {
  const [restoredState] = useState(() => restorePersistedWebviewState(getVscodeApi().getState()));
  const [activeTab, setActiveTab] = useState<TabView>(restoredState?.activeTab ?? 'editor');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [notification, setNotification] = useState<{ text: string; type: 'info' | 'error' | 'success' } | null>(null);
  const [codeGenCode, setCodeGenCode] = useState('');
  const [varSubTab, setVarSubTab] = useState<'vars' | 'sets'>(restoredState?.variableSubTab ?? 'vars');
  const [curlImportPreview, setCurlImportPreview] = useState<CurlImportParseResult | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [baselineRequest, setBaselineRequest] = useState(
    restoredState?.baselineRequest ?? useRequestStore.getState().currentRequest
  );
  const baselineRequestRef = useRef(baselineRequest);
  const saveSnapshots = useRef(new Map<string, { request: JustRequest; authRevision: number }>());
  const [stateRestored, setStateRestored] = useState(restoredState === null);
  const notifTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acknowledgementNotifications = useRef(new Map<string, { message: string; onSuccess?: () => void }>());
  const curlImportPreviewRef = useRef<CurlImportParseResult | null>(null);
  const searchOperationIdRef = useRef<string | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const variableTabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const showNotification = useCallback((text: string, type: 'info' | 'error' | 'success' = 'info') => {
    setNotification({ text, type });
    if (notifTimer.current) { clearTimeout(notifTimer.current); }
    notifTimer.current = setTimeout(() => setNotification(null), 3000);
  }, []);

  useEffect(() => () => {
    if (notifTimer.current) {
      clearTimeout(notifTimer.current);
    }
  }, []);

  const [autosave] = useState(() => new VariableAutosave(postMessageWithAck, () => {
    showNotification('Variables could not be saved. Your pending edits are retained; retry before sending.', 'error');
  }));
  const changeTab = useCallback((tab: TabView) => {
    void (async () => {
      await autosave.flush();
      await useRequestStore.getState().authUpdate;
      setActiveTab(tab);
    })().catch(error => showNotification(String(error), 'error'));
  }, [autosave, showNotification]);
  const authPending = useRequestStore(state => state.authPending);
  const authUpdate = useRequestStore(state => state.authUpdate);

  const setRequest = useRequestStore((s) => s.setRequest);
  const setAuth = useRequestStore((s) => s.setAuth);
  const resetRequest = useRequestStore((s) => s.resetRequest);
  const beginExecution = useRequestStore((s) => s.beginExecution);
  const setExecutionState = useRequestStore((s) => s.setExecutionState);
  const setResponse = useResponseStore((s) => s.setResponse);
  const clearResponse = useResponseStore((s) => s.clearResponse);
  const hasResponse = useResponseStore((s) => s.hasResponse);
  const setCollections = useCollectionStore((s) => s.setCollections);
  const setEntries = useHistoryStore((s) => s.setEntries);
  const addEntry = useHistoryStore((s) => s.addEntry);
  const selectCollection = useCollectionStore((s) => s.selectCollection);
  const setGlobalVariables = useVariableStore((s) => s.setGlobalVariables);
  const setVariableSets = useVariableStore((s) => s.setVariableSets);
  const currentRequest = useRequestStore((s) => s.currentRequest);
  const activeCollectionId = useCollectionStore((s) => s.activeCollectionId);
  const collections = useCollectionStore((s) => s.collections);

  const markRequestClean = useCallback((request: typeof currentRequest) => {
    setRequest(request);
    useRequestStore.getState().markAuthClean();
    baselineRequestRef.current = request;
    setBaselineRequest(request);
  }, [setRequest]);

  const resetCleanRequest = useCallback(() => {
    resetRequest();
    useRequestStore.getState().markAuthClean();
    const request = useRequestStore.getState().currentRequest;
    baselineRequestRef.current = request;
    setBaselineRequest(request);
  }, [resetRequest]);

  const confirmDestructiveNavigation = useCallback((confirmation: PendingConfirmation) => {
    const perform = async () => {
      await autosave.flush();
      await useRequestStore.getState().authUpdate;
      const state = useRequestStore.getState();
      await postMessageWithAck({ type: 'discardRequestChanges', requestId: state.currentRequest.id });
      if (state.activeExecutionId) {
        postMessage({ type: 'cancelRequest', executionId: state.activeExecutionId });
        state.setExecutionState(state.activeExecutionId, false);
      }
      state.markAuthClean();
      invalidateEditorResults();
      saveSnapshots.current.clear();
      clearResponse();
      setCodeGenCode('');
      confirmation.onConfirm();
    };
    const onConfirm = () => { void perform().catch(error => showNotification(String(error), 'error')); };
    const state = useRequestStore.getState();
    if (!state.authPending && !state.authUpdate && !requestsDiffer(state.currentRequest, baselineRequestRef.current)) {
      onConfirm();
      return;
    }
    setPendingConfirmation({ ...confirmation, onConfirm });
  }, [autosave, clearResponse, showNotification]);

  const registerAcknowledgement = useCallback((operationId: string, message: string, onSuccess?: () => void) => {
    acknowledgementNotifications.current.set(operationId, { message, onSuccess });
  }, []);

  const removeCollectionItems: RemoveCollectionItems = useCallback((requestIds, remove) => {
    const requestId = useRequestStore.getState().currentRequest.id;
    const perform = async () => {
      await autosave.flush();
      await remove();
      if (requestIds.includes(requestId) && useRequestStore.getState().currentRequest.id === requestId) {
        resetCleanRequest();
      }
    };
    if (requestIds.includes(requestId)) {
      confirmDestructiveNavigation({
        title: 'Discard unsaved request changes?',
        message: 'Deleting this item also removes the current saved request and its unsaved edits.',
        confirmLabel: 'Discard and delete',
        onConfirm: () => { void perform().catch(error => showNotification(String(error), 'error')); },
      });
    } else { void perform().catch(error => showNotification(String(error), 'error')); }
  }, [autosave, confirmDestructiveNavigation, resetCleanRequest, showNotification]);

  useEffect(() => {
    if (!restoredState) {
      return;
    }
    setRequest(restoredState.currentRequest);
    selectCollection(restoredState.activeCollectionId);
    baselineRequestRef.current = restoredState.baselineRequest;
    setBaselineRequest(restoredState.baselineRequest);
    setStateRestored(true);
    if (restoredState.redactedValues) {
      showNotification('Sensitive, oversized, or unsaved authentication values were not restored. Review the request before sending.', 'info');
    }
  }, []);

  useEffect(() => {
    baselineRequestRef.current = baselineRequest;
  }, [baselineRequest]);

  useEffect(() => {
    if (!stateRestored) {
      return;
    }
    getVscodeApi().setState(createPersistedWebviewState({
      activeTab,
      variableSubTab: varSubTab,
      activeCollectionId,
      currentRequest,
      baselineRequest,
      pendingAuth: authPending || authUpdate !== null,
    }));
  }, [activeCollectionId, activeTab, authPending, authUpdate, baselineRequest, currentRequest, stateRestored, varSubTab]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      void autosave.flush().catch(() => undefined);
      const state = useRequestStore.getState();
      if (state.authPending || state.authUpdate || requestsDiffer(state.currentRequest, baselineRequestRef.current)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  useEffect(() => {
    return onMessage((message) => {
      if (!isCurrentOperation(message.operationId)) {
        return;
      }
      switch (message.type) {
        case 'initialState':
          setCollections(autosave.overlayCollections(message.state.collections));
          if (useCollectionStore.getState().activeCollectionId
            && !message.state.collections.some(collection => (
              collection.id === useCollectionStore.getState().activeCollectionId
            ))) {
            selectCollection(null);
          }
          setEntries(message.state.history);
          setGlobalVariables(autosave.overlayGlobal(message.state.variables));
          setVariableSets(message.state.variableSets || []);
          setIsReady(true);
          break;
        case 'initializationComplete':
          setIsReady(true);
          break;
        case 'collections': {
          const previous = useCollectionStore.getState().collections;
          const requestId = useRequestStore.getState().currentRequest.id;
          const previousOwner = previous.find(collection => hasSavedRequest(collection.items, requestId));
          const nextOwner = message.collections.find(collection => hasSavedRequest(collection.items, requestId));
          setCollections(autosave.overlayCollections(message.collections));
          if (previousOwner && nextOwner && previousOwner.id !== nextOwner.id) {
            selectCollection(nextOwner.id);
          } else if (!message.collections.some(collection => collection.id === useCollectionStore.getState().activeCollectionId)) {
            selectCollection(null);
          }
          break;
        }
        case 'response':
          if (isActiveExecution(useRequestStore.getState().activeExecutionId, message.executionId)) {
            setResponse(message.response);
          }
          break;
        case 'history':
          setEntries(message.entries);
          break;
        case 'historyEntry':
          if (isActiveExecution(useRequestStore.getState().activeExecutionId, message.executionId)) {
            addEntry(message.entry);
          }
          break;
        case 'variables':
          setGlobalVariables(autosave.overlayGlobal(message.variables));
          break;
        case 'requestExecuting':
          setExecutionState(message.executionId, message.executing);
          break;
        case 'curlImportResult':
          if (curlImportPreviewRef.current
            && curlImportPreviewRef.current.request.id !== message.request.id) {
            postMessage({
              type: 'cancelCurlImport',
              requestId: curlImportPreviewRef.current.request.id,
            });
          }
          curlImportPreviewRef.current = { request: message.request, warnings: message.warnings };
          setCurlImportPreview(curlImportPreviewRef.current);
          break;
        case 'requestLoaded':
          markRequestClean(message.request);
          setActiveTab('editor');
          requestAnimationFrame(() => document.getElementById('request-name-input')?.focus());
          break;
        case 'requestSaved': {
          const submitted = saveSnapshots.current.get(message.operationId);
          saveSnapshots.current.delete(message.operationId);
          if (submitted && useRequestStore.getState().currentRequest.id === message.request.id) {
            useRequestStore.getState().acceptSavedRequest(message.request, submitted.request, submitted.authRevision);
            baselineRequestRef.current = message.request;
            setBaselineRequest(message.request);
          }
          break;
        }
        case 'requestAuthUpdated':
          if (useRequestStore.getState().currentRequest.id === message.requestId) {
            setAuth(message.auth, message.pending);
            showNotification('Authentication applied. Save the request to keep this change.', 'info');
          }
          break;
        case 'error':
          saveSnapshots.current.delete(message.operationId);
          acknowledgementNotifications.current.delete(message.operationId);
          if (searchOperationIdRef.current === message.operationId) {
            searchOperationIdRef.current = null;
            setSearchLoading(false);
            setSearchOpen(true);
          }
          if (!message.executionId
            || isActiveExecution(useRequestStore.getState().activeExecutionId, message.executionId)) {
            const details = message.details?.join('; ');
            showNotification(
              details ? `${message.message} ${details}` : message.message || 'An error occurred',
              'error'
            );
          }
          break;
        case 'searchResults':
          if (searchOperationIdRef.current !== message.operationId) {
            break;
          }
          setSearchResults(message.results);
          searchOperationIdRef.current = null;
          setSearchLoading(false);
          setSearchOpen(true);
          break;
        case 'codeGenerationResult':
          setCodeGenCode(message.code);
          setActiveTab('codegen');
          break;
        case 'variableSets':
          setVariableSets(message.sets);
          break;
        case 'resolutionPreview':
          emit('resolutionPreview', message);
          break;
        case 'startupAction':
          switch (message.action.type) {
            case 'newRequest':
              confirmDestructiveNavigation({
                title: 'Discard unsaved request changes?',
                message: 'Creating a new request will replace the unsaved editor contents.',
                confirmLabel: 'Discard and create',
                onConfirm: () => {
                  resetCleanRequest();
                  setActiveTab('editor');
                  requestAnimationFrame(() => document.getElementById('request-name-input')?.focus());
                  showNotification('New request created', 'success');
                  completeStartupAction(message.operationId, message.action.type);
                },
                onCancel: () => completeStartupAction(message.operationId, message.action.type),
              });
              return;
            case 'importCurl':
              if (curlImportPreviewRef.current
                && curlImportPreviewRef.current.request.id !== message.action.request.id) {
                postMessage({
                  type: 'cancelCurlImport',
                  requestId: curlImportPreviewRef.current.request.id,
                });
              }
              curlImportPreviewRef.current = {
                request: message.action.request,
                warnings: message.action.warnings,
              };
              setCurlImportPreview(curlImportPreviewRef.current);
              setActiveTab('editor');
              break;
            case 'showCollections':
              if (message.action.collectionId) {
                selectCollection(message.action.collectionId);
              }
              setActiveTab('collections');
              break;
            case 'showHistory':
              setActiveTab('history');
              break;
            case 'showVariables':
              setVarSubTab('vars');
              setActiveTab('variables');
              break;
            case 'showCodeGeneration':
              setActiveTab('codegen');
              break;
          }
          completeStartupAction(message.operationId, message.action.type);
          break;
        case 'acknowledgement': {
          const acknowledgement = acknowledgementNotifications.current.get(message.operationId);
          if (acknowledgement) {
            acknowledgementNotifications.current.delete(message.operationId);
            acknowledgement.onSuccess?.();
            showNotification(acknowledgement.message, 'success');
          }
          break;
        }
      }
    });
  }, []);

  useEffect(() => {
    if (!isReady) {
      postMessage({ type: 'webviewReady' });
    }
  }, [isReady]);

  const handleSend = useCallback(() => {
    void (async () => {
      await autosave.flush();
      await useRequestStore.getState().authUpdate;
      setSearchResults([]);
      setSearchOpen(false);
      const requestState = useRequestStore.getState();
      if (requestState.isExecuting) {
        return;
      }
      const request = requestState.currentRequest;
      const collectionId = useCollectionStore.getState().activeCollectionId;
      if (!request.url) {
        showNotification('Please enter a URL', 'error');
        return;
      }
      const executionId = createExecutionId();
      clearResponse();
      beginExecution(executionId);
      try {
        postMessage({
          type: 'executeRequest',
          executionId,
          request,
          collectionId: collectionId ?? undefined,
        });
      } catch {
        setExecutionState(executionId, false);
        showNotification('The request could not be submitted.', 'error');
      }
    })().catch(error => showNotification(String(error), 'error'));
  }, [autosave, showNotification]);

  const handleSave = useCallback(() => {
    void (async () => {
      await autosave.flush();
      await useRequestStore.getState().authUpdate;
      const state = useRequestStore.getState();
      const collectionId = useCollectionStore.getState().activeCollectionId;
      if (!collectionId) { showNotification('Select a collection first', 'info'); return; }
      const request = state.currentRequest;
      const operation = postMessage({ type: 'saveRequest', request, collectionId });
      saveSnapshots.current.set(operation.operationId, { request, authRevision: state.authRevision });
      registerAcknowledgement(operation.operationId, 'Request saved');
    })().catch(error => showNotification(String(error), 'error'));
  }, [autosave, registerAcknowledgement, showNotification]);

  const handleNewRequest = useCallback(() => {
    confirmDestructiveNavigation({
      title: 'Discard unsaved request changes?',
      message: 'Creating a new request will replace the unsaved editor contents.',
      confirmLabel: 'Discard and create',
      onConfirm: () => {
        resetCleanRequest();
        clearResponse();
        setActiveTab('editor');
        requestAnimationFrame(() => document.getElementById('request-name-input')?.focus());
        showNotification('New request created', 'success');
      },
    });
  }, [clearResponse, confirmDestructiveNavigation, resetCleanRequest, showNotification]);

  const openSavedRequest = useCallback((requestId: string, collectionId?: string) => {
    confirmDestructiveNavigation({
      title: 'Discard unsaved request changes?',
      message: 'Opening another request will replace the unsaved editor contents.',
      confirmLabel: 'Discard and open',
      onConfirm: () => {
        if (collectionId) {
          selectCollection(collectionId);
        }
        postMessage({ type: 'getRequest', requestId });
      },
    });
  }, [confirmDestructiveNavigation, selectCollection]);

  const replayHistoryEntry = useCallback((entry: HistoryEntry) => {
    if (entry.requestId) {
      openSavedRequest(entry.requestId, entry.collectionId);
      return;
    }
    confirmDestructiveNavigation({
      title: 'Discard unsaved request changes?',
      message: 'Replaying this history summary will replace the unsaved editor contents.',
      confirmLabel: 'Discard and replay',
      onConfirm: () => {
        const request = {
          ...createDefaultRequest(),
          name: `History: ${entry.method} request`,
          method: entry.method,
          url: entry.url,
        };
        markRequestClean(request);
        setActiveTab('editor');
        requestAnimationFrame(() => document.getElementById('request-name-input')?.focus());
        showNotification('Sensitive values and the body were intentionally not retained in history.', 'info');
      },
    });
  }, [confirmDestructiveNavigation, markRequestClean, openSavedRequest, showNotification]);

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
            confirmDestructiveNavigation({
              title: 'Discard unsaved request changes?',
              message: 'Importing this cURL request will replace the unsaved editor contents.',
              confirmLabel: 'Discard and import',
              onConfirm: () => {
                markRequestClean(curlImportPreview.request);
                setActiveTab('editor');
                requestAnimationFrame(() => document.getElementById('request-name-input')?.focus());
                curlImportPreviewRef.current = null;
                setCurlImportPreview(null);
                showNotification('cURL imported successfully', 'success');
              },
            });
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

      <div
        id={`main-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`main-tab-${activeTab}`}
        tabIndex={0}
        style={{ flex: 1, overflow: 'auto' }}
      >
        <DeferredPanel panelKey={activeTab}>
        {activeTab === 'editor' && (
          <RequestEditor
            onSend={handleSend}
            onSave={handleSave}
            onNew={handleNewRequest}
            onPrepare={async () => { await autosave.flush(); await useRequestStore.getState().authUpdate; }}
            isDirty={authPending || authUpdate !== null || requestsDiffer(currentRequest, baselineRequest)}
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
          code={codeGenCode}
          prepare={async () => { await autosave.flush(); await useRequestStore.getState().authUpdate; }}
          onError={message => showNotification(message, 'error')}
        />}
        </DeferredPanel>
      </div>

      <DeferredPanel panelKey="response">
        {hasResponse ? <ResponseViewer /> : <div style={{ borderTop: '1px solid var(--vscode-panel-border)', padding: '16px', textAlign: 'center', color: 'var(--vscode-descriptionForeground)', fontSize: '12px' }}>Execute a request to see the response</div>}
      </DeferredPanel>
    </div>
  );
}
