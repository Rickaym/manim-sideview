import * as vscode from "vscode";
import { getNonce, WebviewResources } from "./globals";

export class TemplateEngine {
  constructor(
    public readonly webview: vscode.Webview,
    public readonly resource: WebviewResources,
    public readonly name: String,
    public readonly extensionUri: vscode.Uri
  ) {}

  private resMap = {
    js: ` ${this.name}.js`,
    css: ` ${this.name}.css`
  };

  /**
   * A list of preamble context variables that will be rendered without
   * explicit instructions.
   */
  private preamble = {
    cspSource: this.webview.cspSource,
    [this.resMap.js]: this.webview.asWebviewUri(this.resource.js).toString(),
    [this.resMap.css]: this.webview.asWebviewUri(this.resource.css).toString(),
    nonce: getNonce(),
    // eslint-disable-next-line @typescript-eslint/naming-convention
    "codicon.css": this.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        "node_modules",
        "@vscode/codicons",
        "dist",
        "codicon.css"
      )
    )
  };

  static async renderDoc(fp: vscode.Uri, globals: { [varname: string]: any }) {
    return TemplateEngine.textRender((await vscode.workspace.fs.readFile(fp)).toString(), globals);
  }

  public static createCSSRegex(property: string, pattern: string) {
    return new RegExp(`${property}\s*:\s*(${pattern})\s*;`);
  }

  static textRender(text: string, globals: { [varname: string]: any }) {
    Object.keys(globals).forEach((varname) => {
      if (varname.startsWith(" ")) {
        text = text.replace(new RegExp(varname.trim(), "gi"), globals[varname]);
      } else {
        text = text.replace(new RegExp(`{{ ${varname} }}`, "gi"), globals[varname]);
      }
    });
    return text;
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
   * The latter replaces the first occurence of the varname without squiggly braces.
   * The value for it must be fed into the globals object with a leading space.
   */
  async render(globals: { [varname: string]: any }) {
    return TemplateEngine.textRender(
      TemplateEngine.textRender(
        (await vscode.workspace.fs.readFile(this.resource.html)).toString(),
        this.preamble
      ),
      globals
    );
  }
}
