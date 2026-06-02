import { execFile } from "node:child_process";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("reference inspector CLI", () => {
  it("renders PDF page images as real page-sized PNG assets instead of the 1x1 placeholder", async () => {
    const outDir = path.resolve("temp/reference-inspector-render-test");
    await rm(outDir, { force: true, recursive: true });

    await execFileAsync("node", [
      "tools/inspect-reference-file.mjs",
      "/Users/rhetoric/Work/InfoTheory/哈工深-Lecture4-AEP-IDD.pdf",
      "--out",
      outDir,
      "--max-page-chars",
      "200"
    ]);

    const assetsDir = path.join(outDir, "assets");
    const assetNames = await readdir(assetsDir);
    const pageAssetName = assetNames.find((name) => /-page-\d+\.png$/.test(name));
    expect(pageAssetName).toBeTruthy();

    const image = await loadImage(await readFile(path.join(assetsDir, pageAssetName ?? "")));
    expect(image.width).toBeGreaterThan(100);
    expect(image.height).toBeGreaterThan(100);
  }, 20_000);
});
