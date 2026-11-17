import React from 'react';
import PropTypes from 'prop-types';
import { useTheme } from '@mui/material/styles';

// Small SVG parts the tour's step pictures share. A picture shows one phase
// after the other from the tour player's progress, so Hold and the speed
// buttons work on it too. Parts move only opacity and transform; the dots
// that run along a line use a CSS animation that Hold pauses and that
// prefers-reduced-motion turns off.

export const FADE = 'opacity .35s ease, transform .35s ease';
export const mono = 'var(--font-mono, ui-monospace, monospace)';

/** Which of `count` phases a step's progress (0..1) is in. */
export const phaseAt = (progress, count) => Math.max(0, Math.min(count - 1, Math.floor((progress || 0) * count)));

/** The theme's colors, named for what they mean in a picture. */
export function useColors() {
    const { palette } = useTheme();
    return {
        good: palette.success.main,
        bad: palette.error.main,
        warn: palette.warning.main,
        ink: palette.text.primary,
        muted: palette.text.secondary,
        line: palette.divider,
        accent: palette.primary.main,
        hash: palette.secondary.main,
        paper: palette.background.paper,
        tint: palette.action.hover,
    };
}

/** Shows `children` from phase `from` on (and, with `until`, before phase `until`), sliding in from dx/dy. */
export function Reveal({ phase, from, until, dx = 0, dy = 0, delay = 0, children }) {
    const shown = phase >= from && (until === undefined || phase < until);
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
    phase: PropTypes.number.isRequired, from: PropTypes.number.isRequired, until: PropTypes.number,
    dx: PropTypes.number, dy: PropTypes.number, delay: PropTypes.number, children: PropTypes.node,
};

/** A labelled box. `lit` draws it in the accent color, `dashed` as absent or an example. */
export function Node({ x, y, w, h = 30, label, sub, color, lit, dashed, fill, size = 10 }) {
    const c = useColors();
    const stroke = color || (lit ? c.accent : c.muted);
    return (
        <g>
            <rect x={x} y={y} width={w} height={h} rx="6" fill={fill || (lit ? stroke : 'none')} fillOpacity={fill ? 1 : 0.12}
                stroke={stroke} strokeWidth={lit ? 1.8 : 1.2} strokeDasharray={dashed ? '4 3' : undefined} />
            <text x={x + w / 2} y={y + (sub ? h / 2 - 1 : h / 2 + size * 0.35)} fontSize={size} fontWeight="700" textAnchor="middle" fill={lit ? stroke : c.ink}>{label}</text>
            {sub && <text x={x + w / 2} y={y + h / 2 + 10} fontSize={size - 1.6} textAnchor="middle" fill={c.muted} style={{ fontFamily: mono }}>{sub}</text>}
        </g>
    );
}

Node.propTypes = {
    x: PropTypes.number.isRequired, y: PropTypes.number.isRequired, w: PropTypes.number.isRequired, h: PropTypes.number,
    label: PropTypes.node, sub: PropTypes.node, color: PropTypes.string, lit: PropTypes.bool, dashed: PropTypes.bool,
    fill: PropTypes.string, size: PropTypes.number,
};

/** A straight arrow from (x1,y1) to (x2,y2), with an optional label above its middle. */
export function Arrow({ x1, y1, x2, y2, color, label, dashed, width = 1.5, labelDy = -5, size = 9, both }) {
    const c = useColors();
    const stroke = color || c.muted;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = (x, y, a) => `M${x - 6 * Math.cos(a - 0.45)} ${y - 6 * Math.sin(a - 0.45)} L${x} ${y} L${x - 6 * Math.cos(a + 0.45)} ${y - 6 * Math.sin(a + 0.45)}`;
    return (
        <g>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={width} strokeDasharray={dashed ? '4 3' : undefined} />
            <path d={head(x2, y2, angle)} fill="none" stroke={stroke} strokeWidth={width} strokeLinejoin="round" />
            {both && <path d={head(x1, y1, angle + Math.PI)} fill="none" stroke={stroke} strokeWidth={width} strokeLinejoin="round" />}
            {label && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 + labelDy} fontSize={size} textAnchor="middle" fill={stroke} style={{ fontFamily: mono }}>{label}</text>}
        </g>
    );
}

