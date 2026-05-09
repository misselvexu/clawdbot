import { describe, expect, it } from "vitest";
import { expandPackageDistImportClosure } from "../../scripts/lib/package-dist-imports.mjs";

const ALIAS_BODY = (hash: string) => `export * from "./abort.runtime-${hash}.js";`;

describe("expandPackageDistImportClosure root-runtime alias preservation (private fork patch)", () => {
  it("keeps stable alias when only the hashed sibling is in the seed", () => {
    const files = [
      "dist/abort.runtime.js",
      "dist/abort.runtime-AAA111.js",
      "dist/abort.runtime-BBB222.js",
      "dist/dispatch.js",
    ];
    const sources: Record<string, string> = {
      "dist/abort.runtime.js": ALIAS_BODY("AAA111"),
      "dist/abort.runtime-AAA111.js": "export const a = 1;",
      "dist/abort.runtime-BBB222.js": "export const a = 2;",
      "dist/dispatch.js": "import './abort.runtime-AAA111.js';",
    };
    const seed = ["dist/dispatch.js"];

    const closure = expandPackageDistImportClosure({
      files,
      seedFiles: seed,
      readText: (path: string) => sources[path] ?? "",
    });

    expect(closure).toContain("dist/abort.runtime.js");
    expect(closure).toContain("dist/abort.runtime-AAA111.js");
    expect(closure).toContain("dist/abort.runtime-BBB222.js");
    expect(closure).toContain("dist/dispatch.js");
  });

  it("keeps all hashed siblings when only the stable alias is in the seed", () => {
    const files = [
      "dist/route-reply.runtime.js",
      "dist/route-reply.runtime-XYZ.js",
      "dist/route-reply.runtime-PQR.js",
    ];
    const sources: Record<string, string> = {
      "dist/route-reply.runtime.js": `export * from "./route-reply.runtime-XYZ.js";`,
      "dist/route-reply.runtime-XYZ.js": "export const r = 1;",
      "dist/route-reply.runtime-PQR.js": "export const r = 2;",
    };
    const seed = ["dist/route-reply.runtime.js"];

    const closure = expandPackageDistImportClosure({
      files,
      seedFiles: seed,
      readText: (path: string) => sources[path] ?? "",
    });

    expect(closure).toContain("dist/route-reply.runtime.js");
    expect(closure).toContain("dist/route-reply.runtime-XYZ.js");
    expect(closure).toContain("dist/route-reply.runtime-PQR.js");
  });

  it("does not add alias for unrelated dist files", () => {
    const files = [
      "dist/index.js",
      "dist/some-other-file.js",
      "dist/abort.runtime.js",
      "dist/abort.runtime-XYZ.js",
    ];
    const sources: Record<string, string> = {
      "dist/index.js": "export const x = 1;",
      "dist/some-other-file.js": "export const y = 2;",
      "dist/abort.runtime.js": `export * from "./abort.runtime-XYZ.js";`,
      "dist/abort.runtime-XYZ.js": "export const z = 3;",
    };
    const seed = ["dist/index.js"];

    const closure = expandPackageDistImportClosure({
      files,
      seedFiles: seed,
      readText: (path: string) => sources[path] ?? "",
    });

    expect(closure).toContain("dist/index.js");
    expect(closure).not.toContain("dist/abort.runtime.js");
    expect(closure).not.toContain("dist/abort.runtime-XYZ.js");
    expect(closure).not.toContain("dist/some-other-file.js");
  });

  it("handles multiple independent base names (abort + runtime-plugins)", () => {
    const files = [
      "dist/abort.runtime.js",
      "dist/abort.runtime-AAA.js",
      "dist/runtime-plugins.runtime.js",
      "dist/runtime-plugins.runtime-BBB.js",
      "dist/dispatch.js",
    ];
    const sources: Record<string, string> = {
      "dist/abort.runtime.js": `export * from "./abort.runtime-AAA.js";`,
      "dist/abort.runtime-AAA.js": "export const a = 1;",
      "dist/runtime-plugins.runtime.js": `export * from "./runtime-plugins.runtime-BBB.js";`,
      "dist/runtime-plugins.runtime-BBB.js": "export const b = 2;",
      "dist/dispatch.js": `
        import "./abort.runtime-AAA.js";
        import "./runtime-plugins.runtime-BBB.js";
      `,
    };
    const seed = ["dist/dispatch.js"];

    const closure = expandPackageDistImportClosure({
      files,
      seedFiles: seed,
      readText: (path: string) => sources[path] ?? "",
    });

    expect(closure).toContain("dist/abort.runtime.js");
    expect(closure).toContain("dist/abort.runtime-AAA.js");
    expect(closure).toContain("dist/runtime-plugins.runtime.js");
    expect(closure).toContain("dist/runtime-plugins.runtime-BBB.js");
  });

  it("handles nested dist subdirectories when seed already contains hashed file", () => {
    // Note: BFS may or may not traverse into nested dist/ via import scanning
    // depending on upstream JS_DIST_FILE_RE filter; this test verifies only
    // the alias-pair preservation pass which kicks in when a hashed file
    // is already in expectedSet (regardless of how it got there).
    const files = [
      "packages/foo/dist/abort.runtime.js",
      "packages/foo/dist/abort.runtime-NESTED.js",
    ];
    const sources: Record<string, string> = {
      "packages/foo/dist/abort.runtime.js": `export * from "./abort.runtime-NESTED.js";`,
      "packages/foo/dist/abort.runtime-NESTED.js": "export const x = 1;",
    };
    const seed = ["packages/foo/dist/abort.runtime-NESTED.js"];

    const closure = expandPackageDistImportClosure({
      files,
      seedFiles: seed,
      readText: (path: string) => sources[path] ?? "",
    });

    expect(closure).toContain("packages/foo/dist/abort.runtime.js");
    expect(closure).toContain("packages/foo/dist/abort.runtime-NESTED.js");
  });
});
