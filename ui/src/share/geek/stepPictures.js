import React from 'react';
import PropTypes from 'prop-types';

import { TX, RX } from './traffic';
import FingerprintDiagram from './FingerprintDiagram';
import { Reveal, Node, Arrow, Flow, Lock, Mark, PhotoIcon, useColors, mono } from './diagramParts';

// One picture per tour step, drawn one phase after the other next to the
// text of that phase. Each takes { phase, held, data }: `data` comes from
// the step (tour.js `told`), so real addresses and hashes show where the
// tour has them. All pictures are 340 units wide.

const AMBER = `rgb(${TX})`;
const GREEN = `rgb(${RX})`;
const short = (text, head = 8) => (text && text.length > head + 4 ? `${text.slice(0, head)}…` : text || '');

function Svg({ height, label, children }) {
    return (
        <svg viewBox={`0 0 340 ${height}`} width="100%" role="img" aria-label={label}
            style={{ display: 'block', overflow: 'visible', fontFamily: 'inherit' }}>
            {children}
        </svg>
    );
}

Svg.propTypes = { height: PropTypes.number.isRequired, label: PropTypes.string, children: PropTypes.node };

const pictureProps = { phase: PropTypes.number.isRequired, held: PropTypes.bool, data: PropTypes.object };

/** 1: the request goes through Cloud Run and nginx to the app; you get a peer ID; SSE stays open. */
function RoomPicture({ phase, held, data = {} }) {
    const c = useColors();
    const peerId = data.peerId ? short(data.peerId, 8) : 'a1b2c3d4…';
    return (
        <Svg height={150} label="Your browser, Cloud Run, nginx and the app; the app gives you a peer ID and keeps an event stream open">
            <Node x={4} y={40} w={84} h={40} label="your browser" sub={phase >= 1 ? `peer ${peerId}` : ' '} lit={phase >= 1} />
            <Node x={108} y={44} w={66} h={32} label="Cloud Run" sub="wakes it" lit={phase === 0} size={9.5} />
            <Node x={190} y={44} w={56} h={32} label="nginx" lit={phase === 0} />
            <Node x={262} y={44} w={74} h={32} label="app" sub=":8081" lit={phase >= 1} />
            <Arrow x1={88} y1={60} x2={106} y2={60} color={phase === 0 ? c.accent : undefined} />
            <Arrow x1={174} y1={60} x2={188} y2={60} color={phase === 0 ? c.accent : undefined} />
            <Arrow x1={246} y1={60} x2={260} y2={60} color={phase === 0 ? c.accent : undefined} />
            <text x={170} y={30} fontSize="9" textAnchor="middle" fill={phase === 0 ? c.accent : c.muted} style={{ fontFamily: mono }}>GET /  ·  POST join room</text>
            <Reveal phase={phase} from={0} until={1}>
                <Flow d="M88 60 L262 60" color={c.accent} held={held} count={2} seconds={1.4} />
            </Reveal>
            <Reveal phase={phase} from={1} dy={-6}>
                <path d="M299 76 C299 100 46 100 46 82" fill="none" stroke={c.accent} strokeWidth="1.5" />
                <path d="M41 88 l5 -6 l5 6" fill="none" stroke={c.accent} strokeWidth="1.5" />
                <rect x="128" y="84" width="88" height="16" rx="8" fill={c.paper} stroke={c.accent} />
                <text x="172" y="95.5" fontSize="9" textAnchor="middle" fill={c.accent} style={{ fontFamily: mono }}>random peer ID</text>
            </Reveal>
            <Reveal phase={phase} from={2} dy={6}>
                <rect x="46" y="118" width="253" height="12" rx="6" fill={c.tint} stroke={c.line} />
                <text x="172" y="145" fontSize="9" textAnchor="middle" fill={c.muted} style={{ fontFamily: mono }}>SSE stays open · room changes: photos, people</text>
                <Flow d="M299 124 L46 124" color={c.hash} held={held} count={4} seconds={2.4} r={3} />
                <line x1="46" y1="80" x2="46" y2="118" stroke={c.line} />
                <line x1="299" y1="76" x2="299" y2="118" stroke={c.line} />
            </Reveal>
        </Svg>
    );
}

