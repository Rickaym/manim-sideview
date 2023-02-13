import * as vscode from "vscode";

/**
 * A minimal implementation to parse a toml subset of config files without any
 * type concern.
 * Only supports sectionalized key = value pairs and no type persistance.
 * The aim here is to parse out only necessary string type details.
 *
 *           CONFIG           ||              Captured Result
 * ---------------------------++------------------------------------
 * [Title]                    ||   { Title: {
 *  save_as_gif = True        ||      save_as_gif: "True",
 *  background_color = WHITE  ||      background_color: "WHITE";
 *                            ||   } }
 */

type Config = { [name: string]: { [name: string]: any } };

// key = value
const RE_KEYVALPAIR = /(?<key>\w+)\s*=\s*(?<value>.+)/g;

export class ConfigParser {
  static async parse(uri: string): Promise<Config> {
    const result: Config = {};

    const contents = (await vscode.workspace.fs.readFile(vscode.Uri.file(uri))).toString();
    const sect = "CLI";
    [...contents.matchAll(RE_KEYVALPAIR)].forEach((r) => {
      if (r && r.groups) {
        if (!result[sect]) {
          result[sect] = {};
        }
        result[sect][r.groups.key] = r.groups.value;
      }
    });
    return result;
  }
}
