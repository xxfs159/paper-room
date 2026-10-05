import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readHostingConfig } from "../scripts/hosting-config.mjs";
import { sites } from "../build/sites-vite-plugin.ts";

function buildMetadata(root: string) {
  // Only these hooks are needed to exercise packaging without running Vite.
  const plugin = sites() as {
    configResolved(config: { root: string; command: "build" }): void;
    closeBundle(): Promise<void>;
  };
  plugin.configResolved({ root, command: "build" });
  return plugin.closeBundle();
}

test("clean checkouts need no deployment metadata or storage bindings", () => {
  const directory = mkdtempSync(join(tmpdir(), "paper-room-hosting-"));
  try {
    assert.deepEqual(readHostingConfig(join(directory, "hosting.json")), {});
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("real hosting configuration is preserved and invalid metadata fails", () => {
  const directory = mkdtempSync(join(tmpdir(), "paper-room-hosting-"));
  const path = join(directory, "hosting.json");
  try {
    const config = { d1: "DB", r2: "FILES", siteId: "existing-site" };
    writeFileSync(path, JSON.stringify(config));
    assert.deepEqual(readHostingConfig(path), config);
    for (const contents of ["{", "null", "[]", '{"d1":true}', '{"r2":""}']) {
      writeFileSync(path, contents);
      assert.throws(() => readHostingConfig(path));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("build metadata is optional and a supplied deployment file is copied exactly", async () => {
  const directory = mkdtempSync(join(tmpdir(), "paper-room-build-"));
  const output = join(directory, "dist", ".openai", "hosting.json");
  try {
    await buildMetadata(directory);
    assert.equal(existsSync(output), false);

    mkdirSync(join(directory, ".openai"));
    const contents = '{\n  "d1": "DB",\n  "siteId": "existing-site"\n}\n';
    writeFileSync(join(directory, ".openai", "hosting.json"), contents);
    await buildMetadata(directory);
    assert.equal(readFileSync(output, "utf8"), contents);

    // A later local build must not retain obsolete deployment metadata.
    rmSync(join(directory, ".openai", "hosting.json"));
    await buildMetadata(directory);
    assert.equal(existsSync(output), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
