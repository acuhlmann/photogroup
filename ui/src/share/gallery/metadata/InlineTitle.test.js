import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import InlineTitle from './InlineTitle';

function setInput(input, value) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

const key = (input, name) => input.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));

async function render(props) {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => root.render(<InlineTitle {...props} />));
    return { div, root };
}

describe('InlineTitle', () => {
    it('adds a missing title in place and saves it on Enter', async () => {
        const onSave = vi.fn().mockResolvedValue({});
        const { div, root } = await render({ value: '', onSave });

        await act(async () => div.querySelector('button[aria-label="Add title"]').click());
        const input = div.querySelector('input');
        expect(document.activeElement).toBe(input);
        await act(async () => setInput(input, '  Night market '));
        await act(async () => key(input, 'Enter'));

        expect(onSave).toHaveBeenCalledWith('Night market');
        expect(div.querySelector('input')).toBeNull();
        await act(async () => root.unmount());
    });

    it('cancels on Escape and skips saving when nothing changed', async () => {
        const onSave = vi.fn().mockResolvedValue({});
        const { div, root } = await render({ value: 'Pier', onSave });

        await act(async () => div.querySelector('button').click());
        await act(async () => setInput(div.querySelector('input'), 'Other'));
        await act(async () => key(div.querySelector('input'), 'Escape'));
        expect(div.textContent).toBe('Pier');

        await act(async () => div.querySelector('button').click());
        await act(async () => key(div.querySelector('input'), 'Enter'));
        expect(onSave).not.toHaveBeenCalled();
        await act(async () => root.unmount());
    });

    it('keeps the typed text when saving fails so it can be retried', async () => {
        const onSave = vi.fn().mockRejectedValue(new Error('Offline'));
        const { div, root } = await render({ value: '', onSave });

        await act(async () => div.querySelector('button').click());
        await act(async () => setInput(div.querySelector('input'), 'Harbour'));
        await act(async () => key(div.querySelector('input'), 'Enter'));
        expect(div.querySelector('input').value).toBe('Harbour');
        await act(async () => root.unmount());
    });

    it('is plain text without a save handler', async () => {
        const { div, root } = await render({ value: 'Pier' });
        expect(div.querySelector('button')).toBeNull();
        expect(div.textContent).toBe('Pier');
        await act(async () => root.unmount());
    });
});
