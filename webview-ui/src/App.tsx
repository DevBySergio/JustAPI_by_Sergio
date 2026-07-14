import { useEffect, useState, useCallback, useRef } from 'react';
import {
  createExecutionId,
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
import { SearchResult } from '../../src/models/MessageProtocol';
import { isActiveExecution } from '../../src/protocol/CorrelationTracker';

type TabView = 'editor' | 'collections' | 'history' | 'variables' | 'codegen';

export function App() {
  const [activeTab, setActiveTab] = useState<TabView>('editor');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [notification, setNotification] = useState<{ text: string; type: 'info' | 'error' | 'success' } | null>(null);
  const [codeGenCode, setCodeGenCode] = useState('');
  const [varSubTab, setVarSubTab] = useState<'vars' | 'sets'>('vars');
  const notifTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acknowledgementNotifications = useRef(new Map<string, string>());

  const showNotification = useCallback((text: string, type: 'info' | 'error' | 'success' = 'info') => {
    setNotification({ text, type });
    if (notifTimer.current) { clearTimeout(notifTimer.current); }
    notifTimer.current = setTimeout(() => setNotification(null), 3000);
  }, []);

  const setRequest = useRequestStore((s) => s.setRequest);
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

  useEffect(() => {
    return onMessage((message) => {
      if (!isCurrentOperation(message.operationId)) {
        return;
      }
      switch (message.type) {
        case 'initialState':
          setCollections(message.state.collections);
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
          setRequest(message.request);
          setActiveTab('editor');
          showNotification('cURL imported successfully', 'success');
          break;
        case 'requestLoaded':
          setRequest(message.request);
          setActiveTab('editor');
          break;
        case 'error':
          if (!message.executionId
            || isActiveExecution(useRequestStore.getState().activeExecutionId, message.executionId)) {
            showNotification(message.message || 'An error occurred', 'error');
          }
          break;
        case 'searchResults':
          setSearchResults(message.results);
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
        case 'createNewRequest':
          resetRequest();
          setActiveTab('editor');
          showNotification('New request created', 'success');
          break;
        case 'acknowledgement': {
          const notification = acknowledgementNotifications.current.get(message.operationId);
          if (notification) {
            acknowledgementNotifications.current.delete(message.operationId);
            showNotification(notification, 'success');
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
    const request = useRequestStore.getState().currentRequest;
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
      acknowledgementNotifications.current.set(operation.operationId, 'Request saved');
    } else {
      showNotification('Select a collection first', 'info');
    }
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', position: 'relative' }}>
      {notification && (
        <div
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

      <SearchBar
        value={searchQuery}
        onChange={setSearchQuery}
        onSearch={(q) => {
          setSearchResults([]);
          postMessage({ type: 'search', query: q });
        }}
      />

      {searchResults.length > 0 && (
        <SearchResults
          results={searchResults}
          onClose={() => setSearchResults([])}
          onSelect={(result) => {
            setSearchResults([]);
            if (result.type === 'request' && result.collectionId) {
              selectCollection(result.collectionId);
              setActiveTab('collections');
            }
          }}
        />
      )}

      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--vscode-panel-border)',
        background: 'var(--vscode-tab-activeBackground)',
      }}>
        {(['editor', 'collections', 'history', 'variables', 'codegen'] as TabView[]).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
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

      <div style={{ flex: 1, overflow: 'auto' }}>
        {activeTab === 'editor' && (
          <RequestEditor onSend={handleSend} onSave={handleSave} onNotification={showNotification} />
        )}
        {activeTab === 'collections' && <CollectionPanel />}
        {activeTab === 'history' && <HistoryPanel />}
        {activeTab === 'variables' && (
          <div>
            <div style={{ display: 'flex', gap: '2px', borderBottom: '1px solid var(--vscode-panel-border)', padding: '0 8px' }}>
              {(['vars', 'sets'] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => setVarSubTab(st)}
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
            {varSubTab === 'vars' ? <VariableEditor /> : <VariableSetPanel />}
          </div>
        )}
        {activeTab === 'codegen' && <CodeGenPanel code={codeGenCode} />}
      </div>

      <ResponseViewer />
    </div>
  );
}
