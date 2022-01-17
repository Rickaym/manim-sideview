import * as vscode from "vscode";
import { normalize } from "path";
import * as fs from "fs";

/**
 * A list of type and value definitions used in different modules with no ownership
 * to any.
 *
 * Mainly to avoid circular dependencies
 */

/**
 * A configuration necessary to run a render.
 *
 * exePath: the absolute path to the manim.exe executable
 * srcPath: the absolute path to the source.py file
 * sceneName: the name of the scene to be rendered
 * moduleName: the module name of the source file
 * args: the command line arguments
 * output: the relative path to the video file
 * mediaDir: the root folder for all media output
 * videoDir: the directory where the video is output
 * usingConfigFile: whether if this is running using a configuration file
 */
export type RunningConfig = {
  exePath: string;
  srcPath: string;
  sceneName: string;
  moduleName: string;
  args: string;
  root: string;
  output: string;
  document: vscode.TextDocument;
  mediaDir: string;
  videoDir: string;
  usingConfigFile: boolean;
};

export type ContextVars = { [k: string]: string };

export type WebviewResources = {
  js: vscode.Uri;
  html: vscode.Uri;
  css: vscode.Uri;
};

// internal in this context means internal to the extension
export type InternalManimCfg = {
  media_dir: string;
  video_dir: string;
  quality: string;
  quality_map: { [tp: string]: string };
  [exts: string]: string | { [tp: string]: string };
};

/**
 * A list of internal assets to all the  assets used within the
 * extension.
 */
const pathsToLoad: { [tp: string]: string } = {
  cfgMap: "assets/local/manim.cfg.json",
  mobjVersion: "assets/mobjects/mobject_version.txt",
  mobjImgs: "assets/mobjects/",
};

export const PATHS: { [tp: string]: vscode.Uri } = {};

// The supposed default internal manim configuration
export var INTERNAL_MANIM_CONFIG: InternalManimCfg = {
  media_dir: "",
  video_dir: "",
  quality: "",
  quality_map: {},
};

export var EXTENSION_VERSION: string | undefined;

/**
 * Load all the required assets as a resource
 * @param root root URI
 */
export function loadPaths(root: vscode.Uri) {
  Object.keys(pathsToLoad).forEach((tp) => {
    PATHS[tp] = vscode.Uri.joinPath(root, pathsToLoad[tp]);
  });
}

export async function loadGlobals(ctx: vscode.ExtensionContext) {
  loadPaths(ctx.extensionUri);
  const cfg = JSON.parse(
    (await vscode.workspace.fs.readFile(PATHS.cfgMap)).toString()
  );
  updateInternalManimCfg(cfg, false);
  var PACKAGE_JSON: { [key: string]: string } = JSON.parse(
    fs
      .readFileSync(
        vscode.Uri.joinPath(ctx.extensionUri, "package.json").fsPath
      )
      .toString()
  );
  EXTENSION_VERSION = PACKAGE_JSON["version"];
}

export function updateInternalManimCfg(
  updated: {
    [tp: string]: string;
  },
  saveUpdated: boolean = true
) {
  Object.keys(INTERNAL_MANIM_CONFIG).forEach((ky) => {
    if (updated[ky]) {
      INTERNAL_MANIM_CONFIG[ky] = updated[ky];
    }
  });
  if (saveUpdated) {
    fs.writeFile(
      PATHS.cfgMap.fsPath,
      JSON.stringify(INTERNAL_MANIM_CONFIG),
      () => {}
    );
  }
}

// base values for running in-time configurations
export const BASE_VIDEO_DIR = "media/videos/{module_name}/480p15";
export const BASE_MEDIA_DIR = "media";
export const BASE_ARGS = "-ql";
export const BASE_MANIM_EXE = "manim";
export const BASE_PROGRESS_BAR_COLOR = "var(--vscode-textLink-foreground)";

/**
 * Provide a nonce for inline scripts inside webviews, this is necessary for
 * script execution.
 * @returns nonce
 */
export function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/**
 * Replaces {variables} with a given map - sorta like how Python string
 * formatting works.
 *
 * @param context Context Variables
 * @param payload The string using the ctx variables
 * @returns
 */
export function insertContext(context: ContextVars, payload: string): string {
  var path = payload;
  Object.keys(context).forEach((k) => {
    if (path.includes(k)) {
      path = path.replace(new RegExp(k, "g"), context[k]);
    }
  });
  return path;
}

export function getRootPath(): string | false {
  if (!vscode.workspace.workspaceFolders) {
    vscode.window.showErrorMessage(
      "I couldn't figure out the root path due to the lack of workspaces, please make one!"
    );
    return false;
  }
  return normalize(vscode.workspace.workspaceFolders[0].uri.fsPath);
}

/**
 * Used in webviews to load the html, js and css paths in one call.
 *
 * @param extensionUri
 * @param viewName
 * @returns WebviewResources
 */
export function getWebviewResource(
  extensionUri: vscode.Uri,
  viewName: string
): WebviewResources {
  return {
    css: vscode.Uri.joinPath(
      extensionUri,
      `webview/${viewName}/${viewName}.css`
    ),
    js: vscode.Uri.joinPath(extensionUri, `webview/${viewName}/${viewName}.js`),
    html: vscode.Uri.joinPath(
      extensionUri,
      `webview/${viewName}/${viewName}.html`
    ),
  };
}
