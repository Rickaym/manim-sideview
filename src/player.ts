import * as vscode from "vscode";
import {
  BASE_PROGRESS_BAR_COLOR,
  getWebviewResource,
  RunningConfig,
} from "./globals";
import { TemplateEngine } from "./templateEngine";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const PlayableMediaType = {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  Video: 0,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  Image: 1,
};

export class MediaPlayer {
  constructor(
    public readonly extensionUri: vscode.Uri,
    public readonly disposables: any[]
  ) {}

  private recentVideoPanel: vscode.WebviewPanel | undefined;
  private recentImagePanel: vscode.WebviewPanel | undefined;

  private manimIconsPath = {
    dark: vscode.Uri.joinPath(this.extensionUri, "assets/images/dark_logo.png"),
    light: vscode.Uri.joinPath(
      this.extensionUri,
      "assets/images/light_logo.png"
    ),
  };

  parseProgressStyle(colorStr?: string): string {
    if (!colorStr) {
      colorStr = BASE_PROGRESS_BAR_COLOR;
    } else if (
      colorStr.includes(";") ||
      colorStr.includes('"') ||
      colorStr.includes("'")
    ) {
      // prevents html injections
      colorStr = BASE_PROGRESS_BAR_COLOR;
    } else if (!colorStr.startsWith("#")) {
      colorStr = `var(--vscode-${colorStr.replace(/\./g, "-")});`;
    }
    return `style="background-color: ${colorStr}"`;
  }

  async playMedia(
    mediaUri: vscode.Uri,
    config: RunningConfig,
    mediaType: number
  ) {
    if (mediaType === PlayableMediaType.Video && this.recentVideoPanel) {
      return this.recentVideoPanel.webview.postMessage({
        command: "reload",
        mediaType: mediaType,
        resource: this.recentVideoPanel.webview
          .asWebviewUri(mediaUri)
          .toString(),
        pictureInPicture: vscode.workspace
          .getConfiguration("manim-sideview")
          .get("pictureInPictureOnStart"),
        out: mediaUri.fsPath,
        moduleName: config.sceneName,
      });
    }

    if (mediaType === PlayableMediaType.Image && this.recentImagePanel) {
      return this.recentImagePanel.webview.postMessage({
        command: "reload",
        mediaType: mediaType,
        resource: this.recentImagePanel.webview
          .asWebviewUri(mediaUri)
          .toString(),
        out: mediaUri.fsPath,
        moduleName: config.sceneName,
      });
    }

    const panel = vscode.window.createWebviewPanel(
      mediaUri.path,
      "Manim Sideview",
      {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true,
      },
      {
        localResourceRoots: [
          vscode.Uri.joinPath(
            vscode.Uri.file(config.document.uri.fsPath),
            "../"
          ),
          this.extensionUri,
        ],
        enableScripts: true,
      }
    );

    const engine = new TemplateEngine(
      panel.webview,
      getWebviewResource(this.extensionUri, "player"),
      "player"
    );
    const prefs = vscode.workspace.getConfiguration("manim-sideview");
    const targetKey =
      mediaType === PlayableMediaType.Video ? "videoDir" : "posterDir";
    const toBeHid =
      mediaType === PlayableMediaType.Video
        ? "posterHideState"
        : "videoHideState";

    panel.iconPath = this.manimIconsPath;
    panel.webview.html = await engine.render({
      [targetKey]: panel.webview.asWebviewUri(mediaUri).toString(),
      [toBeHid]: "hidden",
      mediaDir: mediaUri.fsPath,
      moduleName: config.sceneName,
      previewShowProgressOnIdle: prefs.get("previewShowProgressOnIdle")
        ? ""
        : " hidden-controls",
      previewProgressStyle: this.parseProgressStyle(
        prefs.get("previewProgressColor")
      ),
      loop: prefs.get("previewLooping") ? "loop" : "",
      autoplay: prefs.get("previewAutoPlay") ? "autoplay" : "",
    });

    panel.webview.onDidReceiveMessage(
      (message) => {
        if (message.command === "reload-webviews") {
          vscode.commands.executeCommand(
            "workbench.action.webview.reloadWebviewAction"
          );
        }
      },
      undefined,
      this.disposables
    );

    panel.onDidDispose(
      () => {
        if (
          mediaType === PlayableMediaType.Image &&
          panel === this.recentImagePanel
        ) {
          this.recentImagePanel = undefined;
        } else if (
          mediaType === PlayableMediaType.Video &&
          panel === this.recentVideoPanel
        ) {
          this.recentVideoPanel = undefined;
        }
      },
      undefined,
      this.disposables
    );

    if (mediaType === PlayableMediaType.Image) {
      this.recentImagePanel = panel;
    } else if (mediaType === PlayableMediaType.Video) {
      this.recentVideoPanel = panel;
    }
  }
}
