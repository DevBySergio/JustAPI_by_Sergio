import React, { useState, useMemo, useEffect } from 'react';

const indentSize = 16;

const v = {
  toggle: {
    cursor: 'pointer',
    userSelect: 'none' as const,
    fontSize: '10px',
    color: 'var(--vscode-descriptionForeground)',
    width: '12px',
    display: 'inline-block',
    flexShrink: 0,
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

const hasDescCache = new Map<object, boolean>();

function cachedHasDesc(value: unknown, query: string): boolean {
  if (typeof value !== 'object' || value === null) return false;

  const cached = hasDescCache.get(value);
  if (cached !== undefined) return cached;

  const q = query.toLowerCase();
  let result = false;

  if (Array.isArray(value)) {
    result = value.some((item, index) => {
      if (String(index).toLowerCase().includes(q)) return true;
      if (typeof item === 'string' && item.toLowerCase().includes(q)) return true;
      if (typeof item === 'number' && String(item).includes(q)) return true;
      if (typeof item === 'boolean' && String(item).includes(q)) return true;
      if (item === null && 'null'.includes(q)) return true;
      return cachedHasDesc(item, query);
    });
  } else {
    result = Object.entries(value as Record<string, unknown>).some(([key, val]) => {
      if (key.toLowerCase().includes(q)) return true;
      if (typeof val === 'string' && val.toLowerCase().includes(q)) return true;
      if (typeof val === 'number' && String(val).includes(q)) return true;
      if (typeof val === 'boolean' && String(val).includes(q)) return true;
      if (val === null && 'null'.includes(q)) return true;
      return cachedHasDesc(val, query);
    });
  }

  hasDescCache.set(value, result);
  return result;
}

export function JsonTreeViewer({ data, searchQuery, defaultExpanded }: JTProps) {
  useEffect(() => {
    hasDescCache.clear();
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
    if (isObj) return Object.entries(value as Record<string, unknown>);
    if (isArr) return (value as unknown[]).map((v, i) => [String(i), v] as [string, unknown]);
    return [];
  }, [value, isObj, isArr]);

  const match = useMemo(() => {
    if (!searchQuery) return { self: false, desc: false };
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
    if (!searchQuery) return text;
    const lt = text.toLowerCase();
    const lq = searchQuery.toLowerCase();
    const parts: React.ReactNode[] = [];
    let li = 0;
    let idx = lt.indexOf(lq);
    let k = 0;
    while (idx !== -1) {
      if (idx > li) parts.push(text.slice(li, idx));
      parts.push(<span key={k++} style={v.hl}>{text.slice(idx, idx + searchQuery.length)}</span>);
      li = idx + searchQuery.length;
      idx = lt.indexOf(lq, li);
    }
    if (li < text.length) parts.push(text.slice(li));
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
        {keyName != null && (
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
  const info = `${entries.length} ${isObj ? 'properties' : 'items'}`;

  if (!expanded) {
    return (
      <div style={{ paddingLeft: depth * indentSize, background: hlRow ? 'var(--vscode-editor-findMatchHighlightBackground)' : undefined }}>
        <span onClick={() => setExpanded(true)} style={v.toggle}>▶ </span>
        {keyName != null && (
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
        <span onClick={() => setExpanded(false)} style={v.toggle}>▾ </span>
        {keyName != null && (
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
      <div style={{ paddingLeft: depth * indentSize }}>
        <span style={v.bracket}>{br[1]}</span>
      </div>
    </div>
  );
});


