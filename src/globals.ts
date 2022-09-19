/* eslint-disable @typescript-eslint/naming-convention */

import * as vscode from "vscode";
import * as fs from "fs";
import path = require("path");

export const LOGGER = vscode.window.createOutputChannel("Manim Sideview");

type FormatHandlerFn = (level: string, msg: string) => string;

export class Log {
  static format(level: string, msg: string) {
    const date = new Date();
    return `[${date.toLocaleDateString()} ${date.getHours()}:${date.getMinutes()}] ${level.toUpperCase()}: ${msg}`;
  }

  static logs(
    level: string,
    msg: string,
    formatter: FormatHandlerFn = Log.format
  ) {
    LOGGER.appendLine(formatter(level, msg));
    return msg;
  }

  static info(msg: string) {
    return Log.logs("info", msg);
  }

  static warn(msg: string) {
    return Log.logs("warn", msg);
  }

  static error(msg: string) {
    return Log.logs("error", msg);
  }
}

// The key and value pairs that directly correlate to the output path
export type ManimConfig = {
  media_dir: string;
  video_dir: string;
  image_dir: string;
  quality: string;
  frame_rate: string;
};

export function getDefaultMainConfig(): ManimConfig {
  return {
    media_dir: FALLBACK_CONFIG.mediaDir,
    video_dir: FALLBACK_CONFIG.videoDir,
    image_dir: FALLBACK_CONFIG.imageDir,
    quality: FALLBACK_CONFIG.quality,
    frame_rate: FALLBACK_CONFIG.frameRate,
  };
}

/**
 * A configuration necessary to run a render.
 *
 * executablePath: the absolute path to the manim.exe executable
 * srcPath: the absolute path to the running Python file
 * sceneName: the name of the scene to be rendered
 * moduleName: the module name of the source file
 * cliArgs: any extra command line arguments
 * srcRootFolder: the absolute path to the root directory
 * document: the vscode.TextDocument for the Python file
 * isUsingCfgFile: whether if this is running using a configuration file
 */
export type RunningConfig = {
  srcPath: string;
  sceneName: string;
  moduleName: string;
  srcRootFolder: string;
  document: vscode.TextDocument;
  isUsingCfgFile: boolean;
  manimConfig: ManimConfig;
};

export function getVideoOutputPath(
  config: RunningConfig,
  extension: string = ".mp4"
) {
  // fix in the frame_rate value
  let quality = FALLBACK_CONFIG.qualityMap[config.manimConfig.quality];
  if (config.manimConfig.frame_rate !== quality.slice(-2)) {
    quality = quality.replace(quality.slice(-2), config.manimConfig.frame_rate);
  }

  return insertContext(
    {
      "{quality}": quality,
      "{media_dir}": config.manimConfig.media_dir,
      "{module_name}": config.moduleName,
      "{scene_name}": config.sceneName,
    },
    path.join(config.manimConfig.video_dir, `${config.sceneName}${extension}`)
  );
}

export function getImageOutputPath(
  config: RunningConfig,
  manimVersion: string,
  extension: string = ".png"
) {
  return insertContext(
    {
      "{media_dir}": config.manimConfig.media_dir,
      "{module_name}": config.moduleName,
      "{scene_name}": config.sceneName,
    },
    path.join(config.manimConfig.image_dir, `${config.sceneName}_ManimCE_v${manimVersion}${extension}`)
  );
}

export type ContextVars = { [k: string]: string };

export type WebviewResources = {
  js: vscode.Uri;
  html: vscode.Uri;
  css: vscode.Uri;
};

// internal in this context means internal to the extension
export type InternalManimCfg = {
  mediaDir: string;
  videoDir: string;
  imageDir: string;
  quality: string;
  frameRate: string;
  qualityMap: { [tp: string]: string };
  [exts: string]: string | { [tp: string]: string };
};

// Default configurations.
export var FALLBACK_CONFIG: InternalManimCfg = {
  mediaDir: "./media",
  videoDir: "{media_dir}/videos/{module_name}/{quality}",
  imageDir: "{media_dir}/images/{module_name}",
  quality: "low",
  frameRate: "15",
  qualityMap: {
    fourk: "2160p60",
    production: "1440p60",
    high: "1080p60",
    medium: "720p30",
    low: "480p15",
    example: "480p30",
  },
};

// Loaded on activation
export const PATHS: { [tp: string]: vscode.Uri } = {};

export function updateFallbackManimCfg(
  updated: {
    [tp: string]: string;
  },
  saveUpdated: boolean = true
) {
  Object.keys(FALLBACK_CONFIG).forEach((ky) => {
    if (updated[ky]) {
      FALLBACK_CONFIG[ky] = updated[ky];
    }
  });

  if (saveUpdated) {
    fs.writeFile(
      PATHS.cfgMap!.fsPath,
      JSON.stringify(FALLBACK_CONFIG),
      () => {}
    );
  }
}

export var EXTENSION_VERSION: string | undefined;

export async function loadGlobals(ctx: vscode.ExtensionContext) {
  Log.info("Loading globals.");

  const pathsToLoad: { [tp: string]: string } = {
    cfgMap: "assets/local/manim.cfg.json",
    mobjVersion: "assets/mobjects/mobject_version.txt",
    mobjGalleryParameters: "assets/mobjects/gallery_parameters.json",
    mobjImgs: "assets/mobjects/",
  };

  Object.keys(pathsToLoad).forEach((tp) => {
    PATHS[tp] = vscode.Uri.joinPath(ctx.extensionUri, pathsToLoad[tp]);
  });
  Log.info("Loaded all resource paths.");

  const cfg = JSON.parse(
    (await vscode.workspace.fs.readFile(PATHS.cfgMap!)).toString()
  );
  updateFallbackManimCfg(cfg, false);

  var PACKAGE_JSON: { [key: string]: string } = JSON.parse(
    fs
      .readFileSync(
        vscode.Uri.joinPath(ctx.extensionUri, "package.json").fsPath
      )
      .toString()
  );
  EXTENSION_VERSION = PACKAGE_JSON["version"];
  Log.info("Successfully loaded all globals.");
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
