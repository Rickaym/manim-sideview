import { test } from "node:test";
import * as assert from "assert";
import * as path from "path";

import { findManimConfigPath, resolveSceneFileArg } from "../../runRoot";

const ROOT = path.join(path.sep, "project");
const SRC = path.join(ROOT, "src", "main.py");
const SRC_DIR_CFG = path.join(ROOT, "src", "manim.cfg");
const ROOT_CFG = path.join(ROOT, "manim.cfg");

test("explicit config path always wins", () => {
  const picked = findManimConfigPath("/custom/manim.cfg", SRC, ROOT, () => true);
  assert.strictEqual(picked, "/custom/manim.cfg");
});

test("no run root: legacy next-to-file path, even if it does not exist", () => {
  const picked = findManimConfigPath("", SRC, undefined, () => false);
  assert.strictEqual(picked, SRC_DIR_CFG);
});

test("run root with a manim.cfg: root config is preferred", () => {
  const picked = findManimConfigPath("", SRC, ROOT, (p) => p === ROOT_CFG);
  assert.strictEqual(picked, ROOT_CFG);
});

test("run root without a manim.cfg: falls back to next-to-file", () => {
  const picked = findManimConfigPath("", SRC, ROOT, () => false);
  assert.strictEqual(picked, SRC_DIR_CFG);
});

test("scene arg is relative to the run root when the feature is on", () => {
  const arg = resolveSceneFileArg(SRC, ROOT, true);
  assert.strictEqual(arg, path.join("src", "main.py"));
});

test("scene arg stays absolute when the feature is off", () => {
  assert.strictEqual(resolveSceneFileArg(SRC, ROOT, false), SRC);
});

test("scene arg stays absolute for a file outside the run root", () => {
  const outside = path.join(path.sep, "elsewhere", "main.py");
  assert.strictEqual(resolveSceneFileArg(outside, ROOT, true), outside);
});
