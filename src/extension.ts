import { readFile, readFileSync } from "fs";
import path = require("path");
import * as vscode from "vscode";
import { ConfigParser } from "./configparser";

// {media_dir}/videos/{module_name}/{quality}

const CONFIG_STATE_ID = "config_state_id";
const DEFAULT_MEDIA_DIR = "videos/${fileName}/${sceneName}.mp4";
/**
 * TODO:
 *       2. Using Parsed results in extensions
 */

/**
 * An object of context variables and their suppliers
 */
const CONTEXT_VARIABLES: { [varName: string]: any } = {
  "${fileName}": function (): string {
    if (vscode.window.activeTextEditor) {
      const fn = generalizeUri(
        vscode.window.activeTextEditor.document.fileName
      ).split("/");
      return fn[fn.length - 1];
    } else {
      return "none";
    }
  },
};

// generalizes both directional slashes into a forward slash
const generalizeUri = (uri: string) => uri.replace(/\\/g, "/");

/**
 * Location mapping of where certain details are stored inside the
 * manim config.
 *
 * These should be changed accordingly if there are any changes to the
 * manim configuration.
 */
const OUTPUT_LC = { section: "CLI", key: "media_dir" };

// Relevant config for running
type RunningConfig = {
  path: string;
  args: string;
  output: string;
  filepath: string;
};

// Fromatted manim config from .cfg
type ManimConfig = {
  output: string;
};

class ManimSideview {
  constructor(public readonly ctx: vscode.ExtensionContext) {
    this.ctx = ctx;
    this.manimCfgPath = "";
    this.jobs = {};
  }
  private manimCfgPath: string;
  // a list of running jobs tied to each file
  // starting a job will allow auto-save rendering
  // unless explicitely disabled
  private jobs: { [sourcePath: string]: boolean };

  async run(onSave: boolean = false) {
    if (!vscode.window.activeTextEditor) {
      return await vscode.window.showErrorMessage(
        "Hey! You need a valid Python file to run the sideview."
      );
    }
    const srcPath = vscode.window.activeTextEditor.document.fileName;

    if (onSave && !this.jobs[srcPath]) {
      return;
    }

    const conf = await this.getRunningConfig(srcPath);
    let error: string | undefined;

    if (!conf.path) {
      error =
        "You cannot run a manim sideview without supplying a valid manim executable path.";
    } else if (!conf.output) {
      error = "You haven't supplied a valid media output path.";
    }
    if (error) {
      return await vscode.window.showErrorMessage(error);
    }

    var terminal;
    vscode.window.terminals.forEach((t) => {
      if (t.name === "Manim") {
        terminal = t;
      }
    });
    if (!terminal) {
      terminal = vscode.window.createTerminal(`Manim`);
    }
    terminal.sendText(`${conf.path} ${conf.filepath} ${conf.args}`);

    // formulate a decent system to understand when a command is executed
    const selects = await vscode.window.showInformationMessage(
      "Please press Ok once you want to load the preview.",
      "Ok"
    );
    if (selects !== "Ok") {
      return;
    }
    // Mpeg-4 cross extension dependency guard
    const exists = (await vscode.commands.getCommands(false)).filter(
      (c) => c === "preview-mp4.zoomIn"
    );
    if (!exists) {
      return await vscode.window.showErrorMessage(
        "You have a cross extension dependency missing, please install it here: https://marketplace.visualstudio.com/items?itemName=analytic-signal.preview-mp4"
      );
    }

    try {
      this.openSideview(this.outputPathByContext(conf));
      this.jobs[srcPath] = true;
    } catch (e) {
      console.log(e);
      await vscode.window.showErrorMessage(
        "I'm unable to resolve the relative path due to the lack of workspace root folders, please provide an absolute path."
      );
    }
  }

  async refreshConfiguration() {
    this.ctx.workspaceState.update(CONFIG_STATE_ID, undefined);
  }

  async setConfigFile() {
    const uri = await vscode.window.showOpenDialog({
      canSelectFolders: false,
      canSelectMany: false,
      title: "Open manim.cfg",
      filters: { config: ["cfg", "config", "ini"] },
    });
    if (uri) {
      const pth: string = generalizeUri(uri[0].path);
      this.manimCfgPath = pth.startsWith("/") ? pth.substring(1) : pth;
      this.ctx.workspaceState.update(CONFIG_STATE_ID, true);
    }
  }

