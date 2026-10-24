import React from 'react';
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import SimpleHowItWorks from './SimpleHowItWorks';

const button = text => Array.from(document.body.querySelectorAll('button')).find(item => item.textContent === text);
const title = () => document.body.querySelector('[data-testid="simple-how-title"]')?.textContent;

describe('SimpleHowItWorks', () => {
    it('walks the three steps and closes', async () => {
        const div = document.createElement('div');
        document.body.appendChild(div);
        const root = createRoot(div);
        await act(async () => root.render(<SimpleHowItWorks />));
        await act(async () => button('How does it work?').click());
        expect(title()).toBe('You share a photo');
        await act(async () => button('Next').click());
        expect(title()).toBe('The server connects the phones');
        expect(document.body.textContent).toContain('The server does not get the photo.');
        await act(async () => button('Next').click());
        expect(title()).toBe('The photo goes from phone to phone');
        await act(async () => button('Done').click());
        await act(async () => root.unmount());
        div.remove();
    });
});
