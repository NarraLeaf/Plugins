/**
 * Render the Performance Inspector plugin thumbnail: a line-art gauge, one ink
 * colour on one ground. 256x256 PNG, encoded by hand — a store thumbnail is not
 * worth pulling an image library into a plugin that otherwise builds with
 * esbuild alone.
 *
 *   node tools/make-icon.mjs icon.png [--size=64] [--stroke=0.04]
 *
 * The drawing is a dial with its needle high, matching the lucide `Gauge` this
 * plugin puts on Studio's rail, so the store thumbnail and the in-app icon are
 * the same idea.
 *
 * The drawing is defined as strokes — segments and arcs — not as a silhouette to
 * be outlined. Deriving an outline from a solid shape sounds equivalent and is
 * not: every interior hole then has to be wider than the stroke or it fills in.
 * Ink is the band within half a stroke of the nearest primitive, so the weight
 * is uniform by construction and antialiasing is just the distance ramp.
 *
 * Judge it at `--size=64`. That is the size a store row actually shows, and it
 * is the size at which two lines closer than about two stroke widths merge into
 * a blob — which is what sets the gap between the ticks and the dial.
 *
 * The output has to stay square, 64-512px, and under 512 KB — Studio refuses the
 * package otherwise (see scripts/lib/image.mjs in the registry root).
 *
 * The encoder below is the same one `narraleaf.steam-achievements` uses. Kept as
 * a copy rather than shared: each plugin directory in this registry is a
 * standalone package with its own dependency tree, and reaching into a sibling
 * for a build-time helper is the one thing that arrangement exists to prevent.
 */
import fs from "node:fs";
import zlib from "node:zlib";

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
 * Below about 0.03 the line starts washing out at 64px.
 */
const strokeArg = process.argv.find(arg => arg.startsWith("--stroke="));
const STROKE = strokeArg ? Number.parseFloat(strokeArg.slice("--stroke=".length)) : 0.042;
if (!Number.isFinite(STROKE) || STROKE <= 0 || STROKE > 0.2) {
    console.error(`--stroke must be a fraction in (0, 0.2] (got ${STROKE})`);
    process.exit(1);
}

/* ------------------------------------------------------------------ palette */
// Two tones, no gradients: ink on ground.
const GROUND = [24, 27, 33];
const INK = [232, 236, 242];

/* ------------------------------------------------------------------ drawing */
// Normalized coords: x in [-0.5, 0.5], y in [0, 1] top-down. Angles are measured
// with y growing down, so 1.5*PI points at the top of the icon.

const HUB_X = 0;
const HUB_Y = 0.660;
const DIAL_R = 0.310;
/** A little past a half circle at each end, which is what makes it read as a dial. */
const DIAL_OVERSHOOT = 0.34;
const NEEDLE_R = 0.205;
/** Needle angle: up and to the right, so the dial reads as showing a high value. */
const NEEDLE_A = Math.PI * 1.78;
const TICK_INNER = DIAL_R - 0.098;
const TICK_OUTER = DIAL_R - 0.030;

/** Distance from a point to a line segment. */
function distSegment(x, y, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - x1) * dx + (y - y1) * dy) / len2));
    return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

/**
 * Distance to a circular arc. The arc runs from `a0` to `a1` in increasing
 * angle. Points off the ends fall back to the nearer endpoint, so an arc caps
 * like a segment.
 */
function distArc(x, y, cx, cy, r, a0, a1) {
    const dx = x - cx;
    const dy = y - cy;
    const angle = Math.atan2(dy, dx);
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

/** One tick: a short radial stroke inside the dial, at `angle`. */
function distTick(x, y, angle) {
    return distSegment(
        x,
        y,
        HUB_X + TICK_INNER * Math.cos(angle),
        HUB_Y + TICK_INNER * Math.sin(angle),
        HUB_X + TICK_OUTER * Math.cos(angle),
        HUB_Y + TICK_OUTER * Math.sin(angle),
    );
}

/**
 * Distance to the gauge: the dial, three ticks, the needle, and a hub.
 *
 * The hub is a filled disc rather than a ring — at 64px a ring this small closes
 * up into a blob anyway, and a disc that is meant to be solid stays legible
 * while a ring that has become one does not.
 */
function distGauge(x, y) {
    const hubDistance = Math.max(0, Math.hypot(x - HUB_X, y - HUB_Y) - 0.030);
    return Math.min(
        distArc(x, y, HUB_X, HUB_Y, DIAL_R, Math.PI - DIAL_OVERSHOOT, Math.PI * 2 + DIAL_OVERSHOOT),
        distTick(x, y, Math.PI * 1.15),
        distTick(x, y, Math.PI * 1.5),
        distTick(x, y, Math.PI * 1.85),
        distSegment(x, y, HUB_X, HUB_Y, HUB_X + NEEDLE_R * Math.cos(NEEDLE_A), HUB_Y + NEEDLE_R * Math.sin(NEEDLE_A)),
        hubDistance,
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
        const d = distGauge(x, y);
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
