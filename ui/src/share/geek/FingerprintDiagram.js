import React from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';

import { TX } from './traffic';
import { EXAMPLE_PHOTO } from './tour';

// The tour's fingerprint step as a picture: the photo, cut into pieces, a
// SHA-1 hash per piece, the list of these hashes and its own SHA-1 (the
// infohash), then the separate fingerprint. Everything sits inside one frame,
// because none of it has left the device yet. It is drawn by phase from the
// tour player's progress, so Hold and the speed buttons work on it too, and
// it moves only opacity and transform (no layout, no timers of its own).

export const PHASES = 5;
const FADE = 'opacity .35s ease, transform .35s ease';
const mono = 'var(--font-mono, ui-monospace, monospace)';

/** Which phase a step's progress (0..1) is in. */
export const phaseAt = progress => Math.max(0, Math.min(PHASES - 1, Math.floor((progress || 0) * PHASES)));

const shortHash = hash => (hash.length > 26 ? `${hash.slice(0, 16)}…${hash.slice(-8)}` : hash);
const shortName = name => (name.length > 12 ? `${name.slice(0, 5)}…${name.slice(-6)}` : name);
const sizeText = bytes => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} kB`);

/** Shows `children` from phase `from` on, sliding in from `dx`. */
function Reveal({ phase, from, dx = 0, dy = 0, delay = 0, children }) {
    const shown = phase >= from;
    return (
        <g style={{
            opacity: shown ? 1 : 0,
            transform: shown ? 'none' : `translate(${dx}px, ${dy}px)`,
            transition: FADE,
            transitionDelay: shown ? `${delay}ms` : '0ms',
        }}>
            {children}
        </g>
    );
}

Reveal.propTypes = {
    phase: PropTypes.number.isRequired, from: PropTypes.number.isRequired,
    dx: PropTypes.number, dy: PropTypes.number, delay: PropTypes.number, children: PropTypes.node,
};

/** Rows the diagram draws for the pieces: up to four, with "⋮" before the last of many. */
function pieceRows(photo) {
    const hashes = photo.pieceHashes || [];
    const many = photo.pieceCount > hashes.length;
    const ys = many ? [52, 72, 92, 120] : [52, 72, 92, 112];
    return hashes.map((hash, index) => ({
        hash,
        y: ys[index],
        number: many && index === hashes.length - 1 ? photo.pieceCount : index + 1,
    }));
}

export default function FingerprintDiagram({ photo = EXAMPLE_PHOTO, phase }) {
    const theme = useTheme();
    const { palette } = theme;
    const good = palette.success.main;
    const ink = palette.text.primary;
    const muted = palette.text.secondary;
    const line = palette.divider;
    const accent = palette.primary.main;
    const hashInk = palette.secondary.main;
    const piece = `rgb(${TX})`;
    const rows = pieceRows(photo);
    const many = photo.pieceCount > rows.length;
    const named = phase >= 3;
    const label = photo.example ? 'example' : 'your photo';

    return (
        <Box
            data-testid="fingerprint-diagram"
            data-phase={phase}
            sx={{
                mt: 0.5, mb: 0.75, width: '100%', maxWidth: 420,
                '@media (prefers-reduced-motion: reduce)': { '& g': { transition: 'none !important' } },
            }}
        >
            <svg viewBox="0 0 340 196" width="100%" role="img"
                aria-label={`On your device only. ${label}: ${photo.name}, ${sizeText(photo.length)}, ${photo.pieceCount} pieces, infohash ${photo.infoHash}`}
                style={{ display: 'block', overflow: 'visible', fontFamily: 'inherit' }}>
                {/* Everything here stays on this device. */}
                <rect x="1" y="18" width="338" height="176" rx="10" fill="none" stroke={good} strokeWidth="1.5" strokeDasharray="5 4" />
                <rect x="10" y="10" width="138" height="16" rx="8" fill={palette.background.paper} />
                <text x="16" y="22" fontSize="9.5" fontWeight="700" letterSpacing="0.06em" fill={good} style={{ fontFamily: mono }}>ON YOUR DEVICE ONLY</text>
                <rect x="262" y="10" width="72" height="16" rx="8" fill={palette.background.paper} />
                <text x="328" y="22" fontSize="9" textAnchor="end" fill={muted}>{label}</text>

                {/* The photo. */}
                <g>
                    <path d="M14 42 h38 l14 14 v52 h-52 z" fill={palette.action.hover} stroke={muted} strokeWidth="1.5" strokeLinejoin="round" />
                    <path d="M52 42 v14 h14" fill="none" stroke={muted} strokeWidth="1.5" strokeLinejoin="round" />
                    <circle cx="28" cy="66" r="5" fill={piece} />
                    <path d="M18 104 l14 -18 l9 10 l8 -8 l13 16 z" fill={muted} opacity="0.55" />
                    <text x="40" y="122" fontSize="9.5" textAnchor="middle" fill={ink}>{shortName(photo.name)}</text>
                    <text x="40" y="134" fontSize="9" textAnchor="middle" fill={muted}>{sizeText(photo.length)}</text>
                </g>

                {/* 1: cut into pieces. */}
                <text x="118" y="38" fontSize="9" textAnchor="middle" fill={phase === 0 ? ink : muted}>
                    {`${photo.pieceCount} ${photo.pieceCount === 1 ? 'piece' : 'pieces'}`}
                </text>
                {rows.map((row, index) => (
                    <Reveal key={`p${index}`} phase={phase} from={0} dx={-44} delay={index * 120}>
                        <rect x="94" y={row.y - 8} width="48" height="16" rx="3" fill={`rgba(${TX},0.22)`} stroke={piece} strokeWidth="1.2" />
                        <text x="118" y={row.y + 3.5} fontSize="9" textAnchor="middle" fill={ink} style={{ fontFamily: mono }}>#{row.number}</text>
                    </Reveal>
                ))}
                {many && (
                    <Reveal phase={phase} from={0} delay={360}>
                        <text x="118" y="110" fontSize="11" textAnchor="middle" fill={muted}>⋮</text>
                    </Reveal>
                )}

                {/* 2: a SHA-1 hash per piece. */}
                <Reveal phase={phase} from={1}>
                    <text x="182" y="38" fontSize="9" textAnchor="middle" fill={phase === 1 ? ink : muted}>SHA-1 each</text>
                </Reveal>
                {rows.map((row, index) => (
                    <Reveal key={`h${index}`} phase={phase} from={1} dx={-10} delay={index * 120}>
                        <line x1="144" y1={row.y} x2="152" y2={row.y} stroke={line} strokeWidth="1.2" />
                        <rect x="153" y={row.y - 8} width="58" height="16" rx="3" fill="none" stroke={hashInk} strokeWidth="1" opacity="0.6" />
                        <text x="182" y={row.y + 3.5} fontSize="8.5" textAnchor="middle" fill={hashInk} style={{ fontFamily: mono }}>{row.hash}…</text>
                    </Reveal>
                ))}

                {/* 3: the hashes go in one list; its SHA-1 is the infohash. */}
                <Reveal phase={phase} from={2} dx={-8}>
                    {rows.map((row, index) => (
                        <path key={`c${index}`} d={`M212 ${row.y} C222 ${row.y} 222 103 230 103`} fill="none" stroke={line} strokeWidth="1.2" />
                    ))}
                    <rect x="230" y="42" width="102" height="76" rx="6" fill="none" stroke={muted} strokeWidth="1.2" />
                    <text x="281" y="38" fontSize="9" textAnchor="middle" fill={phase === 2 ? ink : muted}>one list</text>
                    {['name', 'size', 'piece size', 'piece hashes'].map((item, index) => (
                        <text key={item} x="238" y={58 + index * 15} fontSize="9" fill={index === 3 ? hashInk : ink}>{item}</text>
                    ))}
                    <line x1="281" y1="118" x2="281" y2="140" stroke={accent} strokeWidth="1.5" />
                    <path d="M276 135 l5 6 l5 -6" fill="none" stroke={accent} strokeWidth="1.5" />
                    <text x="288" y="133" fontSize="9" fontWeight="700" fill={accent}>SHA-1</text>
                    <rect x="94" y="144" width="238" height="22" rx="5" fill={named ? accent : 'none'} fillOpacity="0.14"
                        stroke={accent} strokeWidth={named ? 2 : 1.2} style={{ transition: 'stroke-width .35s' }} />
                    <text x="101" y="158.5" fontSize="9" fontWeight="700" fill={accent}>infohash</text>
                    <text x="148" y="158.5" fontSize="8.4" fill={ink} style={{ fontFamily: mono }}>{shortHash(photo.infoHash)}</text>
                </Reveal>

                {/* 4: the infohash is the photo's name on the network. */}
                <Reveal phase={phase} from={3} dy={-4}>
                    <text x="213" y="182" fontSize="9.5" fontWeight="700" textAnchor="middle" fill={accent}>= the name of the photo on the network</text>
                </Reveal>

                {/* 5: the separate fingerprint, straight from the file. */}
                <Reveal phase={phase} from={4} dy={-6}>
                    <line x1="40" y1="138" x2="40" y2="144" stroke={line} strokeWidth="1.2" strokeDasharray="2 2" />
                    <rect x="8" y="144" width="78" height="38" rx="5" fill="none" stroke={good} strokeWidth="1.5" />
                    <text x="47" y="158" fontSize="9" fontWeight="700" textAnchor="middle" fill={good}>fingerprint</text>
                    <text x="47" y="172" fontSize="8.4" textAnchor="middle" fill={muted} style={{ fontFamily: mono }}>size + SHA-256</text>
                </Reveal>
            </svg>
        </Box>
    );
}

FingerprintDiagram.propTypes = {
    photo: PropTypes.object,
    phase: PropTypes.number.isRequired,
};
