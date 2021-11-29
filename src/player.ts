import { Context } from "mocha";
import * as vscode from "vscode";
import {
  ContextVars,
  DEFAULT_PROGRESS_BAR_COLOR,
  getNonce,
  getWebviewResource,
  insertContext,
  RunningConfig,
  WebviewResources,
} from "./globals";

export class VideoPlayer {
  constructor(
    public readonly ctx: vscode.ExtensionContext,
    public readonly extensionUri: vscode.Uri = ctx.extensionUri,
    public readonly disposables: any[] = ctx.subscriptions
  ) {
    this.setup();
  }

  private panel: vscode.WebviewPanel | undefined;
  private htmlDoc: string | undefined;

  private loads: WebviewResources = getWebviewResource(
    this.extensionUri,
    "player"
  );

  private fontAwesomeCss = {
    all: vscode.Uri.joinPath(
      this.extensionUri,
      "assets/fontawesome/css/all.min.css"
    ),
    fontawesome: vscode.Uri.joinPath(
      this.extensionUri,
      "assets/fontawesome/css/fontawesome.min.css"
    ),
  };

  private fontAwesomeJs = {
    all: vscode.Uri.joinPath(
      this.extensionUri,
      "assets/fontawesome/js/all.min.js"
    ),
    fontawesome: vscode.Uri.joinPath(
      this.extensionUri,
      "assets/fontawesome/js/fontawesome.min.js"
    ),
  };
  private manimIconsPath = {
    dark: vscode.Uri.joinPath(this.extensionUri, "assets/images/dark_logo.png"),
    light: vscode.Uri.joinPath(
      this.extensionUri,
      "assets/images/light_logo.png"
    ),
  };

  async setup(): Promise<string> {
    this.htmlDoc = (
      await vscode.workspace.fs.readFile(this.loads.html)
    ).toString();
    return this.htmlDoc;
  }

  parseProgressColor(colorStr?: string): string {
    if (!colorStr) {
       return DEFAULT_PROGRESS_BAR_COLOR;
    } else if (!colorStr.startsWith("#")) {
      return `var(--vscode-${colorStr.replace(/\./g, "-")});`;
    }
    return colorStr;
  }

  async show(videoUri: vscode.Uri, moduleName: string) {
    const resource = videoUri
      .with({ scheme: "vscode-resource" })
      .toString()
      .replace(
        /vscode-resource:/g,
        "https://file%2B.vscode-resource.vscode-webview.net"
      );
    if (this.panel) {
      return this.panel.webview.postMessage({
        command: "reload",
        resource: resource,
        pictureInPicture: vscode.workspace
          .getConfiguration("manim-sideview")
          .get("pictureInPictureOnStart"),
        out: videoUri.fsPath,
        moduleName: moduleName,
      });
    }
    if (!this.htmlDoc) {
      var htmlDoc = await this.setup();
    } else {
      var htmlDoc = this.htmlDoc;
    }
    this.panel = vscode.window.createWebviewPanel(
      videoUri.path,
      "Video Player",
      {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true,
      },
      {
        enableScripts: true,
      }
    );
    this.panel.iconPath = this.manimIconsPath;

    const styleSrc = this.panel.webview.asWebviewUri(this.loads.css).toString();
    const vars: ContextVars = {
      "%videoSrc%": resource,
      "%out%": videoUri.fsPath,
      "%moduleName%": moduleName,
      "%previewShowProgressOnIdle%": vscode.workspace
        .getConfiguration("manim-sideview")
        .get("previewShowProgressOnIdle")
        ? ""
        : " hidden-controls",
      "%previewProgressColor%": this.parseProgressColor(
        vscode.workspace
          .getConfiguration("manim-sideview")
          .get("previewProgressColor")
      ),
      "%cspSource%": this.panel.webview.cspSource,
      "player.css": styleSrc,
      "player.js": this.loads.js.with({ scheme: "vscode-resource" }).toString(),
      "%nonce%": getNonce(),
      "../../assets/fontawesome/css/all.min.css": this.panel.webview
        .asWebviewUri(this.fontAwesomeCss.all)
        .toString(),
      "../../assets/fontawesome/css/fontawesome.min.css": this.panel.webview
        .asWebviewUri(this.fontAwesomeCss.fontawesome)
        .toString(),
      "../../assets/fontawesome/js/all.min.js": this.fontAwesomeJs.all
        .with({ scheme: "vscode-resource" })
        .toString(),
      "../../assets/fontawesome/js/fontawesome.min.js":
        this.fontAwesomeJs.fontawesome
          .with({ scheme: "vscode-resource" })
          .toString(),
    };
    this.panel.webview.html = insertContext(vars, htmlDoc);
    this.panel.onDidDispose(
      () => {
        this.panel = undefined;
      },
      undefined,
      this.disposables
    );
  }
}
