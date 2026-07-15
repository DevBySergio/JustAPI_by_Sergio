import { useState } from 'react';
import { useRequestStore } from '../stores/useRequestStore';
import { useCollectionStore } from '../stores/useCollectionStore';
import { postMessage } from '../utils/vscodeApi';

type TargetLanguage = 'javascript' | 'typescript' | 'python' | 'curl' | 'csharp' | 'java' | 'go';

const LANGUAGES: { value: TargetLanguage; label: string }[] = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'curl', label: 'cURL' },
  { value: 'csharp', label: 'C#' },
  { value: 'java', label: 'Java' },
  { value: 'go', label: 'Go' },
];

interface CodeGenPanelProps {
  code: string;
}

export function CodeGenPanel({ code }: CodeGenPanelProps) {
  const currentRequest = useRequestStore((s) => s.currentRequest);
  const activeCollectionId = useCollectionStore((s) => s.activeCollectionId);
  const [language, setLanguage] = useState<TargetLanguage>('javascript');
  const [includeCredentials, setIncludeCredentials] = useState(false);

  const handleGenerate = () => {
    if (!currentRequest.url) { return; }
    postMessage({
      type: 'generateCode',
      request: currentRequest,
      language,
      includeCredentials,
      collectionId: activeCollectionId ?? undefined,
    });
  };

  return (
    <div style={{ padding: '8px' }}>
      <h3 style={{ fontSize: '12px', fontWeight: 600, margin: '0 0 8px' }}>Code Generation</h3>

      <div style={{ display: 'flex', gap: '4px', marginBottom: '8px', flexWrap: 'wrap' }}>
        {LANGUAGES.map((l) => (
          <button
            key={l.value}
            onClick={() => setLanguage(l.value)}
            style={{
              padding: '3px 8px',
              border: '1px solid var(--vscode-panel-border)',
              background: language === l.value ? 'var(--vscode-button-background)' : 'transparent',
              color: language === l.value ? 'var(--vscode-button-foreground)' : 'var(--vscode-foreground)',
              cursor: 'pointer',
              fontSize: '10px',
              borderRadius: '2px',
            }}
          >
            {l.label}
          </button>
        ))}
      </div>

      <label style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px', fontSize: '10px' }}>
        <input
          type="checkbox"
          checked={includeCredentials}
          onChange={(event) => setIncludeCredentials(event.target.checked)}
        />
        Include credentials once (confirmation required)
      </label>

      <button
        onClick={handleGenerate}
        disabled={!currentRequest.url}
        style={{
          width: '100%',
          padding: '5px',
          background: currentRequest.url ? 'var(--vscode-button-background)' : 'var(--vscode-button-secondaryBackground)',
          color: 'var(--vscode-button-foreground)',
          border: 'none',
          cursor: currentRequest.url ? 'pointer' : 'default',
          fontSize: '11px',
          opacity: currentRequest.url ? 1 : 0.5,
          marginBottom: '8px',
        }}
      >
        Generate Code
      </button>

      <textarea
        value={code}
        readOnly
        onClick={(e) => {
          (e.target as HTMLTextAreaElement).select();
          navigator.clipboard?.writeText(code).catch(() => {});
        }}
        placeholder="Generated code will appear here. Click to copy."
        style={{
          width: '100%',
          minHeight: '150px',
          padding: '6px',
          background: 'var(--vscode-input-background)',
          color: 'var(--vscode-input-foreground)',
          border: '1px solid var(--vscode-input-border)',
          fontFamily: 'var(--vscode-editor-font-family)',
          fontSize: '11px',
          resize: 'vertical',
          outline: 'none',
        }}
      />
    </div>
  );
}
