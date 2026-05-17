interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSearch: (query: string) => void;
}

export function SearchBar({ value, onChange, onSearch }: SearchBarProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && value.trim()) {
      onSearch(value.trim());
    }
  };

  return (
    <div style={{ padding: '8px', borderBottom: '1px solid var(--vscode-panel-border)' }}>
      <input
        type="text"
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
          outline: 'none',
        }}
      />
    </div>
  );
}
