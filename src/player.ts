import * as vscode from "vscode";
import {
  ContextVars,
  getNonce,
  insertContext,
  WebviewResources,
} from "./globals";

export class VideoPlayer {
  constructor(
    public readonly extensionUri: vscode.Uri,
    public readonly disposables: any[]
  ) {
    this.extensionUri = extensionUri;
    this.disposables = disposables;
  }

  private panel: vscode.WebviewPanel | undefined;
  private loads: WebviewResources = {
    css: vscode.Uri.joinPath(this.extensionUri, "webview/player/player.css"),
    js: vscode.Uri.joinPath(this.extensionUri, "webview/player/player.js"),
    html: vscode.Uri.joinPath(this.extensionUri, "webview/player/player.html"),
  };
  private htmlDoc: string | undefined;
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

  async show(videoUri: vscode.Uri) {
    const resource = videoUri.with({ scheme: "vscode-resource" }).toString().replace(/vscode-resource:/g, "https://file%2B.vscode-resource.vscode-webview.net");
    if (this.panel) {
      return this.panel.webview.postMessage({
        command: "reload",
        resource: resource,
        pictureInPicture: vscode.workspace
          .getConfiguration("manim-sideview")
          .get("pictureInPictureOnStart"),
      });
    }
    if (!this.htmlDoc) {
      this.htmlDoc = (
        await vscode.workspace.fs.readFile(this.loads.html)
      ).toString();
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
    this.panel.iconPath = {
      dark: vscode.Uri.joinPath(
        this.extensionUri,
        "assets/images/dark_logo.png"
      ),
      light: vscode.Uri.joinPath(
        this.extensionUri,
        "assets/images/light_logo.png"
      ),
    };

    const styleSrc = this.panel.webview.asWebviewUri(this.loads.css);
    const nonce = getNonce();
    const vars: ContextVars = {
      "%videoSrc%": resource,
      "%cspSource%": this.panel.webview.cspSource,
      "player.css": styleSrc.toString(),
      "%nonce%": nonce,
      "player.js": this.loads.js.with({ scheme: "vscode-resource" }).toString(),
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
    this.panel.webview.html = insertContext(vars, this.htmlDoc);
    this.panel.onDidDispose(
      () => {
        this.panel = undefined;
      },
      undefined,
      this.disposables
    );
  }
}
