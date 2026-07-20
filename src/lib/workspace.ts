export interface WorkspaceEntry {
    name: string;
    path: string;
}

export interface WorkspaceStatus {
    active_name: string | null;
    active_path: string | null;
    active_index: number;
    entries: WorkspaceEntry[];
}

export type WorkspaceChangedPayload = {
    message: string;
    status: WorkspaceStatus;
};
