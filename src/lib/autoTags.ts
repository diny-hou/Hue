import type { AutoConfig } from '../components/SliceEditor';

/** Resolve tags from `tags[]` or legacy single `tag`. */
export function normalizeAutoTags(auto?: AutoConfig | null): string[] {
    if (!auto) return [];
    const fromTags = (auto.tags ?? [])
        .map(t => t.trim())
        .filter(Boolean);
    if (fromTags.length > 0) return fromTags;
    const legacy = auto.tag?.trim();
    return legacy ? [legacy] : [];
}

export function formatAutoTagsLabel(tags: string[]): string {
    if (tags.length === 0) return 'files & folders';
    if (tags.length === 1) return `tag “${tags[0]}”`;
    return `tags ${tags.map(t => `“${t}”`).join(', ')}`;
}
