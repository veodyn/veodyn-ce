import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// activePack() is the fail-loud guard that decides which fixture pack a build
// bundles (see next.config.ts). Nothing used to call it directly: it only ran
// as a side effect of building nextConfig.turbopack.resolveAlias, which no
// suite exercises (tsc and Vitest never read next.config.ts). That gap is why
// a broken ordering there (checking NEXT_PUBLIC_REDASH_URL before
// NEXT_PUBLIC_DEMO_PACK, so an overlay build's own printed docker command
// silently returned empty.ts) survived review. This file imports the module
// directly and drives every branch, mocking node:fs's existsSync rather than
// creating or deleting real files under src/lib/mock-data/packs/la.
//
// nextConfig calls activePack() eagerly, as a plain object property, so a
// throwing branch surfaces as the `import()` itself rejecting rather than as
// a call to a function the import returned. The success-path tests import
// first, then also call the exported activePack() directly (same env and
// mocks, so it agrees), since that direct call is what a future change to
// this file is most likely to be exercised through.

const existsSyncMock = vi.fn<(path: string) => boolean>();

vi.mock("node:fs", () => {
  const existsSync = (path: string) => existsSyncMock(path);
  return { existsSync, default: { existsSync } };
});

const ORIGINAL_ENV = { ...process.env };

describe("activePack", () => {
  beforeEach(() => {
    vi.resetModules();
    existsSyncMock.mockReset();
    delete process.env.NEXT_PUBLIC_REDASH_URL;
    delete process.env.NEXT_PUBLIC_DEMO_PACK;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("real backend, no demo pack requested: resolves to the empty pack", async () => {
    process.env.NEXT_PUBLIC_REDASH_URL = "https://redash.example.com";
    existsSyncMock.mockReturnValue(false);

    const mod = await import("./next.config");

    expect(mod.activePack()).toBe("./src/lib/mock-data/packs/empty.ts");
    expect(mod.default.turbopack?.resolveAlias?.["@/lib/mock-data/packs/active"]).toBe(
      "./src/lib/mock-data/packs/empty.ts",
    );
  });

  it("mock mode, no demo pack requested: resolves to the neutral pack", async () => {
    existsSyncMock.mockReturnValue(false);

    const mod = await import("./next.config");

    expect(mod.activePack()).toBe("./src/lib/mock-data/packs/neutral/index.ts");
  });

  it("mock mode, la requested, pack missing on disk: throws the missing-pack error", async () => {
    process.env.NEXT_PUBLIC_DEMO_PACK = "la";
    existsSyncMock.mockReturnValue(false);

    await expect(import("./next.config")).rejects.toThrow(/src\/lib\/mock-data\/packs\/la is not on disk/);
  });

  it("mock mode, la requested, pack present on disk: resolves to the la pack", async () => {
    process.env.NEXT_PUBLIC_DEMO_PACK = "la";
    existsSyncMock.mockReturnValue(true);

    const mod = await import("./next.config");

    expect(mod.activePack()).toBe("./src/lib/mock-data/packs/la/index.ts");
  });

  // The path finding 1 was written about: following build-overlay.sh's
  // printed docker command used to hit exactly this combination (the
  // Dockerfile defaults NEXT_PUBLIC_REDASH_URL=1, and the command only
  // overrode NEXT_PUBLIC_DEMO_PACK), and the old ordering silently returned
  // empty.ts instead of failing. Pack presence is mocked true here, to prove
  // the contradiction is what fails it, not a missing directory.
  it("real backend AND la requested: throws the contradiction error, regardless of pack presence", async () => {
    process.env.NEXT_PUBLIC_REDASH_URL = "https://redash.example.com";
    process.env.NEXT_PUBLIC_DEMO_PACK = "la";
    existsSyncMock.mockReturnValue(true);

    await expect(import("./next.config")).rejects.toThrow(/NEXT_PUBLIC_REDASH_URL is also set/);
  });
});
