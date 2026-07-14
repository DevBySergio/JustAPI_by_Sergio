import { useState, useEffect } from 'react';
import { postMessage, onMessage } from '../utils/vscodeApi';
import { useCollectionStore } from '../stores/useCollectionStore';
import { VariableSet } from '../../../src/models/VariableSet';
import { ToggleSwitch } from './Common/ToggleSwitch';

function LinkModal({
  set,
  collections,
  onClose,
}: {
  set: VariableSet;
  collections: { id: string; name: string }[];
  onClose: () => void;
}) {
  const handleToggle = (collectionId: string, isLinked: boolean) => {
    if (isLinked) {
      postMessage({ type: 'unlinkVariableSet', setId: set.id, collectionId });
    } else {
      postMessage({ type: 'linkVariableSet', setId: set.id, collectionId });
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 500,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--vscode-editor-background)',
          border: '1px solid var(--vscode-panel-border)',
          borderRadius: '4px',
          padding: '12px',
          minWidth: '220px',
          maxWidth: '300px',
          maxHeight: '70vh',
          overflow: 'auto',
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 600 }}>Link "{set.name}" to:</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--vscode-foreground)', cursor: 'pointer', fontSize: '14px', padding: '2px' }}>×</button>
        </div>

        {collections.length === 0 && (
          <div style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)', padding: '8px', textAlign: 'center' }}>
            No collections available.
          </div>
        )}

        {collections.map((col) => {
          const isLinked = set.linkedCollectionIds.includes(col.id);
          return (
            <label
              key={col.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 4px',
                fontSize: '11px',
                cursor: 'pointer',
                borderRadius: '2px',
              }}
            >
              <input
                type="checkbox"
                checked={isLinked}
                onChange={() => handleToggle(col.id, isLinked)}
                style={{ margin: 0 }}
              />
              {col.name}
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function VariableSetPanel() {
  const [sets, setSets] = useState<VariableSet[]>([]);
  const [newName, setNewName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [expandedSet, setExpandedSet] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [linkingSetId, setLinkingSetId] = useState<string | null>(null);
  const collections = useCollectionStore((s) => s.collections);

  useEffect(() => {
    postMessage({ type: 'getVariableSets' });
    return onMessage((message) => {
      if (message.type === 'variableSets') {
        setSets(message.sets);
      }
    });
  }, []);

  const handleCreate = () => {
    if (newName.trim()) {
      postMessage({ type: 'createVariableSet', name: newName.trim() });
      setNewName('');
      setIsCreating(false);
    }
  };

  const handleDelete = (id: string) => {
    if (confirmDelete === id) {
      postMessage({ type: 'deleteVariableSet', setId: id });
      setConfirmDelete(null);
    } else {
      setConfirmDelete(id);
    }
  };

  const handleAddVar = (setId: string) => {
    const set = sets.find(s => s.id === setId);
    if (!set) { return; }
    postMessage({
      type: 'updateVariableSet',
      set: {
        ...set,
        variables: [...set.variables, { id: crypto.randomUUID(), key: '', value: '', enabled: true, scope: 'collection' as const }],
      },
    });
  };

  const handleUpdateVar = (setId: string, varId: string, field: 'key' | 'value', val: string) => {
    const set = sets.find(s => s.id === setId);
    if (!set) { return; }
    postMessage({
      type: 'updateVariableSet',
      set: { ...set, variables: set.variables.map(v => v.id === varId ? { ...v, [field]: val } : v) },
    });
  };

  const handleToggleVar = (setId: string, varId: string) => {
    const set = sets.find(s => s.id === setId);
    if (!set) { return; }
    postMessage({
      type: 'updateVariableSet',
      set: { ...set, variables: set.variables.map(v => v.id === varId ? { ...v, enabled: !v.enabled } : v) },
    });
  };

  const handleRemoveVar = (setId: string, varId: string) => {
    const set = sets.find(s => s.id === setId);
    if (!set) { return; }
    postMessage({
      type: 'updateVariableSet',
      set: { ...set, variables: set.variables.filter(v => v.id !== varId) },
    });
  };

  return (
    <div style={{ padding: '8px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <h3 style={{ fontSize: '12px', fontWeight: 600, margin: 0 }}>Variable Sets</h3>
        {!isCreating && (
          <button onClick={() => setIsCreating(true)} style={{ padding: '3px 8px', background: 'var(--vscode-button-background)', color: 'var(--vscode-button-foreground)', border: 'none', cursor: 'pointer', fontSize: '10px', borderRadius: '2px' }}>
            + New Set
          </button>
        )}
      </div>

      {isCreating && (
        <div style={{ display: 'flex', gap: '4px', marginBottom: '10px' }}>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Set name..."
            autoFocus
            style={{ flex: 1, padding: '4px 6px', background: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)', border: '1px solid var(--vscode-input-border)', fontSize: '11px', outline: 'none', borderRadius: '2px' }}
          />
          <button onClick={handleCreate} style={{ padding: '4px 8px', background: 'var(--vscode-button-background)', color: 'var(--vscode-button-foreground)', border: 'none', cursor: 'pointer', fontSize: '11px', borderRadius: '2px' }}>OK</button>
          <button onClick={() => setIsCreating(false)} style={{ padding: '4px 8px', background: 'transparent', color: 'var(--vscode-foreground)', border: 'none', cursor: 'pointer', fontSize: '11px', opacity: 0.6 }}>×</button>
        </div>
      )}

      {sets.length === 0 && (
        <div style={{ color: 'var(--vscode-descriptionForeground)', fontSize: '11px', textAlign: 'center', padding: '24px 16px', lineHeight: 1.6 }}>
          No variable sets yet.<br />
          <span style={{ fontSize: '10px' }}>Create reusable groups of variables linked to your API collections.</span>
        </div>
      )}

      {/* Set Cards */}
      {sets.map((set) => {
        const isExpanded = expandedSet === set.id;
        const linkedCols = collections.filter(c => set.linkedCollectionIds.includes(c.id));

        return (
          <div
            key={set.id}
            style={{
              border: '1px solid var(--vscode-panel-border)',
              borderRadius: '3px',
              marginBottom: '6px',
              overflow: 'hidden',
            }}
          >
            {/* Card Header */}
            <div
              onClick={() => setExpandedSet(isExpanded ? null : set.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 8px',
                cursor: 'pointer',
                background: isExpanded ? 'var(--vscode-list-activeSelectionBackground)' : 'transparent',
                color: isExpanded ? 'var(--vscode-list-activeSelectionForeground)' : 'var(--vscode-foreground)',
                transition: 'background 0.1s',
              }}
            >
              <span style={{ fontSize: '10px', width: '12px', textAlign: 'center', flexShrink: 0 }}>
                {isExpanded ? '▼' : '▶'}
              </span>
              <span style={{ fontWeight: 600, fontSize: '11px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {set.name}
              </span>

              {/* Linked collection tags */}
              <div style={{ display: 'flex', gap: '3px', overflow: 'hidden', maxWidth: '120px', flexShrink: 0 }}>
                {linkedCols.slice(0, 3).map(col => (
                  <span
                    key={col.id}
                    style={{
                      fontSize: '8px',
                      padding: '1px 4px',
                      background: 'var(--vscode-textLink-foreground)',
                      color: '#fff',
                      borderRadius: '8px',
                      whiteSpace: 'nowrap',
                      maxWidth: '60px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {col.name}
                  </span>
                ))}
                {linkedCols.length > 3 && (
                  <span style={{ fontSize: '8px', color: 'var(--vscode-descriptionForeground)' }}>+{linkedCols.length - 3}</span>
                )}
              </div>

              <span style={{ fontSize: '9px', color: isExpanded ? 'var(--vscode-list-activeSelectionForeground)' : 'var(--vscode-descriptionForeground)', flexShrink: 0, opacity: 0.7 }}>
                {set.variables.length}v
              </span>

              {/* Link button */}
              <button
                onClick={(e) => { e.stopPropagation(); setLinkingSetId(set.id); }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: isExpanded ? 'var(--vscode-list-activeSelectionForeground)' : 'var(--vscode-textLink-foreground)',
                  cursor: 'pointer',
                  fontSize: '10px',
                  padding: '2px 4px',
                  flexShrink: 0,
                  textDecoration: 'underline',
                  opacity: 0.7,
                }}
                title="Link to collections"
              >
                Link
              </button>

              {/* Delete */}
              {confirmDelete === set.id ? (
                <span style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(set.id); }} style={{ padding: '1px 4px', background: 'var(--vscode-errorForeground)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '9px', borderRadius: '2px' }}>Confirm</button>
                  <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); }} style={{ padding: '1px 4px', background: 'transparent', color: 'var(--vscode-foreground)', border: '1px solid var(--vscode-panel-border)', cursor: 'pointer', fontSize: '9px', borderRadius: '2px' }}>×</button>
                </span>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(set.id); }}
                  style={{ background: 'none', border: 'none', color: 'var(--vscode-errorForeground)', cursor: 'pointer', fontSize: '12px', padding: '2px', opacity: 0.5, flexShrink: 0 }}
                  title="Delete"
                >
                  ×
                </button>
              )}
            </div>

            {/* Expanded Content */}
            {isExpanded && (
              <div style={{ padding: '6px 8px 8px' }}>
                {/* Variables */}
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--vscode-foreground)' }}>Variables</span>
                    <button onClick={() => handleAddVar(set.id)} style={{ padding: '2px 8px', background: 'var(--vscode-button-background)', color: 'var(--vscode-button-foreground)', border: 'none', cursor: 'pointer', fontSize: '9px', borderRadius: '2px' }}>+ Add</button>
                  </div>

                  {set.variables.length === 0 && (
                    <div style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)', padding: '8px', textAlign: 'center' }}>No variables yet.</div>
                  )}

                  {set.variables.map((v) => (
                    <div key={v.id} style={{ display: 'flex', gap: '4px', marginBottom: '3px', alignItems: 'center' }}>
                      <div style={{ flexShrink: 0 }}>
                        <ToggleSwitch checked={v.enabled} onChange={() => handleToggleVar(set.id, v.id)} />
                      </div>
                      <input type="text" value={v.key} onChange={(e) => handleUpdateVar(set.id, v.id, 'key', e.target.value)} placeholder="Name"
                        style={{ flex: 1, padding: '2px 4px', background: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)', border: '1px solid var(--vscode-input-border)', fontSize: '10px', fontFamily: 'var(--vscode-editor-font-family)', outline: 'none', borderRadius: '2px' }} />
                      <input type="text" value={v.value} onChange={(e) => handleUpdateVar(set.id, v.id, 'value', e.target.value)} placeholder="Value"
                        style={{ flex: 2, padding: '2px 4px', background: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)', border: '1px solid var(--vscode-input-border)', fontSize: '10px', fontFamily: 'var(--vscode-editor-font-family)', outline: 'none', borderRadius: '2px' }} />
                      <button onClick={() => handleRemoveVar(set.id, v.id)} style={{ background: 'none', border: 'none', color: 'var(--vscode-errorForeground)', cursor: 'pointer', fontSize: '12px', padding: '1px', opacity: 0.5, lineHeight: 1, flexShrink: 0 }}>×</button>
                    </div>
                  ))}
                </div>

                {/* Linked collections tags */}
                <div>
                  <span style={{ fontSize: '10px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Linked Collections</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {linkedCols.length === 0 && (
                      <span style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)' }}>Not linked to any collection.</span>
                    )}
                    {linkedCols.map(col => (
                      <span
                        key={col.id}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                          padding: '2px 6px',
                          fontSize: '9px',
                          background: 'var(--vscode-textBlockQuote-background)',
                          borderRadius: '10px',
                          border: '1px solid var(--vscode-panel-border)',
                        }}
                      >
                        {col.name}
                        <button
                          onClick={() => postMessage({ type: 'unlinkVariableSet', setId: set.id, collectionId: col.id })}
                          style={{ background: 'none', border: 'none', color: 'var(--vscode-errorForeground)', cursor: 'pointer', fontSize: '10px', padding: 0, lineHeight: 1, opacity: 0.6 }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <button
                      onClick={() => setLinkingSetId(set.id)}
                      style={{
                        padding: '2px 8px',
                        fontSize: '9px',
                        background: 'none',
                        border: '1px dashed var(--vscode-panel-border)',
                        color: 'var(--vscode-textLink-foreground)',
                        cursor: 'pointer',
                        borderRadius: '10px',
                      }}
                    >
                      + Link
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Link Modal */}
      {linkingSetId && (
        <LinkModal
          set={sets.find(s => s.id === linkingSetId)!}
          collections={collections}
          onClose={() => setLinkingSetId(null)}
        />
      )}
    </div>
  );
}
