import React, { useState, useMemo, useEffect } from 'react';
import { RESPONSE_RENDER_LIMITS } from '../../../../src/webview/ResponsePresentation';

const indentSize = 16;

const v = {
  toggle: {
    cursor: 'pointer',
    userSelect: 'none' as const,
    fontSize: '10px',
    color: 'var(--vscode-descriptionForeground)',
    width: '16px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    border: 'none',
    padding: 0,
    background: 'transparent',
  },
  key: { color: 'var(--vscode-textLink-foreground)' },
  str: { color: '#ce9178' },
  num: { color: '#b5cea8' },
  lit: { color: '#569cd6' },
  bracket: { color: 'var(--vscode-editor-foreground)' },
  info: { color: 'var(--vscode-descriptionForeground)', fontSize: '10px' },
  hl: {
    background: 'var(--vscode-editor-findMatchHighlightBackground)',
    borderRadius: '2px',
  },
};

interface JTProps {
  data: unknown;
  searchQuery?: string;
  defaultExpanded: boolean;
}

let hasDescCache = new WeakMap<object, Map<string, boolean>>();

function cachedHasDesc(value: unknown, query: string, depth = 0): boolean {
  if (typeof value !== 'object' || value === null) { return false; }
  if (depth >= RESPONSE_RENDER_LIMITS.maximumTreeDepth) { return false; }

  const normalizedQuery = query.toLowerCase();
  const cached = hasDescCache.get(value)?.get(normalizedQuery);
  if (cached !== undefined) { return cached; }

  const q = query.toLowerCase();
  let result = false;

  if (Array.isArray(value)) {
    result = value.some((item, index) => {
      if (String(index).toLowerCase().includes(q)) { return true; }
      if (typeof item === 'string' && item.toLowerCase().includes(q)) { return true; }
      if (typeof item === 'number' && String(item).includes(q)) { return true; }
      if (typeof item === 'boolean' && String(item).includes(q)) { return true; }
      if (item === null && 'null'.includes(q)) { return true; }
      return cachedHasDesc(item, query, depth + 1);
    });
  } else {
    result = Object.entries(value as Record<string, unknown>).some(([key, val]) => {
      if (key.toLowerCase().includes(q)) { return true; }
      if (typeof val === 'string' && val.toLowerCase().includes(q)) { return true; }
      if (typeof val === 'number' && String(val).includes(q)) { return true; }
      if (typeof val === 'boolean' && String(val).includes(q)) { return true; }
      if (val === null && 'null'.includes(q)) { return true; }
      return cachedHasDesc(val, query, depth + 1);
    });
  }

  const queries = hasDescCache.get(value) ?? new Map<string, boolean>();
  queries.set(normalizedQuery, result);
  hasDescCache.set(value, queries);
  return result;
}

export function JsonTreeViewer({ data, searchQuery, defaultExpanded }: JTProps) {
  useEffect(() => {
    hasDescCache = new WeakMap<object, Map<string, boolean>>();
  }, [searchQuery]);

  return (
    <JN value={data} searchQuery={searchQuery} defaultExpanded={defaultExpanded} depth={0} />
  );
}

interface JNProps {
  keyName?: string;
  value: unknown;
  searchQuery?: string;
  defaultExpanded: boolean;
  depth: number;
}

