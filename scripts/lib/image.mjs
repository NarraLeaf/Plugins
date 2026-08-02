/**
 * Icon rules and a header-only image reader.
 *
 * Port of Studio's src/shared/constants/pluginIcon.ts + src/shared/utils/
 * {imageDimensions,pluginIcon}.ts. Same contract as the manifest validator next
 * door: if that file changes, this one must change with it, or CI accepts an
 * icon Studio refuses at install.
 *
 * Header-only is deliberate — nothing here decodes an image, it reads a bounded
 * prefix of structure and reports what the bytes actually are, which is how a
 * `.png` that is really something else gets caught.
 */

/** Raster only. `svg` is a document that can carry script; `gif` animates a list row. */
export const PLUGIN_ICON_EXTENSIONS = ["png", "webp", "jpg", "jpeg"];
export const PLUGIN_ICON_MAX_DIMENSION = 512;
export const PLUGIN_ICON_MIN_DIMENSION = 64;
export const PLUGIN_ICON_MAX_BYTES = 512 * 1024;

const FORMAT_OF_EXTENSION = { png: "png", webp: "webp", jpg: "jpeg", jpeg: "jpeg" };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The declared extension of an icon path, lowercased, or null if not allowed. */
export function pluginIconExtension(iconPath) {
    const dot = typeof iconPath === "string" ? iconPath.lastIndexOf(".") : -1;
    if (dot < 0) {
        return null;
    }
    const extension = iconPath.slice(dot + 1).toLowerCase();
    return PLUGIN_ICON_EXTENSIONS.includes(extension) ? extension : null;
}

export function pluginIconExtensionList() {
    return PLUGIN_ICON_EXTENSIONS.map(extension => `.${extension}`).join(", ");
}

/** `{ format, width, height }`, or null when the bytes are not a readable image. */
export function readImageDimensions(bytes) {
    return readPng(bytes) ?? readJpeg(bytes) ?? readWebp(bytes);
}

/** An error message describing why these bytes are not a shippable icon, or null. */
export function validatePluginIconBytes(bytes, iconPath) {
    const extension = pluginIconExtension(iconPath);
    if (!extension) {
        return `icon must be one of: ${pluginIconExtensionList()}`;
    }
    if (bytes.length > PLUGIN_ICON_MAX_BYTES) {
        return `icon must be at most ${Math.floor(PLUGIN_ICON_MAX_BYTES / 1024)} KB (got ${Math.ceil(bytes.length / 1024)} KB)`;
    }
    const probe = readImageDimensions(bytes);
    if (!probe) {
        return `icon "${iconPath}" is not a readable ${extension.toUpperCase()} image`;
    }
    if (probe.format !== FORMAT_OF_EXTENSION[extension]) {
        return `icon "${iconPath}" is a ${probe.format.toUpperCase()} file with a .${extension} name`;
    }
    if (probe.width !== probe.height) {
        return `icon must be square (got ${probe.width}x${probe.height})`;
    }
    if (probe.width > PLUGIN_ICON_MAX_DIMENSION) {
        return `icon must be at most ${PLUGIN_ICON_MAX_DIMENSION}x${PLUGIN_ICON_MAX_DIMENSION} (got ${probe.width}x${probe.height})`;
    }
    if (probe.width < PLUGIN_ICON_MIN_DIMENSION) {
        return `icon must be at least ${PLUGIN_ICON_MIN_DIMENSION}x${PLUGIN_ICON_MIN_DIMENSION} (got ${probe.width}x${probe.height})`;
    }
    return null;
}

function ascii(bytes, offset, length) {
    if (offset + length > bytes.length) {
        return "";
    }
    let out = "";
    for (let i = 0; i < length; i += 1) {
        out += String.fromCharCode(bytes[offset + i]);
    }
    return out;
}

function be32(bytes, offset) {
    return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function be16(bytes, offset) {
    return (bytes[offset] << 8) | bytes[offset + 1];
}

function le16(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
}

/** IHDR is walked to, not assumed first: tools do emit a chunk ahead of it. */
function readPng(bytes) {
    if (bytes.length < 24 || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
        return null;
    }
    let offset = 8;
    while (offset + 8 <= bytes.length) {
        const length = be32(bytes, offset);
        if (ascii(bytes, offset + 4, 4) === "IHDR") {
            if (offset + 16 > bytes.length) {
                return null;
            }
            return { format: "png", width: be32(bytes, offset + 8), height: be32(bytes, offset + 12) };
        }
        // length + the 4-byte length field + the 4-byte type + the 4-byte CRC.
        offset += length + 12;
    }
    return null;
}

/** Start-of-frame markers. C4/C8/CC share the range but are tables, not frames. */
function isStartOfFrame(marker) {
    return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function readJpeg(bytes) {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
        return null;
    }
    let offset = 2;
    while (offset + 4 <= bytes.length) {
        if (bytes[offset] !== 0xff) {
            offset += 1;
            continue;
        }
        let marker = bytes[offset + 1];
        while (marker === 0xff && offset + 2 < bytes.length) {
            offset += 1;
            marker = bytes[offset + 1];
        }
        offset += 2;
        if (marker === 0xd9) {
            return null;
        }
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
            continue;
        }
        if (offset + 2 > bytes.length) {
            return null;
        }
        if (isStartOfFrame(marker)) {
            // length(2) precision(1) height(2) width(2)
            if (offset + 7 > bytes.length) {
                return null;
            }
            return { format: "jpeg", height: be16(bytes, offset + 3), width: be16(bytes, offset + 5) };
        }
        const segmentLength = be16(bytes, offset);
        if (segmentLength < 2) {
            return null;
        }
        offset += segmentLength;
    }
    return null;
}

function readWebp(bytes) {
    if (bytes.length < 30 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") {
        return null;
    }
    const chunk = ascii(bytes, 12, 4);
    const payload = 20;

    if (chunk === "VP8X") {
        const width = (bytes[payload + 4] | (bytes[payload + 5] << 8) | (bytes[payload + 6] << 16)) + 1;
        const height = (bytes[payload + 7] | (bytes[payload + 8] << 8) | (bytes[payload + 9] << 16)) + 1;
        return { format: "webp", width, height };
    }
    if (chunk === "VP8 ") {
        if (bytes[payload + 3] !== 0x9d || bytes[payload + 4] !== 0x01 || bytes[payload + 5] !== 0x2a) {
            return null;
        }
        return {
            format: "webp",
            width: le16(bytes, payload + 6) & 0x3fff,
            height: le16(bytes, payload + 8) & 0x3fff,
        };
    }
    if (chunk === "VP8L") {
        if (bytes[payload] !== 0x2f) {
            return null;
        }
        const bits = (bytes[payload + 1] | (bytes[payload + 2] << 8) | (bytes[payload + 3] << 16) | (bytes[payload + 4] << 24)) >>> 0;
        return {
            format: "webp",
            width: (bits & 0x3fff) + 1,
            height: ((bits >>> 14) & 0x3fff) + 1,
        };
    }
    return null;
}
