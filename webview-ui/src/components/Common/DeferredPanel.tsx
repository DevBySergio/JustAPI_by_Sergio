import { Component, Suspense, type ReactNode } from 'react';

class PanelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <div role="alert" style={{ padding: '12px' }}>This panel could not be loaded. Reopen JustAPI to retry. Your request draft is retained.</div>
      : this.props.children;
  }
}

export function DeferredPanel({ children, panelKey }: { children: ReactNode; panelKey: string }) {
  return <PanelBoundary key={panelKey}>
    <Suspense fallback={<div role="status" style={{ padding: '12px' }}>Loading panel…</div>}>{children}</Suspense>
  </PanelBoundary>;
}
