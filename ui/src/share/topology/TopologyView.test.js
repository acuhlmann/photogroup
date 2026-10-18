import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { EventEmitter } from 'events';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import { createAppTheme } from '../../theme';
import TopologyView from './TopologyView';
import Peers from './Peers';

const phone = {
    peerId: 'phone',
    name: 'Phone',
    originPlatform: 'Safari 18 on iOS',
    networkChain: [
        { ip: '192.168.1.20', port: 50000, type: 'host', typeDetail: 'host' },
        { ip: '203.0.113.7', port: 50001, type: 'srflx', typeDetail: 'Normal NAT srflx' },
    ],
};
const laptop = {
    peerId: 'laptop',
    name: 'Laptop',
    originPlatform: 'Chrome 140 on Linux',
    networkChain: [
        { ip: '192.168.1.30', port: 50002, type: 'host', typeDetail: 'host' },
        { ip: '203.0.113.7', port: 50003, type: 'srflx', typeDetail: 'Normal NAT srflx' },
    ],
};
const room = { photos: [{ infoHash: 'abc', peerId: 'laptop', owners: [{ peerId: 'laptop' }, { peerId: 'phone' }] }] };

// Mirrors TorrentMaster: Peers subscribes to the emitter before any view mounts.
function createMaster({ peers = [], connections = [] } = {}) {
    const emitter = new EventEmitter();
    const master = {
        emitter,
        client: { peerId: 'phone' },
        me: { originPlatform: phone.originPlatform, name: phone.name },
        peers: new Peers(emitter, peers, {}),
        service: { hasRoom: true, getRoom: vi.fn().mockResolvedValue(room) },
    };
    master.peers.connections = connections;
    return master;
}

async function open(master) {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => {
        root.render(
            <ThemeProvider theme={createAppTheme('dark')}>
                <TopologyView master={master} />
            </ThemeProvider>
        );
    });
    return {
        text: () => div.textContent,
        close: async () => {
            await act(async () => root.unmount());
            div.remove();
        },
    };
}

describe('TopologyView', () => {
    let ctx;

    beforeEach(() => {
        ctx = new Proxy({}, {
            get: (target, prop) => {
                if (!(prop in target)) {
                    target[prop] = prop === 'measureText' ? vi.fn(() => ({ width: 10 })) : vi.fn();
                }
                return target[prop];
            },
            set: () => true,
        });
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('says you are alone when the room has nobody to draw', async () => {
        const view = await open(createMaster());

        expect(view.text()).toContain("You're the only one here");
        await view.close();
    });

    it('draws the room as soon as the map opens, and again after reopening', async () => {
        const master = createMaster({ peers: [phone, laptop] });

        const first = await open(master);
        expect(first.text()).not.toContain("You're the only one here");
        await first.close();

        const second = await open(master);
        expect(second.text()).not.toContain("You're the only one here");
        await second.close();
    });

    it('shows photo badges without waiting for the next photo event', async () => {
        const master = createMaster({ peers: [phone, laptop] });

        const view = await open(master);

        expect(master.service.getRoom).toHaveBeenCalled();
        expect(ctx.fillText.mock.calls.some(([text]) => text === '1')).toBe(true);
        await view.close();
    });
});
