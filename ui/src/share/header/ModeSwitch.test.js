import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import ModeSwitch from './ModeSwitch';

async function render(props) {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => root.render(<ModeSwitch {...props} />));
    return { div, root };
}

describe('ModeSwitch', () => {
    it('shows the current view and switches to another', async () => {
        const onChange = vi.fn();
        const { div, root } = await render({ mode: 'simple', onChange });
        const button = div.querySelector('[aria-haspopup="menu"]');
        expect(button.textContent).toContain('Simple');

        await act(async () => button.click());
        const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
        expect(items.map(item => item.textContent)).toEqual([
            expect.stringContaining('Simple'),
            expect.stringContaining('Default'),
            expect.stringContaining('Geek'),
        ]);

        await act(async () => items[2].click());
        expect(onChange).toHaveBeenCalledWith('geek');
        await act(async () => root.unmount());
        div.remove();
    });

    it('does nothing when the current view is picked again', async () => {
        const onChange = vi.fn();
        const { div, root } = await render({ mode: 'default', onChange });
        await act(async () => div.querySelector('[aria-haspopup="menu"]').click());
        const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
        await act(async () => items[1].click());
        expect(onChange).not.toHaveBeenCalled();
        await act(async () => root.unmount());
        div.remove();
    });
});
