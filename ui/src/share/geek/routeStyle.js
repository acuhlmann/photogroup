// One colour per kind of traffic, used for routes, packets and the legend.
export const ROUTE_STYLE = {
    sse: { rgb: '96,165,250', label: 'SSE / API', dash: [3, 5], width: 1 },
    tracker: { rgb: '167,139,250', label: 'tracker', dash: [3, 5], width: 1 },
    copies: { rgb: '232,121,249', label: 'server copy', dash: [2, 6], width: 1, hidden: true },
    stun: { rgb: '148,163,184', label: 'STUN', dash: [1, 4], width: 1 },
    lan: { rgb: '61,222,139', label: 'P2P same LAN', dash: [], width: 3 },
    punch: { rgb: '45,212,191', label: 'P2P via NAT', dash: [], width: 2.5 },
    relay: { rgb: '255,93,115', label: 'TURN relay', dash: [], width: 2.5 },
    turnctl: { rgb: '255,93,115', label: 'TURN allocate', dash: [1, 4], width: 1, hidden: true },
};

