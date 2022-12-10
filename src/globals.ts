/* eslint-disable @typescript-eslint/naming-convention */

import * as vscode from "vscode";
import * as fs from "fs";
import path = require("path");

export const LOGGER = vscode.window.createOutputChannel("Manim Sideview");
export const DefaultTerminalName = "manim-exc";
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
  quality: string;
  images_dir: string;
  frame_rate?: string;
};

// The key and value pairs that directly correlate to the output path
type FallbackConfig = {
  image_name: string;
  quality_map: { [tp: string]: string };
};

// default configurations, these values are set through ./local/manim.cfg.json
export var FALLBACK_CONFIG: ManimConfig & FallbackConfig = {
  media_dir: "",
  video_dir: "",
  images_dir: "",
  quality: "",
  image_name: "",
  quality_map: {},
};

export function getDefaultMainConfig() {
  return { ...FALLBACK_CONFIG };
}

/**
 * A configuration necessary to run a render.
 *
 * srcPath: the absolute path to the running Python file
 * sceneName: the name of the scene to be rendered
 * moduleName: the module name of the source file
 * srcRootFolder: the absolute path to the root directory
 * document: the vscode.TextDocument for the Python file
 * isUsingCfgFile: whether if this is running using a configuration file
 * manimConfig: manim config tied to the running config
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
  if (
    !Object.keys(FALLBACK_CONFIG.quality_map).includes(
      config.manimConfig.quality
    )
  ) {
    vscode.window.showErrorMessage(
      Log.error(
        `Manim Sideview: The quality "${config.manimConfig.quality}" provided in the configuration is invalid.`
      )
    );
    return;
  }

  let quality = FALLBACK_CONFIG.quality_map![config.manimConfig.quality];

  return insertContext(
    {
      "{quality}": quality,
      "{media_dir}": config.manimConfig.media_dir,
      "{module_name}": config.moduleName,
    },
    path.join(config.manimConfig.video_dir, `${config.sceneName}${extension}`)
  );
}

/**
 * @param config running config that provides the output path
 * @param loggedImageName logged name of the image file
 * @param extension extension of the image file
 * @returns
 */
export function getImageOutputPath(
  config: RunningConfig,
  loggedImageName?: string,
  extension: string = ".png"
) {
  return insertContext(
    {
      "{media_dir}": config.manimConfig.media_dir,
      "{module_name}": config.moduleName,
      // fallback inference variables
      "{version}": `ManimCE_${getUserConfiguration("manimExecutableVersion")}`,
      "{scene_name}": config.sceneName,
      "{extension}": extension,
    },
    path.join(
      config.manimConfig.images_dir,
      loggedImageName || FALLBACK_CONFIG.image_name
    )
  );
}

/**
 * Gets the user set configuration property, if it's not found somehow, will
 * fallback to using package.json set valus.
 *
 * @param property
 * @returns
 */
export function getUserConfiguration<T>(property: string): T {
  let value: T | undefined = vscode.workspace
    .getConfiguration("manim-sideview")
    .get(property);

  if (value === undefined) {
    const propertyDict =
      PACKAGE_JSON["contributes"]["configuration"]["properties"][
        `manim-sideview.${property}`
      ];
    if (propertyDict["type"] === "boolean") {
      return (propertyDict["default"] === "true"
        ? true
        : false) as unknown as T;
    }
  }
  return value!;
}

export type ContextVars = { [k: string]: string };

export type WebviewResources = {
  js: vscode.Uri;
  html: vscode.Uri;
  css: vscode.Uri;
};

// Loaded on activation
export const PATHS: { [tp: string]: vscode.Uri } = {};

export function updateFallbackManimCfg(
  updated: {
    [tp: string]: any;
  },
  saveUpdated: boolean = true
) {
  Object.keys(FALLBACK_CONFIG).forEach((ky) => {
    if (updated[ky]) {
      FALLBACK_CONFIG[ky as keyof ManimConfig] = updated[ky];
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

export var PACKAGE_JSON: { [key: string]: any } = {};

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
  PACKAGE_JSON = JSON.parse(
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
