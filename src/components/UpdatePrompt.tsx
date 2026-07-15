import { useCallback, useEffect, useState } from 'react';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

type Phase = 'idle' | 'checking' | 'available' | 'working' | 'error';

/**
 * Startup update UI (main window only). Skipped in Vite dev — use a production build to test.
 */
export function UpdatePrompt() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [update, setUpdate] = useState<Update | null>(null);
  const [downloaded, setDownloaded] = useState(0);
  const [contentLength, setContentLength] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD) return;

    let cancelled = false;

    (async () => {
      setPhase('checking');
      try {
        const u = await check();
        if (cancelled) return;
        if (u) {
          setUpdate(u);
          setPhase('available');
        } else {
          setPhase('idle');
        }
      } catch (e) {
        console.warn('[updater] check failed', e);
        if (!cancelled) setPhase('idle');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const onDismiss = useCallback(() => {
    void update?.close();
    setUpdate(null);
    setPhase('idle');
    setError(null);
  }, [update]);

  const onDownloadAndRestart = useCallback(async () => {
    if (!update) return;
    setError(null);
    setPhase('working');
    setDownloaded(0);
    setContentLength(0);

    const onEvent = (event: DownloadEvent) => {
      switch (event.event) {
        case 'Started':
          setContentLength(event.data.contentLength ?? 0);
          break;
        case 'Progress':
          setDownloaded((d) => d + event.data.chunkLength);
          break;
        case 'Finished':
          break;
      }
    };

    try {
      await update.downloadAndInstall(onEvent);
      await relaunch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }, [update]);

  if (phase === 'idle' || phase === 'checking') return null;

  const pct =
    contentLength > 0 ? Math.min(100, Math.round((downloaded / contentLength) * 100)) : phase === 'working' ? 0 : 0;

  return (
    <div className="update-prompt-backdrop" role="dialog" aria-labelledby="update-prompt-title">
      <div className="update-prompt-modal">
        <h2 id="update-prompt-title" className="update-prompt-title">
          {phase === 'available' ? 'Update available' : phase === 'working' ? 'Downloading update…' : 'Update failed'}
        </h2>

        {phase === 'available' && update && (
          <>
            <p className="update-prompt-version">
              New version: <strong>{update.version}</strong>
              <span className="update-prompt-cur"> (current {update.currentVersion})</span>
            </p>
            {update.body ? (
              <pre className="update-prompt-notes">{update.body}</pre>
            ) : null}
            <div className="update-prompt-actions">
              <button type="button" className="update-prompt-btn secondary" onClick={onDismiss}>
                Later
              </button>
              <button type="button" className="update-prompt-btn primary" onClick={() => void onDownloadAndRestart()}>
                Install and restart
              </button>
            </div>
          </>
        )}

        {phase === 'working' && (
          <div className="update-prompt-progress-wrap">
            <div className="update-prompt-progress-bar" style={{ width: `${pct}%` }} />
            <p className="update-prompt-progress-label">
              {contentLength > 0 ? `${pct}%` : 'Starting download…'}
            </p>
          </div>
        )}

        {phase === 'error' && (
          <>
            {error ? <p className="update-prompt-error">{error}</p> : null}
            <div className="update-prompt-actions">
              <button type="button" className="update-prompt-btn primary" onClick={onDismiss}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