RoomPicture.propTypes = pictureProps;

/** 2: private address, STUN tells the public one, both become candidates. */
function StunPicture({ phase, held, data = {} }) {
    const c = useColors();
    const pub = data.publicIp || '198.51.100.23';
    return (
        <Svg height={156} label={`Your device has the private address ${data.privateIp}; STUN tells it the public address ${pub}`}>
            <Node x={4} y={94} w={92} h={36} label="your device" sub={data.privateIp || '192.168.1.2'} lit={phase === 0} />
            <Node x={128} y={94} w={74} h={36} label="router" sub="NAT" />
            <line x1="96" y1="112" x2="128" y2="112" stroke={c.muted} strokeWidth="1.5" />
            <Node x={232} y={8} w={104} h={36} label="STUN" sub={short(data.stun || 'stun server', 18)} lit={phase === 1} />
            <Reveal phase={phase} from={0} until={1}>
                <text x="165" y="80" fontSize="18" fontWeight="700" textAnchor="middle" fill={c.muted}>?</text>
                <text x="165" y="146" fontSize="9" textAnchor="middle" fill={c.muted}>public address: unknown</text>
            </Reveal>
            <Reveal phase={phase} from={1}>
                <Arrow x1={190} y1={94} x2={244} y2={46} color={phase === 1 ? c.accent : undefined} />
                <text x="226" y="36" fontSize="9" textAnchor="end" fill={phase === 1 ? c.accent : c.muted} style={{ fontFamily: mono }}>binding request</text>
                <Arrow x1={284} y1={44} x2={284} y2={92} color={phase === 1 ? c.accent : undefined} />
                <rect x="222" y="58" width="114" height="18" rx="9" fill={c.paper} stroke={c.accent} />
                <text x="279" y="70.5" fontSize="8.6" textAnchor="middle" fill={c.accent} style={{ fontFamily: mono }}>you are {short(pub, 15)}</text>
            </Reveal>
            <Reveal phase={phase} from={2} dx={10}>
                <rect x="212" y="98" width="124" height="44" rx="6" fill="none" stroke={c.good} strokeWidth="1.5" />
                <text x="220" y="112" fontSize="9" fontWeight="700" fill={c.good}>ICE candidates</text>
                <text x="220" y="124" fontSize="8.4" fill={c.ink} style={{ fontFamily: mono }}>host  {short(data.privateIp || '192.168.1.2', 14)}</text>
                <text x="220" y="136" fontSize="8.4" fill={c.ink} style={{ fontFamily: mono }}>srflx {short(pub, 14)}</text>
                <text x="274" y="154" fontSize="9" textAnchor="middle" fill={c.muted}>→ to the room</text>
            </Reveal>
            <Reveal phase={phase} from={1}>
                <Flow d="M190 94 L244 46" color={c.accent} held={held} count={1} seconds={1.6} />
            </Reveal>
        </Svg>
    );
}

StunPicture.propTypes = pictureProps;

