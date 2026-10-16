import { useState } from 'react';
import { useCollectionStore } from '../stores/useCollectionStore';
import { useVariableStore } from '../stores/useVariableStore';
import { postMessage, postMessageWithAck } from '../utils/vscodeApi';
import { CollectionItemRow, FolderNameForm, requestIdsIn, type RemoveCollectionItems } from './CollectionTree';

interface CollectionPanelProps {
  onOpenRequest: (requestId: string, collectionId: string) => void;
  onRemove: RemoveCollectionItems;
}

export function CollectionPanel({ onOpenRequest, onRemove }: CollectionPanelProps) {
  const collections = useCollectionStore((s) => s.collections);
  const activeCollectionId = useCollectionStore((s) => s.activeCollectionId);
  const selectCollection = useCollectionStore((s) => s.selectCollection);
  const [folderCollectionId, setFolderCollectionId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleCreate = () => {
    if (newName.trim()) {
      postMessage({ type: 'createCollection', name: newName.trim() });
      setNewName('');
      setIsCreating(false);
    }
  };

  const handleDeleteCollection = (id: string) => {
    if (confirmDeleteId === id) {
      const collection = collections.find(value => value.id === id);
      onRemove(requestIdsIn(collection?.items ?? []), () => postMessageWithAck({ type: 'deleteCollection', collectionId: id }));
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(id);
    }
  };

  const startRename = (id: string, currentName: string) => {
    setRenamingId(id);
    setRenameValue(currentName);
  };

  const commitRename = (id: string) => {
    if (renameValue.trim()) {
      postMessage({ type: 'renameCollection', collectionId: id, name: renameValue.trim() });
    }
    setRenamingId(null);
  };

  const handleDuplicate = (id: string) => {
    postMessage({ type: 'duplicateCollection', collectionId: id });
  };

  return (
    <div style={{ padding: '8px' }}>
      {!isCreating && (
        <button
          onClick={() => setIsCreating(true)}
          style={{
            width: '100%',
            padding: '6px',
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            cursor: 'pointer',
            fontSize: '11px',
            marginBottom: '8px',
          }}
        >
          + New Collection
        </button>
      )}

      {isCreating && (
        <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Collection name..."
            autoFocus
            style={{
              flex: 1,
              padding: '4px 6px',
              background: 'var(--vscode-input-background)',
              color: 'var(--vscode-input-foreground)',
              border: '1px solid var(--vscode-input-border)',
              fontSize: '11px',
            }}
          />
          <button onClick={handleCreate} style={{ padding: '4px 8px', background: 'var(--vscode-button-background)', color: 'var(--vscode-button-foreground)', border: 'none', cursor: 'pointer', fontSize: '11px' }}>OK</button>
          <button onClick={() => setIsCreating(false)} style={{ padding: '4px 8px', background: 'transparent', color: 'var(--vscode-foreground)', border: 'none', cursor: 'pointer', fontSize: '11px', opacity: 0.6 }}>×</button>
        </div>
      )}

      {collections.length === 0 && (
        <div style={{ color: 'var(--vscode-descriptionForeground)', fontSize: '11px', textAlign: 'center', padding: '24px 16px', lineHeight: 1.6 }}>
          No collections yet.<br />
          <span style={{ fontSize: '10px' }}>Create one to organize your requests.</span>
        </div>
      )}

      {collections.map((col) => (
        <div key={col.id} style={{ marginBottom: '4px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 6px',
              background: activeCollectionId === col.id ? 'var(--vscode-list-activeSelectionBackground)' : 'transparent',
              color: activeCollectionId === col.id ? 'var(--vscode-list-activeSelectionForeground)' : 'var(--vscode-foreground)',
              borderRadius: '2px',
            }}
          >
            {renamingId === col.id ? (
              <input
                type="text"
                aria-label={`Rename collection ${col.name}`}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { commitRename(col.id); }
                  if (e.key === 'Escape') { setRenamingId(null); }
                }}
                onBlur={() => commitRename(col.id)}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                style={{
                  flex: 1,
                  padding: '2px 4px',
                  background: 'var(--vscode-input-background)',
                  color: 'var(--vscode-input-foreground)',
                  border: '1px solid var(--vscode-focusBorder)',
                  fontSize: '12px',
                  fontWeight: 600,
                  outline: 'none',
                }}
              />
            ) : (
              <button
                type="button"
                style={{
                  flex: 1,
                  fontWeight: 600,
                  fontSize: '12px',
                  border: 'none',
                  background: 'transparent',
                  color: 'inherit',
                  textAlign: 'left',
                  cursor: 'pointer',
                  padding: 0,
                }}
                onClick={() => selectCollection(col.id)}
                onDoubleClick={() => startRename(col.id, col.name)}
                title="Double-click to rename"
              >
                {col.name}
              </button>
            )}

            <button type="button" aria-label={`Rename collection ${col.name}`} onClick={() => startRename(col.id, col.name)}
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '10px' }}>Rename</button>
            <button
              onClick={(e) => { e.stopPropagation(); handleDuplicate(col.id); }}
              style={{ background: 'none', border: 'none', color: 'var(--vscode-textLink-foreground)', cursor: 'pointer', fontSize: '10px', padding: '2px' }}
              title="Duplicate"
              aria-label={`Duplicate collection ${col.name}`}
            >
              ⧉
            </button>

            {confirmDeleteId === col.id ? (
              <span role="group" aria-label={`Confirm deleting collection ${col.name}`} style={{ fontSize: '10px', display: 'flex', gap: '2px' }}>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteCollection(col.id); }}
                  style={{ padding: '1px 4px', background: 'var(--vscode-errorForeground)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '9px', borderRadius: '2px' }}
                >
                  Confirm
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                  style={{ padding: '1px 4px', background: 'transparent', color: 'var(--vscode-foreground)', border: '1px solid var(--vscode-panel-border)', cursor: 'pointer', fontSize: '9px', borderRadius: '2px' }}
                >
                  ×
                </button>
              </span>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); handleDeleteCollection(col.id); }}
                style={{ background: 'none', border: 'none', color: 'var(--vscode-errorForeground)', cursor: 'pointer', fontSize: '12px', padding: '2px', opacity: 0.7 }}
                title="Delete"
                aria-label={`Delete collection ${col.name}`}
              >
                ×
              </button>
            )}
          </div>

          {activeCollectionId === col.id && <div style={{ padding: '4px 6px' }}>
            <button type="button" aria-label={`New folder in ${col.name}`} onClick={() => setFolderCollectionId(col.id)}
              style={{ background: 'none', border: '1px solid var(--vscode-panel-border)', color: 'var(--vscode-textLink-foreground)', cursor: 'pointer', fontSize: '11px' }}>+ New folder</button>
            {folderCollectionId === col.id && <FolderNameForm label="Folder name" submitLabel="Create folder"
              onCancel={() => setFolderCollectionId(null)}
              onSubmit={name => postMessageWithAck({ type: 'createFolder', collectionId: col.id, name })} />}
          </div>}
          {activeCollectionId === col.id && col.items.length > 0 && (
            <div style={{ marginLeft: '12px', marginTop: '2px' }}>
              {col.items.map((item, index) => (
                <CollectionItemRow
                  key={item.id}
                  item={item}
                  siblings={col.items}
                  index={index}
                  onRemove={onRemove}
                  collectionId={col.id}
                  onOpenRequest={onOpenRequest}
                />
              ))}
            </div>
          )}

          {activeCollectionId === col.id && <LinkedSetsSection collectionId={col.id} />}
        </div>
      ))}
    </div>
  );
}

