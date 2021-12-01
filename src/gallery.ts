import * as vscode from "vscode";
import {
  ContextVars,
  getNonce,
  getWebviewResource,
  insertContext,
  WebviewResources,
} from "./globals";
import * as fs from "fs";
import * as path from "path";
import Axios from "axios";
import axios from "axios";

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
  private lastActiveEditor: vscode.TextEditor | undefined;

  setLastActiveEditor(editor: vscode.TextEditor) {
    this.lastActiveEditor = editor;
  }

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
      this.imageMapping[x.replace(".json", "").replace(/_/g, " ")] = JSON.parse(
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
        ].replace(/"/g, "'")}" src=${panel.webview.asWebviewUri(
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
        if (
          message.command === "update" ||
          message.command === "download-again"
        ) {
          return this.synchronize(message.command === "download-again");
        } else {
          this.insertCode(message.code);
        }
      },
      undefined,
      this.disposables
    );
  }

  getPreviousEditor() {
    if (!vscode.window.activeTextEditor) {
      vscode.commands.executeCommand("workbench.action.focusPreviousGroup");
    }
    return vscode.window.activeTextEditor;
  }

  async insertCode(code: string) {
    const editor = this.lastActiveEditor ? this.lastActiveEditor : this.getPreviousEditor();
    if (!editor) {
      return vscode.window.showErrorMessage(
        "Select a document first and then use the buttons!"
      );
    }
    const doc = vscode.window.visibleTextEditors.filter(
      (e) => e.document.fileName === editor.document.fileName
    );
    if (!doc) {
      return vscode.window.showErrorMessage(
        "You haven't selected any document to insert code."
      );
    }

    if (doc.length > 0) {
      const appendage = doc[0];
      const before = appendage.document.getText(
        new vscode.Range(
          new vscode.Position(appendage.selection.active.line, 0),
          appendage.selection.active
        )
      );
      // adaptive indentations
      if (!before.trim()) {
        code = code.replace(/\n/g, "\n" + before);
      }
      // notebooks need to be dealt with in a special case when it comes to
      // refocus - so far this isn't a good fix at all
      if (typeof appendage.document.notebook === "undefined") {
        vscode.window.showTextDocument(
          appendage.document,
          appendage.viewColumn
        );
      } else {
        vscode.commands.executeCommand("workbench.action.focusPreviousGroup");
        vscode.commands.executeCommand("notebook.focusPreviousEditor");
      }
      appendage.edit((e) => {
        e.insert(appendage.selection.active, code);
      });
    }
  }

  async synchronize(forceDownload: boolean) {
    const localVersion = (
      await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(this.extensionUri, "assets/mobjects/version.txt")
      )
    ).toString();
    const root = vscode.Uri.joinPath(
      this.extensionUri,
      "assets/mobjects/"
    ).fsPath;
    Axios.get(ENTRY_FILE).then(({ data }) => {
      if (!forceDownload) {
        const version = data.match(VERSION_RE);
        if (version) {
          const segs = version[0].split('"');
          const olVersion = segs[segs.length - 2];

          if (olVersion === localVersion) {
            vscode.window.showInformationMessage("You're already up to date.");
            return;
          }
        } else {
          vscode.window.showErrorMessage(
            "Version descriptor in remote location missing."
          );
          return;
        }
      }
      vscode.window.showInformationMessage(
        "Please wait a moment while we synchronize the local assets..."
      );
      JSON_FILES.forEach((fn) => {
        Axios.get(ASSET_DIR + fn).then(({ data }) => {
          fs.writeFile(path.join(root, fn), JSON.stringify(data), () => {});
          console.log(data);
          const assets = Object.keys(data);
          assets.forEach((imgFn) => {
            axios({
              method: "get",
              url: ASSET_DIR + imgFn,
              responseType: "stream",
            }).then(function (response) {
              response.data.pipe(
                fs.createWriteStream(path.join(root, "img", imgFn))
              );
              if (
                fn === JSON_FILES[JSON_FILES.length - 1] &&
                imgFn === assets[assets.length - 1]
              ) {
                vscode.window.showInformationMessage(
                  "Successfully downloaded all assets!"
                );
              }
            });
          });
        });
      });
    });
  }
}
