/**
 * Minimal deterministic ZIP writer (deflate), so packaging needs no external
 * `zip` binary and behaves identically on Windows, macOS and the CI runner.
 *
 * Timestamps are pinned to the DOS epoch (1980-01-01) so repackaging the same
 * inputs produces a byte-identical archive — a release asset can be rebuilt and
 * compared rather than trusted.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
        let c = i;
        for (let k = 0; k < 8; k += 1) {
            c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        }
        table[i] = c >>> 0;
    }
    return table;
})();

function crc32(buffer) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buffer.length; i += 1) {
        crc = CRC_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

const DOS_DATE = 0x0021; // 1980-01-01
const DOS_TIME = 0x0000;

/**
 * @param {Array<{name: string, data: Buffer}>} files archive-relative paths (forward slashes)
 * @returns {Buffer}
 */
export function createZip(files) {
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const file of files) {
        const nameBuffer = Buffer.from(file.name, "utf-8");
        const compressed = zlib.deflateRawSync(file.data, { level: 9 });
        const crc = crc32(file.data);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034B50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0, 6);
        local.writeUInt16LE(8, 8);
        local.writeUInt16LE(DOS_TIME, 10);
        local.writeUInt16LE(DOS_DATE, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(file.data.length, 22);
        local.writeUInt16LE(nameBuffer.length, 26);
        local.writeUInt16LE(0, 28);
        locals.push(local, nameBuffer, compressed);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014B50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0, 8);
        central.writeUInt16LE(8, 10);
        central.writeUInt16LE(DOS_TIME, 12);
        central.writeUInt16LE(DOS_DATE, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(file.data.length, 24);
        central.writeUInt16LE(nameBuffer.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        central.writeUInt32LE(0, 38);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, nameBuffer);

        offset += local.length + nameBuffer.length + compressed.length;
    }

    const centralBuffer = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054B50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(centralBuffer.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);

    return Buffer.concat([...locals, centralBuffer, end]);
}

/** Collect a directory tree as sorted archive entries (sorted = deterministic). */
export function collectFiles(rootDir, prefix = "") {
    const entries = [];
    for (const dirent of fs.readdirSync(rootDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const full = path.join(rootDir, dirent.name);
        const name = prefix ? `${prefix}/${dirent.name}` : dirent.name;
        if (dirent.isDirectory()) {
            entries.push(...collectFiles(full, name));
        } else if (dirent.isFile()) {
            entries.push({ name, data: fs.readFileSync(full) });
        }
    }
    return entries;
}
