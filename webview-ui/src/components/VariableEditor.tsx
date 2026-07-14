import { useEffect, useRef, useState } from 'react';
import { useVariableStore } from '../stores/useVariableStore';
import { useCollectionStore } from '../stores/useCollectionStore';
import { postMessage } from '../utils/vscodeApi';
import { ToggleSwitch } from './Common/ToggleSwitch';
import { Variable } from '../../../src/models/Variable';

const SCOPE_STYLES: Record<string, { badge: string; color: string; label: string }> = {
  global: { badge: 'G', color: 'var(--vscode-testing-iconPassedForeground)', label: 'Global' },
  collection: { badge: 'C', color: 'var(--vscode-textLink-foreground)', label: 'Collection' },
};

interface VariableRowProps {
  v: Variable;
  scope: 'global' | 'collection';
  onUpdate: (id: string, field: 'key' | 'value', val: string) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}

function VariableRow({ v, scope, onUpdate, onToggle, onRemove }: VariableRowProps) {
  const sc = SCOPE_STYLES[scope];

  return (
    <div
      style={{
        display: 'flex',
        gap: '6px',
        alignItems: 'center',
        padding: '5px 8px',
        marginBottom: '3px',
        borderRadius: '3px',
        opacity: v.enabled ? 1 : 0.5,
        transition: 'opacity 0.15s, background 0.15s',
      }}
    >
      {/* Scope badge */}
      <span
        style={{
          width: '20px',
          height: '20px',
          borderRadius: '50%',
          background: sc.color,
          color: '#fff',
          fontSize: '9px',
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
        title={sc.label}
      >
        {sc.badge}
      </span>

      {/* Toggle */}
      <ToggleSwitch checked={v.enabled} onChange={() => onToggle(v.id)} />

      {/* Key input */}
      <input
        type="text"
        value={v.key}
        onChange={(e) => onUpdate(v.id, 'key', e.target.value)}
        placeholder="Variable name"
        style={{
          flex: 1,
          padding: '3px 6px',
          background: 'var(--vscode-input-background)',
          color: 'var(--vscode-input-foreground)',
          border: '1px solid var(--vscode-input-border)',
          fontSize: '11px',
          fontFamily: 'var(--vscode-editor-font-family)',
          outline: 'none',
          borderRadius: '2px',
        }}
      />

      {/* Value input */}
      <input
        type="text"
        value={v.value}
        onChange={(e) => onUpdate(v.id, 'value', e.target.value)}
        placeholder="Value"
        style={{
          flex: 2,
          padding: '3px 6px',
          background: 'var(--vscode-input-background)',
          color: 'var(--vscode-input-foreground)',
          border: '1px solid var(--vscode-input-border)',
          fontSize: '11px',
          fontFamily: 'var(--vscode-editor-font-family)',
          outline: 'none',
          borderRadius: '2px',
        }}
      />

      {/* Delete */}
      <button
        onClick={() => onRemove(v.id)}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--vscode-errorForeground)',
          cursor: 'pointer',
          fontSize: '14px',
          padding: '2px 4px',
          lineHeight: 1,
          opacity: 0.5,
          transition: 'opacity 0.15s',
          flexShrink: 0,
        }}
        title="Remove"
      >
        ×
      </button>
    </div>
  );
}

