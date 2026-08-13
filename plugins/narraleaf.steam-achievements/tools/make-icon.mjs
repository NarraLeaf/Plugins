/**
 * Render the Steam Achievements plugin thumbnail: a line-art trophy, one ink
 * colour on one ground. 256x256 PNG, encoded by hand — a store thumbnail is not
 * worth pulling an image library into a plugin that otherwise builds with
 * esbuild alone.
 *
 *   node tools/make-icon.mjs icon.png [--size=64]
 *
 * **No Steam logo, and no derivative of one.** Valve's branding guidelines are
 * explicit on both counts: their marks "may not be displayed as primary or
 * prominent features on any non-Valve materials", the logo "must stand alone
 * and may not be combined with any object", and only Valve's own artwork may be
 * used — so a silhouette or knocked-out variant is further out of bounds than
 * the logo itself, not a safer middle ground. A plugin icon is the most
 * prominent brand slot there is, and this package is published by NarraLeaf.
 * The plugin's *name* says Steam, which is ordinary descriptive use of the
 * thing it integrates with, and that is where the association belongs.
 *
 * The drawing is a trophy, matching the lucide `Trophy` this plugin already
 * puts on Studio's left rail, so the store thumbnail and the in-app icon are
 * the same idea.
 *
 * The drawing is defined as strokes — segments and arcs — not as a silhouette
 * to be outlined. Deriving an outline from a solid shape sounds equivalent and
 * is not: every interior hole then has to be wider than the stroke or it fills
 * in, which is exactly what happened to the handles on the first attempt. Ink
 * is the band within half a stroke of the nearest primitive, so the weight is
 * uniform by construction and antialiasing is just the distance ramp.
 *
 * The output has to stay square, 64-512px, and under 512 KB — Studio refuses
 * the package otherwise (see scripts/lib/image.mjs in the registry root).
 */
import fs from "node:fs";
import zlib from "node:zlib";

// 256 is what ships. `--size=64` renders it at the size a store row actually
// shows, which is the only size worth judging line art at.
const sizeArg = process.argv.find(arg => arg.startsWith("--size="));
const SIZE = sizeArg ? Number.parseInt(sizeArg.slice("--size=".length), 10) : 256;
if (!Number.isInteger(SIZE) || SIZE < 64 || SIZE > 512) {
    console.error(`--size must be an integer in 64..512 (got ${SIZE})`);
    process.exit(1);
}

/** Mask resolution per output pixel, per axis. Also the antialiasing budget. */
const SS = 3;
const N = SIZE * SS;

/**
 * Stroke weight as a fraction of the icon's width, so it scales with --size.
 * Overridable to compare weights side by side; the default is the one that
 * ships. Below about 0.03 the line starts washing out at 64px, which is the
 * size that decides it.
 */
const strokeArg = process.argv.find(arg => arg.startsWith("--stroke="));
const STROKE = strokeArg ? Number.parseFloat(strokeArg.slice("--stroke=".length)) : 0.040;
if (!Number.isFinite(STROKE) || STROKE <= 0 || STROKE > 0.2) {
    console.error(`--stroke must be a fraction in (0, 0.2] (got ${STROKE})`);
    process.exit(1);
}

/* ------------------------------------------------------------------ palette */
// Two tones, no gradients: ink on ground.
const GROUND = [24, 27, 33];
const INK = [232, 236, 242];

/* ------------------------------------------------------------------ drawing */
// Normalized coords: x in [-0.5, 0.5], y in [0, 1] top-down.

const RIM = 0.245;          // rim line
const CUP_HALF = 0.170;     // half-width of the cup
const BOWL_START = 0.395;   // where the straight sides give way to the bowl
const BOWL_BOTTOM = BOWL_START + CUP_HALF;
const BASE = 0.795;

/** Distance from a point to a line segment. */
function distSegment(x, y, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - x1) * dx + (y - y1) * dy) / len2));
    return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

/**
 * Distance to a circular arc. Angles in radians, measured with y growing down,
 * and the arc runs counter-clockwise on screen from `a0` to `a1`. Points off
 * the ends fall back to the nearer endpoint, so an arc caps like a segment.
 */
function distArc(x, y, cx, cy, r, a0, a1) {
    const dx = x - cx;
    const dy = y - cy;
    let angle = Math.atan2(dy, dx);
    const TAU = Math.PI * 2;
    const norm = value => ((value % TAU) + TAU) % TAU;
    const span = norm(a1 - a0);
    if (norm(angle - a0) <= span) {
        return Math.abs(Math.hypot(dx, dy) - r);
    }
    return Math.min(
        Math.hypot(x - (cx + r * Math.cos(a0)), y - (cy + r * Math.sin(a0))),
        Math.hypot(x - (cx + r * Math.cos(a1)), y - (cy + r * Math.sin(a1))),
    );
}

/**
 * Distance to the trophy: rim, two straight cup walls, the U of the bowl, a
 * handle on each side, the stem, and a base bar with a short flare into it.
 *
 * The handles are half-rings standing off the cup wall, and the gap between
 * ring and wall is set to about two stroke widths — any tighter and the two
 * lines merge into a blob at 64px, which is the size that decides this.
 */
