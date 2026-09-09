import { test } from "node:test";
import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  parseMediaOutputFromLog,
  probeMediaOnDisk,
  baseName,
} from "../../mediaResolution";

const FIXTURES = path.join(__dirname, "..", "..", "..", "src", "test", "fixtures");

function loadLog(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, "logs", name), "utf-8");
}

test("parses a single-line File ready entry", () => {
  const result = parseMediaOutputFromLog(
    "INFO  File ready at '/proj/media/videos/main/720p30/Demo.mp4'"
  );
  assert.ok(result);
  assert.strictEqual(result.isImage, false);
  assert.strictEqual(result.mediaPath, "/proj/media/videos/main/720p30/Demo.mp4");
});

test("recovers a path wrapped across log lines (issue #132 shape)", () => {
  // manim's rich console wraps long paths; whitespace inside the quotes
  // must be stripped to recover the real path
  const result = parseMediaOutputFromLog(loadLog("wrapped_video.log"));
  assert.ok(result);
  assert.strictEqual(result.isImage, false);
  assert.strictEqual(
    result.mediaPath,
    "/home/amran/dev/python/manimcs/media/videos/demo/480p15/Demo.mp4"
  );
});

test("preserves genuine spaces in paths while unwrapping (0.4.1 regression)", () => {
  const result = parseMediaOutputFromLog(loadLog("wrapped_spaced_path.log"));
  assert.ok(result);
  assert.strictEqual(
    result.mediaPath,
    "C:\\Users\\Jake Smith\\manim_projects\\media\\videos\\scene\\480p15\\Demo Scene.mp4"
  );
});

test("wrap at a real space is recovered via the exists predicate", () => {
  // rich word-wraps AT a space and the wrap consumes it; only the
  // filesystem can disambiguate
  const log =
    "INFO  File ready at '/tmp/my\n                             scenes/media/Demo.mp4'";
  const spaced = "/tmp/my scenes/media/Demo.mp4";
  const result = parseMediaOutputFromLog(log, (p) => p === spaced);
  assert.ok(result);
  assert.strictEqual(result.mediaPath, spaced);
  // without a matching file the joined form is the fallback
  const fallback = parseMediaOutputFromLog(log, () => false);
  assert.ok(fallback);
  assert.strictEqual(fallback.mediaPath, "/tmp/myscenes/media/Demo.mp4");
});

test("single-line path with spaces is untouched", () => {
  const result = parseMediaOutputFromLog(
    "INFO  File ready at '/proj/My Scenes/media/videos/main/480p15/Demo.mp4'"
  );
  assert.ok(result);
  assert.strictEqual(
    result.mediaPath,
    "/proj/My Scenes/media/videos/main/480p15/Demo.mp4"
  );
});

test("prefers the merged output over partial movie files", () => {
  const result = parseMediaOutputFromLog(loadLog("partials_then_final.log"));
  assert.ok(result);
  assert.strictEqual(result.isImage, false);
  assert.strictEqual(
    result.mediaPath,
    "/proj/media/videos/main/1080p60/FullScene.mp4"
  );
});

test("detects an image output (issue #139 logged case)", () => {
  const result = parseMediaOutputFromLog(loadLog("image_output.log"));
  assert.ok(result);
  assert.strictEqual(result.isImage, true);
  assert.strictEqual(
    result.mediaPath,
    "/proj/media/images/main/TestScene_ManimCE_v0.19.0.png"
  );
  assert.strictEqual(
    baseName(result.mediaPath),
    "TestScene_ManimCE_v0.19.0.png"
  );
});

test("returns null when the log has no File ready entries", () => {
  assert.strictEqual(
    parseMediaOutputFromLog("Manim Community v0.19.0\nRendered TestScene\n"),
    null
  );
});

// ---- disk probe fallback (verbosity WARNING/ERROR, issue #139) ----

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "msv-test-"));
}

test("probe: image-only render is detected as an image", () => {
  const dir = tmpdir();
  const video = path.join(dir, "videos", "Scene.mp4");
  const image = path.join(dir, "images", "Scene.png");
  fs.mkdirSync(path.dirname(image), { recursive: true });
  fs.writeFileSync(image, "png");

  const result = probeMediaOnDisk(video, image);
  assert.ok(result);
  assert.strictEqual(result.isImage, true);
  assert.strictEqual(result.mediaPath, image);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("probe: fresh image beats a stale video (issue #139 regression)", () => {
  const dir = tmpdir();
  const video = path.join(dir, "Scene.mp4");
  const image = path.join(dir, "Scene.png");
  fs.writeFileSync(video, "mp4");
  fs.writeFileSync(image, "png");
  const past = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(video, past, past);

  const result = probeMediaOnDisk(video, image);
  assert.ok(result);
  assert.strictEqual(result.isImage, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("probe: fresh video beats a stale image", () => {
  const dir = tmpdir();
  const video = path.join(dir, "Scene.mp4");
  const image = path.join(dir, "Scene.png");
  fs.writeFileSync(image, "png");
  fs.writeFileSync(video, "mp4");
  const past = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(image, past, past);

  const result = probeMediaOnDisk(video, image);
  assert.ok(result);
  assert.strictEqual(result.isImage, false);
  assert.strictEqual(result.mediaPath, video);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("probe: returns null when neither predicted file exists", () => {
  const dir = tmpdir();
  assert.strictEqual(
    probeMediaOnDisk(path.join(dir, "a.mp4"), path.join(dir, "b.png")),
    null
  );
  fs.rmSync(dir, { recursive: true, force: true });
});
