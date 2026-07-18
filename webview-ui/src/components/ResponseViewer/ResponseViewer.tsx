import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useResponseStore } from '../../stores/useResponseStore';
import { BodyType, ResponseCookie } from '../../../../src/models/Response';
import { JsonTreeViewer } from './JsonTreeViewer';
import {
  boundResponseText,
  RESPONSE_RENDER_LIMITS,
  validateImagePreview,
} from '../../../../src/webview/ResponsePresentation';
import { nextTabIndex } from '../../../../src/webview/WebviewState';

type ResponseTab = 'body' | 'headers' | 'cookies';
type JsonViewMode = 'tree' | 'pretty' | 'raw';
const RESPONSE_TABS: ResponseTab[] = ['body', 'headers', 'cookies'];

function formatBytes(bytes: number): string {
  if (bytes < 1024) { return `${bytes} B`; }
  if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) { return `${ms.toFixed(0)} ms`; }
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatTimingBreakdown(response: NonNullable<ReturnType<typeof useResponseStore.getState>['response']>): string {
  const phases = [
    ['DNS', response.timings.dns],
    ['Connect', response.timings.connect],
    ['TLS', response.timings.tls],
    ['First byte', response.timings.firstByte],
    ['Download', response.timings.download],
    ['Total', response.timings.total],
  ] as const;
  return phases.flatMap(([label, value]) =>
    value === undefined ? [] : [`${label}: ${formatDuration(value)}`]
  ).join('\n');
}

function formatXml(xml: string): string {
  let formatted = '';
  let indent = '';
  const lines = xml.replace(/>\s*</g, '>\n<').split('\n');
  for (const line of lines) {
    if (line.match(/<\/\w/)) {
      indent = indent.slice(2);
    }
    formatted += indent + line.trim() + '\n';
    if (line.match(/<\w[^>]*[^/]>\s*$/) && !line.match(/<\/\w/)) {
      indent += '  ';
    }
  }
  return formatted.trim();
}

function highlightTextInString(text: string, query: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let lastIdx = 0;
  let idx = lowerText.indexOf(lowerQuery);
  let key = 0;

  while (idx !== -1) {
    if (idx > lastIdx) { parts.push(text.slice(lastIdx, idx)); }
    parts.push(
      <span key={key++} style={{
        background: 'var(--vscode-editor-findMatchHighlightBackground)',
        borderRadius: '2px',
      }}>
        {text.slice(idx, idx + query.length)}
      </span>
    );
    lastIdx = idx + query.length;
    idx = lowerText.indexOf(lowerQuery, lastIdx);
  }
  if (lastIdx < text.length) { parts.push(text.slice(lastIdx)); }

  return parts.length > 0 ? parts : text;
}

interface Token {
  text: string;
  type: 'ws' | 'punct' | 'key' | 'str' | 'num' | 'bool' | 'null';
}

function tokenizeJson(json: string): Token[] {
  const tokenRegex = /("(?:[^"\\]|\\.)*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\]:,]|\s+)/g;
  const tokens: Token[] = [];
  const stack: ('object' | 'array')[] = [];
  let expectKey = false;
  let match;

  while ((match = tokenRegex.exec(json)) !== null) {
    const t = match[0];

    if (/^\s+$/.test(t)) {
      tokens.push({ text: t, type: 'ws' });
    } else if (t === '{') {
      stack.push('object');
      expectKey = true;
      tokens.push({ text: t, type: 'punct' });
    } else if (t === '}') {
      stack.pop();
      tokens.push({ text: t, type: 'punct' });
    } else if (t === '[') {
      stack.push('array');
      expectKey = false;
      tokens.push({ text: t, type: 'punct' });
    } else if (t === ']') {
      stack.pop();
      tokens.push({ text: t, type: 'punct' });
    } else if (t === ':') {
      expectKey = false;
      tokens.push({ text: t, type: 'punct' });
    } else if (t === ',') {
      expectKey = stack[stack.length - 1] === 'object';
      tokens.push({ text: t, type: 'punct' });
    } else if (/^"/.test(t) && expectKey) {
      tokens.push({ text: t, type: 'key' });
    } else if (/^"/.test(t)) {
      tokens.push({ text: t, type: 'str' });
    } else if (/^(true|false)$/.test(t)) {
      tokens.push({ text: t, type: 'bool' });
    } else if (/^\d/.test(t)) {
      tokens.push({ text: t, type: 'num' });
    } else if (t === 'null') {
      tokens.push({ text: t, type: 'null' });
    } else {
      tokens.push({ text: t, type: 'str' });
    }
  }

  return tokens;
}

