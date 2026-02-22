import React, { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { SliceEditor, SliceItem } from './SliceEditor';

export const SliceEditorApp: React.FC = () => {
    const [index, setIndex] = useState<number | null>(null);
    const [item, setItem] = useState<SliceItem | null>(null);

    useEffect(() => {
        const unlisten = listen<{ index: number, item: SliceItem }>('load-item', (event) => {
            setIndex(event.payload.index);
            setItem(event.payload.item);
        });

        // Close editor if it loses focus
        const unlistenBlur = listen('tauri://blur', () => {
            invoke('close_editor').catch(console.error);
        });

        return () => {
            unlisten.then(un => un());
            unlistenBlur.then(un => un());
        };
    }, []);

    const handleSave = async (updatedItem: SliceItem) => {
        if (index === null) return;
        try {
            // Get current config, update the specific item, then save
            const config = await invoke<{ items: SliceItem[] }>('get_config');
            const newItems = [...config.items];
            newItems[index] = updatedItem;
            await invoke('update_config', { newConfig: { items: newItems } });
            await invoke('close_editor');
        } catch (e) {
            console.error(e);
        }
    };

    const handleCancel = () => {
        invoke('close_editor').catch(console.error);
    };

    if (!item) return null;

    return (
        <SliceEditor
            item={item}
            onSave={handleSave}
            onCancel={handleCancel}
        />
    );
};
