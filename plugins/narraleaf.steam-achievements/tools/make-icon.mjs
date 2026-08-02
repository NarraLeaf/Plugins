/**
 * Render the Steam Achievements plugin thumbnail: a gold trophy on Steam's
 * navy, 256x256 PNG. Drawn analytically and supersampled 4x, then encoded by
 * hand — a store thumbnail is not worth pulling an image library into a plugin
 * that otherwise builds with esbuild alone.
 *
 * Committed so the icon is reproducible rather than a binary someone once made:
 *   node tools/make-icon.mjs icon.png
 *
 * The output has to stay square, 64-512px, and under 512 KB — Studio refuses
 * the package otherwise (see scripts/lib/image.mjs in the registry root).
 */
import fs from "node:fs";
import zlib from "node:zlib";

const SIZE = 256;
const SS = 4; // supersampling factor per axis

/* ------------------------------------------------------------------ palette */
const BG_TOP = [32, 45, 66];
const BG_BOTTOM = [17, 24, 36];
const GOLD_LIGHT = [247, 201, 90];
const GOLD_DARK = [199, 138, 26];
const RIBBON = [92, 126, 168];

/* -------------------------------------------------------------------- shapes */

/** Normalized coords: x in [-0.5, 0.5], y in [0, 1] top-down. */
function inCup(x, y) {
    if (y < 0.255 || y > 0.545) return false;
    const ax = Math.abs(x);
    // Rim slab.
    if (y <= 0.30) return ax <= 0.215;
    // Bowl: tapers, with the sides bowing inward slightly.
    const t = (y - 0.30) / (0.545 - 0.30);
    const half = 0.205 - 0.145 * t - 0.022 * Math.sin(Math.PI * t);
    if (ax > half) return false;
    // Round off the underside of the bowl.
    if (t > 0.82) {
        const k = (t - 0.82) / 0.18;
        return ax <= half * Math.sqrt(Math.max(0, 1 - k * k));
    }
    return true;
}

function inHandle(x, y) {
    const ax = Math.abs(x);
    const cx = 0.208;
    const cy = 0.345;
    const dx = ax - cx;
    const dy = y - cy;
    const r = Math.hypot(dx, dy * 1.15);
    // Outer half of a ring only, so it reads as a handle and not a circle.
    return r >= 0.072 && r <= 0.106 && dx > -0.03;
}

function inStem(x, y) {
    if (y < 0.545 || y > 0.665) return false;
    const t = (y - 0.545) / 0.12;
    return Math.abs(x) <= 0.035 + 0.022 * t * t;
}

function inBase(x, y) {
    const ax = Math.abs(x);
    if (y >= 0.665 && y <= 0.725) {
        const t = (y - 0.665) / 0.06;
        return ax <= 0.070 + 0.075 * t;
    }
    // Plinth.
    if (y > 0.725 && y <= 0.775) return ax <= 0.175;
    return false;
}

function inTrophy(x, y) {
    return inCup(x, y) || inHandle(x, y) || inStem(x, y) || inBase(x, y);
}

/** A small star struck on the cup — the "achievement" half of the idea. */
function inStar(x, y) {
    const cx = 0;
    const cy = 0.375;
    const dx = x - cx;
    const dy = (y - cy) * 1.0;
    const r = Math.hypot(dx, dy);
    if (r > 0.085) return false;
    let angle = Math.atan2(dy, dx) + Math.PI / 2;
    const spoke = Math.PI * 2 / 5;
    angle = ((angle % spoke) + spoke) % spoke;
    const half = spoke / 2;
    const edge = 0.084 * 0.382 / Math.cos(Math.min(angle, spoke - angle) - half + half);
    // Classic 5-point star: radius oscillates between outer and inner.
    const k = Math.abs(angle - half) / half;
    const radius = 0.034 + (0.085 - 0.034) * k * k;
    void edge;
    return r <= radius;
}

/** Rounded-square mask so the thumbnail has a shape of its own in a list. */
function inCard(px, py) {
    const radius = 0.16;
    const x = Math.min(px, 1 - px);
    const y = Math.min(py, 1 - py);
    if (x >= radius || y >= radius) return true;
    const dx = radius - x;
    const dy = radius - y;
    return dx * dx + dy * dy <= radius * radius;
}

function mix(a, b, t) {
    return [
        Math.round(a[0] + (b[0] - a[0]) * t),
        Math.round(a[1] + (b[1] - a[1]) * t),
        Math.round(a[2] + (b[2] - a[2]) * t),
    ];
}

/* -------------------------------------------------------------------- render */

const rgba = Buffer.alloc(SIZE * SIZE * 4);
for (let py = 0; py < SIZE; py += 1) {
    for (let px = 0; px < SIZE; px += 1) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let sy = 0; sy < SS; sy += 1) {
            for (let sx = 0; sx < SS; sx += 1) {
                const u = (px + (sx + 0.5) / SS) / SIZE;
                const v = (py + (sy + 0.5) / SS) / SIZE;
                if (!inCard(u, v)) continue;
                const x = u - 0.5;
                const y = v;

                let colour = mix(BG_TOP, BG_BOTTOM, v);
                // A faint ribbon behind the trophy, for depth.
                if (Math.abs(y - 0.80) < 0.045 && Math.abs(x) < 0.34) {
                    colour = mix(colour, RIBBON, 0.35);
                }
                if (inTrophy(x, y)) {
                    const shade = Math.min(1, Math.max(0, (y - 0.24) / 0.5));
                    colour = mix(GOLD_LIGHT, GOLD_DARK, shade);
                    // Specular hint on the left of the bowl. Falls off in both
                    // axes — a hard-edged band reads as a drawing mistake at
                    // thumbnail size, which is the only size this is ever seen.
                    if (inCup(x, y)) {
                        const fx = 1 - Math.min(1, Math.abs(x + 0.105) / 0.055);
                        const fy = 1 - Math.min(1, Math.abs(y - 0.355) / 0.085);
                        const glare = Math.max(0, fx) * Math.max(0, fy);
                        if (glare > 0) {
                            colour = mix(colour, [255, 243, 210], 0.5 * glare * glare);
                        }
                    }
                    if (inStar(x, y)) {
                        colour = mix(BG_BOTTOM, [10, 14, 22], 0.5);
                    }
                }
                r += colour[0]; g += colour[1]; b += colour[2]; a += 255;
            }
        }
        const samples = SS * SS;
        const i = (py * SIZE + px) * 4;
        // Premultiplied average would darken the edge against the card mask, so
        // colour is averaged over covered samples only.
        const covered = a / 255;
        rgba[i] = covered ? Math.round(r / covered) : 0;
        rgba[i + 1] = covered ? Math.round(g / covered) : 0;
        rgba[i + 2] = covered ? Math.round(b / covered) : 0;
        rgba[i + 3] = Math.round(a / samples);
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
ihdr[8] = 8;      // bit depth
ihdr[9] = 6;      // colour type: RGBA
ihdr[10] = 0;     // deflate
ihdr[11] = 0;     // adaptive filtering
ihdr[12] = 0;     // no interlace

// One filter byte per scanline; filter 0 (None) keeps the encoder honest and
// zlib still compresses the large flat areas well.
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

const out = process.argv[2];
fs.writeFileSync(out, png);
console.log(`wrote ${out} — ${SIZE}x${SIZE}, ${png.length} bytes`);
