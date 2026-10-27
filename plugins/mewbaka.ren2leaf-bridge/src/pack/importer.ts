/**
 * Reading a pack folder the author picked. Studio keeps its native picker to itself
 * (`privileged.fs.selectFile` refuses every plugin), so the panel uses the browser's folder input,
 * which opens the same system dialog and hands over the files themselves - no path, and no
 * filesystem permission to ask for.
 */

import type { ImageKind } from "../types";
import type { RawPack } from "./build";
import { PackError } from "./build";

/**
 * The picked files, relative to the folder that holds README.md. The author may pick the pack
 * itself or a folder above it; the shallowest README.md decides.
 */
export function packFiles(files: ArrayLike<File>): { folder: string; files: Map<string, File> } {
    const all = Array.from(files, file => ({ file, segments: (file.webkitRelativePath || file.name).split("/") }));
    const readme = all
        .filter(entry => entry.segments[entry.segments.length - 1] === "README.md")
        .sort((a, b) => a.segments.length - b.segments.length)[0];
    if (!readme) {
        throw new PackError("No README.md in the picked folder. Pick the folder Ren2Leaf exported (it holds README.md, data/ and screens/).");
    }
    const depth = readme.segments.length - 1;
    const prefix = readme.segments.slice(0, depth).join("/");
    const out = new Map<string, File>();
    for (const entry of all) {
        if (entry.segments.length <= depth || entry.segments.slice(0, depth).join("/") !== prefix) continue;
        out.set(entry.segments.slice(depth).join("/"), entry.file);
    }
    return { folder: readme.segments[depth - 1] ?? "", files: out };
}

async function readJson(files: Map<string, File>, path: string, required: boolean): Promise<unknown> {
    const file = files.get(path);
    if (!file) {
        if (required) throw new PackError(`The pack has no ${path}.`);
        return null;
    }
    try {
        return JSON.parse(await file.text());
    } catch {
        throw new PackError(`${path} is not valid JSON.`);
    }
}

export async function readPack(folder: string, files: Map<string, File>): Promise<RawPack> {
    const readme = await files.get("README.md")!.text();
    const inventory = await readJson(files, "data/inventory.json", true);
    const speakers = await readJson(files, "data/speakers.json", false);
    const chapters = await readJson(files, "data/chapters.json", false);

    const elements: RawPack["elements"] = [];
    for (const path of files.keys()) {
        const match = /^data\/screens\/([^/]+\.elements\.json)$/.exec(path);
        if (!match) continue;
        const json = await readJson(files, path, false);
        if (json !== null) elements.push({ fileName: match[1]!, json });
    }
    return { sourcePath: folder, readme, inventory, speakers, chapters, elements };
}

/**
 * How each kind of picture is stored. Screenshots are 1920 wide and over 1 MB each as PNG, so they
 * become JPEG; crops and portraits are smaller and may be cut out, so they stay PNG.
 */
const STORED: Record<ImageKind, { edge: number; type: "image/jpeg" | "image/png" }> = {
    screenshot: { edge: 1280, type: "image/jpeg" },
    crop: { edge: 1024, type: "image/png" },
    portrait: { edge: 1024, type: "image/png" },
};

/** A picture scaled down for storage, base64; null when the browser cannot decode it. */
export async function shrinkImage(file: File, kind: ImageKind): Promise<{ mimeType: "image/png" | "image/jpeg"; data: string } | null> {
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        return null;
    }
    const { edge, type } = STORED[kind];
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await canvas.convertToBlob(type === "image/jpeg" ? { type, quality: 0.85 } : { type });
    return { mimeType: type, data: toBase64(new Uint8Array(await blob.arrayBuffer())) };
}

export function toBase64(bytes: Uint8Array): string {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}