/** 4: the magnet link goes to the server and on to the room; the photo stays. */
function MagnetPicture({ phase, held, data = {} }) {
    const c = useColors();
    const hash = data.infoHash || '9c1e42d87fa03b5e61c9d2a48e7f0b3c5d6a07b3';
    return (
        <Svg height={164} label="The magnet link goes to the server and to your friend; the photo stays on your device">
            <rect x="2" y="4" width="336" height="26" rx="6" fill={c.tint} stroke={phase === 0 ? c.accent : c.line} />
            <text x="10" y="21" fontSize="8.6" style={{ fontFamily: mono }}>
                <tspan fill={c.muted}>magnet:?xt=urn:btih:</tspan>
                <tspan fill={c.accent} fontWeight="700">{short(hash, 12)}</tspan>
                <tspan fill={c.muted}>&amp;dn={short(data.name || 'photo.jpg', 12)}</tspan>
            </text>
            <text x="168" y="42" fontSize="8.6" textAnchor="middle" fill={c.accent}>infohash</text>

            <Node x={4} y={70} w={80} h={30} label="you" lit={phase === 0} />
            <Node x={130} y={50} w={80} h={30} label="server" lit={phase === 1} />
            <Node x={256} y={70} w={80} h={30} label="friend" lit={phase === 1} dashed={phase < 1} />
            <PhotoIcon x={31} y={110} color={phase === 2 ? c.good : undefined} />
            <Arrow x1={84} y1={80} x2={128} y2={68} color={c.accent} label="POST" labelDy={-4} />
            <Reveal phase={phase} from={0} until={1}><Flow d="M84 80 L128 68" color={c.accent} held={held} count={1} seconds={1.2} /></Reveal>
            <Reveal phase={phase} from={1}>
                <Arrow x1={212} y1={68} x2={254} y2={80} color={c.accent} label="SSE" labelDy={-4} />
                <PhotoIcon x={283} y={110} placeholder />
                <text x="296" y="154" fontSize="8.6" textAnchor="middle" fill={c.muted}>placeholder</text>
            </Reveal>
            <Reveal phase={phase} from={1} until={2}><Flow d="M212 68 L254 80" color={c.accent} held={held} count={1} seconds={1.2} /></Reveal>
            <Reveal phase={phase} from={2}>
                <line x1="62" y1="126" x2="278" y2="126" stroke={c.muted} strokeDasharray="3 4" />
                <Mark x={170} y={126} color={c.muted} />
                <text x="170" y="150" fontSize="9" fontWeight="700" textAnchor="middle" fill={c.good}>the photo has not moved</text>
            </Reveal>
        </Svg>
    );
}

MagnetPicture.propTypes = pictureProps;

/** 5: both announce the same infohash; the tracker swaps offer and answer. */
function TrackerPicture({ phase, data = {} }) {
    const c = useColors();
    const hash = short(data.infoHash || '9c1e42d87fa0', 6);
    const X = { you: 40, tracker: 170, friend: 300 };
    const message = (from, to, y, label, from0, lit) => (
        <Reveal phase={phase} from={from0} dx={from < to ? -8 : 8}>
            <Arrow x1={X[from] + (from < to ? 0 : 0)} y1={y} x2={X[to]} y2={y} color={lit ? c.accent : c.muted} label={label} labelDy={-3} size={8.4} />
        </Reveal>
    );
    return (
        <Svg height={166} label="Both browsers announce the infohash to the tracker; it swaps the offer and the answer; then they can reach each other">
            {Object.entries({ you: 'you', tracker: 'tracker', friend: 'friend' }).map(([key, label]) => (
                <g key={key}>
                    <Node x={X[key] - 36} y={2} w={72} h={24} label={label} lit={key === 'tracker' ? phase < 2 : phase === 2} />
                    <line x1={X[key]} y1="26" x2={X[key]} y2="146" stroke={c.line} strokeDasharray="3 3" />
                </g>
            ))}
            {message('you', 'tracker', 46, `announce ${hash}`, 0, phase === 0)}
            {message('friend', 'tracker', 46, `announce ${hash}`, 0, phase === 0)}
            <Reveal phase={phase} from={0} delay={300}>
                <text x="170" y="62" fontSize="8.4" textAnchor="middle" fill={c.good}>same photo: match</text>
            </Reveal>
            {message('you', 'tracker', 80, 'offer (SDP)', 1, phase === 1)}
            {message('tracker', 'friend', 94, 'offer', 1, phase === 1)}
            {message('friend', 'tracker', 112, 'answer (SDP)', 1, phase === 1)}
            {message('tracker', 'you', 126, 'answer', 1, phase === 1)}
            <Reveal phase={phase} from={2} dy={6}>
                <Arrow x1={44} y1={154} x2={296} y2={154} both color={c.good} width={2} />
                <rect x="104" y="146" width="132" height="16" rx="8" fill={c.paper} />
                <text x="170" y="157.5" fontSize="9" fontWeight="700" textAnchor="middle" fill={c.good}>they can reach each other</text>
            </Reveal>
        </Svg>
    );
}

TrackerPicture.propTypes = pictureProps;

