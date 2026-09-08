import { test } from "node:test";
import * as assert from "assert";
import * as path from "path";

import { isCoveredByRoots, mediaResourceRoots } from "../../resourceRoots";

const proj = path.join(path.sep, "home", "u", "proj");

test("media under the source folder needs only the source root", () => {
  const media = path.join(proj, "media", "videos", "main", "480p15", "Demo.mp4");
  assert.deepStrictEqual(mediaResourceRoots(proj, media), [proj]);
});

test("media directly in the source folder needs only the source root", () => {
  assert.deepStrictEqual(
    mediaResourceRoots(proj, path.join(proj, "Demo.png")),
    [proj]
  );
});

test("media_dir outside the project adds the media folder (issue #159)", () => {
  const outside = path.join(path.sep, "mnt", "renders", "videos", "main", "480p15");
  assert.deepStrictEqual(
    mediaResourceRoots(proj, path.join(outside, "Demo.mp4")),
    [proj, outside]
  );
});

test("a sibling folder with the project name as a prefix is not covered", () => {
  const sibling = path.join(path.sep, "home", "u", "proj-media", "videos");
  assert.deepStrictEqual(
    mediaResourceRoots(proj, path.join(sibling, "Demo.mp4")),
    [proj, sibling]
  );
});

test("relative media_dir resolved to a parent folder adds that folder", () => {
  const parent = path.join(path.sep, "home", "u", "out", "videos", "main", "1080p60");
  assert.deepStrictEqual(
    mediaResourceRoots(proj, path.join(parent, "Demo.mp4")),
    [proj, parent]
  );
});

test("isCoveredByRoots accepts the root itself and its descendants", () => {
  assert.ok(isCoveredByRoots([proj], proj));
  assert.ok(isCoveredByRoots([proj], path.join(proj, "a", "b")));
  assert.ok(!isCoveredByRoots([proj], path.join(path.sep, "home", "u")));
  assert.ok(!isCoveredByRoots([proj], path.join(path.sep, "elsewhere")));
});

test("isCoveredByRoots checks every root", () => {
  const ext = path.join(path.sep, "ext");
  const media = path.join(path.sep, "mnt", "renders");
  assert.ok(isCoveredByRoots([proj, ext, media], path.join(media, "videos")));
  assert.ok(!isCoveredByRoots([proj, ext], path.join(media, "videos")));
});
