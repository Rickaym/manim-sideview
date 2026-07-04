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

// manim wraps long paths across lines inside the quotes; strip the
// wrapping whitespace to recover the real path
function cleanPath(p: string): string {
  return p.replace(/ |\r|\n/g, "");
}

/**
 * Finds the output file manim reported in its logs.
 *
 * Prefers an image entry if present; otherwise takes the last "File ready
 * at" entry, since videos log one line per partial movie file plus a final
 * entry for the merged output.
 */
export function parseMediaOutputFromLog(
  stdoutLogbook: string
): ResolvedMedia | null {
  const matches = [...stdoutLogbook.matchAll(RE_FILE_READY)];
  if (matches.length === 0) {
    return null;
  }
  const imageEntry = matches.find((m) =>
    cleanPath(m.groups?.path ?? "").endsWith(".png")
  );
  const chosen = imageEntry ?? matches[matches.length - 1];
  return {
    isImage: !!imageEntry,
    mediaPath: cleanPath(chosen.groups?.path ?? ""),
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
