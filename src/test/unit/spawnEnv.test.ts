import { test } from "node:test";
import * as assert from "assert";
import * as path from "path";

import { buildSpawnEnv, SpawnEnvDeps } from "../../spawnEnv";

function deps(overrides: Partial<SpawnEnvDeps> = {}): SpawnEnvDeps {
  return {
    platform: "linux",
    baseEnv: { PATH: "/usr/bin" },
    exists: () => false,
    ...overrides,
  };
}

test("relative command inherits the parent environment", () => {
  assert.strictEqual(buildSpawnEnv("manim", undefined, deps()), undefined);
});

test("absolute non-conda path without binDir inherits the parent environment", () => {
  assert.strictEqual(
    buildSpawnEnv("/opt/tools/bin/manim", undefined, deps()),
    undefined
  );
});

test("venv fallback prepends the interpreter bin dir (#98)", () => {
  const result = buildSpawnEnv(
    "/proj/.venv/bin/manim",
    "/proj/.venv/bin",
    deps()
  );
  assert.ok(result);
  assert.strictEqual(result.condaPrefix, undefined);
  assert.strictEqual(
    result.env.PATH,
    `/proj/.venv/bin${path.delimiter}/usr/bin`
  );
});

test("conda prefix on linux prepends its bin and sets CONDA_PREFIX", () => {
  const prefix = "/home/u/miniconda3/envs/anim";
  const result = buildSpawnEnv(`${prefix}/bin/manim`, undefined, deps({
    exists: (p) => p === path.join(prefix, "conda-meta"),
  }));
  assert.ok(result);
  assert.strictEqual(result.condaPrefix, prefix);
  assert.strictEqual(result.env.CONDA_PREFIX, prefix);
  assert.strictEqual(
    result.env.PATH,
    `${path.join(prefix, "bin")}${path.delimiter}/usr/bin`
  );
});

// note: prefix is posix-style because the ambient path module on the test
// host decides absoluteness; platform only selects the activation dir list
test("conda prefix on win32 prepends the full activation dir list in order", () => {
  const prefix = path.join(path.sep, "envs", "anim");
  const result = buildSpawnEnv(
    path.join(prefix, "Scripts", "manim.exe"),
    undefined,
    deps({
      platform: "win32",
      baseEnv: { Path: "C:\\Windows\\system32" },
      exists: (p) => p === path.join(prefix, "conda-meta"),
    })
  );
  assert.ok(result);
  const expected = [
    prefix,
    path.join(prefix, "Library", "mingw-w64", "bin"),
    path.join(prefix, "Library", "usr", "bin"),
    path.join(prefix, "Library", "bin"),
    path.join(prefix, "Scripts"),
    path.join(prefix, "bin"),
  ].join(path.delimiter);
  // the inherited "Path" spelling must be reused, not duplicated as "PATH"
  assert.strictEqual(result.env.Path, `${expected}${path.delimiter}C:\\Windows\\system32`);
  assert.strictEqual(
    Object.keys(result.env).filter((k) => k.toUpperCase() === "PATH").length,
    1
  );
  assert.strictEqual(result.env.CONDA_PREFIX, prefix);
});

test("conda detection wins over the binDir fallback", () => {
  const prefix = "/envs/anim";
  const result = buildSpawnEnv(`${prefix}/bin/manim`, `${prefix}/bin`, deps({
    exists: (p) => p === path.join(prefix, "conda-meta"),
  }));
  assert.ok(result);
  assert.strictEqual(result.condaPrefix, prefix);
});

test("missing parent PATH still produces a usable PATH", () => {
  const result = buildSpawnEnv("/v/bin/manim", "/v/bin", deps({ baseEnv: {} }));
  assert.ok(result);
  assert.strictEqual(result.env.PATH, `/v/bin${path.delimiter}`);
});
