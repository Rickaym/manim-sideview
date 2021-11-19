import { readFileSync } from "fs";
import * as vscode from "vscode";
import { ConfigParser, Config } from "./configparser";

// {media_dir}/videos/{module_name}/{quality}
const DEFAULT_MEDIA_DIR = "videos/${fileName}/${sceneName}.mp4";
const USER_DEF_CONFIGURATION = ["output", "sceneName"];
const LOCATE = { section: "CLI", key: "media_dir" };

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

// Relevant config for running, not all are user provided
type RunningConfig = {
  exePath: string;
  srcPath: string;
  sceneName: string;
  args: string;
  output: string;
  usingConfigFile: boolean;
};

// The key and value pairs here directly correlate to
// USER_DEF_CONFIGURATION
type ManimConfig = {
  output: string;
  sceneName: string;
};

type Job = {
  config: RunningConfig;
  /*  to be implemented */
  flag: boolean;
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

class ManimSideview {
  constructor(public readonly ctx: vscode.ExtensionContext) {
    this.ctx = ctx;
    this.manimCfgPath = "";
    this.jobs = [];
  }
  private manimCfgPath: string;
  // a list of running jobs tied to each file
  // starting a job will allow auto-save rendering
  // unless explicitely disabled
  private jobs: Job[];

  async run(onSave: boolean = false) {
    if (!vscode.window.activeTextEditor) {
      return await vscode.window.showErrorMessage(
        "Hey! You need a valid Python file to run the sideview."
      );
    }
    const srcPath = vscode.window.activeTextEditor.document.fileName;

    // we only want to engage rendering on save (if enabled)
    // when the job was already first started by the user
    if (onSave === true && !Object.keys(srcPath).includes(srcPath)) {
      return;
    }

    const conf = await this.getRunningConfig(srcPath);

    // the top level run function does not directly report error messages and
    // expects the lower level functions to do so
    if (conf === false) {
      return;
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
    terminal.sendText(`${conf.exePath} ${conf.srcPath} ${conf.args}`);

    // formulate a decent system to understand when a command is executed
    const selects = await vscode.window.showInformationMessage(
      "Please press Ok once you want to load the preview.",
      "Ok"
    );
    if (selects !== "Ok") {
      return;
    }
    // Mpeg-4 cross extension dependency guard
    const exists = (await vscode.commands.getCommands(false)).includes(
      "preview-mp4.zoomIn"
    );
    if (!exists) {
      return await vscode.window.showErrorMessage(
        "You have a cross extension dependency missing, please install it here: https://marketplace.visualstudio.com/items?itemName=analytic-signal.preview-mp4"
      );
    }

    try {
      this.openSideview(this.outputPathByContext(conf));
      this.jobs.push({ config: conf, flag: false });
    } catch (e) {
      console.log(e);
      await vscode.window.showErrorMessage(
        "I'm unable to resolve the relative path due to the lack of workspace root folders, please provide an absolute path."
      );
    }
  }

  async refreshConfiguration() {}

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
    }
  }

  async setRenderingScene() {
    try {
      var job = this.getActiveJob();
    } catch (e: any) {
      return await vscode.window.showErrorMessage(e.message);
    }
    if (job) {
      const sceneName = await vscode.window.showInputBox({
        title: "Provide a scene name",
      });
      if (sceneName) {
        job.config.sceneName = sceneName;
      }
    }
  }

  getActiveJob(): Job | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "python") {
      throw TypeError(
        "Active text editor or the document must not be None or incompatible"
      );
    } else {
      return this.jobs.find(
        (j) =>
          generalizeUri(j.config.srcPath).toLowerCase() ===
          generalizeUri(editor.document.fileName).toLowerCase()
      );
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
  async getManimConfig(sourcePath: string): Promise<ManimConfig | undefined | false> {
    var cfg: ManimConfig | undefined;
    // user made manim.cfg files normally must remain on the
    // same directory of the source path thus we can guess this as such
    var cfgPath = this.manimCfgPath
      ? this.manimCfgPath
      : sourcePath.split("/").slice(0, -1).join("/") + "/manim.cfg";
    try {
      var parsedRes = ConfigParser.parse(cfgPath);
    } catch (e) {
      return undefined;
    }
    const hasAll = USER_DEF_CONFIGURATION.map((key) => Object.keys(parsedRes[LOCATE.section])
                      .includes(key))
                      .every((e) => e);

    if (hasAll === true) {
      return cfg;
    } else {
      return false;
    }
  }

  /**
   * Get the configurations in a tightly packed
   * object relevant for running.
   */
  async getRunningConfig(sourcePath: string): Promise<RunningConfig | false> {
    const conf = vscode.workspace.getConfiguration("manim-sideview");

    const exe: string = conf.get("defaultManimPath") || "";
    var args: string = conf.get("commandLineArgs") || "";
    var videoFP: string = conf.get("videoFilePath") || "";
    videoFP = generalizeUri(videoFP);

    sourcePath = generalizeUri(sourcePath);
    var output: string = "";

    const runningCfg: RunningConfig = {
      exePath: exe,
      srcPath: sourcePath,
      args: args,
      output: output,
      usingConfigFile: false,
      sceneName: "",
    };
    const cfg = await this.getManimConfig(sourcePath);

    if (cfg === false) {
      vscode.window.showErrorMessage(`Your configuration file found is incomplete! Please make sure you have all the following defined ${USER_DEF_CONFIGURATION.join(', ')}`);
      return false;
    } else if (cfg) {
      runningCfg.usingConfigFile = true;
      runningCfg.sceneName = cfg.sceneName;
      runningCfg.output =
        cfg.output + videoFP.startsWith("/") ? videoFP : "/" + videoFP;
      // we'll let the user know that we're using the manim.cfg if the job had just started
      if (!this.jobs.find((j) => j.config.srcPath === runningCfg.srcPath)) {
        vscode.window.showInformationMessage(
          "I found a mainm.cfg file in the source directory! The sideview is as configured appropriately."
        );
    }
    } else {
      await this.getInTimeConfiguration(runningCfg);
    }
    return runningCfg;
  }

  async getInTimeConfiguration(runningCfg: RunningConfig) {
    const _panel = vscode.window.createWebviewPanel(
      "inTimeConfiguration",
      "In Time Configurations",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
      }
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

    var htmlDoc = readFileSync(
      htlmDiskPth.path.startsWith("/")
        ? htlmDiskPth.path.substring(1)
        : htlmDiskPth.path
    ).toString();
    Object.keys(vars).forEach((k) => {
      if (htmlDoc.includes(k)) {
        htmlDoc = htmlDoc.replace(new RegExp(k, "g"), vars[k]);
      }
    });
    _panel.webview.html = htmlDoc;

    _panel.webview.onDidReceiveMessage((message) => {
      console.log(message);
      switch (message.command) {
        case "dispose":
          _panel.dispose();
        case "configure":
          runningCfg.args = message.args;
          runningCfg.output = message.video_dir;
          runningCfg.sceneName = message.scene_name;
      }
    });
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
  // insert function calls into closures to persist "this"
  context.subscriptions.push(
    vscode.commands.registerCommand("manim-sideview.run", async function () {
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
    ),
    vscode.commands.registerCommand(
      "manim-sideview.setRenderingScene",
      async function () {
        await view.setRenderingScene();
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
