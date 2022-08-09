import * as vscode from "vscode";
import {
  ContextVars,
  getNonce,
  getWebviewResource,
  insertContext,
  PATHS,
  WebviewResources,
} from "./globals";
import * as fs from "fs";
import * as path from "path";
import Axios from "axios";
import axios from "axios";
import { TemplateEngine } from "./templateEngine";

const VERSION_RE = /version_number\s*=\s*"([^"]+)";?/g;
const GITHUB_ROOT_DIR =
  "https://raw.githubusercontent.com/kolibril13/mobject-gallery/main/";
// gallery synchronization files
const GITHUB_ENTRY_FILE =
  "https://raw.githubusercontent.com/kolibril13/mobject-gallery/main/index.js";
const GITHUB_ASSET_DIR =
  "https://raw.githubusercontent.com/kolibril13/mobject-gallery/main/gallery_assets/";
// object mappings
const mobjMap = "gallery_parameters.json";

interface ImageMap {
  image_path: string;
  celltype: string;
  css: string;
  code: string;
}

export class Gallery {
  constructor(
    public readonly extensionUri: vscode.Uri,
    public readonly disposables: any[]
  ) {}

  private panel: vscode.WebviewPanel | undefined;
  private mobjectsPath: vscode.Uri = vscode.Uri.joinPath(
    this.extensionUri,
    "assets/mobjects"
  );
  private imageMapping: { [title: string]: ImageMap[] } = {};
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

  async show() {
    this.panel = vscode.window.createWebviewPanel(
      "mobject-gallery",
      "Mobjects",
      {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true,
      },
      {
        enableScripts: true,
        enableForms: false,
      }
    );

    var images = "";
    const panel = this.panel;
    Object.keys(this.imageMapping).forEach((title) => {
      images += `<h2>${title}</h2>`;
      this.imageMapping[title].forEach((imgMap) => {
        const code = imgMap.code.replace(/"/g, "'");
        images += `<img class="image-button" src=${panel.webview.asWebviewUri(
          vscode.Uri.joinPath(this.mobjectsPath, imgMap.image_path)
        )} alt="${code}">`;
      });
    });

    const engine = new TemplateEngine(this.panel.webview, this.loads, "gallery");

    this.panel.iconPath = this.manimIconsPath;
    this.panel.webview.html = await engine.render({
      mobjects: images,
      version: (
        await vscode.workspace.fs.readFile(PATHS.mobjVersion)
      ).toString(),
    });

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

  /**
   * Fix indentations into user configured settings.
   *
   * @param code
   * @param editor
   * @returns string
   */
  static adaptiveIndent(code: string, editor: vscode.TextEditor) {
    const before = editor.document.getText(
      new vscode.Range(
        new vscode.Position(editor.selection.active.line, 0),
        editor.selection.active
      )
    );

    var tab = "\t";
    if (editor.options.insertSpaces && editor.options.tabSize) {
      if (typeof editor.options.tabSize === "string") {
        var tabSize = parseInt(editor.options.tabSize);
      } else {
        var tabSize = editor.options.tabSize;
      }
      tab = " ".repeat(tabSize);
    }
    if (!before.trim()) {
      const replacable = `\n${tab}`;
      code = code
        .replace(/\n    /g, replacable)
        .replace(/^\t/g, replacable)
        .replace(/\n/g, "\n" + before);
    }
    return code;
  }

  static getPreviousEditor() {
    if (!vscode.window.activeTextEditor) {
      vscode.commands.executeCommand("workbench.action.focusPreviousGroup");
    }
    return vscode.window.activeTextEditor;
  }

  async insertCode(code: string) {
    const lastEditor = this.lastActiveEditor
      ? this.lastActiveEditor
      : Gallery.getPreviousEditor();
    if (!lastEditor) {
      return vscode.window.showErrorMessage(
        "Select a document first and then use the gallery!"
      );
    }

    code = Gallery.adaptiveIndent(code, lastEditor);

    lastEditor
      .edit((e) => {
        e.insert(lastEditor.selection.active, code);
      })
      .then(() => {
        vscode.commands
          .executeCommand("workbench.action.focusPreviousGroup")
          .then(() =>
            lastEditor.revealRange(
              new vscode.Range(
                lastEditor.selection.active,
                lastEditor.selection.active
              )
            )
          );
      });
  }

  async synchronize(forceDownload: boolean) {
    const localVersion = (
      await vscode.workspace.fs.readFile(PATHS.mobjVersion)
    ).toString();

    const root = PATHS.mobjImgs.fsPath;
    var newVersion = localVersion;
    Axios.get(GITHUB_ENTRY_FILE).then(({ data }) => {
      if (!forceDownload) {
        const version = data.match(VERSION_RE);
        if (!version) {
          vscode.window.showErrorMessage(
            "Version descriptor in remote location missing. Please try again later."
          );
          return;
        }

        const segs = version[0].split('"');
        newVersion = segs[segs.length - 2];

        if (newVersion === localVersion) {
          vscode.window.showInformationMessage("You're already up to date!");
          return;
        }
      }
      vscode.window.showInformationMessage(
        "Please wait a moment while we pull remote assets..."
      );
      Axios.get(GITHUB_ASSET_DIR + mobjMap).then(({ data }) => {
        fs.writeFile(path.join(root, mobjMap), JSON.stringify(data), () => {});

        const imgAssets = Object.keys(data);
        imgAssets.forEach((categoryName) => {
          let allObjects: { [key: string]: string }[] = data[categoryName];
          allObjects.forEach((mObj) => {
            let imgFn = mObj.image_path;
            axios({
              method: "get",
              url: GITHUB_ROOT_DIR + imgFn,
              responseType: "stream",
            }).then(function (response) {
              response.data.pipe(fs.createWriteStream(path.join(root, imgFn)));
              if (
                categoryName === imgAssets[imgAssets.length - 1] &&
                mObj === allObjects[allObjects.length - 1]
              ) {
                fs.writeFile(PATHS.mobjVersion.fsPath, newVersion, () => {
                  vscode.window.showInformationMessage(
                    `Successfully downloaded all assets to version ${newVersion}! Please reload the webview.`
                  );
                });
              }
            });
          });
        });
      });
    });
  }
}
