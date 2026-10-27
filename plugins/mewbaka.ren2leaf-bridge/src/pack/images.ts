/**
 * Which pictures of a pack the plugin keeps. Pure: the importer passes the paths it was handed,
 * so the choice runs in a unit test.
 */

import type { ImageKind, ShotIndexEntry } from "../types";

export type PackImage = { path: string; kind: ImageKind; label: string };

const PICTURE = /\.(png|jpe?g|webp)$/i;
/** How Ren2Leaf lists a crop under its capture in section 6: `- 切图 <label>：[<path>](<path>)（x, y, w, h）`. */
const CROP_LINE = /^- 切图 (.+?)：\[([^\]]+)\]\(/;

/**
 * The captures, the crops cut from them and the speaker portraits, by their path in the pack.
 * Anything else in `screens/` counts as a crop, so a crop the README does not list is still kept.
 */
export function packImages(readme: string, shots: ShotIndexEntry[], paths: Iterable<string>): PackImage[] {
    const present = new Set(paths);
    const out = new Map<string, PackImage>();
    for (const shot of shots) {
        if (present.has(shot.image)) out.set(shot.image, { path: shot.image, kind: "screenshot", label: shot.label });
    }
    for (const line of readme.split("\n")) {
        const match = CROP_LINE.exec(line.trim());
        if (match && present.has(match[2]!) && !out.has(match[2]!)) {
            out.set(match[2]!, { path: match[2]!, kind: "crop", label: match[1]! });
        }
    }
    for (const path of present) {
        if (out.has(path) || !PICTURE.test(path)) continue;
        const portrait = /^characters\/([^/]+)\.[a-z]+$/i.exec(path);
        if (portrait) out.set(path, { path, kind: "portrait", label: portrait[1]! });
        else if (/^screens\/[^/]+$/.test(path)) out.set(path, { path, kind: "crop", label: path.slice("screens/".length).replace(PICTURE, "") });
    }
    return [...out.values()];
}
