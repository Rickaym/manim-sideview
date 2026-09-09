import * as fs from "fs";

/**
 * Pure helpers for locating the rendered output file. Kept free of any
 * vscode dependency so they can be unit tested directly.
 */

export const RE_FILE_READY = /File\s*ready\s*at[^']*'(?<path>[^']*)'/g;

export type ResolvedMedia = {
  isImage: boolean;
  mediaPath: string;
};

// manim's rich console wraps long paths across lines inside the quotes,
// indenting the continuation. A long token is broken mid-word, but a path
// containing a space is word-wrapped AT the space, which the wrap consumes.
// Reconstruction is therefore ambiguous: each line break may or may not
// stand for a real space.
function wrapSegments(p: string): string[] {
  return p
    .replace(/\r/g, "")
    .split("\n")
    .map((s) => s.replace(/^[ \t]+|[ \t]+$/g, ""));
}

// All plausible reconstructions: every combination of "" or " " at each
// line-break junction, starting with the all-joined form. Bounded so a
// pathological log cannot explode combinatorially.
function pathCandidates(p: string): string[] {
  const segments = wrapSegments(p);
  const junctions = segments.length - 1;
  if (junctions <= 0) {
    return [segments[0] ?? ""];
  }
  const maxJunctions = 10;
  if (junctions > maxJunctions) {
    return [segments.join("")];
  }
  const candidates: string[] = [];
  for (let mask = 0; mask < 1 << junctions; mask++) {
    let joined = segments[0];
    for (let i = 0; i < junctions; i++) {
      joined += (mask & (1 << i) ? " " : "") + segments[i + 1];
    }
    candidates.push(joined);
  }
  return candidates;
}

/**
 * Finds the output file manim reported in its logs.
 *
 * Prefers an image entry if present; otherwise takes the last "File ready
 * at" entry, since videos log one line per partial movie file plus a final
 * entry for the merged output.
 *
 * @param exists used to disambiguate wrapped paths against the filesystem;
 * defaults to fs.existsSync. The first existing candidate wins, otherwise
 * the fully-joined reconstruction is returned.
 */
export function parseMediaOutputFromLog(
  stdoutLogbook: string,
  exists: (p: string) => boolean = fs.existsSync
): ResolvedMedia | null {
  const matches = [...stdoutLogbook.matchAll(RE_FILE_READY)];
  if (matches.length === 0) {
    return null;
  }
  const imageEntry = matches.find((m) =>
    wrapSegments(m.groups?.path ?? "").join("").endsWith(".png")
  );
  const chosen = imageEntry ?? matches[matches.length - 1];
  const candidates = pathCandidates(chosen.groups?.path ?? "");
  const mediaPath = candidates.find(exists) ?? candidates[0];
  return {
    isImage: !!imageEntry,
    mediaPath,
  };
}

/**
 * Fallback for when manim's logs are silent (e.g. verbosity WARNING or
 * ERROR): probe both predicted paths on disk and pick whichever exists,
 * preferring the most recently modified.
 */
export function probeMediaOnDisk(
  predictedVideo: string,
  predictedImage: string
): ResolvedMedia | null {
  const videoMtime = fs.existsSync(predictedVideo)
    ? fs.statSync(predictedVideo).mtimeMs
    : undefined;
  const imageMtime = fs.existsSync(predictedImage)
    ? fs.statSync(predictedImage).mtimeMs
    : undefined;
  if (
    imageMtime !== undefined &&
    (videoMtime === undefined || imageMtime >= videoMtime)
  ) {
    return { isImage: true, mediaPath: predictedImage };
  }
  if (videoMtime !== undefined) {
    return { isImage: false, mediaPath: predictedVideo };
  }
  return null;
}

export function baseName(mediaPath: string): string | undefined {
  return mediaPath.split(/\\|\//g).pop();
}
