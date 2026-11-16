// One colour per kind of traffic, used for routes, packets and the legend.
export const ROUTE_STYLE = {
    lan: { rgb: '61,222,139', label: 'P2P same LAN', dash: [], width: 3, group: 'data' },
    punch: { rgb: '45,212,191', label: 'P2P via NAT', dash: [], width: 2.5, group: 'data' },
    relay: { rgb: '255,93,115', label: 'TURN relay', dash: [], width: 3, group: 'data' },
    stun: { rgb: '56,189,248', label: 'STUN lookup', dash: [2, 4], width: 1.5, group: 'discovery' },
    turnctl: { rgb: '255,93,115', label: 'TURN allocate', dash: [2, 5], width: 1.25, group: 'discovery' },
    tracker: { rgb: '167,139,250', label: 'PG tracker', dash: [4, 4], width: 1.4, group: 'infra' },
    pubtracker: { rgb: '251,146,60', label: 'public trackers', dash: [5, 4], width: 1.35, group: 'discovery' },
    sse: { rgb: '96,165,250', label: 'SSE / API', dash: [4, 4], width: 1.25, group: 'infra' },
    copies: { rgb: '232,121,249', label: 'server copy', dash: [2, 5], width: 1.5, hidden: true, group: 'infra' },
};
