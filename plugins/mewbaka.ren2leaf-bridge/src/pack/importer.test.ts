import { test } from "node:test";
import assert from "node:assert/strict";
import { PackError } from "./build";
import { packImages } from "./images";
import { packFiles, readPack } from "./importer";

/** A file as the folder input hands it over: its path, from the picked folder down. */
function picked(path: string, text: string): File {
    const file = new File([text], path.split("/").pop()!);
    Object.defineProperty(file, "webkitRelativePath", { value: path });
    return file;
}

test("the folder holding the shallowest README.md is the pack, whichever folder was picked", async () => {
    const files = [
        picked("downloads/sample-ren2leaf/README.md", "## 0　硬性要求\n\nrules\n"),
        picked("downloads/sample-ren2leaf/data/inventory.json", JSON.stringify({ schemaVersion: 2 })),
        picked("downloads/sample-ren2leaf/data/screens/shot-1.elements.json", JSON.stringify({ key: "shot-1" })),
        picked("downloads/sample-ren2leaf/data/screens/notes.txt", "ignored"),
        picked("downloads/sample-ren2leaf/screens/shot-1.png", "png"),
        picked("downloads/sample-ren2leaf/vendor/README.md", "a dependency's own readme"),
        picked("downloads/other/README.md", "outside the pack"),
    ];
    const { folder, files: inside } = packFiles(files);
    assert.equal(folder, "sample-ren2leaf");
    assert.deepEqual([...inside.keys()].sort(), [
        "README.md",
        "data/inventory.json",
        "data/screens/notes.txt",
        "data/screens/shot-1.elements.json",
        "screens/shot-1.png",
        "vendor/README.md",
    ]);
    const raw = await readPack(folder, inside);
    assert.equal(raw.sourcePath, "sample-ren2leaf");
    assert.match(raw.readme, /硬性要求/);
    assert.deepEqual(raw.inventory, { schemaVersion: 2 });
    assert.equal(raw.speakers, null);
    assert.deepEqual(raw.elements, [{ fileName: "shot-1.elements.json", json: { key: "shot-1" } }]);
});

test("a folder without README.md, or a pack without its inventory, is refused", async () => {
    assert.throws(() => packFiles([picked("x/data/inventory.json", "{}")]), PackError);
    const { folder, files } = packFiles([picked("p/README.md", "")]);
    await assert.rejects(readPack(folder, files), /no data\/inventory\.json/);
    const broken = packFiles([picked("p/README.md", ""), picked("p/data/inventory.json", "{")]);
    await assert.rejects(readPack(broken.folder, broken.files), /not valid JSON/);
});

test("the pictures kept are the captures, their crops and the speaker portraits", () => {
    const shots = [{ key: "shot-1", label: "Title", screens: ["main_menu"], image: "screens/shot-1.png", elementCount: 3 }];
    const readme = "## 6　界面截图\n\n- 切图 开始按钮：[screens/shot-1-1.png](screens/shot-1-1.png)（10, 20, 30, 40）\n";
    const images = packImages(readme, shots, [
        "README.md",
        "screens/shot-1.png",
        "screens/shot-1-1.png",
        "screens/shot-1-2.png",
        "characters/s.png",
        "characters/notes.txt",
        "data/inventory.json",
    ]);
    assert.deepEqual(images, [
        { path: "screens/shot-1.png", kind: "screenshot", label: "Title" },
        { path: "screens/shot-1-1.png", kind: "crop", label: "开始按钮" },
        { path: "screens/shot-1-2.png", kind: "crop", label: "shot-1-2" },
        { path: "characters/s.png", kind: "portrait", label: "s" },
    ]);
});