function distTrophy(x, y) {
    const ax = Math.abs(x);
    const HANDLE_CX = CUP_HALF + 0.062;
    const HANDLE_CY = 0.320;
    const HANDLE_R = 0.070;

    return Math.min(
        // Rim, cup walls, and the bowl's U.
        distSegment(ax, y, 0, RIM, CUP_HALF, RIM),
        distSegment(ax, y, CUP_HALF, RIM, CUP_HALF, BOWL_START),
        distArc(x, y, 0, BOWL_START, CUP_HALF, 0, Math.PI),
        // Handle: the ring's *outer* half (up -> right -> down, with y growing
        // down), plus two stubs joining it to the wall so it reads as attached
        // rather than floating. Taking the other half bulges it into the cup,
        // where it overlaps the wall and reads as a bracket.
        distArc(ax, y, HANDLE_CX, HANDLE_CY, HANDLE_R, Math.PI * 1.5, Math.PI / 2),
        distSegment(ax, y, CUP_HALF, HANDLE_CY - HANDLE_R, HANDLE_CX, HANDLE_CY - HANDLE_R),
        distSegment(ax, y, CUP_HALF, HANDLE_CY + HANDLE_R, HANDLE_CX, HANDLE_CY + HANDLE_R),
        // Stem, flared foot, base bar. The flare starts off a short flat rather
        // than a point, so it does not read as a letter A.
        distSegment(x, y, 0, BOWL_BOTTOM, 0, 0.688),
        distSegment(ax, y, 0.034, 0.688, 0.100, BASE),
        distSegment(ax, y, 0, 0.688, 0.034, 0.688),
        distSegment(ax, y, 0, BASE, 0.178, BASE),
    );
}

/** Rounded-square ground, so the thumbnail has a shape of its own in a list. */
function inCard(px, py) {
    const radius = 0.17;
    const x = Math.min(px, 1 - px);
    const y = Math.min(py, 1 - py);
    if (x >= radius || y >= radius) return true;
    const dx = radius - x;
    const dy = radius - y;
    return dx * dx + dy * dy <= radius * radius;
}

/* -------------------------------------------------------------------- ink */

const halfStroke = STROKE / 2;
/** Feather over roughly one output pixel, so the line is crisp but not jagged. */
const feather = 0.6 / SIZE;

const coverage = new Float64Array(N * N);
for (let gy = 0; gy < N; gy += 1) {
    for (let gx = 0; gx < N; gx += 1) {
        const x = (gx + 0.5) / N - 0.5;
        const y = (gy + 0.5) / N;
        const d = distTrophy(x, y);
        coverage[gy * N + gx] = Math.min(1, Math.max(0, (halfStroke - d) / feather + 0.5));
    }
}

/* -------------------------------------------------------------------- render */

function mix(a, b, t) {
    const k = Math.min(1, Math.max(0, t));
    return [
        Math.round(a[0] + (b[0] - a[0]) * k),
        Math.round(a[1] + (b[1] - a[1]) * k),
        Math.round(a[2] + (b[2] - a[2]) * k),
    ];
}

const rgba = Buffer.alloc(SIZE * SIZE * 4);
for (let py = 0; py < SIZE; py += 1) {
    for (let px = 0; px < SIZE; px += 1) {
        let ink = 0;
        let card = 0;
        for (let sy = 0; sy < SS; sy += 1) {
            for (let sx = 0; sx < SS; sx += 1) {
                const gx = px * SS + sx;
                const gy = py * SS + sy;
                const u = (gx + 0.5) / N;
                const v = (gy + 0.5) / N;
                if (!inCard(u, v)) continue;
                card += 1;
                ink += coverage[gy * N + gx];
            }
        }
        const samples = SS * SS;
        const i = (py * SIZE + px) * 4;
        if (card === 0) {
            rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0;
            continue;
        }
        const colour = mix(GROUND, INK, ink / card);
        rgba[i] = colour[0];
        rgba[i + 1] = colour[1];
        rgba[i + 2] = colour[2];
        rgba[i + 3] = Math.round((card / samples) * 255);
    }
}

/* -------------------------------------------------------------------- encode */

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    return table;
})();

function crc32(buffer) {
    let c = 0xffffffff;
    for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // colour type: RGBA
ihdr[10] = 0; // deflate
ihdr[11] = 0; // adaptive filtering
ihdr[12] = 0; // no interlace

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y += 1) {
    raw[y * (SIZE * 4 + 1)] = 0;
    rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
]);

const out = process.argv.find(arg => !arg.startsWith("--") && arg.endsWith(".png"));
if (!out) {
    console.error("Usage: node tools/make-icon.mjs <out.png> [--size=64]");
    process.exit(1);
}
fs.writeFileSync(out, png);
console.log(`wrote ${out} — ${SIZE}x${SIZE}, ${png.length} bytes`);
