import { test } from "node:test";
import * as assert from "assert";
import * as path from "path";

import { resolveManimNextToInterpreter } from "../../spawnEnv";

const existsIn = (files: string[]) => (p: string) => files.includes(p);

test("unix env resolves manim next to the interpreter in bin", () => {
  const bin = "/envs/anim/bin";
  const result = resolveManimNextToInterpreter(
    bin,
    "manim",
    "linux",
    existsIn([path.join(bin, "manim")])
  );
  assert.strictEqual(result.manim, path.join(bin, "manim"));
  assert.strictEqual(result.binDir, bin);
});

test("windows venv with manim beside python in Scripts does not double-append", () => {
  const scripts = path.join(path.sep, "proj", ".venv", "Scripts");
  const result = resolveManimNextToInterpreter(
    scripts,
    "manim",
    "win32",
    existsIn([path.join(scripts, "manim") + ".exe"])
  );
  assert.strictEqual(result.manim, path.join(scripts, "manim"));
  assert.strictEqual(result.binDir, scripts);
});

test("windows conda-style env falls back to the Scripts subfolder", () => {
  const prefix = path.join(path.sep, "u", ".pixi", "envs", "default");
  const scripts = path.join(prefix, "Scripts");
  const result = resolveManimNextToInterpreter(
    prefix,
    "manim",
    "win32",
    existsIn([path.join(scripts, "manim") + ".exe"])
  );
  assert.strictEqual(result.manim, path.join(scripts, "manim"));
  assert.strictEqual(result.binDir, scripts);
});

test("not found anywhere returns the root candidate unchanged", () => {
  const prefix = path.join(path.sep, "envs", "anim");
  const result = resolveManimNextToInterpreter(
    prefix,
    "manim",
    "win32",
    () => false
  );
  assert.strictEqual(result.manim, path.join(prefix, "manim"));
  assert.strictEqual(result.binDir, prefix);
});

test("unknown platform assumes the unix bin layout", () => {
  const prefix = "/envs/anim";
  const result = resolveManimNextToInterpreter(
    prefix,
    "manim",
    "sunos" as NodeJS.Platform,
    existsIn([path.join(prefix, "bin", "manim")])
  );
  assert.strictEqual(result.manim, path.join(prefix, "bin", "manim"));
  assert.strictEqual(result.binDir, path.join(prefix, "bin"));
});