const JN = React.memo(function JNInner({ keyName, value, searchQuery, defaultExpanded, depth }: JNProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const isArr = Array.isArray(value);
  const isObj = value !== null && typeof value === 'object' && !isArr;
  const isCol = isObj || isArr;

  const entries = useMemo(() => {
    if (depth >= RESPONSE_RENDER_LIMITS.maximumTreeDepth) { return []; }
    if (isObj) {
      return Object.entries(value as Record<string, unknown>)
        .slice(0, RESPONSE_RENDER_LIMITS.maximumTreeEntriesPerNode);
    }
    if (isArr) {
      return (value as unknown[])
        .slice(0, RESPONSE_RENDER_LIMITS.maximumTreeEntriesPerNode)
        .map((v, i) => [String(i), v] as [string, unknown]);
    }
    return [];
  }, [value, isObj, isArr, depth]);

  const match = useMemo(() => {
    if (!searchQuery) { return { self: false, desc: false }; }
    const q = searchQuery.toLowerCase();
    const k = keyName ? keyName.toLowerCase().includes(q) : false;
    const valMatch = !isCol && String(value).toLowerCase().includes(q);
    return { self: k || valMatch, desc: isCol && cachedHasDesc(value, searchQuery) };
  }, [searchQuery, keyName, value, isCol]);

  useEffect(() => {
    if (searchQuery && (match.self || match.desc)) {
      setExpanded(true);
    }
  }, [searchQuery, match.self, match.desc]);

  useEffect(() => {
    if (!searchQuery) {
      setExpanded(defaultExpanded);
    }
  }, [defaultExpanded, searchQuery]);

  const hlRow = searchQuery && match.self;

  function hr(text: string): React.ReactNode {
    if (!searchQuery) { return text; }
    const lt = text.toLowerCase();
    const lq = searchQuery.toLowerCase();
    const parts: React.ReactNode[] = [];
    let li = 0;
    let idx = lt.indexOf(lq);
    let k = 0;
    while (idx !== -1) {
      if (idx > li) { parts.push(text.slice(li, idx)); }
      parts.push(<span key={k++} style={v.hl}>{text.slice(idx, idx + searchQuery.length)}</span>);
      li = idx + searchQuery.length;
      idx = lt.indexOf(lq, li);
    }
    if (li < text.length) { parts.push(text.slice(li)); }
    return parts.length > 0 ? parts : text;
  }

  if (!isCol) {
    let dv: string;
    let vs: React.CSSProperties;
    if (typeof value === 'string') {
      dv = JSON.stringify(value);
      vs = v.str;
    } else if (typeof value === 'number') {
      dv = String(value);
      vs = v.num;
    } else if (typeof value === 'boolean') {
      dv = String(value);
      vs = v.lit;
    } else {
      dv = 'null';
      vs = v.lit;
    }

    return (
      <div style={{ paddingLeft: depth * indentSize, background: hlRow ? 'var(--vscode-editor-findMatchHighlightBackground)' : undefined }}>
        {keyName !== null && keyName !== undefined && (
          <>
            <span style={v.key}>{hr(keyName)}</span>
            <span style={v.bracket}>: </span>
          </>
        )}
        <span style={vs}>{hr(dv)}</span>
      </div>
    );
  }

  const br = isObj ? ['{', '}'] : ['[', ']'];
  const totalEntries = isArr
    ? (value as unknown[]).length
    : Object.keys(value as Record<string, unknown>).length;
  const omittedEntries = totalEntries - entries.length;
  const info = `${totalEntries} ${isObj ? 'properties' : 'items'}`;

  if (depth >= RESPONSE_RENDER_LIMITS.maximumTreeDepth) {
    return (
      <div style={{ paddingLeft: depth * indentSize, color: 'var(--vscode-descriptionForeground)' }}>
        {keyName !== null && keyName !== undefined && <span style={v.key}>{hr(keyName)}: </span>}
        Preview depth limit reached ({info})
      </div>
    );
  }

  if (!expanded) {
    return (
      <div style={{ paddingLeft: depth * indentSize, background: hlRow ? 'var(--vscode-editor-findMatchHighlightBackground)' : undefined }}>
        <button
          type="button"
          aria-expanded="false"
          aria-label={`Expand ${keyName ?? 'JSON value'}`}
          onClick={() => setExpanded(true)}
          style={v.toggle}
        >▶</button>
        {keyName !== null && keyName !== undefined && (
          <>
            <span style={v.key}>{hr(keyName)}</span>
            <span style={v.bracket}>: </span>
          </>
        )}
        <span style={v.bracket}>{br[0]} ... {br[1]}</span>
        <span style={v.info}> {info}</span>
      </div>
    );
  }

  return (
    <div>
      <div style={{ paddingLeft: depth * indentSize }}>
        <button
          type="button"
          aria-expanded="true"
          aria-label={`Collapse ${keyName ?? 'JSON value'}`}
          onClick={() => setExpanded(false)}
          style={v.toggle}
        >▾</button>
        {keyName !== null && keyName !== undefined && (
          <>
            <span style={v.key}>{hr(keyName)}</span>
            <span style={v.bracket}>: </span>
          </>
        )}
        <span style={v.bracket}>{br[0]}</span>
      </div>
      {entries.map(([k, val]) => (
        <JN
          key={k}
          keyName={isArr ? undefined : k}
          value={val}
          searchQuery={searchQuery}
          defaultExpanded={defaultExpanded}
          depth={depth + 1}
        />
      ))}
      {omittedEntries > 0 && (
        <div style={{ paddingLeft: (depth + 1) * indentSize, color: 'var(--vscode-descriptionForeground)' }}>
          … {omittedEntries.toLocaleString()} more {isObj ? 'properties' : 'items'} omitted
        </div>
      )}
      <div style={{ paddingLeft: depth * indentSize }}>
        <span style={v.bracket}>{br[1]}</span>
      </div>
    </div>
  );
});
