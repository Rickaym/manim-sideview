import * as fs from "fs";
import * as path from "path";

/**
 * Pure builder for the environment used when spawning manim. Kept free of
 * any vscode dependency so it can be unit tested directly; dependencies on
 * the platform, parent environment, and filesystem are injectable.
 *
 * Conda-style environments (conda, mamba, micromamba, pixi) are not
 * self-contained on Windows: native libraries live in directories (e.g.
 * `<prefix>\Library\bin`) that only join PATH during activation. Spawning
 * the bare executable without activation crashes the process at the OS
 * loader level (exit code 0xC06D007F) with no traceback the moment a
 * delay-loaded DLL such as numpy's BLAS is first called. Prepending the
 * activation directories to PATH fixes DLL resolution; `conda-meta` at the
 * prefix root is the marker all conda-style managers share.
 *
 * For non-conda installs, falls back to prepending the interpreter's bin
 * directory when one is known, so tools installed next to manim (ffmpeg in
 * venv environments) are found (#98).
 */

export const PYTHON_ENV_SCRIPTS_FOLDER = {
  win32: "Scripts",
  darwin: "bin",
  linux: "bin",
};

const executableFileExists = (p: string): boolean => {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/**
 * Locate manim relative to the python interpreter's directory. On Windows,
 * conda-style environments (conda, mamba, pixi) place python.exe at the env
 * prefix root while entry-point executables like manim.exe live under
 * `<prefix>\Scripts`, so the interpreter's directory alone is not enough.
 * Probes the interpreter directory first, then its scripts subfolder.
 * Returns the resolved path and the directory it lives in; when neither
 * candidate exists, returns the root candidate unchanged so callers keep
 * their existing not-found handling.
 */
export function resolveManimNextToInterpreter(
  interpreterDir: string,
  manimName: string,
  platform: NodeJS.Platform = process.platform,
  exists: (p: string) => boolean = executableFileExists
): { manim: string; binDir: string } {
  // Mirror checkExecutableExists, which probes both the bare name and .exe.
  const executableExists = (p: string) => exists(p) || exists(p + ".exe");

  const rootCandidate = path.join(interpreterDir, manimName);
  if (executableExists(rootCandidate)) {
    return { manim: rootCandidate, binDir: interpreterDir };
  }

  const scriptsFolder =
    PYTHON_ENV_SCRIPTS_FOLDER[
      platform as keyof typeof PYTHON_ENV_SCRIPTS_FOLDER
    ] || PYTHON_ENV_SCRIPTS_FOLDER["linux"];
  const scriptsDir = path.join(interpreterDir, scriptsFolder);
  const scriptsCandidate = path.join(scriptsDir, manimName);
  if (executableExists(scriptsCandidate)) {
    return { manim: scriptsCandidate, binDir: scriptsDir };
  }

  return { manim: rootCandidate, binDir: interpreterDir };
}

export type SpawnEnvDeps = {
  platform: NodeJS.Platform;
  baseEnv: NodeJS.ProcessEnv;
  exists: (p: string) => boolean;
};

export type SpawnEnvResult = {
  env: NodeJS.ProcessEnv;
  condaPrefix?: string;
};

const defaultDeps = (): SpawnEnvDeps => ({
  platform: process.platform,
  baseEnv: process.env,
  exists: fs.existsSync,
});

/**
 * @param manimExe path to the manim executable being spawned
 * @param binDir the interpreter's bin directory, if known
 * @returns the environment to spawn with, or undefined to inherit the
 * parent environment untouched
 */
export function buildSpawnEnv(
  manimExe: string,
  binDir?: string,
  deps: SpawnEnvDeps = defaultDeps()
): SpawnEnvResult | undefined {
  let prefix: string | undefined;
  if (path.isAbsolute(manimExe)) {
    // <prefix>/Scripts/manim.exe (win32) or <prefix>/bin/manim (unix)
    const candidate = path.dirname(path.dirname(manimExe));
    if (deps.exists(path.join(candidate, "conda-meta"))) {
      prefix = candidate;
    }
  }

  let binDirs: string[];
  if (prefix) {
    // The same directories conda activation prepends to PATH, in its order.
    binDirs =
      deps.platform === "win32"
        ? [
            prefix,
            path.join(prefix, "Library", "mingw-w64", "bin"),
            path.join(prefix, "Library", "usr", "bin"),
            path.join(prefix, "Library", "bin"),
            path.join(prefix, "Scripts"),
            path.join(prefix, "bin"),
          ]
        : [path.join(prefix, "bin")];
  } else if (binDir) {
    binDirs = [binDir];
  } else {
    return undefined;
  }

  const env: NodeJS.ProcessEnv = { ...deps.baseEnv };
  // On Windows the inherited key may be spelled "Path"; reuse it to avoid
  // handing the child duplicate PATH variables differing only in case.
  const pathKey =
    Object.keys(env).find((key) => key.toUpperCase() === "PATH") || "PATH";
  env[pathKey] =
    binDirs.join(path.delimiter) + path.delimiter + (env[pathKey] || "");
  if (prefix) {
    env.CONDA_PREFIX = prefix;
  }
  return { env, condaPrefix: prefix };
}
