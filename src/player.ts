import * as vscode from "vscode";
import {
  ContextVars,
  BASE_PROGRESS_BAR_COLOR,
  getNonce,
  getWebviewResource,
  insertContext,
  WebviewResources,
  RunningConfig,
} from "./globals";
import { TemplateEngine } from "./templateEngine";

export class VideoPlayer {
  constructor(
    public readonly extensionUri: vscode.Uri,
    public readonly disposables: any[]
  ) {}

  private panel: vscode.WebviewPanel | undefined;

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

  async showVideo(videoUri: vscode.Uri, runtimeConfig: RunningConfig) {
    // const title = runtimeConfig.output.split("\\").pop() || "Untitled";
    const title = runtimeConfig.sceneName;
    if (this.panel) {
      return this.panel.webview.postMessage({
        command: "reload",
        resource: this.panel.webview.asWebviewUri(videoUri).toString(),
        pictureInPicture: vscode.workspace
          .getConfiguration("manim-sideview")
          .get("pictureInPictureOnStart"),
        out: videoUri.fsPath,
        moduleName: title,
      });
    }

    this.panel = vscode.window.createWebviewPanel(
      videoUri.path,
      "Manim Sideview",
      {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true,
      },
      {
        enableScripts: true,
      }
    );

    const engine = new TemplateEngine(
      this.panel.webview,
      getWebviewResource(this.extensionUri, "player"),
      "player"
    );
    const conf = vscode.workspace.getConfiguration("manim-sideview");
    this.panel.iconPath = this.manimIconsPath;
    this.panel.webview.html = await engine.render({
      videoSrc: this.panel.webview.asWebviewUri(videoUri).toString(),
      out: videoUri.fsPath,
      moduleName: title,
      previewShowProgressOnIdle: conf.get("previewShowProgressOnIdle")
        ? ""
        : " hidden-controls",
      previewProgressStyle: this.parseProgressStyle(
        conf.get("previewProgressColor")
      ),
      loop: conf.get("previewLooping") ? "loop" : "",
      autoplay: conf.get("previewAutoPlay") ? "autoplay" : "",
    });

    this.panel.onDidDispose(
      () => {
        this.panel = undefined;
      },
      undefined,
      this.disposables
    );
  }
}
