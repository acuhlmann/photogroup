import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import KeywordEditor from './KeywordEditor';

function setInput(input, value) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function render(props) {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => root.render(<KeywordEditor {...props} />));
    return { div, root };
}

const button = (div, label) => div.querySelector(`button[aria-label="${label}"]`);

describe('KeywordEditor', () => {
    it('adds keywords, several at once, skipping ones already there', async () => {
        const onChange = vi.fn().mockResolvedValue({});
        const { div, root } = await render({ words: ['beach'], onChange });

        await act(async () => button(div, 'Add keyword').click());
        const input = div.querySelector('input');
        await act(async () => setInput(input, 'Sunset, BEACH,  dusk '));
        await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
        expect(onChange).toHaveBeenCalledWith(['beach', 'Sunset', 'dusk']);
        expect(div.querySelector('input')).toBeNull();
        await act(async () => root.unmount());
    });

    it('removes a keyword', async () => {
        const onChange = vi.fn().mockResolvedValue({});
        const { div, root } = await render({ words: ['beach', 'dusk'], onChange });
        await act(async () => button(div, 'Remove keyword beach').click());
        expect(onChange).toHaveBeenCalledWith(['dusk']);
        await act(async () => root.unmount());
    });

    it('keeps what was typed when saving fails', async () => {
        const onChange = vi.fn().mockRejectedValue(new Error('Offline'));
        const { div, root } = await render({ words: [], onChange });
        await act(async () => button(div, 'Add keyword').click());
        await act(async () => setInput(div.querySelector('input'), 'pier'));
        await act(async () => div.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
        expect(div.querySelector('input').value).toBe('pier');
        await act(async () => root.unmount());
    });

    it('is read-only chips without onChange, and nothing when empty', async () => {
        const { div, root } = await render({ words: ['beach'] });
        expect(div.textContent).toBe('beach');
        expect(div.querySelector('button')).toBeNull();
        await act(async () => root.render(<KeywordEditor words={[]} />));
        expect(div.textContent).toBe('');
        await act(async () => root.unmount());
    });
});
