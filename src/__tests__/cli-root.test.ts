import { describe, expect, it } from "vitest";
import { findRootCommand, ROOT_COMMANDS } from "../cli/root-commands.js";
import { buildRootHelp } from "../cli/root-help.js";

describe("root command registry", () => {
  it("registers the metaworld-facing commands", () => {
    expect(findRootCommand("group")?.invocation).toBe("openfox group ...");
    expect(findRootCommand("world")?.invocation).toBe("openfox world ...");
    expect(findRootCommand("status")?.invocation).toBe("openfox status");
  });

  it("keeps command names unique", () => {
    const names = ROOT_COMMANDS.map((command) => command.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("buildRootHelp", () => {
  it("renders help from the registry", () => {
    const help = buildRootHelp("0.2.1");
    expect(help).toContain("OpenFox v0.2.1");
    expect(help).toContain("openfox group ...");
    expect(help).toContain("Create and inspect local Fox communities");
    expect(help).toContain("openfox world ...");
    expect(help).toContain("Inspect the local metaWorld activity feed");
    expect(help).toContain("openfox status");
    expect(help).toContain("OPENAI_API_KEY");
    expect(help).toContain("TOS_RPC_URL");
  });
});
