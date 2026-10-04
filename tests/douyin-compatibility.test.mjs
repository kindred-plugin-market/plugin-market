import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (relativePath) =>
  JSON.parse(await readFile(join(ROOT, relativePath), "utf8"));

describe("douyin-content-assets host compatibility", () => {
  it("declares the first Bench release containing its ACL commands", async () => {
    const manifest = await readJson(
      "extensions/douyin-content-assets/manifest.json",
    );

    assert.equal(manifest.engines.bench, ">=1.36.0");
  });

  it("yanks the published release whose compatibility floor was too low", async () => {
    const registry = await readJson("registry.json");
    const extension = registry.extensions.find(
      (entry) => entry.id === "douyin-content-assets",
    );
    const previousRelease = extension?.versions.find(
      (entry) => entry.version === "0.1.0",
    );

    assert.equal(previousRelease?.yanked, true);
  });

  it("runs the market quality gate against the first released host with those commands", async () => {
    const baseline = (
      await readFile(join(ROOT, ".github/host-baseline.txt"), "utf8")
    ).trim();

    assert.equal(baseline, "5ecb1f0c7f0bdb1daf9482ff18e1f7dad04ec33b");
  });
});
