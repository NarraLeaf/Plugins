/**
 * Things the author does from the panel that touch several stores at once.
 */

import { buildPack } from "./pack/build";
import { packImages } from "./pack/images";
import { packFiles, readPack, shrinkImage } from "./pack/importer";
import type { BridgeStore } from "./store";
import type { ImagesStore } from "./types";

/** Above this the inventory still goes into the project, but the author is told. */
export const LARGE_INVENTORY_BYTES = 5 * 1024 * 1024;

export type ImportOutcome = {
    game: string;
    sections: number;
    shots: number;
    speakerDecisions: number;
    inventoryBytes: number;
};

/**
 * Import (or re-import) a pack from the files of a picked folder. Replaces the pack namespaces and
 * the migrator's decisions; leaves the checklist, the agent's decisions, issues, log and line
 * records alone.
 */
export async function importPack(store: BridgeStore, picked: ArrayLike<File>): Promise<ImportOutcome> {
    const { folder, files } = packFiles(picked);
    const built = buildPack(await readPack(folder, files), new Date().toISOString());
    const images: ImagesStore = { version: 1, files: {} };
    for (const image of packImages(built.pack.sections.map(section => section.body).join("\n"), built.pack.shots, files.keys())) {
        const stored = await shrinkImage(files.get(image.path)!, image.kind);
        if (stored) images.files[image.path] = { kind: image.kind, label: image.label, ...stored };
    }
    const keep = store.snapshot.decisions.items.filter(item => item.origin !== "pack");
    await store.write({
        pack: built.pack,
        inventory: built.inventory,
        screens: built.screens,
        images,
        decisions: { version: 1, items: [...built.decisions, ...keep] },
    });
    return {
        game: built.pack.game.name,
        sections: built.pack.sections.length,
        shots: built.pack.shots.length,
        speakerDecisions: built.decisions.filter(item => item.id.startsWith("pack:speaker:")).length,
        inventoryBytes: JSON.stringify(built.inventory.inventory).length,
    };
}
