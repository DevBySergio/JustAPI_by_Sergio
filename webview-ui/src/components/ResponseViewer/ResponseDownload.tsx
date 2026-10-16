import { useRequestStore } from '../../stores/useRequestStore';
import { postMessageWithAck } from '../../utils/vscodeApi';
import { LocalButton } from '../Common/LocalButton';

export function ResponseDownload() {
  const tab = useRequestStore(); const response = tab.response; const download = response?.download;
  if (!download || !response || response.error) { return null; }
  const pending = tab.downloadState?.status === 'saving';
  const save = () => {
    const ownerId = tab.tabId; const responseId = download.responseId; let operationId = '';
    if (!download.available || pending) { return; }
    void postMessageWithAck({ type: 'saveResponseBody', responseId }, message => {
      operationId = message.operationId;
      useRequestStore.getState().setResponseDownloadState(ownerId, { operationId, responseId, status: 'saving', message: 'Choose a local file in the save dialog…' });
    }, { timeoutMs: 0 }).then(() => {
      const state = useRequestStore.getState(); const owner = state.getTab(ownerId);
      if (owner?.downloadState?.operationId === operationId && owner.downloadState.status === 'saving') {
        state.setResponseDownloadState(ownerId, { operationId, responseId, status: 'error', message: 'The saved file was not confirmed. Try again.' });
      }
    }).catch(error => {
      const state = useRequestStore.getState();
      if (state.getTab(ownerId)?.downloadState?.status === 'saving') {
        state.setResponseDownloadState(ownerId, { operationId, responseId, status: 'error', message: String(error) });
      }
    });
  };
  return <div style={{ padding: '6px 8px', fontSize: '10px', borderBottom: '1px solid var(--vscode-panel-border)', overflowWrap: 'anywhere' }}>
    <LocalButton type="button" disabled={!download.available || pending} onClick={save}>Save response body…</LocalButton>
    <span style={{ marginLeft: '6px' }}>{response.size.toLocaleString()} bytes · complete body</span>
    <p style={{ margin: '5px 0 0', color: 'var(--vscode-descriptionForeground)' }}>
      {download.available ? 'Saves the complete body after HTTP decompression, preserving its original bytes and text encoding. Preview limits and formatting do not change the file.'
        : 'Original body no longer available. Send the request again to download it.'}
    </p>
    {tab.downloadState && <p role={tab.downloadState.status === 'error' ? 'alert' : 'status'} style={{ margin: '5px 0 0' }}>{tab.downloadState.message}</p>}
  </div>;
}
