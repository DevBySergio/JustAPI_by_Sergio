import { useEffect, useState, useCallback, useRef } from 'react';
import {
  createExecutionId,
  completeStartupAction,
  getVscodeApi,
  isCurrentOperation,
  onMessage,
  postMessage,
} from './utils/vscodeApi';
import { emit } from './utils/eventBus';
import { useRequestStore } from './stores/useRequestStore';
import { useResponseStore } from './stores/useResponseStore';
import { useCollectionStore } from './stores/useCollectionStore';
import { useHistoryStore } from './stores/useHistoryStore';
import { useVariableStore } from './stores/useVariableStore';
import { RequestEditor } from './components/RequestEditor/RequestEditor';
import { ResponseViewer } from './components/ResponseViewer/ResponseViewer';
import { CollectionPanel } from './components/CollectionPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { VariableEditor } from './components/VariableEditor';
import { VariableSetPanel } from './components/VariableSetPanel';
import { SearchBar } from './components/Common/SearchBar';
import { SearchResults } from './components/Common/SearchResults';
import { CodeGenPanel } from './components/CodeGenPanel';
import { CurlImportPreview } from './components/CurlImportPreview';
import { ConfirmDialog } from './components/Common/ConfirmDialog';
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

  const setRequest = useRequestStore((s) => s.setRequest);
  const setAuth = useRequestStore((s) => s.setAuth);
  const resetRequest = useRequestStore((s) => s.resetRequest);
  const beginExecution = useRequestStore((s) => s.beginExecution);
  const setExecutionState = useRequestStore((s) => s.setExecutionState);
  const setResponse = useResponseStore((s) => s.setResponse);
  const clearResponse = useResponseStore((s) => s.clearResponse);
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
    baselineRequestRef.current = request;
    setBaselineRequest(request);
  }, [setRequest]);

  const resetCleanRequest = useCallback(() => {
    resetRequest();
    const request = useRequestStore.getState().currentRequest;
    baselineRequestRef.current = request;
    setBaselineRequest(request);
  }, [resetRequest]);

  const confirmDestructiveNavigation = useCallback((confirmation: PendingConfirmation) => {
    const request = useRequestStore.getState().currentRequest;
    if (!requestsDiffer(request, baselineRequestRef.current)) {
      confirmation.onConfirm();
      return;
    }
    setPendingConfirmation(confirmation);
  }, []);

  const registerAcknowledgement = useCallback((operationId: string, message: string, onSuccess?: () => void) => {
    acknowledgementNotifications.current.set(operationId, { message, onSuccess });
  }, []);

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
      showNotification('Sensitive or oversized editor values were not restored. Review the request before sending.', 'info');
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
    }));
  }, [activeCollectionId, activeTab, baselineRequest, currentRequest, stateRestored, varSubTab]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (requestsDiffer(useRequestStore.getState().currentRequest, baselineRequestRef.current)) {
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
          setCollections(message.state.collections);
          if (useCollectionStore.getState().activeCollectionId
            && !message.state.collections.some(collection => (
              collection.id === useCollectionStore.getState().activeCollectionId
            ))) {
            selectCollection(null);
          }
          setEntries(message.state.history);
          setGlobalVariables(message.state.variables);
          setVariableSets(message.state.variableSets || []);
          setIsReady(true);
          break;
        case 'collections':
          setCollections(message.collections);
          break;
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
          setGlobalVariables(message.variables);
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
        case 'requestAuthUpdated':
          if (useRequestStore.getState().currentRequest.id === message.requestId) {
            setAuth(message.auth);
            setBaselineRequest(previous => {
              const baseline = { ...previous, auth: message.auth };
              baselineRequestRef.current = baseline;
              return baseline;
            });
            showNotification('Authentication updated', 'success');
          }
          break;
        case 'error':
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
  }, []);

  const handleSave = useCallback(() => {
    const request = useRequestStore.getState().currentRequest;
    const selCol = useCollectionStore.getState().activeCollectionId;
    if (selCol) {
      const operation = postMessage({ type: 'saveRequest', request, collectionId: selCol });
      registerAcknowledgement(operation.operationId, 'Request saved');
    } else {
      showNotification('Select a collection first', 'info');
    }
  }, [registerAcknowledgement]);

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
        <CurlImportPreview
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
        />
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
            onClick={() => setActiveTab(tab)}
            onKeyDown={(event) => {
              const nextIndex = nextTabIndex(index, event.key, TABS.length);
              if (nextIndex === null) {
                return;
              }
              event.preventDefault();
              setActiveTab(TABS[nextIndex]);
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
        {activeTab === 'editor' && (
          <RequestEditor
            onSend={handleSend}
            onSave={handleSave}
            onNew={handleNewRequest}
            isDirty={requestsDiffer(currentRequest, baselineRequest)}
            isSaved={collections.some(collection => hasSavedRequest(collection.items, currentRequest.id))}
            onNotification={showNotification}
          />
        )}
        {activeTab === 'collections' && <CollectionPanel onOpenRequest={openSavedRequest} />}
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
              {varSubTab === 'vars' ? <VariableEditor /> : <VariableSetPanel />}
            </div>
          </div>
        )}
        {activeTab === 'codegen' && <CodeGenPanel code={codeGenCode} />}
      </div>

      <ResponseViewer />
    </div>
  );
}
