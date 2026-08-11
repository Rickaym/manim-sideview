import { test } from "node:test";
import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

/**
 * Tests globals.ts path prediction. globals.ts imports "vscode", which does
 * not exist outside the editor, so a minimal stub is registered in the
 * module cache before the import.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const Module = require("module");

const settings: { [key: string]: unknown } = {};
const vscodeStub = {
  window: {
    createOutputChannel: () => ({ appendLine: () => undefined }),
    showErrorMessage: () => undefined,
    showWarningMessage: () => undefined,
    showInformationMessage: () => undefined,
  },
  workspace: {
    getConfiguration: () => ({ get: (k: string) => settings[k] }),
  },
  Uri: {
    joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
      fsPath: path.join(base.fsPath, ...parts),
    }),
    file: (p: string) => ({ fsPath: p }),
  },
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...args: unknown[]) {
  if (request === "vscode") {
    return "vscode";
  }
  return originalResolve.call(this, request, ...args);
};
require.cache["vscode"] = {
  id: "vscode",
  filename: "vscode",
  loaded: true,
  exports: vscodeStub,
} as never;

const globals = require("../../globals");

// load the real fallback configuration exactly as loadGlobals does
const REPO = path.join(__dirname, "..", "..", "..");
const cfgMap = JSON.parse(
  fs.readFileSync(path.join(REPO, "assets", "local", "manim.cfg.json"), "utf-8")
);
globals.updateFallbackManimCfg(cfgMap, false);

type Overrides = { [key: string]: string };

function mkConfig(manimConfig: Overrides = {}, rest: Overrides = {}) {
  return {
    srcPath: rest.srcPath ?? "/proj/main.py",
    sceneName: rest.sceneName ?? "Demo",
    moduleName: rest.moduleName ?? "main",
    srcRootFolder: rest.srcRootFolder ?? "/proj",
    document: null,
    isUsingConfFile: false,
    manimConfig: { ...globals.getDefaultConfig(), ...manimConfig },
  };
}

test("default config predicts the 1080p60 video path", () => {
  assert.strictEqual(
    globals.getVideoOutputPath(mkConfig()),
    path.join("media", "videos", "main", "1080p60", "Demo.mp4")
  );
});

test("quality names map to their quality folders", () => {
  const cases: [string, string][] = [
    ["low_quality", "480p15"],
    ["medium_quality", "720p30"],
    ["high_quality", "1080p60"],
    ["production_quality", "1440p60"],
    ["fourk_quality", "2160p60"],
  ];
  for (const [quality, folder] of cases) {
    assert.strictEqual(
      globals.getVideoOutputPath(mkConfig({ quality })),
      path.join("media", "videos", "main", folder, "Demo.mp4")
    );
  }
});

test("explicit pixel dimensions override the quality folder (issue #115 cfg case)", () => {
  const config = mkConfig({
    pixel_width: "1080",
    pixel_height: "1920",
    frame_rate: "60",
  });
  assert.strictEqual(
    globals.getVideoOutputPath(config),
    path.join("media", "videos", "main", "1920p60", "Demo.mp4")
  );
});

test("an unknown quality value throws (issue #137 pre-trim behavior)", () => {
  assert.throws(() => {
    globals.getVideoOutputPath(mkConfig({ quality: "low_quality " }));
  });
});

test("custom media_dir is honored in both predicted paths", () => {
  settings["manimExecutableVersion"] = "v0.19.0";
  const config = mkConfig({ media_dir: "out_custom" });
  assert.strictEqual(
    globals.getVideoOutputPath(config),
    path.join("out_custom", "videos", "main", "1080p60", "Demo.mp4")
  );
  assert.strictEqual(
    globals.getImageOutputPath(config, undefined, ".png"),
    path.join("out_custom", "images", "main", "Demo_ManimCE_v0.19.0.png")
  );
});

test("image path uses the configured manim version (issue #139 fallback)", () => {
  settings["manimExecutableVersion"] = "v0.19.0";
  assert.strictEqual(
    globals.getImageOutputPath(mkConfig(), undefined, ".png"),
    path.join("media", "images", "main", "Demo_ManimCE_v0.19.0.png")
  );
});
