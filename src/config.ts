import * as vscode from "vscode";
import { join } from "path";
import {
  ContextVars,
  DEFAULT_ARGS,
  DEFAULT_MEDIA_DIR,
  DEFAULT_VIDEO_DIR,
  getNonce,
  insertContext,
  RunningConfig,
  WebviewResources,
} from "./globals";

export class DueTimeConfiguration {
  constructor(
    public readonly extensionUri: vscode.Uri,
    public readonly disposables: any[]
  ) {
    this.extensionUri = extensionUri;
    this.disposables = disposables;
  }
  private panel: vscode.WebviewPanel | undefined;
  private loads: WebviewResources = {
    css: vscode.Uri.joinPath(this.extensionUri, "webview/config/config.css"),
    js: vscode.Uri.joinPath(this.extensionUri, "webview/config/config.js"),
    html: vscode.Uri.joinPath(this.extensionUri, "webview/config/config.html"),
  };
  private htmlDoc: string | undefined;

  async showInput(conf: RunningConfig) {
    if (this.panel) {
      vscode.window.showErrorMessage(
        "You cannot open multiple configuration panels at the same time."
      );
      return;
    }

    if (!this.htmlDoc) {
      this.htmlDoc = (
        await vscode.workspace.fs.readFile(this.loads.html)
      ).toString();
    }
    this.panel = vscode.window.createWebviewPanel(
      "inTimeConfiguration",
      "In Time Configurations",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
      }
    );

    this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, "assets/images/settings.png");

    const styleSrc = this.panel.webview.asWebviewUri(this.loads.css);
    const nonce = getNonce();

    const vars: ContextVars = {
      "%styleSrc%": styleSrc.toString(),
      "%cspSource%": this.panel.webview.cspSource,
      "%nonce%": nonce,
      "%scriptSrc%": this.loads.js
        .with({ scheme: "vscode-resource" })
        .toString(),
      "%args%":
        conf.args ||
        vscode.workspace
          .getConfiguration("manim-sideview")
          .get("commandLineArgs") ||
        DEFAULT_ARGS,
      "%video_dir%":
        conf.videoDir ||
        vscode.workspace
          .getConfiguration("manim-sideview")
          .get("videoDirectory") ||
        DEFAULT_VIDEO_DIR,
      "%scene_name%": conf.sceneName,
      "%media_dir%":
        conf.mediaDir ||
        vscode.workspace
          .getConfiguration("manim-sideview")
          .get("mediaDirectory") ||
        DEFAULT_MEDIA_DIR,
    };

    this.panel.webview.html = insertContext(vars, this.htmlDoc);

    this.panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case "dispose":
            if (this.panel) {
              this.panel.dispose();
            }
            return;
          case "configure":
            if (this.panel) {
              conf.args = message.args;
              conf.sceneName = message.sceneName;
              conf.videoDir = message.videoDir;
              conf.output = join(message.videoDir, conf.sceneName+".mp4");
              this.panel.dispose();
              vscode.window.showInformationMessage(
                "Success, I've configured the running configurations to the details provided for now!"
              );
            }
            return;
        }
      },
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(
      () => {
        this.panel = undefined;
      },
      undefined,
      this.disposables
    );
  }
}
