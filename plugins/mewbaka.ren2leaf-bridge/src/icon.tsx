/**
 * Ren2Leaf's logo, the snake drawn as a "2" biting a leaf: `assets/logo/ren2leaf-icon.svg` in the
 * Ren2Leaf repository, the drawing its README, its web app and this plugin's `icon.png` use. Drawn
 * in the current text colour, so it follows the sidebar in light and dark themes; the eye and the
 * leaf's vein are cut out of it, as in the original.
 *
 * Same paths as the original, without its `translate(-34 -4)`: the view box is cropped to the
 * drawing instead, so it fills a 16px rail slot (the body's stroke comes out about 2.3px there).
 */

import { useId, useSyncExternalStore } from "react";
import type { BridgeStore } from "./store";
import { openQuestionCount } from "./model";

/** The drawing's bounds (x 122-462, y 111-432) in a square, centred. */
const VIEW = { x: 114, y: 93, size: 356 };

const LEAF = "M345 395 C370 340 420 318 462 316 C456 360 420 400 345 395 Z";
const BODY = "M148 200 C148 120 352 110 352 205 C352 270 220 320 150 392 L300 392";
const TAIL = "M122 200 Q126 236 136 250 Q158 236 174 200 Z";
const HEAD = "M318 392 L361.5 375.1 A48 40 0 1 0 361.5 408.9 Z";
const VEIN = "M352 391 L450 324";

/** A dot in the empty top-right corner, with a gap cut around it so it reads apart from the "2". */
const DOT = { cx: 428, cy: 135, r: 42, gap: 58 };

export function Ren2LeafMark({ size = 16, dot = false }: { size?: number; dot?: boolean }) {
    // One mask per rendered copy: the rail, the panel header and the sidebar menu each draw one.
    const mask = `ren2leaf-mark-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
    return (
        <svg width={size} height={size} viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.size} ${VIEW.size}`} aria-hidden="true">
            <defs>
                <mask id={mask} maskUnits="userSpaceOnUse" x={VIEW.x} y={VIEW.y} width={VIEW.size} height={VIEW.size}>
                    <rect x={VIEW.x} y={VIEW.y} width={VIEW.size} height={VIEW.size} fill="#fff" />
                    <path d={VEIN} stroke="#000" strokeWidth={6} strokeLinecap="round" fill="none" />
                    <circle cx={322} cy={374} r={7} fill="#000" />
                    {dot && <circle cx={DOT.cx} cy={DOT.cy} r={DOT.gap} fill="#000" />}
                </mask>
            </defs>
            <g fill="currentColor" mask={`url(#${mask})`}>
                <path d={LEAF} />
                <path d={BODY} fill="none" stroke="currentColor" strokeWidth={52} strokeLinecap="round" strokeLinejoin="round" />
                <path d={TAIL} />
                <path d={HEAD} />
            </g>
            {dot && <circle cx={DOT.cx} cy={DOT.cy} r={DOT.r} style={{ fill: "rgb(var(--nl-primary, 64 168 196))" }} />}
        </svg>
    );
}

/**
 * The rail icon: the mark, with a dot while the agent has questions waiting. Studio draws no badge
 * on a sidebar icon, so the icon draws its own; it is the one thing the author sees without opening
 * the panel.
 */
export function BridgeRailIcon({ store }: { store: BridgeStore }) {
    const open = useSyncExternalStore(store.subscribe, () => openQuestionCount(store.snapshot.decisions));
    return <Ren2LeafMark dot={open > 0} />;
}
