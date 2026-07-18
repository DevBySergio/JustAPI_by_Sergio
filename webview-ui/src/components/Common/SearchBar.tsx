interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSearch: (query: string) => void;
  resultsOpen: boolean;
  onDismiss: () => void;
}

export function SearchBar({ value, onChange, onSearch, resultsOpen, onDismiss }: SearchBarProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && value.trim()) {
      onSearch(value.trim());
    } else if (e.key === 'Escape' && resultsOpen) {
      e.preventDefault();
      onDismiss();
    } else if (e.key === 'ArrowDown' && resultsOpen) {
      const firstResult = document.querySelector<HTMLButtonElement>('#global-search-results [role="option"]');
      if (firstResult) {
        e.preventDefault();
        firstResult.focus();
      }
    }
  };

  return (
    <div style={{ padding: '8px', borderBottom: '1px solid var(--vscode-panel-border)' }}>
      <input
        id="global-search-input"
        type="text"
        aria-label="Search requests, collections, and history"
        aria-controls="global-search-results"
        aria-expanded={resultsOpen}
        aria-haspopup="listbox"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search requests, collections..."
        style={{
          width: '100%',
          padding: '4px 8px',
          background: 'var(--vscode-input-background)',
          color: 'var(--vscode-input-foreground)',
          border: '1px solid var(--vscode-input-border)',
          fontSize: '12px',
          fontFamily: 'var(--vscode-font-family)',
        }}
      />
    </div>
  );
}