/** 6: three kinds of path, tried from best to worst; the first that works wins. */
function IcePicture({ phase, held, data = {} }) {
    const c = useColors();
    const winner = data.winner || 'punch';
    const rows = [
        { kind: 'lan', y: 28, label: 'same network', pair: 'host ↔ host' },
        { kind: 'punch', y: 76, label: 'through both routers', pair: 'srflx ↔ srflx' },
        { kind: 'relay', y: 124, label: 'TURN relay', pair: 'relay ↔ relay' },
    ];
    const won = rows.findIndex(row => row.kind === winner);
    const done = phase === 3;
    return (
        <Svg height={150} label={`ICE tries three paths; the ${rows[won].label} path works`}>
            {rows.map((row, index) => {
                const trying = phase === index;
                const color = done ? (index === won ? c.good : c.muted) : trying ? c.accent : c.muted;
                const d = row.kind === 'relay' ? `M110 ${row.y} L205 ${row.y - 16} L300 ${row.y}` : `M110 ${row.y} L300 ${row.y}`;
                return (
                    <Reveal key={row.kind} phase={phase} from={index} dx={-8}>
                        <text x="4" y={row.y - 2} fontSize="9.5" fontWeight="700" fill={color}>{index + 1}. {row.label}</text>
                        <text x="4" y={row.y + 11} fontSize="8.4" fill={c.muted} style={{ fontFamily: mono }}>{row.pair}</text>
                        <path d={d} fill="none" stroke={color} strokeWidth={done && index === won ? 2.4 : 1.4} strokeDasharray={done && index !== won ? '3 3' : undefined} />
                        <circle cx="110" cy={row.y} r="5" fill={color} />
                        <circle cx="300" cy={row.y} r="5" fill={color} />
                        {row.kind === 'punch' && [175, 235].map(x => <rect key={x} x={x - 9} y={row.y - 7} width="18" height="14" rx="2" fill={c.paper} stroke={color} />)}
                        {row.kind === 'relay' && <rect x="186" y={row.y - 25} width="38" height="16" rx="4" fill={c.paper} stroke={color} strokeDasharray={data.hasTurn === false ? '3 2' : undefined} />}
                        {row.kind === 'relay' && <text x="205" y={row.y - 14} fontSize="8" textAnchor="middle" fill={color}>TURN</text>}
                        {trying && !done && <Flow d={d} color={c.accent} held={held} count={2} seconds={1.4} r={3} />}
                        {done && <Mark x={324} y={row.y} ok={index === won} color={index === won ? c.good : c.muted} />}
                    </Reveal>
                );
            })}
            <Reveal phase={phase} from={3}>
                <text x="205" y={rows[won].y + 18} fontSize="8.6" fontWeight="700" textAnchor="middle" fill={c.good}>
                    {data.winner ? 'carries the photo' : 'carries the photo (example)'}
                </text>
            </Reveal>
        </Svg>
    );
}

IcePicture.propTypes = pictureProps;

