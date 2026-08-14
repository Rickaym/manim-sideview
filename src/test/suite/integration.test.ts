import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import * as vscode from "vscode";
import { PlayableMediaType } from "../../player";
import type { RenderResult } from "../../sideview";

const EXTENSION_ID = "Rickaym.manim-sideview";

// out/test/suite -> repository root
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const fixturesRoot = path.join(repoRoot, "src", "test", "fixtures");
const workspaceRoot = process.env.MANIM_SIDEVIEW_TEST_WORKSPACE!;

// MANIM_BIN wins so CI can pass an absolute path; otherwise probe the PATH.
// Returns undefined when no manim exists, in which case render tests skip.
function resolveManimBin(): string | undefined {
  const fromEnv = process.env.MANIM_BIN;
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }
  try {
    const cmd = process.platform === "win32" ? "where manim" : "which manim";
    const found = execSync(cmd).toString().split(/\r?\n/)[0].trim();
    return found || undefined;
  } catch {
    return undefined;
  }
}

const manimBin = resolveManimBin();

function requireManim(ctx: Mocha.Context) {
  if (!manimBin) {
    console.log(
      "No manim executable found (MANIM_BIN unset and not on PATH); skipping render test."
    );
    ctx.skip();
  }
}

// Copies a fixture directory into a fresh folder inside the temp workspace,
// opens the scene file, and drives a render through the scene-name hook.
async function renderFixture(
  fixtureDir: string,
  fileName: string,
  sceneName: string,
  commandLineArgs: string = ""
): Promise<RenderResult | undefined> {
  const dest = fs.mkdtempSync(path.join(workspaceRoot, "case-"));
  fs.cpSync(path.join(fixturesRoot, fixtureDir), dest, { recursive: true });
  const file = path.join(dest, fileName);

  const config = vscode.workspace.getConfiguration("manim-sideview");
  await config.update(
    "commandLineArgs",
    commandLineArgs,
    vscode.ConfigurationTarget.Workspace
  );

  const document = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(document);

  return vscode.commands.executeCommand<RenderResult | undefined>(
    "manim-sideview.run",
    vscode.Uri.file(file),
    false,
    sceneName
  );
}

suite("manim-sideview integration", () => {
  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, "extension not found in the test VSCode");
    await extension.activate();

    const config = vscode.workspace.getConfiguration("manim-sideview");
    if (manimBin) {
      await config.update(
        "defaultManimPath",
        manimBin,
        vscode.ConfigurationTarget.Workspace
      );
      // The disk probe predicts image names from this setting; it must
      // match the real manim version (see the #139 row in TESTING.md).
      const versionOutput = execSync(`"${manimBin}" --version`).toString();
      const version = versionOutput.match(/v\d+\.\d+\.\d+/)?.[0];
      if (version) {
        await config.update(
          "manimExecutableVersion",
          version,
          vscode.ConfigurationTarget.Workspace
        );
      }
    }
    // keep renders quiet and predictable in the host window
    await config.update(
      "focusOutputOnRun",
      false,
      vscode.ConfigurationTarget.Workspace
    );
  });

  test("activates and registers all commands without ms-python", async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const name of [
      "manim-sideview.run",
      "manim-sideview.stop",
      "manim-sideview.removeAllJobs",
      "manim-sideview.removeCurrentJob",
      "manim-sideview.renderNewScene",
      "manim-sideview.showMobjectGallery",
      "manim-sideview.syncMobjectGallery",
      "manim-sideview.updateDefaultManimConfig",
      "manim-sideview.showOutputChannel",
      "manim-sideview.showExtensionManimConfig",
      "manim-sideview.showManimExecTerminal",
    ]) {
      assert.ok(commands.includes(name), `command ${name} not registered`);
    }
  });

  test("renders a video scene with -ql from settings", async function () {
    requireManim(this);
    const result = await renderFixture(
      "scenes",
      "video_scene.py",
      "VideoScene",
      "-ql"
    );
    assert.ok(result, "run command returned no result");
    assert.strictEqual(result.mediaType, PlayableMediaType.Video);
    assert.ok(fs.existsSync(result.outputPath), result.outputPath);
    assert.match(result.outputPath, /\.mp4$/);
    // -ql renders into the 480p15 quality directory
    assert.ok(result.outputPath.includes("480p15"), result.outputPath);
  });

  test("renders an image scene", async function () {
    requireManim(this);
    const result = await renderFixture(
      "scenes",
      "image_scene.py",
      "ImageScene",
      "-ql"
    );
    assert.ok(result, "run command returned no result");
    assert.strictEqual(result.mediaType, PlayableMediaType.Image);
    assert.ok(fs.existsSync(result.outputPath), result.outputPath);
    assert.match(result.outputPath, /\.png$/);
  });

  test("resolves output via disk probe when logs are silent (#139)", async function () {
    requireManim(this);
    const result = await renderFixture(
      path.join("issues", "139_low_verbosity"),
      "scene.py",
      "ImageScene"
    );
    assert.ok(result, "run command returned no result");
    assert.strictEqual(result.mediaType, PlayableMediaType.Image);
    assert.ok(fs.existsSync(result.outputPath), result.outputPath);
  });

  test("honors a custom media_dir from manim.cfg", async function () {
    requireManim(this);
    const result = await renderFixture(
      path.join("issues", "custom_media_dir"),
      "scene.py",
      "ImageScene"
    );
    assert.ok(result, "run command returned no result");
    assert.ok(fs.existsSync(result.outputPath), result.outputPath);
    assert.ok(
      result.outputPath.includes("out_custom"),
      `expected output under out_custom, got ${result.outputPath}`
    );
  });
});
