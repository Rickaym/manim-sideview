import * as path from "path";

function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return (
    rel === "" ||
    (rel !== ".." &&
      !rel.startsWith(".." + path.sep) &&
      !path.isAbsolute(rel))
  );
}

export function isCoveredByRoots(roots: string[], dir: string): boolean {
  return roots.some((root) => isWithin(root, dir));
}

/**
 * Directories the preview webview must be allowed to read from in order to
 * load `mediaPath`. The source folder is always included; the media file's
 * own folder is added when it lives elsewhere, e.g. a `media_dir` outside
 * the project.
 */
export function mediaResourceRoots(
  srcRootFolder: string,
  mediaPath: string
): string[] {
  const mediaDir = path.dirname(mediaPath);
  return isWithin(srcRootFolder, mediaDir)
    ? [srcRootFolder]
    : [srcRootFolder, mediaDir];
}
