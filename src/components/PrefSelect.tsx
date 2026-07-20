import React, { useEffect, useRef, useState } from 'react';

export type PrefSelectOption = { value: string; label: string };

type PrefSelectProps = {
    value: string;
    options: PrefSelectOption[];
    onChange: (value: string) => void;
    disabled?: boolean;
    className?: string;
};

export const PrefSelect: React.FC<PrefSelectProps> = ({
    value,
    options,
    onChange,
    disabled = false,
    className = '',
}) => {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const selected = options.find(o => o.value === value) ?? options[0];

    useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        window.addEventListener('mousedown', close);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', close);
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    return (
        <div
            ref={rootRef}
            className={`pref-select-wrap ${open ? 'open' : ''} ${disabled ? 'disabled' : ''} ${className}`.trim()}
        >
            <button
                type="button"
                className="pref-select-trigger"
                disabled={disabled}
                aria-expanded={open}
                onClick={() => { if (!disabled) setOpen(v => !v); }}
            >
                <span>{selected?.label ?? value}</span>
                <span className="pref-select-chevron" aria-hidden>▾</span>
            </button>
            {open && (
                <ul className="pref-select-menu" role="listbox">
                    {options.map(opt => (
                        <li key={opt.value}>
                            <button
                                type="button"
                                role="option"
                                aria-selected={opt.value === value}
                                className={`pref-select-option${opt.value === value ? ' selected' : ''}`}
                                onClick={() => {
                                    onChange(opt.value);
                                    setOpen(false);
                                }}
                            >
                                {opt.label}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export const OPEN_ANIMATION_OPTIONS: PrefSelectOption[] = [
    { value: 'none', label: 'None (Instant)' },
    { value: 'spread', label: 'Spread' },
    { value: 'fade', label: 'Fade' },
    { value: 'bounce', label: 'Bounce' },
    { value: 'spin', label: 'Spin' },
    { value: 'pop', label: 'Pop' },
    { value: 'rise', label: 'Rise' },
    { value: 'blur_in', label: 'Blur In' },
];

export const HOVER_SCALE_OPTIONS: PrefSelectOption[] = [
    { value: 'none', label: 'None (1.0x)' },
    { value: 'small', label: 'Small (1.05x)' },
    { value: 'medium', label: 'Medium (1.10x)' },
    { value: 'large', label: 'Large (1.15x)' },
];

export const HOVER_ANIMATION_OPTIONS: PrefSelectOption[] = [
    { value: 'none', label: 'None' },
    { value: 'pulse', label: 'Pulse' },
    { value: 'glow', label: 'Glow' },
    { value: 'wobble', label: 'Wobble' },
    { value: 'breathe', label: 'Breathe' },
    { value: 'shimmer', label: 'Shimmer' },
    { value: 'ripple', label: 'Ripple' },
];

export const PREFS_CHROME_OPTIONS: PrefSelectOption[] = [
    { value: 'normal', label: 'Normal' },
    { value: 'liquid_glass', label: 'Liquid Glass' },
];
