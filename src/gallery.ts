import { fdatasync } from "fs/promises";
import * as vscode from "vscode";
import {
  ContextVars,
  getNonce,
  getWebviewResource,
  insertContext,
  WebviewResources,
} from "./globals";

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
      "MObjects",
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
      "%mObjects%": images,
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
          // there is only space or tabs behind
          var code = message.code;
          if (!before.trim()) {
            code = code.replace(new RegExp("\n", "g"), "\n" + before);
          }
          appendage.edit((e) => {
            e.insert(appendage.selection.active, code);
          });
          vscode.window.showTextDocument(
            appendage.document,
            vscode.ViewColumn.One
          );
        }
      },
      undefined,
      this.disposables
    );
  }
}
