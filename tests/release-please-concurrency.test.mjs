import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("release-please workflow concurrency", () => {
  it("keeps PR close events from canceling main push runs", async () => {
    const workflow = await readFile(
      join(ROOT, ".github/workflows/release-please.yml"),
      "utf8",
    );
    const concurrency = workflow.split("concurrency:")[1]?.split("\njobs:")[0];
    const group = concurrency
      ?.split("\n")
      .find((line) => line.trim().startsWith("group:"));

    assert.ok(group, "workflow concurrency group must be declared");
    assert.match(group, /github\.event_name\s*==\s*'pull_request'/);
    assert.match(group, /github\.event\.pull_request\.number/);
    assert.match(group, /github\.ref/);
  });
});