/** 7: the direct path is blocked; TURN forwards encrypted bytes (or, here, is not configured). */
function TurnPicture({ phase, held, data = {} }) {
    const c = useColors();
    const turn = data.hasTurn;
    return (
        <Svg height={150} label={turn ? 'The direct path is blocked; TURN forwards encrypted bytes it cannot read' : 'The direct path is blocked; no TURN is configured, so a server copy is the fallback'}>
            <Node x={4} y={104} w={74} h={30} label="you" />
            <Node x={262} y={104} w={74} h={30} label="friend" />
            <line x1="78" y1="119" x2="262" y2="119" stroke={c.muted} strokeDasharray="3 3" />
            <g>
                {[0, 1, 2].map(row => [0, 1].map(col => (
                    <rect key={`${row}${col}`} x={158 + col * 12 - (row % 2) * 6} y={104 + row * 10} width="12" height="10" fill={c.bad} fillOpacity="0.2" stroke={c.bad} strokeWidth="0.8" />
                )))}
            </g>
            <Mark x={170} y={92} color={c.bad} />
            <text x="170" y="146" fontSize="8.6" textAnchor="middle" fill={c.bad}>blocked</text>
            <Reveal phase={phase} from={1} dy={-6}>
                <Node x={124} y={4} w={92} h={32} label="TURN relay" sub={turn ? 'forwards bytes' : 'not configured'} dashed={!turn} lit={turn} />
                {turn ? (
                    <>
                        <path d="M41 104 L41 20 L124 20" fill="none" stroke={c.accent} strokeWidth="1.5" />
                        <path d="M216 20 L299 20 L299 104" fill="none" stroke={c.accent} strokeWidth="1.5" />
                        <Flow d="M41 104 L41 20 L124 20" color={AMBER} held={held} count={2} seconds={1.6} />
                        <Flow d="M216 20 L299 20 L299 104" color={AMBER} held={held} count={2} seconds={1.6} />
                    </>
                ) : (
                    <>
                        <path d="M41 104 L41 20 L124 20" fill="none" stroke={c.muted} strokeDasharray="3 3" />
                        <path d="M216 20 L299 20 L299 104" fill="none" stroke={c.muted} strokeDasharray="3 3" />
                    </>
                )}
            </Reveal>
            <Reveal phase={phase} from={2}>
                {turn ? (
                    <>
                        <Lock x={170} y={56} color={c.good} size={1.4} />
                        <text x="170" y="80" fontSize="9" fontWeight="700" textAnchor="middle" fill={c.good}>encrypted: TURN cannot read it</text>
                    </>
                ) : (
                    <>
                        <Node x={110} y={50} w={120} h={26} label="server copy (step 9)" lit size={9} />
                        <Arrow x1={78} y1={110} x2={110} y2={70} color={c.accent} />
                    </>
                )}
            </Reveal>
        </Svg>
    );
}

TurnPicture.propTypes = pictureProps;

/** 8: handshake, metadata, pieces checked against their hashes, then passed on. */
function PiecesPicture({ phase, held, data = {} }) {
    const c = useColors();
    const hashes = data.pieceHashes || ['a3f91c07', '5e0b2d94'];
    // Which cells of the receiver's grid are in: one bad piece, discarded and asked for again.
    const cells = Array.from({ length: 8 }, (_, index) => index);
    return (
        <Svg height={156} label="The browsers swap a handshake, the metadata and the pieces; each piece is checked against its hash and passed on">
            <Node x={4} y={8} w={72} h={30} label="you" />
            <Node x={150} y={8} w={72} h={30} label="friend" lit={phase === 2} />
            <Node x={264} y={8} w={72} h={30} label="next device" dashed={phase < 3} lit={phase === 3} size={9} />
            <line x1="76" y1="23" x2="150" y2="23" stroke={c.good} strokeWidth="3" strokeOpacity="0.35" />
            <Lock x={113} y={8} color={c.good} size={0.8} />
            <Reveal phase={phase} from={0} until={1}>
                <Arrow x1={78} y1={30} x2={148} y2={30} both color={c.accent} />
                <text x="113" y="50" fontSize="8.6" textAnchor="middle" fill={c.accent} style={{ fontFamily: mono }}>handshake</text>
            </Reveal>
            <Reveal phase={phase} from={1} dy={-6}>
                <rect x="4" y="62" width="128" height="50" rx="6" fill="none" stroke={phase === 1 ? c.accent : c.line} />
                <text x="12" y="76" fontSize="9" fontWeight="700" fill={phase === 1 ? c.accent : c.ink}>metadata</text>
                <text x="12" y="89" fontSize="8.4" fill={c.ink}>{short(data.name || 'photo.jpg', 14)} · {data.pieceCount || 205} pieces</text>
                <text x="12" y="102" fontSize="8.2" fill={c.hash} style={{ fontFamily: mono }}>{hashes.slice(0, 2).join(' ')}…</text>
            </Reveal>
            <Reveal phase={phase} from={1} until={2}><Flow d="M76 23 L150 23" color={c.hash} held={held} count={1} seconds={1.2} /></Reveal>
            <Reveal phase={phase} from={2}>
                {cells.map(index => {
                    const x = 150 + (index % 4) * 18;
                    const y = 64 + Math.floor(index / 4) * 20;
                    const bad = index === 5;
                    return (
                        <g key={index} style={{ opacity: phase >= 2 ? 1 : 0, transition: 'opacity .3s', transitionDelay: `${index * 140}ms` }}>
                            <rect x={x} y={y} width="16" height="16" rx="2" fill={bad ? c.bad : AMBER} fillOpacity="0.25" stroke={bad ? c.bad : AMBER} />
                            {bad
                                ? <path d={`M${x + 4} ${y + 4} l8 8 M${x + 12} ${y + 4} l-8 8`} stroke={c.bad} strokeWidth="1.4" />
                                : <path d={`M${x + 4} ${y + 8} l3 3 l5 -6`} fill="none" stroke={c.good} strokeWidth="1.5" />}
                        </g>
                    );
                })}
                <text x="186" y="120" fontSize="8.4" textAnchor="middle" fill={c.muted}>each piece vs its hash</text>
                <text x="186" y="132" fontSize="8.4" textAnchor="middle" fill={c.bad}>bad piece: discarded</text>
            </Reveal>
            <Reveal phase={phase} from={2} until={3}><Flow d="M76 23 L150 23" color={AMBER} held={held} count={3} seconds={1.2} /></Reveal>
            <Reveal phase={phase} from={3}>
                <line x1="222" y1="23" x2="264" y2="23" stroke={c.good} strokeWidth="3" strokeOpacity="0.35" />
                <Flow d="M222 23 L264 23" color={AMBER} held={held} count={2} seconds={1} />
                <text x="300" y="58" fontSize="8.6" textAnchor="middle" fill={c.good}>good pieces</text>
                <text x="300" y="70" fontSize="8.6" textAnchor="middle" fill={c.good}>go on at once</text>
            </Reveal>
        </Svg>
    );
}

