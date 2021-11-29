import * as vscode from "vscode";
import {
  ContextVars,
  getNonce,
  getWebviewResource,
  insertContext,
  WebviewResources,
} from "./globals";
import * as https from "https";

// gallery synchronization files
const ENTRY_FILE =
  "https://raw.githubusercontent.com/kolibril13/mobject-gallery/main/init_images_and_text.js";
const VERSION_RE = /var\s*version_number\s*=\s*"([^"]+)";?/g;

export class Gallery {
  constructor(
    public readonly ctx: vscode.ExtensionContext,
    public readonly extensionUri: vscode.Uri = ctx.extensionUri,
    public readonly disposables: any[] = ctx.subscriptions
  ) {
    this.setup();
  }

  private panel: vscode.WebviewPanel | undefined;
  private htmlDoc: string | undefined;
  private mobjectsPath: vscode.Uri = vscode.Uri.joinPath(
    this.extensionUri,
    "assets/mobjects"
  );
  private imageMapping: { [header: string]: { [key: string]: string } } = {};
  private loads: WebviewResources = getWebviewResource(
    this.extensionUri,
    "gallery"
  );
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

    const loadables = (
      await vscode.workspace.fs.readDirectory(this.mobjectsPath)
    )
      .filter((f) => f[0].endsWith(".json") && f[1] === 1)
      .map((fd) => fd[0]);

    this.imageMapping = {};
    for (let x of loadables) {
      this.imageMapping[
        x.replace(".json", "").replace(new RegExp("_", "g"), " ")
      ] = JSON.parse(
        (
          await vscode.workspace.fs.readFile(
            vscode.Uri.joinPath(this.mobjectsPath, x)
          )
        ).toString()
      );
    }
    return this.htmlDoc;
  }

  async show() {
    if (!this.htmlDoc) {
      var htmlDoc = await this.setup();
    } else {
      var htmlDoc = this.htmlDoc;
    }
    this.panel = vscode.window.createWebviewPanel(
      "mobject-gallery",
      "Mobjects",
      {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true,
      },
      {
        enableScripts: true,
      }
    );
    this.panel.iconPath = this.manimIconsPath;

    var images = "";
    const panel = this.panel;
    Object.keys(this.imageMapping).forEach((title) => {
      images += `<h2>${title}</h2>`;
      Object.keys(this.imageMapping[title]).forEach((imgPth) => {
        images += `<img class="image-button" id="${this.imageMapping[title][
          imgPth
        ].replace(new RegExp('"', "g"), "'")}" src=${panel.webview.asWebviewUri(
          vscode.Uri.joinPath(this.mobjectsPath, "img", imgPth)
        )}>`;
      });
    });

    const vars: ContextVars = {
      "%cspSource%": this.panel.webview.cspSource,
      "gallery.css": this.panel.webview.asWebviewUri(this.loads.css).toString(),
      "gallery.js": this.loads.js
        .with({ scheme: "vscode-resource" })
        .toString(),
      "%nonce%": getNonce(),
      "%Mobjects%": images,
    };

    this.panel.webview.html = insertContext(vars, htmlDoc);
    this.panel.onDidDispose(
      () => {
        this.panel = undefined;
      },
      undefined,
      this.disposables
    );

    this.panel.webview.onDidReceiveMessage(
      (message) => {
        const doc = vscode.window.visibleTextEditors.filter(
          (e) => e.document.languageId === "python"
        );
        if (doc.length > 0) {
          const appendage = doc[0];
          const before = appendage.document.getText(
            new vscode.Range(
              new vscode.Position(appendage.selection.active.line, 0),
              appendage.selection.active
            )
          );
          var code = message.code;
          // adaptive indentations
          if (!before.trim()) {
            code = code.replace(new RegExp("\n", "g"), "\n" + before);
          }
          appendage.edit((e) => {
            e.insert(appendage.selection.active, code);
          });
          const a = vscode.window.activeTextEditor;
          vscode.commands.executeCommand("workbench.action.focusPreviousGroup");
        }
      },
      undefined,
      this.disposables
    );
  }

  async pullMobjects() {

  };

  async synchronize(
    progress: vscode.Progress<{ increment: number; message: string }>,
    token: vscode.CancellationToken
  ) {
    const localVersion = (
      await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(this.extensionUri, "assets/mobjects/version.txt")
      )
    ).toString();

    let request = https
      .get(ENTRY_FILE, function (res) {
        if (res.statusCode === 200) {
          res.on("data", function (d: Buffer) {
            const version = d.toString().match(VERSION_RE);

            if (version) {
              const segs = version[0].split('"');
              const olVersion = segs[segs.length - 2];

              if (olVersion !== localVersion) {
                progress.report({
                  increment: 10,
                  message: segs[segs.length - 2],
                });
                // downloads synchronization here
              } else {
                progress.report({
                  increment: 100,
                  message: "Your local version is already up to date!",
                });
                vscode.window.showInformationMessage("You're already up to date.");
                request.destroy();
              }
            }
          });
          request.setTimeout(1000, function () {
            request.destroy();
          });
          progress.report({ increment: 100, message: "Matching Versions" });
        } else {
          vscode.window.showErrorMessage(
            `Synchronizing failure for code ${res.statusCode}, ${res.statusMessage}`
          );
        }
      })
      .on("error", function (e) {
        vscode.window.showErrorMessage(`Synchronizing failure ${e.message}`);
      });
  }
}
