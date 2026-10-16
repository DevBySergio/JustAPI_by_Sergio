import { useState, type CSSProperties, type FormEvent } from 'react';
import type { Collection, CollectionItemRef } from '../../../src/models/Collection';
import { useCollectionStore } from '../stores/useCollectionStore';
import { postMessageWithAck } from '../utils/vscodeApi';

export type RemoveCollectionItems = (requestIds: string[], remove: () => Promise<void>) => void;

export function requestIdsIn(items: readonly CollectionItemRef[]): string[] {
  return items.flatMap(item => item.type === 'request'
    ? item.requestId ? [item.requestId] : []
    : requestIdsIn(item.items ?? []));
}

const buttonStyle: CSSProperties = {
  border: '1px solid var(--vscode-panel-border)', background: 'var(--vscode-button-secondaryBackground)',
  color: 'var(--vscode-button-secondaryForeground)', padding: '3px 6px', cursor: 'pointer', fontSize: '11px',
};
const inputStyle: CSSProperties = {
  minWidth: 0, width: '100%', boxSizing: 'border-box', padding: '4px', fontSize: '11px',
  border: '1px solid var(--vscode-input-border)', background: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)',
};

export function FolderNameForm({ label, initialName = '', submitLabel, onSubmit, onCancel }: {
  label: string; initialName?: string; submitLabel: string;
  onSubmit: (name: string) => Promise<void>; onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || busy) { return; }
    setBusy(true); setError('');
    void onSubmit(name.trim()).then(onCancel).catch(reason => setError(String(reason))).finally(() => setBusy(false));
  };
  return <form onSubmit={submit} style={{ padding: '6px' }}>
    <label style={{ fontSize: '11px' }}>{label}
      <input autoFocus value={name} maxLength={1024} onChange={event => setName(event.target.value)}
        onKeyDown={event => { if (event.key === 'Escape' && !busy) { onCancel(); } }} style={inputStyle} />
    </label>
    <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
      <button type="submit" disabled={busy || !name.trim()} style={buttonStyle}>{submitLabel}</button>
      <button type="button" disabled={busy} onClick={onCancel} style={buttonStyle}>Cancel</button>
    </div>
    {error && <div role="alert">{error}</div>}
  </form>;
}