PiecesPicture.propTypes = pictureProps;

/** 9: the download stops, someone with the photo uploads it in parts, the receiver checks it. */
function CopyPicture({ phase, held, data = {} }) {
    const c = useColors();
    return (
        <Svg height={164} label="The receiver asks for a server copy; a device with the photo uploads it in 8 MB parts; the receiver downloads it and checks its fingerprint">
            <Node x={110} y={4} w={120} h={34} label="server copy" sub="photogroup.network" lit={phase === 1 || phase === 2} />
            <Node x={4} y={98} w={84} h={30} label="has the photo" size={9.5} lit={phase === 1} />
            <Node x={252} y={98} w={84} h={30} label="receiver" lit={phase === 0 || phase === 2} />
            <rect x="252" y="134" width="84" height="6" rx="3" fill={c.tint} />
            <rect x="252" y="134" width={phase >= 2 ? 84 : 34} height="6" rx="3" fill={phase >= 2 ? c.good : c.bad} style={{ transition: 'width .6s' }} />
            <Reveal phase={phase} from={0}>
                <text x="294" y="154" fontSize="8.4" textAnchor="middle" fill={phase >= 2 ? c.good : c.bad}>{phase >= 2 ? 'complete' : `stopped for ${data.stallS || 30} s`}</text>
                <Arrow x1={262} y1={96} x2={200} y2={40} color={phase === 0 ? c.accent : c.muted} />
                <text x="224" y="78" fontSize="9" textAnchor="end" fill={phase === 0 ? c.accent : c.muted} style={{ fontFamily: mono }}>request</text>
            </Reveal>
            <Reveal phase={phase} from={1}>
                <Arrow x1={60} y1={96} x2={124} y2={40} color={phase === 1 ? c.accent : c.muted} label="PUT 8 MB parts" labelDy={-10} />
            </Reveal>
            <Reveal phase={phase} from={1} until={2}><Flow d="M60 96 L124 40" color={AMBER} held={held} count={3} seconds={1.5} r={3} /></Reveal>
            <Reveal phase={phase} from={2}>
                <Arrow x1={230} y1={30} x2={312} y2={96} color={c.accent} />
                <text x="336" y="54" fontSize="8.6" textAnchor="end" fill={c.good}>fingerprint ok</text>
                <Mark x={326} y={70} ok color={c.good} />
            </Reveal>
            <Reveal phase={phase} from={2} until={3}><Flow d="M230 30 L312 96" color={GREEN} held={held} count={3} seconds={1.5} r={3} /></Reveal>
            <Reveal phase={phase} from={3} dy={6}>
                <rect x="96" y="132" width="146" height="30" rx="6" fill={c.paper} stroke={c.line} />
                <Mark x={108} y={141} ok color={c.good} r={5} />
                <text x="118" y="144" fontSize="8.4" fill={c.ink}>clips: a copy when shared</text>
                <Mark x={108} y={155} color={c.bad} r={5} />
                <text x="118" y="158" fontSize="8.4" fill={c.ink}>over {data.maxMb || 100} MB: never</text>
            </Reveal>
        </Svg>
    );
}

