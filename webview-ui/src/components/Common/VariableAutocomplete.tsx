import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { useCollectionStore } from '../../stores/useCollectionStore';
import { useVariableStore } from '../../stores/useVariableStore';
import { useRequestStore } from '../../stores/useRequestStore';

interface VariableAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  children: (triggerProps: TriggerProps) => ReactNode;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  inputElement?: HTMLInputElement | HTMLTextAreaElement | null;
  /** For textarea: pass the element to sync scroll */
  scrollElement?: HTMLElement | null;
}

export interface AutocompleteTriggerProps {
  onInput: (value: string, cursorPos: number) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onBlur: () => void;
}

interface TriggerProps extends AutocompleteTriggerProps {}

interface VarMatch {
  name: string;
  scope: 'request' | 'collection' | 'set' | 'global';
  value?: string;
}

export function VariableAutocomplete({ value, onChange, children, onKeyDown: externalKeyDown }: VariableAutocompleteProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [filter, setFilter] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [insertPos, setInsertPos] = useState(0);
  const [dropdownOffset, setDropdownOffset] = useState({ left: 0, top: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const activeInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const activeCollectionId = useCollectionStore((s) => s.activeCollectionId);
  const collections = useCollectionStore((s) => s.collections);
  const variableSets = useVariableStore((s) => s.variableSets);
  const globalVariables = useVariableStore((s) => s.globalVariables);
  const currentRequest = useRequestStore((s) => s.currentRequest);
  const activeCollection = collections.find(c => c.id === activeCollectionId);
  const collectionVars = activeCollection?.variables || [];
  const linkedSets = variableSets.filter(s => activeCollectionId && s.linkedCollectionIds.includes(activeCollectionId));

  // Build matches from all variable scopes
  const allMatches: VarMatch[] = [
    ...(currentRequest.variables || []).filter(v => v.enabled && v.key).map(v => ({ name: v.key, scope: 'request' as const, value: v.value })),
    ...collectionVars.filter(v => v.enabled && v.key).map(v => ({ name: v.key, scope: 'collection' as const, value: v.value })),
    ...linkedSets.flatMap(set =>
      set.variables.filter(v => v.enabled && v.key).map(v => ({ name: v.key, scope: 'set' as const, value: v.value }))
    ),
    ...globalVariables.filter(v => v.enabled && v.key).map(v => ({ name: v.key, scope: 'global' as const, value: v.value })),
  ];

  const matches = filter
    ? allMatches.filter(m => m.name.toLowerCase().includes(filter.toLowerCase()))
    : allMatches;

  // Measure cursor position for dropdown placement
  const measureCursorPos = useCallback((input: HTMLInputElement | HTMLTextAreaElement, cursorPos: number) => {
    const textBefore = value.slice(0, cursorPos);
    const textAfter = value.slice(cursorPos);

    if (!measureRef.current) return;

    const style = getComputedStyle(input);
    measureRef.current.style.fontFamily = style.fontFamily;
    measureRef.current.style.fontSize = style.fontSize;
    measureRef.current.style.fontWeight = style.fontWeight;
    measureRef.current.style.letterSpacing = style.letterSpacing;
    measureRef.current.style.paddingLeft = style.paddingLeft;
    measureRef.current.style.paddingTop = style.paddingTop;

    measureRef.current.textContent = textBefore || '|';

    const inputRect = input.getBoundingClientRect();
    const wrapperRect = wrapperRef.current?.getBoundingClientRect();
    if (!wrapperRect) return;

    const measureRect = measureRef.current.getBoundingClientRect();
    const lineHeight = parseInt(style.lineHeight) || parseInt(style.fontSize) * 1.4;

    // Estimate which line we're on
    const lines = textBefore.split('\n');
    const lineNum = lines.length - 1;
    const lastLine = lines[lineNum] || '';

    // Measure the last line
    measureRef.current.textContent = lastLine || '|';
    const lastLineRect = measureRef.current.getBoundingClientRect();

    const left = lastLineRect.width + parseInt(style.paddingLeft?.replace('px', '') || '4');
    const top = (lineNum * lineHeight) + parseInt(style.paddingTop?.replace('px', '') || '4') + lineHeight + 2;

    setDropdownOffset({ left, top });
  }, [value]);

  const handleInput = useCallback((newValue: string, cursorPos: number) => {
    const beforeCursor = newValue.slice(0, cursorPos);
    const lastOpen = beforeCursor.lastIndexOf('{{');
    const lastClose = beforeCursor.lastIndexOf('}}');

    const shouldShow = lastOpen >= 0 && lastOpen > lastClose;

    if (shouldShow) {
      const afterOpen = beforeCursor.slice(lastOpen + 2);
      setFilter(afterOpen);
      setInsertPos(lastOpen);
      setSelectedIdx(0);

      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        setShowDropdown(true);
        // Measure cursor position
        if (activeInputRef.current) {
          measureCursorPos(activeInputRef.current, cursorPos);
        }
      }, 150);
    } else {
      setShowDropdown(false);
      setFilter('');
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
    }
  }, [measureCursorPos]);

  const insertVariable = useCallback((varName: string) => {
    const before = value.slice(0, insertPos);
    const after = value.slice(insertPos);
    // Find the closing }} in the text after {{
    const closeIdx = after.indexOf('}}');
    // If }} exists, keep everything after it; otherwise remove everything from {{ onward
    const remaining = closeIdx >= 0 ? after.slice(closeIdx + 2) : '';
    const newValue = before + '{{' + varName + '}}' + remaining;
    onChange(newValue);
    setShowDropdown(false);
    setFilter('');
  }, [value, insertPos, onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!showDropdown) {
      externalKeyDown?.(e);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (matches[selectedIdx]) {
        e.preventDefault();
        insertVariable(matches[selectedIdx].name);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowDropdown(false);
    } else {
      externalKeyDown?.(e);
    }
  }, [showDropdown, matches, selectedIdx, insertVariable, externalKeyDown]);

  const handleBlur = useCallback(() => {
    setTimeout(() => setShowDropdown(false), 200);
  }, []);

  // Scroll to selected item
  useEffect(() => {
    if (showDropdown && dropdownRef.current) {
      const item = dropdownRef.current.children[selectedIdx] as HTMLElement;
      if (item) {
        item.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIdx, showDropdown]);

  const scopeConfig: Record<string, { badge: string; color: string }> = {
    'request': { badge: 'R', color: '#4ec9b0' },
    'collection': { badge: 'C', color: 'var(--vscode-textLink-foreground)' },
    'set': { badge: 'S', color: '#ca9ee6' },
    'global': { badge: 'G', color: '#dcdcaa' },
  };

  const triggerProps: TriggerProps = {
    onInput: handleInput,
    onKeyDown: handleKeyDown,
    onBlur: handleBlur,
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
      {/* Hidden measuring element */}
      <div
        ref={measureRef}
        style={{
          position: 'absolute',
          top: -9999,
          left: -9999,
          visibility: 'hidden',
          whiteSpace: 'pre',
          pointerEvents: 'none',
        }}
      />

      {children(triggerProps)}

      {showDropdown && matches.length > 0 && (
        <div
          ref={dropdownRef}
          style={{
            position: 'absolute',
            left: `${Math.min(dropdownOffset.left, (wrapperRef.current?.offsetWidth || 300) - 200)}px`,
            top: `${dropdownOffset.top}px`,
            zIndex: 200,
            background: 'var(--vscode-dropdown-background)',
            border: '1px solid var(--vscode-focusBorder)',
            minWidth: '200px',
            maxHeight: '200px',
            overflow: 'auto',
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
            borderRadius: '2px',
          }}
        >
          {matches.map((match, i) => {
            const sc = scopeConfig[match.scope];
            const matchIdx = match.name.toLowerCase().indexOf(filter.toLowerCase());
            const before = match.name.slice(0, matchIdx);
            const highlight = match.name.slice(matchIdx, matchIdx + filter.length);
            const after = match.name.slice(matchIdx + filter.length);

            return (
              <div
                key={match.name + i}
                onMouseDown={(e) => { e.preventDefault(); insertVariable(match.name); }}
                onMouseEnter={() => setSelectedIdx(i)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '5px 8px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  background: i === selectedIdx ? 'var(--vscode-list-activeSelectionBackground)' : 'transparent',
                  color: i === selectedIdx ? 'var(--vscode-list-activeSelectionForeground)' : 'var(--vscode-foreground)',
                  fontFamily: 'var(--vscode-editor-font-family)',
                  borderBottom: i < matches.length - 1 ? '1px solid var(--vscode-panel-border)' : 'none',
                }}
              >
                <span
                  style={{
                    width: '18px',
                    height: '18px',
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
                  title={match.scope}
                >
                  {sc.badge}
                </span>

                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ opacity: 0.5 }}>{'{{'}</span>
                  {filter ? (
                    <>
                      <span>{before}</span>
                      <span style={{ fontWeight: 700, textDecoration: 'underline' }}>{highlight}</span>
                      <span>{after}</span>
                    </>
                  ) : (
                    <span>{match.name}</span>
                  )}
                  <span style={{ opacity: 0.5 }}>{'}}'}</span>
                </span>

                <span style={{
                  fontSize: '9px',
                  color: sc.color,
                  flexShrink: 0,
                  padding: '1px 4px',
                  borderRadius: '2px',
                  background: i === selectedIdx ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                  textTransform: 'uppercase',
                }}>
                  {match.scope}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
