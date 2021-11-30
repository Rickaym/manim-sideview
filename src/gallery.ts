import * as vscode from "vscode";
import {
  ContextVars,
  getNonce,
  getWebviewResource,
  insertContext,
  WebviewResources,
} from "./globals";
import * as https from "https";
import * as fs from "fs";
import path = require("path");

// gallery synchronization files
const ENTRY_FILE =
  "https://raw.githubusercontent.com/kolibril13/mobject-gallery/main/init_images_and_text.js";
const VERSION_RE = /var\s*version_number\s*=\s*"([^"]+)";?/g;
// files targeted for updating
const JSON_FILES = [
  "Camera_and_Style.json",
  "Mobjects_Basics.json",
  "Mobjects_Text.json",
  "Plots.json",
];
const ASSET_DIR =
  "https://raw.githubusercontent.com/kolibril13/mobject-gallery/main/imgs/";

/**
 * When the finale flag is true the function will dispatch the success
 * of it's last download. This is to notify when an update is over.
 */
function downloadTo(
  url: string,
  local: string,
  root: boolean,
  finale: boolean,
  version: string
) {
  let request = https
    .get(url, function (res) {
      if (res.statusCode === 200) {
        request.setTimeout(1000, function () {
          request.destroy();
        });
        var file = fs.createWriteStream(local);
        res.pipe(file).on("finish", function () {
          if (finale && root) {
            vscode.window.showInformationMessage(
              "Successfully updated Mobject gallery with the latest version!"
            );
            fs.writeFile(
              path.join(local, "../../version.txt"),
              version,
              () => {}
            );
          }
          vscode.workspace.fs
            .readFile(vscode.Uri.file(local))
            .then(function (data) {
              const images = Object.keys(JSON.parse(data.toString()));
              images.forEach((img) => {
                if (
                  img.endsWith("png") ||
                  img.endsWith("jpg") ||
                  img.endsWith("jpeg")
                ) {
                  downloadTo(
                    `${ASSET_DIR}${img}`,
                    path.join(local, "../img", img),
                    true,
                    img === images[images.length - 1] && finale,
                    version
                  );
                }
              });
            });
        });
      } else {
        vscode.window.showErrorMessage(
          `Downloading failure for code ${res.statusCode}, ${res.statusMessage}`
        );
      }
    })
    .on("error", function (e) {
      vscode.window.showErrorMessage(`Downloading failure ${e.message}`);
    });
}

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
        if (message.command === "update") {
          vscode.window.withProgress({
            "location": vscode.ProgressLocation.Notification,
            "title": "Attempting to synchronize local gallery..",
            "cancellable": true},
            (p, t) => this.synchronize(p, t)
          );
          return;
        }
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
          vscode.commands.executeCommand("workbench.action.focusPreviousGroup");
        }
      },
      undefined,
      this.disposables
    );
  }

  async synchronize(
    progress: vscode.Progress<{ increment: number; message: string }>,
    token: vscode.CancellationToken
  ) {
    const localVersion = (
      await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(this.extensionUri, "assets/mobjects/version.txt")
      )
    ).toString();

    const root = vscode.Uri.joinPath(this.extensionUri, "assets/mobjects/");

    let request = https
      .get(ENTRY_FILE, function (res) {
        if (res.statusCode === 200) {
          request.setTimeout(1000, function () {
            request.destroy();
          });
          res.on("data", function (d: Buffer) {
            const version = d.toString().match(VERSION_RE);

            if (version) {
              const segs = version[0].split('"');
              const olVersion = segs[segs.length - 2];

              if (olVersion === localVersion) {
                progress.report({
                  increment: 100,
                  message: "Your local version is already up to date!",
                });
                vscode.window.showInformationMessage(
                  "You're already up to date."
                );
                request.destroy();
                return;
              }

              JSON_FILES.forEach((fn) =>
                downloadTo(
                  `${ASSET_DIR}${fn}`,
                  vscode.Uri.joinPath(root, fn).fsPath,
                  false,
                  fn === JSON_FILES[JSON_FILES.length - 1],
                  olVersion
                )
              );
            }
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
