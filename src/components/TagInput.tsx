import React, { useState } from 'react';

type TagInputProps = {
    tags: string[];
    onChange: (tags: string[]) => void;
    placeholder?: string;
    className?: string;
};

export function TagInput({ tags, onChange, placeholder, className }: TagInputProps) {
    const [draft, setDraft] = useState('');

    const addTag = (raw: string) => {
        const next = raw.trim();
        if (!next) return;
        const exists = tags.some(t => t.toLowerCase() === next.toLowerCase());
        if (exists) {
            setDraft('');
            return;
        }
        onChange([...tags, next]);
        setDraft('');
    };

    const removeTag = (index: number) => {
        onChange(tags.filter((_, i) => i !== index));
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            addTag(draft);
            return;
        }
        if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
            e.preventDefault();
            removeTag(tags.length - 1);
        }
    };

    return (
        <div className={`tag-input${className ? ` ${className}` : ''}`}>
            {tags.map((tag, index) => (
                <span key={`${tag}-${index}`} className="tag-input-chip">
                    {tag}
                    <button
                        type="button"
                        className="tag-input-chip-remove"
                        aria-label={`Remove ${tag}`}
                        onClick={() => removeTag(index)}
                    >
                        ×
                    </button>
                </span>
            ))}
            <input
                className="tag-input-field"
                type="text"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={tags.length === 0 ? placeholder : 'Add tag…'}
            />
        </div>
    );
}