Arrow.propTypes = {
    x1: PropTypes.number, y1: PropTypes.number, x2: PropTypes.number, y2: PropTypes.number, color: PropTypes.string,
    label: PropTypes.node, dashed: PropTypes.bool, width: PropTypes.number, labelDy: PropTypes.number, size: PropTypes.number, both: PropTypes.bool,
};

/** Dots that run along a path, over and over, while the step plays. */
export function Flow({ d, color, count = 3, seconds = 1.6, r = 3.5, held }) {
    return Array.from({ length: count }, (_, index) => (
        <circle key={index} r={r} fill={color} className="pg-flow" style={{
            offsetPath: `path('${d}')`,
            animation: `pgFlow ${seconds}s ${(index * seconds) / count}s linear infinite`,
            animationPlayState: held ? 'paused' : 'running',
        }} />
    ));
}

Flow.propTypes = { d: PropTypes.string.isRequired, color: PropTypes.string, count: PropTypes.number, seconds: PropTypes.number, r: PropTypes.number, held: PropTypes.bool };

/** A small padlock: encrypted. */
export function Lock({ x, y, color, size = 1 }) {
    return (
        <g transform={`translate(${x} ${y}) scale(${size})`}>
            <path d="M-3.5 -1 v-2.5 a3.5 3.5 0 0 1 7 0 v2.5" fill="none" stroke={color} strokeWidth="1.5" />
            <rect x="-5" y="-1" width="10" height="8" rx="1.5" fill={color} />
        </g>
    );
}

Lock.propTypes = { x: PropTypes.number, y: PropTypes.number, color: PropTypes.string, size: PropTypes.number };

/** ✓ or ✗ in a circle. */
export function Mark({ x, y, ok, color, r = 7 }) {
    return (
        <g>
            <circle cx={x} cy={y} r={r} fill={color} fillOpacity="0.16" stroke={color} strokeWidth="1.2" />
            {ok
                ? <path d={`M${x - 3} ${y} l2.2 2.4 l4 -4.6`} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                : <path d={`M${x - 2.8} ${y - 2.8} l5.6 5.6 M${x + 2.8} ${y - 2.8} l-5.6 5.6`} stroke={color} strokeWidth="1.6" strokeLinecap="round" />}
        </g>
    );
}

Mark.propTypes = { x: PropTypes.number, y: PropTypes.number, ok: PropTypes.bool, color: PropTypes.string, r: PropTypes.number };

/** The photo as a small file icon. */
export function PhotoIcon({ x, y, w = 26, h = 32, color, placeholder }) {
    const c = useColors();
    const stroke = color || c.muted;
    return (
        <g>
            <rect x={x} y={y} width={w} height={h} rx="3" fill={placeholder ? 'none' : c.tint} stroke={stroke} strokeWidth="1.3" strokeDasharray={placeholder ? '3 2' : undefined} />
            {!placeholder && (
                <>
                    <circle cx={x + w * 0.32} cy={y + h * 0.3} r={w * 0.11} fill="#f5b942" />
                    <path d={`M${x + 3} ${y + h - 3} l${w * 0.3} ${-h * 0.36} l${w * 0.2} ${h * 0.18} l${w * 0.16} ${-h * 0.12} l${w * 0.22} ${h * 0.3} z`} fill={stroke} opacity="0.55" />
                </>
            )}
        </g>
    );
}

PhotoIcon.propTypes = { x: PropTypes.number, y: PropTypes.number, w: PropTypes.number, h: PropTypes.number, color: PropTypes.string, placeholder: PropTypes.bool };
