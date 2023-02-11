import * as vscode from "vscode";
import {
  BASE_PROGRESS_BAR_COLOR,
  getUserConfiguration,
  getWebviewResource,
  Log,
  RunningConfig
} from "./globals";
import { TemplateEngine } from "./templateEngine";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const PlayableMediaType = {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  Video: 0,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  Image: 1
};

export class MediaPlayer {
  constructor(public readonly extensionUri: vscode.Uri, public readonly disposables: any[]) {}

  private recentMediaPanel: vscode.WebviewPanel | undefined;

  private manimIconsPath = {
    dark: vscode.Uri.joinPath(this.extensionUri, "assets/images/dark_logo.png"),
    light: vscode.Uri.joinPath(this.extensionUri, "assets/images/light_logo.png")
  };

  parseProgressStyle(colorStr?: string): string {
    if (!colorStr) {
      colorStr = BASE_PROGRESS_BAR_COLOR;
    } else if (colorStr.includes(";") || colorStr.includes('"') || colorStr.includes("'")) {
      // prevents html injections
      colorStr = BASE_PROGRESS_BAR_COLOR;
    } else if (!colorStr.startsWith("#")) {
      colorStr = `var(--vscode-${colorStr.replace(/\./g, "-")});`;
    }
    return `style="background-color: ${colorStr}"`;
  }

  asCacheBreakingWebviewUri(webveiw: vscode.Webview, uri: vscode.Uri) {
    return `${webveiw.asWebviewUri(uri).toString()}?t=${new Date().getTime()}`;
  }

  async playMedia(mediaUri: vscode.Uri, config: RunningConfig, mediaType: number) {
    if (this.recentMediaPanel) {
      const resource = this.asCacheBreakingWebviewUri(this.recentMediaPanel.webview, mediaUri);
      Log.info(`Reloading media to URI "${mediaUri.fsPath}"`);
      return this.recentMediaPanel.webview.postMessage({
        command: "reload",
        mediaType: mediaType,
        resource: resource,
        outputFile: mediaUri.fsPath,
        sourceFile: config.srcPath,
        moduleName: config.sceneName
      });
    }
    const panel = vscode.window.createWebviewPanel(
      mediaUri.path,
      "Manim Sideview",
      {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true
      },
      {
        localResourceRoots: [
          vscode.Uri.joinPath(vscode.Uri.file(config.document.uri.fsPath), "../"),
          this.extensionUri
        ],
        enableScripts: true
      }
    );

    const engine = new TemplateEngine(
      panel.webview,
      getWebviewResource(this.extensionUri, "player"),
      "player",
      this.extensionUri
    );
    // the property key to set the resource url to
    const srcReplacementKey = mediaType === PlayableMediaType.Video ? "videoDir" : "imageDir";

    // the property variable key from the HTML document to hide
    const hideKey = mediaType === PlayableMediaType.Video ? "imageHideState" : "videoHideState";

    panel.iconPath = this.manimIconsPath;
    panel.webview.html = await engine.render({
      [srcReplacementKey]: this.asCacheBreakingWebviewUri(panel.webview, mediaUri),
      [hideKey]: "hidden",
      outputFile: mediaUri.fsPath,
      sourceFile: config.srcPath,
      moduleName: config.sceneName,
      previewShowProgressOnIdle: getUserConfiguration("previewShowProgressOnIdle")
        ? ""
        : " hidden-controls",
      previewProgressStyle: this.parseProgressStyle(getUserConfiguration("previewProgressColor")),
      loop: getUserConfiguration("previewLooping") ? "loop" : "",
      autoplay: getUserConfiguration("previewAutoPlay") ? "autoplay" : ""
    });
    Log.info(`Playing media URI "${mediaUri.fsPath}"`);

    panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          // Executes a manim-sideview command and then executes run command
          case "executeSelfCommand":
            Log.info(`Executing command "manim-sideview.${message.name}" for webview.`);
            vscode.commands.executeCommand(`manim-sideview.${message.name}`, ...message.args);
            break;
          case "errorMessage":
            vscode.window.showErrorMessage(Log.error(message.text));
            break;
        }
      },
      undefined,
      this.disposables
    );

    panel.onDidDispose(
      () => {
        if (panel === this.recentMediaPanel) {
          this.recentMediaPanel = undefined;
        }
      },
      undefined,
      this.disposables
    );

    this.recentMediaPanel = panel;
  }
}
