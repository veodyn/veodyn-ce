import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // ── agent-starter correctness cherry-pick ──────────────────────────────────
  // High-value guardrails for AI-written TypeScript, from agent-starter's
  // guides/lint-rules-for-ai.md. These are non-type-aware rules only.
  //
  // RATCHET: all `warn` for now. Deps were not installed and there is no test
  // suite when these landed, so nothing was measured. Once a dev with deps
  // installed runs `pnpm lint` and confirms the real counts are manageable,
  // promote these to `error`. Do not add type-aware rules (no-floating-promises,
  // no-misused-promises, the no-unsafe-* family) until `parserOptions.projectService`
  // is enabled and a separate noise pass is done: they need type info.
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      eqeqeq: ["warn", "always", { null: "ignore" }],
      "no-self-compare": "warn",
      "no-constant-binary-expression": "warn",
      "no-throw-literal": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",
    },
  },

  // ── primitive sweep guardrails ─────────────────────────────────────────────
  // Raw form and interactive elements duplicate an installed primitive and lose
  // the accessibility behaviour it provides for free (label association, focus
  // rings, roles, keyboard navigation). Added after the 2026-07-27 sweep cleared
  // 78 unassociated labels; see docs/superpowers/specs/2026-07-27-primitive-sweep-design.md
  // Ignores: src/components/ui/** because those files ARE the primitives and
  // legitimately render raw elements; **/*.test.tsx because test harnesses
  // legitimately build raw DOM to drive the component under test (or, for
  // editors-labels.test.tsx, need the literal string in a source-guard regex).
  {
    // src/plugins/** added 2026-07-28 with the visualization plugin registry.
    // A plugin renders product UI exactly as a component does, so it needs the
    // same guardrails. It sat outside this glob briefly and a raw <button>
    // under src/plugins linted clean, which is the whole failure this rule
    // exists to prevent.
    files: ["src/components/**/*.tsx", "src/app/**/*.tsx", "src/plugins/**/*.tsx"],
    ignores: [
      "src/components/ui/**",
      // Test harnesses legitimately build raw DOM to drive a component under
      // test. 9 raw buttons live in test files. ADDED 2026-07-28 from the
      // batch 2 lesson: the label rule blocked on exactly this and cost a
      // round trip. Same reasoning, applied before it fires this time.
      "**/*.test.tsx",
      // Per-file exemptions were removed as each owning batch landed. Batch 8
      // (Task 35) asserts this list carries no per-file entries at all.
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name='label']",
          message:
            "Use <Label htmlFor> from @/components/ui/label. A raw <label> loses the control association.",
        },
        {
          selector: "JSXOpeningElement[name.name='button']",
          message:
            "Use <Button> from @/components/ui/button. A raw <button> has no focus-visible ring.",
        },
        {
          selector: "JSXOpeningElement[name.name='table']",
          message:
            "Use <Table> from @/components/ui/table so every grid shares one set of semantics.",
        },
      ],
    },
  },
]);

export default eslintConfig;
