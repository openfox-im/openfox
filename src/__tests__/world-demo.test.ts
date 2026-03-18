import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  exportMetaWorldDemoBundle,
  loadMetaWorldDemoManifest,
  validateMetaWorldDemoBundle,
} from "../metaworld/demo.js";

describe("metaWorld demo bundle", () => {
  const cleanupPaths: string[] = [];

  afterEach(() => {
    while (cleanupPaths.length > 0) {
      const target = cleanupPaths.pop();
      if (!target) continue;
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it("exports a seeded multi-node demo bundle and validates it end-to-end", async () => {
    const bundleDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "openfox-metaworld-demo-"),
    );
    cleanupPaths.push(bundleDir);

    const exportResult = await exportMetaWorldDemoBundle({
      outputDir: bundleDir,
      force: true,
    });

    expect(exportResult.manifest.nodes).toHaveLength(3);
    expect(fs.existsSync(path.join(bundleDir, "README.md"))).toBe(true);
    expect(fs.existsSync(path.join(bundleDir, "scripts", "serve-node.sh"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(bundleDir, "scripts", "validate.sh"))).toBe(
      true,
    );

    for (const node of exportResult.manifest.nodes) {
      expect(fs.existsSync(path.join(bundleDir, node.configPath))).toBe(true);
      expect(fs.existsSync(path.join(bundleDir, node.walletPath))).toBe(true);
      expect(fs.existsSync(path.join(bundleDir, node.dbPath))).toBe(true);
      expect(fs.existsSync(path.join(bundleDir, node.siteDir, "index.html"))).toBe(
        true,
      );
    }

    const manifest = await loadMetaWorldDemoManifest(bundleDir);
    expect(manifest.replicatedGroup.groupId).toBeTruthy();
    expect(manifest.replicatedGroup.expectedActiveMembers).toBe(2);
    expect(manifest.replicatedGroup.expectedAnnouncements).toBe(1);
    expect(manifest.replicatedGroup.expectedMessages).toBe(2);
    expect(manifest.replicatedGroup.expectedPresence).toBe(2);

    const validation = await validateMetaWorldDemoBundle({ bundleDir });
    expect(validation.ok).toBe(true);
    expect(validation.nodes).toHaveLength(3);
    expect(validation.checks.every((check) => check.ok)).toBe(true);

    const alphaNode = validation.nodes.find((node) => node.nodeId === "alpha");
    expect(alphaNode).toBeDefined();
    expect(alphaNode!.groupPage.activeMemberCount).toBe(2);
    expect(alphaNode!.groupPage.announcementCount).toBe(1);
    expect(alphaNode!.groupPage.messageCount).toBe(2);
    expect(alphaNode!.groupPage.presenceCount).toBe(2);
    expect(
      fs.existsSync(path.join(alphaNode!.site.outputDir, alphaNode!.site.groupPagePath)),
    ).toBe(true);
  });
});
