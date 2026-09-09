import * as fs from "fs";
import * as path from "path";

/**
 * Pure helpers for the opt-in "run from workspace root" feature. Kept free
 * of any vscode dependency so they can be unit tested directly.
 */

/**
 * Picks the manim.cfg path the run should use.
 *
 * An explicitly set config path always wins. Otherwise, when a workspace
 * run root is active, a manim.cfg at that root is preferred because that is
 * the cwd manim will read it from; if none exists there, fall back to the
 * one next to the source file. Without a run root the choice is exactly the
 * legacy next-to-file path.
 */
export function findManimConfigPath(
  explicitPath: string,
  srcfilePath: string,
  runRoot?: string,
  exists: (p: string) => boolean = fs.existsSync
): string {
  if (explicitPath) {
    return explicitPath;
  }
  if (runRoot) {
    const rootConfig = path.join(runRoot, "manim.cfg");
    if (exists(rootConfig)) {
      return rootConfig;
    }
  }
  return path.join(srcfilePath, "../manim.cfg");
}

/**
 * The scene file argument passed to manim. When running from the workspace
 * root this is the path relative to that root, matching a manual
 * `manim src/main.py` invocation; otherwise the absolute path as before.
 */
export function resolveSceneFileArg(
  srcPath: string,
  runRoot: string,
  usesWorkspaceRoot: boolean
): string {
  if (!usesWorkspaceRoot) {
    return srcPath;
  }
  const relative = path.relative(runRoot, srcPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return srcPath;
  }
  return relative;
}
