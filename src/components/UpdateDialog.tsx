import type { Update } from '@tauri-apps/plugin-updater';
import { progressPercent, type UpdaterPhase } from '../lib/appUpdater';

interface UpdateDialogProps {
    phase: UpdaterPhase;
    update: Update | null;
    downloaded: number;
    contentLength: number;
    error: string | null;
    onClose: () => void;
}

export function UpdateDialog({
    phase,
    update,
    downloaded,
    contentLength,
    error,
    onClose,
}: UpdateDialogProps) {
    if (phase === 'idle' || phase === 'checking' || phase === 'uptodate') {
        return null;
    }

    const pct = progressPercent(downloaded, contentLength);
    const isWorking = phase === 'downloading' || phase === 'installing';

    let title = 'Update failed';
    if (phase === 'downloading') title = 'Downloading update…';
    if (phase === 'installing') title = 'Installing update…';

    return (
        <div className="update-prompt-backdrop" role="dialog" aria-labelledby="update-dialog-title">
            <div className="update-prompt-modal">
                <h2 id="update-dialog-title" className="update-prompt-title">
                    {title}
                </h2>

                {isWorking && update && (
                    <>
                        <p className="update-prompt-version">
                            Updating to <strong>{update.version}</strong>
                            <span className="update-prompt-cur"> (from {update.currentVersion})</span>
                        </p>
                        <div className="update-prompt-progress-wrap">
                            <div
                                className={`update-prompt-progress-bar${phase === 'installing' ? ' indeterminate' : ''}`}
                                style={phase === 'downloading' ? { width: `${pct > 0 ? pct : 8}%` } : undefined}
                            />
                            <p className="update-prompt-progress-label">
                                {phase === 'installing'
                                    ? 'Finishing install — restarting Hue…'
                                    : contentLength > 0
                                        ? `${pct}%`
                                        : 'Starting download…'}
                            </p>
                        </div>
                    </>
                )}

                {phase === 'error' && (
                    <>
                        {error ? <p className="update-prompt-error">{error}</p> : null}
                        <div className="update-prompt-actions">
                            <button type="button" className="update-prompt-btn primary" onClick={onClose}>
                                Close
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