CopyPicture.propTypes = pictureProps;

/** 10: who sees the photo, its infohash and the addresses, row by row. */
function WhoSawPicture({ phase, data = {} }) {
    const c = useColors();
    const cols = [{ x: 168, label: 'photo' }, { x: 236, label: 'infohash, file data' }, { x: 306, label: 'IP addresses' }];
    // yes, no, copy (server copy only), lock (encrypted bytes only), off (not configured).
    const rows = [
        { label: 'devices in the room', cells: ['yes', 'yes', 'yes'], from: 0 },
        { label: 'photogroup.network', cells: ['copy', 'yes', 'yes'], from: 1 },
        { label: 'STUN', cells: ['no', 'no', 'yes'], from: 2 },
        { label: 'trackers', cells: ['no', 'yes', 'yes'], from: 2 },
        { label: 'TURN', cells: data.hasTurn === false ? ['off', 'off', 'off'] : ['lock', 'no', 'yes'], from: 3 },
    ];
    const cell = (kind, x, y, lit) => {
        if (kind === 'yes') return <Mark x={x} y={y} ok color={c.accent} r={6} />;
        if (kind === 'no') return <Mark x={x} y={y} color={c.muted} r={6} />;
        if (kind === 'lock') return <Lock x={x} y={y - 2} color={c.good} />;
        if (kind === 'off') return <text x={x} y={y + 3} fontSize="8.4" textAnchor="middle" fill={c.muted}>—</text>;
        return (
            <g>
                <circle cx={x} cy={y} r={lit ? 11 : 6} fill={c.warn} fillOpacity="0.16" stroke={c.warn} style={{ transition: 'r .35s' }} />
                <text x={x} y={y + 3} fontSize="8" fontWeight="700" textAnchor="middle" fill={c.warn}>*</text>
            </g>
        );
    };
    return (
        <Svg height={172} label="Who saw what: the devices in the room have the photo; photogroup.network only as a server copy; STUN, trackers and TURN never">
            {cols.map(col => <text key={col.label} x={col.x} y="12" fontSize="8.6" textAnchor="middle" fill={c.muted}>{col.label}</text>)}
            {rows.map((row, index) => {
                const y = 34 + index * 24;
                return (
                    <Reveal key={row.label} phase={phase} from={row.from} dx={-8}>
                        <line x1="4" y1={y + 12} x2="336" y2={y + 12} stroke={c.line} />
                        <text x="4" y={y + 3} fontSize="9.5" fontWeight={phase === row.from ? 700 : 400} fill={phase === row.from ? c.ink : c.muted}>{row.label}</text>
                        {row.cells.map((kind, col) => <g key={col}>{cell(kind, cols[col].x, y, phase === 4)}</g>)}
                    </Reveal>
                );
            })}
            <Reveal phase={phase} from={1}>
                <text x="4" y="166" fontSize="8.4" fill={phase === 4 ? c.warn : c.muted} fontWeight={phase === 4 ? 700 : 400}>* only a server copy, when P2P fails, 24 h at most</text>
            </Reveal>
        </Svg>
    );
}

WhoSawPicture.propTypes = pictureProps;

/** The fingerprint diagram, in the same shape as the other pictures. */
function FingerprintPicture({ phase, data }) {
    return <FingerprintDiagram photo={data} phase={phase} />;
}

FingerprintPicture.propTypes = pictureProps;

export const PICTURES = {
    room: RoomPicture,
    stun: StunPicture,
    fingerprint: FingerprintPicture,
    magnet: MagnetPicture,
    tracker: TrackerPicture,
    ice: IcePicture,
    turn: TurnPicture,
    pieces: PiecesPicture,
    copy: CopyPicture,
    whoSaw: WhoSawPicture,
};
