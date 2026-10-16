import { useRequestStore } from '../../stores/useRequestStore';

export function SettingsEditor() {
  const { currentRequest, setRequest } = useRequestStore();
  const mebibyte = 1024 * 1024;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ minWidth: '120px' }}>Timeout (ms):</span>
        <input
          type="number"
          value={currentRequest.settings.timeout}
          onChange={(e) =>
            setRequest({
              ...currentRequest,
              settings: { ...currentRequest.settings, timeout: parseInt(e.target.value) || 30000 },
            })
          }
          style={{
            flex: 1,
            padding: '3px 6px',
            background: 'var(--vscode-input-background)',
            color: 'var(--vscode-input-foreground)',
            border: '1px solid var(--vscode-input-border)',
          }}
        />
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ minWidth: '120px' }}>Response limit (MiB):</span>
        <input
          type="number"
          min={1 / 1024}
          max={100}
          step={1 / 1024}
          value={currentRequest.settings.maxResponseBytes / mebibyte}
          onChange={(e) => {
            const requested = Math.round(Number(e.target.value) * mebibyte);
            const maxResponseBytes = Number.isFinite(requested)
              ? Math.min(100 * mebibyte, Math.max(1024, requested))
              : 10 * mebibyte;
            setRequest({
              ...currentRequest,
              settings: { ...currentRequest.settings, maxResponseBytes },
            });
          }}
          style={{
            flex: 1,
            padding: '3px 6px',
            background: 'var(--vscode-input-background)',
            color: 'var(--vscode-input-foreground)',
            border: '1px solid var(--vscode-input-border)',
          }}
        />
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ minWidth: '120px' }}>Follow redirects:</span>
        <input
          type="checkbox"
          checked={currentRequest.settings.followRedirects}
          onChange={(e) =>
            setRequest({
              ...currentRequest,
              settings: { ...currentRequest.settings, followRedirects: e.target.checked },
            })
          }
        />
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ minWidth: '120px' }}>Verify SSL:</span>
        <input
          type="checkbox"
          checked={currentRequest.settings.verifySSL}
          onChange={(e) =>
            setRequest({
              ...currentRequest,
              settings: { ...currentRequest.settings, verifySSL: e.target.checked },
            })
          }
        />
      </label>
    </div>
  );
}