function tokenStyle(type: Token['type']): React.CSSProperties {
  switch (type) {
    case 'key': return { color: 'var(--vscode-textLink-foreground)' };
    case 'str': return { color: '#ce9178' };
    case 'num': return { color: '#b5cea8' };
    case 'bool': return { color: '#569cd6' };
    case 'null': return { color: '#569cd6' };
    default: return {};
  }
}

function SyntaxHighlightedJson({ json, searchQuery }: { json: string; searchQuery?: string }) {
  const tokens = useMemo(() => tokenizeJson(json), [json]);

  return (
    <>
      {tokens.map((token, i) => {
        const style = tokenStyle(token.type);
        if (!searchQuery || token.type === 'ws') {
          return <span key={i} style={style}>{token.text}</span>;
        }

        const lowerToken = token.text.toLowerCase();
        const lowerQuery = searchQuery.toLowerCase();
        if (!lowerToken.includes(lowerQuery)) {
          return <span key={i} style={style}>{token.text}</span>;
        }

        const parts: React.ReactNode[] = [];
        let lastIdx = 0;
        let idx = lowerToken.indexOf(lowerQuery);
        let partKey = 0;

        while (idx !== -1) {
          if (idx > lastIdx) {
            parts.push(token.text.slice(lastIdx, idx));
          }
          parts.push(
            <span key={`h${partKey++}`} style={{
              ...style,
              background: 'var(--vscode-editor-findMatchHighlightBackground)',
              borderRadius: '2px',
            }}>
              {token.text.slice(idx, idx + searchQuery.length)}
            </span>
          );
          lastIdx = idx + searchQuery.length;
          idx = lowerToken.indexOf(lowerQuery, lastIdx);
        }
        if (lastIdx < token.text.length) {
          parts.push(token.text.slice(lastIdx));
        }

        return <span key={i} style={style}>{parts}</span>;
      })}
    </>
  );
}

