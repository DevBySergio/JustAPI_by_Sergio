import { useMemo, useState, useEffect } from 'react';
import { useVariableStore } from '../../stores/useVariableStore';
import { useCollectionStore } from '../../stores/useCollectionStore';
import { useRequestStore } from '../../stores/useRequestStore';
import { postMessage } from '../../utils/vscodeApi';
import { on } from '../../utils/eventBus';
import type { VariableDiagnostic } from '../../../../src/models/VariableResolution';

interface VarEntry {
  id: string;
  name: string;
  value: string;
  enabled: boolean;
  scope: 'global' | 'collection' | 'set' | 'request';
  sourceName?: string;
}

interface PreviewResult {
  resolvedUrl: string;
  resolvedHeaders: string;
  resolvedQueryParams: string;
  resolvedBody: string;
  diagnostics: VariableDiagnostic[];
  canExecute: boolean;
}

export function ActiveVariablesPanel() {
  const globalVars = useVariableStore((s) => s.globalVariables);
  const variableSets = useVariableStore((s) => s.variableSets);
  const activeCollectionId = useCollectionStore((s) => s.activeCollectionId);
  const collections = useCollectionStore((s) => s.collections);
  const selectedCol = collections.find(c => c.id === activeCollectionId);
  const currentRequest = useRequestStore((s) => s.currentRequest);

  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    return on('resolutionPreview', (msg: unknown) => {
      setPreviewResult(msg as PreviewResult);
      setPreviewLoading(false);
    });
  }, []);

  // Collect linked sets for this collection
  const linkedSets = useMemo(() => {
    if (!activeCollectionId) { return []; }
    return variableSets.filter(s => s.linkedCollectionIds.includes(activeCollectionId));
  }, [variableSets, activeCollectionId]);

  // Build flat list of all variables by precedence (highest priority last = request wins)
  const allVars = useMemo(() => {
    const entries: VarEntry[] = [];

    // 1. Global vars (lowest priority)
    for (const v of globalVars) {
      entries.push({ id: v.id, name: v.key, value: v.value, enabled: v.enabled, scope: 'global' });
    }

    // 2. Linked set vars
    for (const set of linkedSets) {
      for (const v of set.variables) {
        entries.push({ id: v.id, name: v.key, value: v.value, enabled: v.enabled, scope: 'set', sourceName: set.name });
      }
    }

    // 3. Collection vars
    if (selectedCol?.variables) {
      for (const v of selectedCol.variables) {
        entries.push({ id: v.id, name: v.key, value: v.value, enabled: v.enabled, scope: 'collection', sourceName: selectedCol.name });
      }
    }

    // 4. Request vars (highest priority)
    if (currentRequest?.variables) {
      for (const v of currentRequest.variables) {
        entries.push({ id: v.id, name: v.key, value: v.value, enabled: v.enabled, scope: 'request' });
      }
    }

    return entries;
  }, [selectedCol, linkedSets, globalVars, currentRequest]);

  // Cross-scope matches are intentional precedence. Only duplicates within one scope conflict.
  const conflicts = useMemo(() => {
    const nameMap = new Map<string, Map<VarEntry['scope'], number>>();
    for (const v of allVars) {
      if (!v.enabled || !v.name) { continue; }
      const scopes = nameMap.get(v.name) || new Map<VarEntry['scope'], number>();
      scopes.set(v.scope, (scopes.get(v.scope) || 0) + 1);
      nameMap.set(v.name, scopes);
    }
    const result = new Set<string>();
    for (const [name, scopes] of nameMap) {
      if (Array.from(scopes.values()).some(count => count > 1)) { result.add(name); }
    }
    return result;
  }, [allVars]);

  // Stats
  const activeCount = allVars.filter(v => v.enabled && v.name).length;
  const globalCount = globalVars.filter(v => v.enabled && v.key).length;
  const collectionCount = selectedCol?.variables.filter(v => v.enabled && v.key).length || 0;
  const setsCount = linkedSets.reduce((sum, s) => sum + s.variables.filter(v => v.enabled && v.key).length, 0);
  const requestCount = currentRequest?.variables?.filter(v => v.enabled && v.key).length || 0;

  const handlePreview = () => {
    setPreviewLoading(true);
    setPreviewResult(null);
    postMessage({
      type: 'previewResolution',
      request: currentRequest,
      collectionId: activeCollectionId ?? undefined,
    });
    // Response handled via event bus
    setTimeout(() => setPreviewLoading(false), 8000);
  };

  return (
    <div style={{ padding: '4px 0' }}>
      {/* Summary bar */}
      <div style={{
        display: 'flex',
        gap: '8px',
        padding: '6px 8px',
        marginBottom: '8px',
        background: 'var(--vscode-editorInfo-background)',
        borderRadius: '3px',
        fontSize: '10px',
        flexWrap: 'wrap',
      }}>
        <span>🌐 {globalCount} global</span>
        {activeCollectionId && <span>📁 {collectionCount} collection</span>}
        {linkedSets.length > 0 && <span>📦 {linkedSets.length} sets ({setsCount} vars)</span>}
        {requestCount > 0 && <span>📝 {requestCount} request</span>}
        <span style={{ fontWeight: 600, color: 'var(--vscode-foreground)' }}>= {activeCount} active</span>
      </div>

      {/* Preview button */}
      <button
        onClick={handlePreview}
        disabled={previewLoading}
        style={{
          width: '100%',
          padding: '4px 8px',
          marginBottom: '8px',
          background: previewLoading ? 'var(--vscode-button-secondaryBackground)' : 'var(--vscode-button-background)',
          color: 'var(--vscode-button-foreground)',
          border: 'none',
          cursor: 'pointer',
          fontSize: '10px',
          borderRadius: '2px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px',
        }}
      >
        {previewLoading && <span className="spinner" />}
        {previewLoading ? 'Resolving...' : 'Preview Resolved Variables'}
      </button>

      {/* Variable groups (ordered by priority: low → high) */}
      {globalVars.length > 0 && (
        <VarGroup
          title="Global Variables"
          badge="G"
          color="var(--vscode-testing-iconPassedForeground)"
          vars={globalVars}
          conflicts={conflicts}
        />
      )}

      {linkedSets.map(set => (
        <VarGroup
          key={set.id}
          title={`Set: ${set.name}`}
          badge="S"
          color="#ca9ee6"
          vars={set.variables.map(v => ({ ...v, sourceName: set.name }))}
          conflicts={conflicts}
        />
      ))}

      {selectedCol && selectedCol.variables.length > 0 && (
        <VarGroup
          title="Collection Variables"
          badge="C"
          color="var(--vscode-textLink-foreground)"
          vars={selectedCol.variables.map(v => ({ ...v, sourceName: selectedCol.name }))}
          conflicts={conflicts}
        />
      )}

      {currentRequest?.variables && currentRequest.variables.length > 0 && (
        <VarGroup
          title="Request Variables"
          badge="R"
          color="#e5c890"
          vars={currentRequest.variables}
          conflicts={conflicts}
        />
      )}

      {allVars.length === 0 && (
        <div style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)', textAlign: 'center', padding: '24px', lineHeight: 1.6 }}>
          No variables defined.<br />
          <span style={{ fontSize: '9px' }}>Add variables in the Variables tab or link Variable Sets.</span>
        </div>
      )}

      {/* Preview result */}
      {previewResult && (
        <div style={{ marginTop: '8px', padding: '6px', background: 'var(--vscode-editor-background)', border: '1px solid var(--vscode-panel-border)', borderRadius: '2px', fontSize: '10px' }}>
          <div style={{
            fontWeight: 600,
            marginBottom: '6px',
            color: previewResult.canExecute
              ? 'var(--vscode-testing-iconPassedForeground)'
              : 'var(--vscode-errorForeground)',
          }}>
            {previewResult.canExecute ? 'Ready to execute' : 'Execution blocked'}
          </div>
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>Resolved URL</div>
          <code style={{ wordBreak: 'break-all', color: 'var(--vscode-textLink-foreground)' }}>{previewResult.resolvedUrl || '(empty)'}</code>
          {previewResult.resolvedQueryParams !== '[]' && (
            <PreviewField label="Query parameters" value={previewResult.resolvedQueryParams} />
          )}
          {previewResult.resolvedHeaders !== '[]' && (
            <PreviewField label="Headers" value={previewResult.resolvedHeaders} />
          )}
          {previewResult.resolvedBody && (
            <PreviewField label="Body" value={previewResult.resolvedBody} />
          )}
          {previewResult.diagnostics.length > 0 && (
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontWeight: 600, color: 'var(--vscode-errorForeground)', marginBottom: '3px' }}>
                Variable diagnostics
              </div>
              {previewResult.diagnostics.map((diagnostic, index) => (
                <div key={`${diagnostic.code}-${diagnostic.location}-${index}`} style={{ marginTop: '2px' }}>
                  <code>{diagnostic.code}</code>
                  {' at '}{diagnostic.location}
                  {diagnostic.variable ? `: ${diagnostic.variable}` : ''}
                  {diagnostic.path?.length ? ` (${diagnostic.path.join(' → ')})` : ''}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PreviewField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginTop: '8px' }}>
      <div style={{ fontWeight: 600, marginBottom: '3px' }}>{label}</div>
      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{value}</pre>
    </div>
  );
}

function VarGroup({
  title,
  badge,
  color,
  vars,
  conflicts,
}: {
  title: string;
  badge: string;
  color: string;
  vars: { id: string; key: string; value: string; enabled: boolean; sourceName?: string }[];
  conflicts: Set<string>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const active = vars.filter(v => v.enabled && v.key);

  if (active.length === 0) { return null; }

  return (
    <div style={{ marginBottom: '6px', border: '1px solid var(--vscode-panel-border)', borderRadius: '3px', overflow: 'hidden' }}>
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '5px 8px',
          cursor: 'pointer',
          background: 'var(--vscode-sideBarSectionHeader-background)',
          fontSize: '10px',
          fontWeight: 600,
        }}
      >
        <span style={{ fontSize: '8px', width: '10px', textAlign: 'center' }}>{collapsed ? '▶' : '▼'}</span>
        <span style={{
          width: '14px', height: '14px', borderRadius: '50%',
          background: color, color: '#fff', fontSize: '7px', fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>{badge}</span>
        <span style={{ flex: 1 }}>{title}</span>
        <span style={{ fontSize: '9px', color: 'var(--vscode-descriptionForeground)' }}>{active.length}</span>
      </div>

      {!collapsed && active.map(v => (
        <div
          key={v.id}
          style={{
            display: 'flex',
            gap: '6px',
            alignItems: 'center',
            padding: '3px 8px 3px 28px',
            fontSize: '10px',
            borderTop: '1px solid var(--vscode-panel-border)',
          }}
        >
          <span style={{
            width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
            background: v.enabled ? 'var(--vscode-testing-iconPassedForeground)' : 'var(--vscode-input-border)',
          }} />
          <code style={{
            flex: 1,
            fontFamily: 'var(--vscode-editor-font-family)',
            color: conflicts.has(v.key) ? '#e5c890' : 'var(--vscode-foreground)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {'{{'}{v.key}{'}}'}
            {conflicts.has(v.key) && (
              <span style={{ color: '#e5c890', fontSize: '8px', marginLeft: '4px' }}>⚠ conflict</span>
            )}
          </code>
          <span style={{
            color: 'var(--vscode-descriptionForeground)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '120px',
            fontFamily: 'var(--vscode-editor-font-family)',
          }}>
            {v.value || <span style={{ fontStyle: 'italic', opacity: 0.5 }}>empty</span>}
          </span>
          <button
            onClick={() => navigator.clipboard.writeText('{{' + v.key + '}}').catch(() => {})}
            style={{
              background: 'none', border: 'none', color: 'var(--vscode-textLink-foreground)',
              cursor: 'pointer', fontSize: '9px', padding: '1px 4px', flexShrink: 0,
              textDecoration: 'underline',
            }}
          >
            copy
          </button>
        </div>
      ))}
    </div>
  );
}
