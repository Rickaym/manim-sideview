/**
 * Contract test: renders fixture scenes with a real manim installation and
 * feeds the live stdout through the extension's actual output-resolution
 * code (out/mediaResolution.js). Catches drift in manim's log format, which
 * path prediction depends on.
 *
 * Requires: manim on PATH (or MANIM_BIN set) and a prior `npm run
 * compile-tests`. Renders into a temp directory; the repo stays clean.
 */

const { spawnSync } = require("child_process");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.join(__dirname, "..");
const MANIM = process.env.MANIM_BIN || "manim";
const FIXTURES = path.join(REPO, "src", "test", "fixtures");

const {
  parseMediaOutputFromLog,
  probeMediaOnDisk,
} = require(path.join(REPO, "out", "mediaResolution.js"));

function run(args, cwd) {
  const result = spawnSync(MANIM, args, {
    cwd,
    encoding: "utf-8",
    timeout: 300000,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function freshDir(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `msv-contract-${name}-`));
  return dir;
}

const version = run(["--version"], REPO);
console.log(`manim: ${version.stdout.trim() || version.stderr.trim()}`);

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`[FAIL] ${name}\n${err.message}`);
  }
}

// 1. video render: the logged path must parse and exist
{
  const cwd = freshDir("video");
  fs.copyFileSync(
    path.join(FIXTURES, "scenes", "video_scene.py"),
    path.join(cwd, "scene.py")
  );
  const render = run(["-ql", "scene.py", "VideoScene"], cwd);
  const logbook = render.stdout + render.stderr;

  check("video: File ready path parses from real manim output", () => {
    const parsed = parseMediaOutputFromLog(logbook);
    assert.ok(parsed, `no File ready entry found in:\n${logbook}`);
    assert.strictEqual(parsed.isImage, false);
    assert.ok(
      fs.existsSync(parsed.mediaPath),
      `parsed path does not exist: ${parsed.mediaPath}`
    );
    assert.ok(
      parsed.mediaPath.includes("480p15"),
      `-ql should land in 480p15, got: ${parsed.mediaPath}`
    );
  });
  fs.rmSync(cwd, { recursive: true, force: true });
}

// 2. image render: detected as an image from the logs
{
  const cwd = freshDir("image");
  fs.copyFileSync(
    path.join(FIXTURES, "scenes", "image_scene.py"),
    path.join(cwd, "scene.py")
  );
  const render = run(["-ql", "scene.py", "ImageScene"], cwd);
  const logbook = render.stdout + render.stderr;

  check("image: detected as image with an existing path", () => {
    const parsed = parseMediaOutputFromLog(logbook);
    assert.ok(parsed, `no File ready entry found in:\n${logbook}`);
    assert.strictEqual(parsed.isImage, true);
    assert.ok(
      fs.existsSync(parsed.mediaPath),
      `parsed path does not exist: ${parsed.mediaPath}`
    );
  });
  fs.rmSync(cwd, { recursive: true, force: true });
}

// 3. verbosity WARNING: logs are silent, the disk probe must find the image
{
  const cwd = freshDir("silent");
  fs.copyFileSync(
    path.join(FIXTURES, "issues", "139_low_verbosity", "scene.py"),
    path.join(cwd, "scene.py")
  );
  fs.copyFileSync(
    path.join(FIXTURES, "issues", "139_low_verbosity", "manim.cfg"),
    path.join(cwd, "manim.cfg")
  );
  const render = run(["-ql", "scene.py", "ImageScene"], cwd);
  const logbook = render.stdout + render.stderr;

  check("silent logs: no File ready entry leaks through", () => {
    assert.strictEqual(
      parseMediaOutputFromLog(logbook),
      null,
      `expected silent logs, got:\n${logbook}`
    );
  });

  check("silent logs: disk probe finds the rendered image", () => {
    // predicted names mirror globals.getImageOutputPath with the real version
    const versionTag = (version.stdout.trim() || version.stderr.trim())
      .match(/v[\d.]+(\.post\d+)?/)?.[0];
    assert.ok(versionTag, "could not parse manim version");
    const predictedImage = path.join(
      cwd,
      "media",
      "images",
      "scene",
      `ImageScene_ManimCE_${versionTag}.png`
    );
    const predictedVideo = path.join(
      cwd,
      "media",
      "videos",
      "scene",
      "480p15",
      "ImageScene.mp4"
    );
    const probed = probeMediaOnDisk(predictedVideo, predictedImage);
    assert.ok(
      probed,
      `probe found nothing; media tree: ${JSON.stringify(
        fs.readdirSync(path.join(cwd, "media"), { recursive: true })
      )}`
    );
    assert.strictEqual(probed.isImage, true);
  });
  fs.rmSync(cwd, { recursive: true, force: true });
}

// 4. trailing whitespace in manim.cfg quality still renders (issue #137)
{
  const cwd = freshDir("trim");
  fs.copyFileSync(
    path.join(FIXTURES, "issues", "137_trailing_space", "scene.py"),
    path.join(cwd, "scene.py")
  );
  fs.copyFileSync(
    path.join(FIXTURES, "issues", "137_trailing_space", "manim.cfg"),
    path.join(cwd, "manim.cfg")
  );
  const render = run(["scene.py", "VideoScene"], cwd);
  const logbook = render.stdout + render.stderr;

  check("trailing-space quality: manim renders and path parses", () => {
    assert.strictEqual(render.status, 0, `manim exited ${render.status}:\n${logbook}`);
    const parsed = parseMediaOutputFromLog(logbook);
    assert.ok(parsed, `no File ready entry found in:\n${logbook}`);
    assert.ok(fs.existsSync(parsed.mediaPath));
  });
  fs.rmSync(cwd, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nCONTRACT TESTS PASSED" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