  toAbsolutePath(path: string): string {
    var op = generalizeUri(path);
    if (op.startsWith("./")) {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders) {
        throw TypeError("Workspace folders cannot be empty.");
      } else {
        var rootPath = folders[0].uri.fsPath + "/";
      }
      op = op.replace("./", rootPath);
    }
    return op;
  }

  outputPathByContext(conf: RunningConfig): string {
    const path = this.toAbsolutePath(conf.output);
    Object.keys(CONTEXT_VARIABLES).forEach((k) => {
      if (path.includes(k)) {
        path.replace(k, CONTEXT_VARIABLES[k]());
      }
    });
    return path;
  }

  /**
   * Finds the manim.cfg file and if exists returns a
   * ManimConfig object
   *
   * @param sourcePath
   * @returns ManimConfig
   */
  async getManimConfig(sourcePath: string): Promise<ManimConfig | undefined> {
    var chosen = this.ctx.workspaceState.get(CONFIG_STATE_ID);
    var cfg = undefined;

    // we must reload the config for every run unless explicitly cancelled
    if (chosen !== false) {
      var cfgPath: string;

      if (this.manimCfgPath) {
        cfgPath = this.manimCfgPath;
      } else {
        // user made manim.cfg files normally must remain on the
        // same directory of the source path thus we can guess this as such
        cfgPath = sourcePath.split("/").slice(0, -1).join("/") + "/manim.cfg";
      }
      try {
        cfg = ConfigParser.parse(cfgPath);
      } catch (e) {}

      if (cfg) {
        cfg = {
          output: Object.keys(cfg).includes(OUTPUT_LC.section)
            ? this.toAbsolutePath(cfg[OUTPUT_LC.section][OUTPUT_LC.key]) ||
              DEFAULT_MEDIA_DIR
            : DEFAULT_MEDIA_DIR,
        };
      } else {
        return undefined;
      }
    }

    if (chosen === true) {
      return cfg;
    } else if (chosen === undefined) {
      const selects = await vscode.window.showInformationMessage(
        "I found a `manim.cfg` file in the source directory. Would you like to use the options for rendering the video preview? You can always get this dialog back when running by using the refresh Configuration command.",
        "Yes",
        "No"
      );
      this.ctx.workspaceState.update(CONFIG_STATE_ID, selects === "Yes");
      return selects === "Yes" ? cfg : undefined;
    }
  }

  /**
   * Get the configurations in a tightly packed
   * object relevant for running.
   */
  async getRunningConfig(sourcePath: string): Promise<RunningConfig> {
    const conf = vscode.workspace.getConfiguration("manim-sideview");

    const exe: string = conf.get("defaultManimPath") || "";
    var args: string = conf.get("commandLineArgs") || "";
    var videoFP: string = conf.get("videoFilePath") || "";
    videoFP = generalizeUri(videoFP);

    sourcePath = generalizeUri(sourcePath);
    var output: string = "";

    const runningCfg: RunningConfig = {
      path: exe,
      args: args,
      output: output,
      filepath: sourcePath,
    };

    const cfg = await this.getManimConfig(sourcePath);
    if (cfg) {
      runningCfg.output =
        cfg.output + videoFP.startsWith("/") ? videoFP : "/" + videoFP;
    } else {
      await this.getInTimeConfiguration(runningCfg);
    }
    return runningCfg;
  }

  async getInTimeConfiguration(runningCfg: RunningConfig | null) {
    const _panel = vscode.window.createWebviewPanel(
      "inTimeConfiguration",
      "In Time Configurations",
      vscode.ViewColumn.Beside,
      {}
    );
    const htlmDiskPth = vscode.Uri.joinPath(
      this.ctx.extensionUri,
      "webview",
      "config.html"
    );
    const styleDiskPth = vscode.Uri.joinPath(
      this.ctx.extensionUri,
      "webview",
      "config.css"
    );
    const styleSrc = _panel.webview.asWebviewUri(styleDiskPth);

    // context variables we need to replace
    const vars: { [k: string]: string } = {
      "%styleSrc%": styleSrc.toString(),
      '"%styleSrc%"': `"${styleSrc.toString()}"`,
      "%cspSource%": _panel.webview.cspSource,
    };

    var htmlDoc = readFileSync(htlmDiskPth.path.startsWith("/") ? htlmDiskPth.path.substring(1) : htlmDiskPth.path).toString();
    Object.keys(vars).forEach((k) => {
      if (htmlDoc.includes(k)) {
        htmlDoc = htmlDoc.replace(new RegExp(k, "g"), vars[k]);
      }
    });
    _panel.webview.html = htmlDoc;

  }

  openSideview(mediaFp: string) {
    const res = vscode.Uri.file(mediaFp);
    if (!res) {
      vscode.window.showErrorMessage("The output file couldn't be found.");
    } else {
      vscode.commands.executeCommand(
        "vscode.openWith",
        res,
        "analyticsignal.preview-mp4",
        vscode.ViewColumn.Beside
      );
    }
  }
}

export function activate(context: vscode.ExtensionContext) {
  const view = new ManimSideview(context);
  // When registering commands, insert function calls into closures to persist "this"
  view.getInTimeConfiguration(null);
  context.subscriptions.push(
    vscode.commands.registerCommand("manim-sideview.run",
    async function () {
      await view.run();
    }),
    vscode.commands.registerCommand(
      "manim-sideview.refreshConfiguration",
      async function () {
        await view.refreshConfiguration();
      }
    ),
    vscode.commands.registerCommand(
      "manim-sideview.setConfigFile",
      async function () {
        await view.setConfigFile();
      }
    )
  );
  vscode.workspace.onDidSaveTextDocument(
    (e) => {
      if (
        vscode.workspace.getConfiguration("manim-sideview").get("runOnSave")
      ) {
        vscode.commands.executeCommand("manim-sideview.run", true);
      }
    },
    null,
    context.subscriptions
  );

  vscode.window.showInformationMessage("Manim Sideview Live.");
}

export function deactivate() {}