function LinkedSetsSection({ collectionId }: { collectionId: string }) {
  const variableSets = useVariableStore((s) => s.variableSets);
  const [showLinker, setShowLinker] = useState(false);
  const [selectedSetId, setSelectedSetId] = useState('');

  const linked = variableSets.filter(s => s.linkedCollectionIds.includes(collectionId));
  const unlinked = variableSets.filter(s => !s.linkedCollectionIds.includes(collectionId));

  const handleLink = () => {
    if (selectedSetId) {
      postMessage({ type: 'linkVariableSet', setId: selectedSetId, collectionId });
      setSelectedSetId('');
      setShowLinker(false);
    }
  };

  return (
    <div style={{ marginTop: '6px', borderTop: '1px solid var(--vscode-panel-border)', paddingTop: '4px' }}>
      <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--vscode-descriptionForeground)', marginBottom: '4px', padding: '0 8px' }}>
        Variable Sets
      </div>

      {linked.length === 0 && !showLinker && (
        <div style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)', padding: '2px 8px', marginBottom: '4px' }}>
          No linked sets.{' '}
          <button
            type="button"
            onClick={() => setShowLinker(true)}
            style={{ color: 'var(--vscode-textLink-foreground)', cursor: 'pointer', textDecoration: 'underline', border: 'none', background: 'transparent', padding: 0, font: 'inherit' }}
          >
            Link one
          </button>
        </div>
      )}

      {linked.map(set => (
        <div key={set.id} style={{
          display: 'flex', alignItems: 'center', gap: '4px',
          padding: '2px 8px', fontSize: '10px',
        }}>
          <span style={{
            width: '12px', height: '12px', borderRadius: '50%',
            background: '#ca9ee6', color: '#fff', fontSize: '6px', fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>S</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {set.name}
          </span>
          <span style={{ fontSize: '9px', color: 'var(--vscode-descriptionForeground)' }}>
            {set.variables.filter(v => v.enabled).length} vars
          </span>
          <button
            onClick={() => postMessage({ type: 'unlinkVariableSet', setId: set.id, collectionId })}
            style={{ background: 'none', border: 'none', color: 'var(--vscode-errorForeground)', cursor: 'pointer', fontSize: '10px', padding: '1px 2px', opacity: 0.6 }}
            title="Unlink"
          >
            ×
          </button>
        </div>
      ))}

      {showLinker && unlinked.length > 0 && (
        <div style={{ display: 'flex', gap: '4px', padding: '4px 8px' }}>
          <select
            aria-label="Variable set to link"
            value={selectedSetId}
            onChange={e => setSelectedSetId(e.target.value)}
            style={{
              flex: 1, fontSize: '10px', padding: '2px 4px',
              background: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)',
              border: '1px solid var(--vscode-input-border)',
            }}
          >
            <option value="">Select a set...</option>
            {unlinked.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button
            onClick={handleLink}
            disabled={!selectedSetId}
            style={{
              padding: '2px 6px', fontSize: '10px',
              background: 'var(--vscode-button-background)', color: 'var(--vscode-button-foreground)',
              border: 'none', cursor: 'pointer',
            }}
          >
            Link
          </button>
          <button
            onClick={() => setShowLinker(false)}
            style={{ padding: '2px 6px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--vscode-foreground)', opacity: 0.6 }}
          >
            ×
          </button>
        </div>
      )}

      {showLinker && unlinked.length === 0 && (
        <div style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)', padding: '4px 8px' }}>
          No unlinked sets available.{' '}
          <button
            type="button"
            onClick={() => setShowLinker(false)}
            style={{ color: 'var(--vscode-textLink-foreground)', cursor: 'pointer', textDecoration: 'underline', border: 'none', background: 'transparent', padding: 0, font: 'inherit' }}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
