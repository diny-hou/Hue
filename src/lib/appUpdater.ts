import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export type UpdaterPhase =
    | 'idle'
    | 'checking'
    | 'downloading'
    | 'installing'
    | 'uptodate'
    | 'error';

export function isUpdaterAvailable(): boolean {
    return import.meta.env.PROD;
}

export async function checkForAppUpdate(): Promise<Update | null> {
    if (!isUpdaterAvailable()) {
        throw new Error('Updates are only available in installed production builds.');
    }
    return check();
}

export async function downloadAndInstallUpdate(
    update: Update,
    onEvent: (event: DownloadEvent, downloaded: number, contentLength: number) => void,
): Promise<void> {
    let downloaded = 0;
    let contentLength = 0;

    await update.downloadAndInstall((event) => {
        switch (event.event) {
            case 'Started':
                contentLength = event.data.contentLength ?? 0;
                downloaded = 0;
                break;
            case 'Progress':
                downloaded += event.data.chunkLength;
                break;
            case 'Finished':
                break;
        }
        onEvent(event, downloaded, contentLength);
    });

    await relaunch();
}

export function progressPercent(downloaded: number, contentLength: number): number {
    if (contentLength <= 0) return 0;
    return Math.min(100, Math.round((downloaded / contentLength) * 100));
}
