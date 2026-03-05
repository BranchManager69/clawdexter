import { describe, it, expect } from "vitest";

describe("clawdexter plugin", () => {
  it("exports default plugin with correct id", async () => {
    const plugin = await import("../index.js");
    expect(plugin.default).toBeDefined();
    expect(plugin.default.id).toBe("clawdexter");
    expect(plugin.default.name).toBe("ClawDexter");
  });

  it("has register function", async () => {
    const plugin = await import("../index.js");
    expect(typeof plugin.default.register).toBe("function");
  });

  it("has valid plugin manifest", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const manifestPath = path.join(import.meta.dirname, "..", "openclaw.plugin.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

    expect(manifest.id).toBe("clawdexter");
    expect(manifest.name).toBe("ClawDexter");
    expect(manifest.configSchema?.properties?.svmPrivateKey).toBeDefined();
    expect(manifest.configSchema?.properties?.evmPrivateKey).toBeDefined();
    expect(manifest.configSchema?.properties?.maxPaymentUSDC).toBeDefined();
    expect(manifest.configSchema?.properties?.disableTelemetry).toBeDefined();
    expect(manifest.configSchema?.properties?.baseUrl).toBeUndefined();
    expect(manifest.configSchema?.properties?.autoRefreshTools).toBeUndefined();
  });
});