export function ResponseViewer() {
  const [activeTab, setActiveTab] = useState<ResponseTab>('body');
  const [isPretty, setIsPretty] = useState(true);
  const [jsonViewMode, setJsonViewMode] = useState<JsonViewMode>('tree');
  const [showSearch, setShowSearch] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const responseTabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!showSearch) {
      setSearchQuery('');
      return;
    }
    const timer = setTimeout(() => setSearchQuery(searchInput), 200);
    return () => clearTimeout(timer);
  }, [searchInput, showSearch]);
  const [treeExpanded, setTreeExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  const response = useResponseStore((s) => s.response);
  const hasResponse = useResponseStore((s) => s.hasResponse);

  const isJson = response?.bodyType === 'json';

  const handleCopy = useCallback(() => {
    if (!response?.body) { return; }
    navigator.clipboard.writeText(response.body).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(console.error);
  }, [response?.body]);

  if (!hasResponse || !response) {
    return (
      <div style={{
        borderTop: '1px solid var(--vscode-panel-border)',
        padding: '16px',
        textAlign: 'center',
        color: 'var(--vscode-descriptionForeground)',
        fontSize: '12px',
      }}>
        Execute a request to see the response
      </div>
    );
  }

  if (response.error) {
    return (
      <div role="alert" style={{ borderTop: '1px solid var(--vscode-panel-border)' }}>
        <div style={{ padding: '8px', background: 'var(--vscode-inputValidation-errorBackground)', color: 'var(--vscode-errorForeground)' }}>
          <strong style={{ fontSize: '12px' }}>
            {response.error.type === 'network' ? 'Network Error' :
             response.error.type === 'timeout' ? 'Timeout' :
             response.error.type === 'ssl' ? 'SSL Error' :
             response.error.type === 'dns' ? 'DNS Error' :
             response.error.type === 'socket' ? 'Socket Error' :
             response.error.type === 'invalid-url' ? 'Invalid URL' :
             response.error.type === 'invalid-response' ? 'Invalid Response' :
             response.error.type === 'redirect' ? 'Redirect Error' :
             response.error.type === 'decompression' ? 'Decompression Error' :
             response.error.type === 'response-too-large' ? 'Response Too Large' :
             response.error.type === 'aborted' ? 'Cancelled' :
             'Error'}
          </strong>
          <p style={{ fontSize: '11px', marginTop: '4px', opacity: 0.9 }}>{response.error.message}</p>
          {(response.error.type === 'network' || response.error.type === 'dns') && (
            <p style={{ fontSize: '10px', marginTop: '6px', opacity: 0.75 }}>
              Check the URL and your internet connection.
            </p>
          )}
          {response.error.type === 'timeout' && (
            <p style={{ fontSize: '10px', marginTop: '6px', opacity: 0.75 }}>
              The server did not respond in time. Try increasing the timeout in Settings tab.
            </p>
          )}
          {response.error.type === 'ssl' && (
            <p style={{ fontSize: '10px', marginTop: '6px', opacity: 0.75 }}>
              Disable "Verify SSL" in Settings tab if you trust the server.
            </p>
          )}
          {response.error.type === 'response-too-large' && (
            <p style={{ fontSize: '10px', marginTop: '6px', opacity: 0.75 }}>
              Increase the response limit in Settings only if you trust the server and need the full body.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ borderTop: '1px solid var(--vscode-panel-border)' }}
      role="region"
      aria-label="HTTP response"
    >
      <div
        role="status"
        aria-live="polite"
        style={{
        display: 'flex',
        gap: '12px',
        padding: '6px 8px',
        background: 'var(--vscode-sideBarSectionHeader-background)',
        fontSize: '12px',
        alignItems: 'center',
        flexWrap: 'wrap',
        }}
      >
        <span style={{
          fontWeight: 700,
          color: response.statusCode < 300 ? '#49cc90' : response.statusCode < 500 ? '#fca130' : '#f93e3e',
        }}>
          {response.statusCode} {response.statusText}
        </span>
        <span
          style={{ color: 'var(--vscode-descriptionForeground)' }}
          title={formatTimingBreakdown(response)}
        >
          {formatDuration(response.duration)}
        </span>
        <span style={{ color: 'var(--vscode-descriptionForeground)' }}>
          {formatBytes(response.size)}
        </span>
        {response.redirected && (
          <span style={{ color: '#fca130', fontSize: '10px' }}>Redirected</span>
        )}
      </div>

      <div
        role="tablist"
        aria-label="Response sections"
        style={{
        display: 'flex',
        gap: '2px',
        borderBottom: '1px solid var(--vscode-panel-border)',
        paddingLeft: '8px',
        alignItems: 'center',
        flexWrap: 'wrap',
        }}
      >
        {RESPONSE_TABS.map((tab, index) => (
          <button
            key={tab}
            ref={(element) => { responseTabRefs.current[index] = element; }}
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`response-panel-${tab}`}
            id={`response-tab-${tab}`}
            tabIndex={activeTab === tab ? 0 : -1}
            onClick={() => setActiveTab(tab)}
            onKeyDown={(event) => {
              const nextIndex = nextTabIndex(index, event.key, RESPONSE_TABS.length);
              if (nextIndex === null) {
                return;
              }
              event.preventDefault();
              setActiveTab(RESPONSE_TABS[nextIndex]);
              responseTabRefs.current[nextIndex]?.focus();
            }}
            style={{
              padding: '4px 10px',
              border: 'none',
              background: 'none',
              color: activeTab === tab ? 'var(--vscode-textLink-foreground)' : 'var(--vscode-foreground)',
              cursor: 'pointer',
              fontSize: '11px',
              borderBottom: activeTab === tab ? '2px solid var(--vscode-textLink-foreground)' : '2px solid transparent',
              textTransform: 'capitalize',
            }}
          >
            {tab}
          </button>
        ))}
        <div style={{ flex: 1 }} />

        {activeTab === 'body' && isJson && (
          <>
            {(['tree', 'pretty', 'raw'] as JsonViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setJsonViewMode(mode)}
                style={{
                  padding: '2px 8px',
                  border: 'none',
                  background: 'none',
                  color: jsonViewMode === mode ? 'var(--vscode-textLink-foreground)' : 'var(--vscode-descriptionForeground)',
                  cursor: 'pointer',
                  fontSize: '10px',
                  borderBottom: jsonViewMode === mode ? '2px solid var(--vscode-textLink-foreground)' : '2px solid transparent',
                }}
              >
                {mode === 'tree' ? 'Tree' : mode === 'pretty' ? 'Pretty' : 'Raw'}
              </button>
            ))}
          </>
        )}

        {activeTab === 'body' && !isJson && (
          <button
            onClick={() => setIsPretty(!isPretty)}
            style={{
              padding: '2px 8px',
              border: 'none',
              background: 'none',
              color: isPretty ? 'var(--vscode-textLink-foreground)' : 'var(--vscode-descriptionForeground)',
              cursor: 'pointer',
              fontSize: '10px',
              borderBottom: isPretty ? '2px solid var(--vscode-textLink-foreground)' : '2px solid transparent',
            }}
          >
            Pretty
          </button>
        )}

        {activeTab === 'body' && isJson && jsonViewMode === 'tree' && (
          <>
            <span style={{ width: '1px', height: '12px', background: 'var(--vscode-panel-border)', margin: '0 4px' }} />
            <button
              onClick={() => setTreeExpanded(true)}
              style={{
                padding: '2px 6px',
                border: 'none',
                background: 'none',
                color: 'var(--vscode-descriptionForeground)',
                cursor: 'pointer',
                fontSize: '11px',
              }}
              title="Expand All"
            >
              [+]
            </button>
            <button
              onClick={() => setTreeExpanded(false)}
              style={{
                padding: '2px 6px',
                border: 'none',
                background: 'none',
                color: 'var(--vscode-descriptionForeground)',
                cursor: 'pointer',
                fontSize: '11px',
              }}
              title="Collapse All"
            >
              [-]
            </button>
          </>
        )}

        {activeTab === 'body' && (
          <>
            <span style={{ width: '1px', height: '12px', background: 'var(--vscode-panel-border)', margin: '0 4px' }} />
            <button
              onClick={() => {
                setShowSearch(!showSearch);
                if (showSearch) { setSearchInput(''); }
              }}
              style={{
                padding: '2px 6px',
                border: 'none',
                background: 'none',
                color: showSearch ? 'var(--vscode-textLink-foreground)' : 'var(--vscode-descriptionForeground)',
                cursor: 'pointer',
                fontSize: '11px',
              }}
              title="Search in response"
            >
              &#x1F50D;
            </button>
            <button
              onClick={handleCopy}
              style={{
                padding: '2px 8px',
                border: 'none',
                background: 'none',
                color: copied ? '#49cc90' : 'var(--vscode-descriptionForeground)',
                cursor: 'pointer',
                fontSize: '10px',
              }}
              title="Copy response body"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </>
        )}
      </div>

      {showSearch && activeTab === 'body' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '4px 8px',
          borderBottom: '1px solid var(--vscode-panel-border)',
        }}>
          <span style={{ color: 'var(--vscode-descriptionForeground)', fontSize: '11px' }}>&#x1F50D;</span>
          <input
            aria-label="Search in response"
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search in response..."
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'var(--vscode-input-background)',
              color: 'var(--vscode-input-foreground)',
              padding: '2px 6px',
              fontSize: '11px',
            }}
            autoFocus
          />
          <button
            aria-label="Close response search"
            onClick={() => { setSearchInput(''); setShowSearch(false); }}
            style={{
              border: 'none',
              background: 'none',
              color: 'var(--vscode-descriptionForeground)',
              cursor: 'pointer',
              fontSize: '12px',
              padding: '2px',
            }}
          >
            &#x2715;
          </button>
        </div>
      )}

      <div
        id={`response-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`response-tab-${activeTab}`}
        tabIndex={0}
        style={{ maxHeight: '300px', overflow: 'auto' }}
      >
        {activeTab === 'body' && (
          <ResponseBody
            body={response.body}
            bodyType={response.bodyType}
            mimeType={response.mimeType}
            isPretty={isPretty}
            jsonViewMode={isJson ? jsonViewMode : undefined}
            searchQuery={searchQuery}
            treeExpanded={treeExpanded}
          />
        )}
        {activeTab === 'headers' && <ResponseHeaders headers={response.headers} />}
        {activeTab === 'cookies' && <ResponseCookies cookies={response.cookies} />}
      </div>
    </div>
  );
}

function ResponseBody({ body, bodyType, mimeType, isPretty, jsonViewMode, searchQuery, treeExpanded }: {
  body: string;
  bodyType: BodyType;
  mimeType?: string;
  isPretty: boolean;
  jsonViewMode?: JsonViewMode;
  searchQuery: string;
  treeExpanded: boolean;
}) {
  const imagePreview = useMemo(
    () => bodyType === 'image' ? validateImagePreview(mimeType, body) : null,
    [body, bodyType, mimeType]
  );
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!imagePreview?.ok) {
      setImageUrl(null);
      return;
    }
    try {
      const binary = atob(body);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      const objectUrl = URL.createObjectURL(new Blob([bytes], { type: imagePreview.mimeType }));
      setImageUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    } catch {
      setImageUrl(null);
    }
  }, [body, imagePreview]);

  if (bodyType === 'image') {
    if (!imagePreview?.ok || !imageUrl) {
      return (
        <div role="status" style={{ padding: '12px', color: 'var(--vscode-descriptionForeground)', fontSize: '11px' }}>
          {imagePreview?.ok ? 'Preparing image preview…' : imagePreview?.reason ?? 'Image preview is unavailable.'}
        </div>
      );
    }
    return (
      <div style={{ padding: '8px', textAlign: 'center' }}>
        <img src={imageUrl} alt={`Response image (${imagePreview.mimeType})`} style={{ maxWidth: '100%', maxHeight: '300px' }} />
      </div>
    );
  }

  const bounded = boundResponseText(body);
  const boundedBody = bounded.text;
  const truncationNotice = (omittedCharacters: number) => omittedCharacters > 0 ? (
      <div role="status" style={{ padding: '5px 8px', fontSize: '10px', color: 'var(--vscode-descriptionForeground)' }}>
        Preview limited to {RESPONSE_RENDER_LIMITS.maximumTextCharacters.toLocaleString()} characters; {omittedCharacters.toLocaleString()} omitted.
      </div>
    ) : null;
  const truncation = truncationNotice(bounded.omittedCharacters);

  const preStyle: React.CSSProperties = {
    margin: 0,
    padding: '8px',
    fontSize: '11px',
    fontFamily: 'var(--vscode-editor-font-family)',
    color: 'var(--vscode-editor-foreground)',
    background: 'var(--vscode-editor-background)',
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  };

  if (bodyType === 'json' && jsonViewMode === 'tree') {
    if (body.length > RESPONSE_RENDER_LIMITS.maximumJsonCharacters) {
      return <>{truncation}<pre style={preStyle}>{boundedBody}</pre></>;
    }
    try {
      const parsed = JSON.parse(body);
      return (
        <div style={{
          fontSize: '11px',
          fontFamily: 'var(--vscode-editor-font-family)',
          background: 'var(--vscode-editor-background)',
          overflow: 'auto',
        }}>
          <JsonTreeViewer data={parsed} searchQuery={searchQuery || undefined} defaultExpanded={treeExpanded} />
        </div>
      );
    } catch {
      return <>{truncation}<pre style={preStyle}>{boundedBody}</pre></>;
    }
  }

  if (bodyType === 'json' && jsonViewMode === 'pretty') {
    let formatted: string;
    try {
      formatted = body.length <= RESPONSE_RENDER_LIMITS.maximumJsonCharacters
        ? JSON.stringify(JSON.parse(body), null, 2)
        : boundedBody;
    } catch {
      formatted = boundedBody;
    }
    const boundedFormatted = boundResponseText(formatted);
    formatted = boundedFormatted.text;
    const prettyTruncation = truncationNotice(Math.max(
      bounded.omittedCharacters,
      boundedFormatted.omittedCharacters
    ));
    if (searchQuery) {
      return <>{prettyTruncation}<pre style={preStyle}>{highlightTextInString(formatted, searchQuery)}</pre></>;
    }
    return <>{prettyTruncation}<pre style={preStyle}><SyntaxHighlightedJson json={formatted} /></pre></>;
  }

  if (bodyType === 'json' && jsonViewMode === 'raw') {
    if (searchQuery) {
      return <>{truncation}<pre style={preStyle}>{highlightTextInString(boundedBody, searchQuery)}</pre></>;
    }
    return <>{truncation}<pre style={preStyle}>{boundedBody}</pre></>;
  }

  const displayContent = (() => {
    if (!isPretty) { return boundedBody; }
    if (bodyType === 'xml') { return formatXml(boundedBody); }
    return boundedBody;
  })();

  if (searchQuery) {
    return <>{truncation}<pre style={preStyle}>{highlightTextInString(displayContent, searchQuery)}</pre></>;
  }
  return <>{truncation}<pre style={preStyle}>{displayContent}</pre></>;
}

function ResponseHeaders({ headers }: { headers: Record<string, string> }) {
  return (
    <div style={{ padding: '8px', fontSize: '11px' }}>
      {Object.entries(headers).map(([key, value]) => (
        <div key={key} style={{ display: 'flex', gap: '8px', padding: '2px 0' }}>
          <span style={{ fontWeight: 600, minWidth: '180px', color: 'var(--vscode-textLink-foreground)' }}>{key}</span>
          <span style={{ color: 'var(--vscode-editor-foreground)', wordBreak: 'break-all' }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

function ResponseCookies({ cookies }: { cookies: ResponseCookie[] }) {
  if (!cookies.length) {
    return <div style={{ padding: '8px', fontSize: '11px', color: 'var(--vscode-descriptionForeground)' }}>No cookies</div>;
  }

  return (
    <div style={{ padding: '8px', fontSize: '11px' }}>
      {cookies.map((c, i) => (
        <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid var(--vscode-panel-border)' }}>
          <div><strong>{c.name}</strong> = {c.value}</div>
          {c.domain !== null && c.domain !== undefined && <div style={{ color: 'var(--vscode-descriptionForeground)', fontSize: '10px' }}>Domain: {c.domain}</div>}
          {c.path !== null && c.path !== undefined && <div style={{ color: 'var(--vscode-descriptionForeground)', fontSize: '10px' }}>Path: {c.path}</div>}
        </div>
      ))}
    </div>
  );
}
