import { existsSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

/**
 * Which fixture pack this build puts in the bundle.
 *
 * The demo fixtures are ~196 KB of source per pack, and before this alias
 * existed every build shipped BOTH packs to the browser on every route, live
 * backend or not. A reader of /login downloaded Jane Analyst's rows.
 *
 * `./packs/empty` is the case worth stating plainly: when NEXT_PUBLIC_REDASH_URL
 * is set, USE_REAL_API is true, and every module that reads a fixture value does
 * so in the else-branch of an `if (USE_REAL_API)` (or, for the identity
 * switcher, behind a component that returns null in real mode). Nothing reads a
 * fixture, so nothing needs to be shipped. See src/lib/mock-data/packs/empty.ts
 * for the audit and src/lib/mock-data/packs/packs.test.ts for what keeps the
 * three packs in step.
 *
 * Read here rather than in the module because this is a BUILD decision: the
 * point is that the bundler sees one pack, and a runtime ternary is exactly what
 * left both of them in.
 *
 * `la` is the private tenant pack. It carries real customer hostnames and org
 * names, so it does not live in this repo: the private tenant overlay
 * (build-overlay.sh) copies it back onto disk at
 * src/lib/mock-data/packs/la/ before `pnpm build` runs. If that directory is
 * missing when NEXT_PUBLIC_DEMO_PACK=la, this throws instead of quietly
 * resolving the neutral pack. A silent fallback would mean an overlay build
 * that forgot to copy the tenant pack in produces an image that looks correct
 * and ships neutral fixtures under a tenant's name; that silent-success shape
 * has bitten this reorg before.
 *
 * NEXT_PUBLIC_DEMO_PACK=la together with NEXT_PUBLIC_REDASH_URL set is checked
 * FIRST, before either branch below, and fails loudly rather than silently
 * returning `empty.ts`. The two env vars contradict each other: a real-backend
 * build ships no fixture pack at all (every fixture read is dead code behind
 * an `if (USE_REAL_API)` branch), so asking for a specific tenant pack in that
 * mode means one of the two vars is wrong. Following build-overlay.sh's own
 * printed docker command used to hit exactly this: the Dockerfile defaults
 * NEXT_PUBLIC_REDASH_URL=1, that command only overrode NEXT_PUBLIC_DEMO_PACK,
 * and the old ordering checked NEXT_PUBLIC_REDASH_URL first, so it silently
 * returned `empty.ts`, bundled no fixtures, and never threw.
 */
// Exported for next.config.test.ts, which calls this directly rather than
// exercising it only through the turbopack.resolveAlias side effect below.
export function activePack(): string {
  const wantsLa = process.env.NEXT_PUBLIC_DEMO_PACK === "la";
  const hasRealBackend = Boolean(process.env.NEXT_PUBLIC_REDASH_URL);

  if (wantsLa && hasRealBackend) {
    throw new Error(
      "NEXT_PUBLIC_DEMO_PACK=la but NEXT_PUBLIC_REDASH_URL is also set. These contradict " +
        "each other: a real-backend build ships no fixture pack at all (see " +
        "src/lib/mock-data/packs/empty.ts), so requesting the la pack in that mode means " +
        "one of the two env vars is a mistake. Unset NEXT_PUBLIC_DEMO_PACK for a " +
        "real-backend build, or unset NEXT_PUBLIC_REDASH_URL for a mock-mode tenant demo " +
        "build. (The Dockerfile defaults NEXT_PUBLIC_REDASH_URL=1, so an overlay build must " +
        "override it, not only NEXT_PUBLIC_DEMO_PACK.)",
    );
  }

  if (wantsLa) {
    const laIndex = "./src/lib/mock-data/packs/la/index.ts";
    if (!existsSync(join(__dirname, "src/lib/mock-data/packs/la/index.ts"))) {
      throw new Error(
        "NEXT_PUBLIC_DEMO_PACK=la but src/lib/mock-data/packs/la is not on disk. " +
          "This pack is not part of the public repo: the private tenant overlay's " +
          "build-overlay.sh must copy it back into src/lib/mock-data/packs/la before " +
          "`pnpm build` runs. Refusing to fall back to the neutral pack silently.",
      );
    }
    return laIndex;
  }

  if (hasRealBackend) return "./src/lib/mock-data/packs/empty.ts";

  return "./src/lib/mock-data/packs/neutral/index.ts";
}

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (see Dockerfile)
  output: "standalone",

  turbopack: {
    // src/lib/mock-data/packs/active.ts is the fallback this replaces; it holds
    // the same selection written so tsc and Vitest, which read no Next config,
    // still resolve a real pack. Vitest keeping the real fixtures is deliberate:
    // the unit suite asserts against fixture rows.
    resolveAlias: {
      "@/lib/mock-data/packs/active": activePack(),
    },
  },

  // The React Compiler memoizes components and hook results automatically.
  //
  // This app was already paying its price without collecting on it: the
  // compiler's ESLint rules ship with eslint-config-next and run under
  // `--max-warnings 0`, so `react-hooks/preserve-manual-memoization` has been
  // blocking edits (see ../CLAUDE.md, "Extracting a hook to satisfy the
  // file-size block breaks manual memoization") while nothing in the build
  // actually compiled. Lint passing is also what makes turning it on safe: it
  // means the compiler already analyses this tree without bailing out.
  //
  // It does NOT make the 84 useMemo and 69 useCallback calls in src/ dead. The
  // compiler preserves hand-written memoization rather than replacing it, and
  // several of them are load-bearing for a different reason (a stable identity
  // passed to a non-React consumer, a recharts prop). Remove one only with a
  // measurement in hand.
  reactCompiler: true,
  images: {
    // brand.logo is a vector (public/images/veodyn-mark.svg by default), and
    // the optimizer answers 400 for image/svg+xml unless this is on, so the
    // sidebar mark would render as a broken image. There are no remotePatterns
    // here, so the only SVGs reachable through /_next/image are the ones in
    // this app's own public/ directory; the sandbox CSP below is what stops a
    // served SVG from executing script if one ever were not ours.
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
};

export default nextConfig;
