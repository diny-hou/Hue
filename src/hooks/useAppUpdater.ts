import { useCallback, useState } from 'react';
import type { Update } from '@tauri-apps/plugin-updater';
import {
    checkForAppUpdate,
    downloadAndInstallUpdate,
    isUpdaterAvailable,
    type UpdaterPhase,
} from '../lib/appUpdater';

export function useAppUpdater() {
    const [phase, setPhase] = useState<UpdaterPhase>('idle');
    const [update, setUpdate] = useState<Update | null>(null);
    const [downloaded, setDownloaded] = useState(0);
    const [contentLength, setContentLength] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);

    const reset = useCallback(() => {
        void update?.close();
        setUpdate(null);
        setPhase('idle');
        setDownloaded(0);
        setContentLength(0);
        setError(null);
    }, [update]);

    const runUpdate = useCallback(async () => {
        setError(null);
        setStatusMessage(null);
        setDownloaded(0);
        setContentLength(0);

        if (!isUpdaterAvailable()) {
            setStatusMessage('Updates are available only in installed production builds.');
            return;
        }

        setPhase('checking');
        try {
            const found = await checkForAppUpdate();
            if (!found) {
                setPhase('uptodate');
                setStatusMessage('You are on the latest version.');
                return;
            }

            setUpdate(found);
            setPhase('downloading');

            await downloadAndInstallUpdate(found, (event, nextDownloaded, nextContentLength) => {
                setDownloaded(nextDownloaded);
                setContentLength(nextContentLength);
                if (event.event === 'Finished') {
                    setPhase('installing');
                }
            });
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setPhase('error');
        }
    }, []);

    return {
        phase,
        update,
        downloaded,
        contentLength,
        error,
        statusMessage,
        isBusy: phase === 'checking' || phase === 'downloading' || phase === 'installing',
        runUpdate,
        reset,
    };
}
