// eslint.config.js
import tseslint from "typescript-eslint";
import importX from "eslint-plugin-import-x";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import { defineConfig, globalIgnores } from "eslint/config";

// A component builds on @motionscript/sdk, the authoring subset of core, which
// it takes as a peer. Core itself is engine and host surface.
const BUILD_ON_THE_SDK =
  "Components import @motionscript/sdk (or @motionscript/sdk/component), the authoring surface, not @motionscript/core.";
const CORE = { regex: "^@motionscript/core(/.*)?$", message: BUILD_ON_THE_SDK };

// What a test may borrow from core: the host machinery it stands in for to
// drive a node (an asset catalog and a declaration pass, a measure or render
// context, the timeline), which the SDK leaves out on purpose. Nothing else,
// and no subpath.
const HOST_HARNESS = [
  "AssetDeclaration",
  "CanvasRenderContext2D",
  "ManifestAssetCatalog",
  "NullRenderContext",
  "ClipTimeline",
  "sampleTree",
  "TextState",
];

// The engine packages' rules, minus their barrel-import ban: a component
// package is organised as one directory per node behind its own index.
export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "import-x": importX,
    },
    settings: {
      "import-x/resolver-next": [
        createTypeScriptImportResolver({
          project: "./tsconfig.json",
        }),
      ],
    },
    rules: {
      // Never on unused parameters: an overridable hook keeps its real
      // parameter names for whoever overrides it.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "none",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      "import-x/no-cycle": ["error", { ignoreExternal: true }],
      "import-x/no-self-import": "error",
      "import-x/no-useless-path-segments": ["error", { noUselessIndex: true }],
      "import-x/no-duplicates": "error",
      "import-x/no-unresolved": "error",
      "no-restricted-imports": ["error", { patterns: [CORE] }],
    },
  },
  {
    files: ["**/*.test.ts", "**/tests/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@motionscript/core",
              allowImportNames: HOST_HARNESS,
              message: BUILD_ON_THE_SDK,
            },
          ],
          patterns: [{ regex: "^@motionscript/core/", message: BUILD_ON_THE_SDK }],
        },
      ],
    },
  },
]);