export function VariableEditor() {
  const [filterText, setFilterText] = useState('');

  const globalVariables = useVariableStore((s) => s.globalVariables);
  const setGlobalVariables = useVariableStore((s) => s.setGlobalVariables);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeCollectionId = useCollectionStore((s) => s.activeCollectionId);
  const collections = useCollectionStore((s) => s.collections);
  const selectedCollection = collections.find(c => c.id === activeCollectionId);
  const collectionVars = selectedCollection?.variables || [];

  // Filter
  const lowerFilter = filterText.toLowerCase();
  const filteredGlobal = lowerFilter
    ? globalVariables.filter(v => v.key.toLowerCase().includes(lowerFilter) || v.value.toLowerCase().includes(lowerFilter))
    : globalVariables;
  const filteredColl = lowerFilter
    ? collectionVars.filter(v => v.key.toLowerCase().includes(lowerFilter) || v.value.toLowerCase().includes(lowerFilter))
    : collectionVars;

  // Auto-save global variables
  useEffect(() => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); }
    saveTimer.current = setTimeout(() => {
      postMessage({ type: 'setGlobalVariables', variables: globalVariables });
    }, 500);
    return () => { if (saveTimer.current) { clearTimeout(saveTimer.current); } };
  }, [globalVariables]);

  // Auto-save collection variables
  const collSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!selectedCollection) { return; }
    if (collSaveTimer.current) { clearTimeout(collSaveTimer.current); }
    collSaveTimer.current = setTimeout(() => {
      postMessage({ type: 'updateCollection', collection: selectedCollection });
    }, 500);
    return () => { if (collSaveTimer.current) { clearTimeout(collSaveTimer.current); } };
  }, [collectionVars]);

  const handleGlobalAdd = () => {
    setGlobalVariables([
      ...globalVariables,
      { id: crypto.randomUUID(), key: '', value: '', enabled: true, scope: 'global' as const },
    ]);
  };

  const handleGlobalUpdate = (id: string, field: 'key' | 'value', val: string) => {
    setGlobalVariables(globalVariables.map(v => v.id === id ? { ...v, [field]: val } : v));
  };

  const handleGlobalToggle = (id: string) => {
    setGlobalVariables(globalVariables.map(v => v.id === id ? { ...v, enabled: !v.enabled } : v));
  };

  const handleGlobalRemove = (id: string) => {
    setGlobalVariables(globalVariables.filter(v => v.id !== id));
  };

  const handleCollAdd = () => {
    if (!selectedCollection) { return; }
    const newVars = [
      ...collectionVars,
      { id: crypto.randomUUID(), key: '', value: '', enabled: true, scope: 'collection' as const },
    ];
    useCollectionStore.getState().updateCollectionVariables(selectedCollection.id, newVars);
  };

  const handleCollUpdate = (id: string, field: 'key' | 'value', val: string) => {
    if (!selectedCollection) { return; }
    const updated = collectionVars.map(v => v.id === id ? { ...v, [field]: val } : v);
    useCollectionStore.getState().updateCollectionVariables(selectedCollection.id, updated);
  };

  const handleCollToggle = (id: string) => {
    if (!selectedCollection) { return; }
    const updated = collectionVars.map(v => v.id === id ? { ...v, enabled: !v.enabled } : v);
    useCollectionStore.getState().updateCollectionVariables(selectedCollection.id, updated);
  };

  const handleCollRemove = (id: string) => {
    if (!selectedCollection) { return; }
    useCollectionStore.getState().updateCollectionVariables(
      selectedCollection.id,
      collectionVars.filter(v => v.id !== id)
    );
  };

  return (
    <div style={{ padding: '8px' }}>
      {/* Search */}
      <input
        type="text"
        value={filterText}
        onChange={(e) => setFilterText(e.target.value)}
        placeholder="Filter variables..."
        style={{
          width: '100%',
          padding: '4px 8px',
          marginBottom: '8px',
          background: 'var(--vscode-input-background)',
          color: 'var(--vscode-input-foreground)',
          border: '1px solid var(--vscode-input-border)',
          fontSize: '11px',
          fontFamily: 'var(--vscode-font-family)',
          outline: 'none',
          borderRadius: '2px',
        }}
      />

      {/* Global Variables Section */}
      <div style={{
        border: '1px solid var(--vscode-panel-border)',
        borderRadius: '3px',
        marginBottom: selectedCollection ? '10px' : 0,
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 8px',
          background: 'var(--vscode-sideBarSectionHeader-background)',
          borderBottom: '1px solid var(--vscode-panel-border)',
          borderRadius: '3px 3px 0 0',
        }}>
          <span style={{ fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{
              width: '16px', height: '16px', borderRadius: '50%',
              background: 'var(--vscode-testing-iconPassedForeground)', color: '#fff',
              fontSize: '7px', fontWeight: 700, display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center',
            }}>G</span>
            Global Variables
            <span style={{ fontSize: '9px', color: 'var(--vscode-descriptionForeground)', fontWeight: 400 }}>
              ({globalVariables.length})
            </span>
          </span>
          <button
            onClick={handleGlobalAdd}
            style={{
              padding: '2px 8px',
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
              border: 'none',
              cursor: 'pointer',
              fontSize: '10px',
              borderRadius: '2px',
            }}
          >
            + Add
          </button>
        </div>

        <div style={{ padding: '4px 0' }}>
          {filteredGlobal.length === 0 && (
            <div style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)', textAlign: 'center', padding: '16px 8px', lineHeight: 1.6 }}>
              {filterText ? 'No variables match your filter.' : 'No global variables yet.'}
              {!filterText && <><br /><span style={{ fontSize: '9px' }}>Click "+ Add" to create one.</span></>}
            </div>
          )}
          {filteredGlobal.map((v) => (
            <VariableRow
              key={v.id}
              v={v}
              scope="global"
              onUpdate={handleGlobalUpdate}
              onToggle={handleGlobalToggle}
              onRemove={handleGlobalRemove}
            />
          ))}
        </div>
      </div>

      {/* Collection Variables Section */}
      {selectedCollection && (
        <div style={{ border: '1px solid var(--vscode-panel-border)', borderRadius: '3px', marginBottom: '10px' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '6px 8px',
            background: 'var(--vscode-sideBarSectionHeader-background)',
            borderBottom: '1px solid var(--vscode-panel-border)',
            borderRadius: '3px 3px 0 0',
          }}>
            <span style={{ fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{
                width: '16px', height: '16px', borderRadius: '50%',
                background: 'var(--vscode-textLink-foreground)', color: '#fff',
                fontSize: '7px', fontWeight: 700, display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center',
              }}>C</span>
              Collection Variables
              <span style={{ fontSize: '9px', color: 'var(--vscode-descriptionForeground)', fontWeight: 400 }}>
                ({selectedCollection.name})
              </span>
            </span>
            <button
              onClick={handleCollAdd}
              style={{
                padding: '2px 8px',
                background: 'var(--vscode-button-background)',
                color: 'var(--vscode-button-foreground)',
                border: 'none',
                cursor: 'pointer',
                fontSize: '10px',
                borderRadius: '2px',
              }}
            >
              + Add
            </button>
          </div>

          <div style={{ padding: '4px 0' }}>
            {filteredColl.length === 0 && (
              <div style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)', textAlign: 'center', padding: '16px 8px', lineHeight: 1.6 }}>
                {filterText ? 'No variables match your filter.' : 'No collection-level variables.'}
                {!filterText && <><br /><span style={{ fontSize: '9px' }}>Add variables scoped to this collection.</span></>}
              </div>
            )}
            {filteredColl.map((v) => (
              <VariableRow
                key={v.id}
                v={v}
                scope="collection"
                onUpdate={handleCollUpdate}
                onToggle={handleCollToggle}
                onRemove={handleCollRemove}
              />
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
