import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { EventEmitter } from 'events';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import { createAppTheme } from '../theme';
import MeView from './MeView';
import Peers from './topology/Peers';

const host = { ip: '192.168.1.20', port: 50000, transport: 'udp', type: 'host', typeDetail: 'host' };
const localNat = { ip: '203.0.113.7', port: 50001, transport: 'udp', type: 'srflx', typeDetail: 'Normal NAT srflx' };
const enrichedNat = {
    ...localNat,
    network: { hostname: 'p1234.example-isp.net', city: 'Berlin', country: 'Germany', connection: { isp: 'Example ISP' } },
};

// Mirrors TorrentMaster: Peers subscribes to the emitter before any view mounts.
function createMaster({ peers = [], localNetwork } = {}) {
    const emitter = new EventEmitter();
    return {
        emitter,
        client: { peerId: 'phone' },
        me: { originPlatform: 'Safari 18 on iOS', name: '' },
        peers: new Peers(emitter, peers, {}),
        localNetwork,
        service: { updatePeer: vi.fn() },
    };
}

async function open(master) {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => {
        root.render(
            <ThemeProvider theme={createAppTheme('light')}>
                <MeView master={master} />
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

describe('MeView', () => {
    it('shows this device as soon as it opens when the room already knows us', async () => {
        const master = createMaster({ peers: [{ peerId: 'phone', networkChain: [host, enrichedNat] }] });

        const view = await open(master);

        expect(view.text()).not.toContain('Detecting');
        expect(view.text()).toContain('192.168.1.20');
        expect(view.text()).toContain('203.0.113.7');
        expect(view.text()).toContain('Example ISP');
        await view.close();
    });

    it('falls back to local discovery before the server has our network', async () => {
        const master = createMaster({ peers: [{ peerId: 'phone', networkChain: [] }], localNetwork: [host, localNat] });

        const view = await open(master);

        expect(view.text()).toContain('192.168.1.20');
        expect(view.text()).toContain('203.0.113.7');
        await view.close();
    });

    it('keeps what it learned after the sheet is closed and reopened', async () => {
        const master = createMaster({ peers: [{ peerId: 'phone', networkChain: [] }], localNetwork: [host, localNat] });

        const first = await open(master);
        await act(async () => {
            master.emitter.emit('peers', { type: 'update', item: { peerId: 'phone', networkChain: [host, enrichedNat] } });
        });
        expect(first.text()).toContain('Example ISP');
        await first.close();

        const second = await open(master);
        expect(second.text()).toContain('Example ISP');
        await second.close();
    });
});
