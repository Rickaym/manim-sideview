import * as vscode from "vscode";
import { getNonce, WebviewResources } from "./globals";

export class TemplateEngine {
  constructor(
    public readonly webview: vscode.Webview,
    public readonly resource: WebviewResources,
    public readonly name: String
  ) {}

  private resMap = {
    js: ` ${this.name}.js`,
    css: ` ${this.name}.css`,
  };
  private preamble = {
    cspSource: this.webview.cspSource,
    [this.resMap.js]: this.webview.asWebviewUri(this.resource.js).toString(),
    [this.resMap.css]: this.webview.asWebviewUri(this.resource.css).toString(),
    nonce: getNonce(),
  };

  static async renderDoc(fp: vscode.Uri, globals: { [varname: string]: any }) {
    return TemplateEngine.trueRender(
      (await vscode.workspace.fs.readFile(fp)).toString(),
      globals
    );
  }

  public static createCSSRegex(property: string, pattern: string) {
    return new RegExp(`${property}\s*:\s*(${pattern})\s*;`);
  }

  static trueRender(htmlDoc: string, globals: { [varname: string]: any }) {
    Object.keys(globals).forEach((varname) => {
      if (varname.startsWith(" ")) {
        htmlDoc = htmlDoc.replace(
          new RegExp(varname.trim(), "gi"),
          globals[varname]
        );
      } else {
        htmlDoc = htmlDoc.replace(
          new RegExp(`{{ ${varname} }}`, "gi"),
          globals[varname]
        );
      }
    });
    return htmlDoc;
  }

  /**
   * Render an HTML template file with the given variable parameters and the
   * required preamble.
   *
   * Semantics
   * 'varname' : {{ varname }}
   *  OR
   * ' varname' : varname
   *
   * The latter replaces any first occurence of the varname with unbound
   * squiggly braces. It must be fed into the globals object with a leading
   * space.
   */
  async render(globals: { [varname: string]: any }) {
    return TemplateEngine.trueRender(
      TemplateEngine.trueRender(
        (await vscode.workspace.fs.readFile(this.resource.html)).toString(),
        this.preamble
      ),
      globals
    );
  }
}
