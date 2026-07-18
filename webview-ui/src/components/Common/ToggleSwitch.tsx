export function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onChange}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      style={{
        width: '26px',
        height: '13px',
        borderRadius: '7px',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        background: checked ? 'var(--vscode-testing-iconPassedForeground)' : 'var(--vscode-input-border)',
        position: 'relative',
        transition: 'background 0.2s',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: '2px',
          left: checked ? '13px' : '2px',
          width: '9px',
          height: '9px',
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.2s',
        }}
      />
    </button>
  );
}
