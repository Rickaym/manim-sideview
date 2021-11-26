import * as vscode from "vscode";

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

export const DEFAULT_VIDEO_DIR = "media/videos/{module_name}/480p15";
export const DEFAULT_MEDIA_DIR = "media";
export const DEFAULT_ARGS = "-ql";
export const DEFAULT_MANIM_EXE = "manim";

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
  return vscode.workspace.workspaceFolders[0].uri.path;
}