export function CollectionItemRow({ item, collectionId, siblings, index, parentId, onOpenRequest, onRemove }: {
  item: CollectionItemRef; collectionId: string; siblings: CollectionItemRef[]; index: number; parentId?: string;
  onOpenRequest: (requestId: string, collectionId: string) => void; onRemove: RemoveCollectionItems;
}) {
  const [expanded, setExpanded] = useState(true);
  const [organizing, setOrganizing] = useState(false);
  const [action, setAction] = useState<'create' | 'rename' | 'move' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const folder = item.type === 'folder';
  const close = () => { setAction(null); setOrganizing(false); setError(''); };
  const reorder = (targetIndex: number) => {
    setBusy(true); setError('');
    void postMessageWithAck({ type: 'moveItem', itemId: item.id, sourceCollectionId: collectionId,
      targetCollectionId: collectionId, targetParentId: parentId, targetIndex })
      .catch(reason => setError(String(reason))).finally(() => setBusy(false));
  };
  const remove = () => {
    onRemove(requestIdsIn([item]), async () => {
      setBusy(true); setError('');
      try {
        await postMessageWithAck(folder
          ? { type: 'deleteFolder', collectionId, folderId: item.id }
          : { type: 'deleteRequest', collectionId, requestId: item.requestId! });
      } catch (reason) { setError(String(reason)); throw reason; }
      finally { setBusy(false); }
    });
  };
  return <div style={{ margin: '2px 0' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <button type="button" aria-expanded={folder ? expanded : undefined}
        onClick={() => folder ? setExpanded(!expanded) : item.requestId && onOpenRequest(item.requestId, collectionId)}
        style={{ ...buttonStyle, flex: 1, minWidth: 0, textAlign: 'left', background: 'transparent', color: 'var(--vscode-foreground)', border: 'none', overflowWrap: 'anywhere' }}>
        {folder ? `${expanded ? '▾' : '▸'} 📁 ` : '➜ '}{item.name}
      </button>
      <button type="button" aria-label={`Organize ${folder ? 'folder' : 'request'} ${item.name}`}
        aria-expanded={organizing} onClick={() => { setOrganizing(!organizing); setAction(null); }} style={buttonStyle}>⋯</button>
    </div>
    {organizing && <div role="group" aria-label={`Organize ${item.name}`} style={{ padding: '4px', border: '1px solid var(--vscode-panel-border)' }}>
      <fieldset disabled={busy} style={{ margin: 0, padding: 0, border: 0, display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
        {folder && <>
          <button type="button" onClick={() => setAction('create')} style={buttonStyle}>New subfolder</button>
          <button type="button" onClick={() => setAction('rename')} style={buttonStyle}>Rename</button>
        </>}
        <button type="button" onClick={() => setAction('move')} style={buttonStyle}>Move…</button>
        <button type="button" disabled={busy || index === 0} onClick={() => reorder(index - 1)} style={buttonStyle}>Move up</button>
        <button type="button" disabled={busy || index === siblings.length - 1} onClick={() => reorder(index + 1)} style={buttonStyle}>Move down</button>
        <button type="button" onClick={() => setAction('delete')} style={buttonStyle}>Delete</button>
      </fieldset>
      {action === 'create' && <FolderNameForm label="Subfolder name" submitLabel="Create folder" onCancel={close}
        onSubmit={name => postMessageWithAck({ type: 'createFolder', collectionId, name, parentId: item.id })} />}
      {action === 'rename' && <FolderNameForm label="Folder name" initialName={item.name} submitLabel="Save name" onCancel={close}
        onSubmit={name => postMessageWithAck({ type: 'renameFolder', collectionId, folderId: item.id, name })} />}
      {action === 'move' && <MoveItemForm item={item} collectionId={collectionId} parentId={parentId} onClose={close} />}
      {action === 'delete' && <div style={{ padding: '6px', fontSize: '11px' }}>
        <p>Delete “{item.name}”{folder ? ` and its ${requestIdsIn([item]).length} saved request(s)` : ''}?</p>
        <button type="button" disabled={busy} onClick={remove} style={buttonStyle}>Confirm delete</button>{' '}
        <button type="button" disabled={busy} onClick={close} style={buttonStyle}>Cancel</button>
      </div>}
      {error && <div role="alert">{error}</div>}
    </div>}
    {folder && expanded && <div style={{ marginLeft: '12px' }}>
      {(item.items ?? []).map((child, childIndex) => <CollectionItemRow key={child.id} item={child} collectionId={collectionId}
        siblings={item.items ?? []} index={childIndex} parentId={item.id} onOpenRequest={onOpenRequest} onRemove={onRemove} />)}
      {!item.items?.length && <div style={{ padding: '3px 6px', fontSize: '10px', color: 'var(--vscode-descriptionForeground)' }}>Empty folder</div>}
    </div>}
  </div>;
}

function folderDestinations(collection: Collection | undefined, excludedId: string): Array<{ id: string; path: string; items: CollectionItemRef[] }> {
  const result: Array<{ id: string; path: string; items: CollectionItemRef[] }> = [];
  const visit = (items: CollectionItemRef[], prefix: string) => {
    for (const item of items) {
      if (item.type !== 'folder' || item.id === excludedId) { continue; }
      const path = prefix ? `${prefix} / ${item.name}` : item.name;
      result.push({ id: item.id, path, items: item.items ?? [] });
      visit(item.items ?? [], path);
    }
  };
  visit(collection?.items ?? [], '');
  return result;
}

function MoveItemForm({ item, collectionId, parentId, onClose }: {
  item: CollectionItemRef; collectionId: string; parentId?: string; onClose: () => void;
}) {
  const collections = useCollectionStore(state => state.collections);
  const [targetId, setTargetId] = useState(collectionId);
  const [targetParent, setTargetParent] = useState(parentId ?? '');
  const [beforeId, setBeforeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const target = collections.find(collection => collection.id === targetId);
  const folders = folderDestinations(target, item.id);
  const parent = targetParent ? folders.find(folder => folder.id === targetParent) : undefined;
  const destinationValid = !!target && (!targetParent || !!parent);
  const siblings = (parent?.items ?? target?.items ?? []).filter(sibling => sibling.id !== item.id);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!destinationValid || busy) { return; }
    const targetIndex = beforeId ? siblings.findIndex(sibling => sibling.id === beforeId) : siblings.length;
    if (targetIndex < 0) { setError('The destination changed. Choose a position again.'); return; }
    setBusy(true); setError('');
    void postMessageWithAck({ type: 'moveItem', itemId: item.id, sourceCollectionId: collectionId,
      targetCollectionId: targetId, targetParentId: targetParent || undefined, targetIndex })
      .then(onClose).catch(reason => setError(String(reason))).finally(() => setBusy(false));
  };
  return <form onSubmit={submit} style={{ padding: '6px', display: 'grid', gap: '6px', fontSize: '11px' }}>
    <label>Destination collection<select value={targetId} onChange={event => { setTargetId(event.target.value); setTargetParent(''); setBeforeId(''); }} style={inputStyle}>
      {collections.map(collection => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
    </select></label>
    <label>Destination folder<select value={targetParent} onChange={event => { setTargetParent(event.target.value); setBeforeId(''); }} style={inputStyle}>
      <option value="">Collection root</option>
      {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.path}</option>)}
    </select></label>
    <label>Position<select value={beforeId} onChange={event => setBeforeId(event.target.value)} style={inputStyle}>
      <option value="">At the end</option>
      {siblings.map(sibling => <option key={sibling.id} value={sibling.id}>Before {sibling.name}</option>)}
    </select></label>
    <div>
      <button type="submit" disabled={busy || !destinationValid} style={buttonStyle}>Move here</button>{' '}
      <button type="button" disabled={busy} onClick={onClose} style={buttonStyle}>Cancel</button>
    </div>
    {error && <div role="alert">{error}</div>}
  </form>;
}
