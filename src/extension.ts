import { readFileSync } from "fs";
import path = require("path");
import * as vscode from "vscode";
import { ConfigParser } from "./configparser";

/**
 * TODO: Make  working
 */

// System Defaults that overarches application defaults
const DEFAULT_VIDEO_DIR = "media/videos/ep1/480p15";
const DEFAULT_MEDIA_DIR = "media";
const DEFAULT_ARGS = "-ql";

const USER_DEF_CONFIGURATION = ["scene_names"];
const LOCATE = { section: "CLI", key: "media_dir" };

/**
 * A configuration necessary to run a render.
 *
 * exePath: the absolute path to the manim.exe executable
 * srcPath: the absolute path to the source.py file
 * sceneName: the name of the scene to be rendered
 * moduleName: the module name of the source file
 * args: the command line arguments
 * output: the relative path to the video file
 * mediaDir: the root folder for all media output
 * videoDir: the directory where the video is output
 * usingConfigFile: whether if this is running using a configuration file
 */
type RunningConfig = {
  exePath: string;
  srcPath: string;
  sceneName: string;
  moduleName: string;
  args: string;
  output: string;
  document: vscode.TextDocument;
  mediaDir: string;
  videoDir: string;
  usingConfigFile: boolean;
};

// The key and value pairs here directly correlate to
// USER_DEF_CONFIGURATION
type ManimConfig = {
  output: string;
  sceneName: string;
  mediaDir: string;
  videoDir: string;
};

type Job = {
  config: RunningConfig;
  /*  to be implemented */
  flag: boolean;
};

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
    this.prompt = new DueTimeConfiguration(
      this.ctx.extensionUri,
      this.ctx.subscriptions
    );
  }
  private manimCfgPath: string;
  // a list of running jobs tied to each file
  // starting a job will allow auto-save rendering
  // unless explicitely disabled
  private jobs: Job[];
  private prompt: DueTimeConfiguration;

  /**
   * The command for running a manim sideview.
   *
   * @param routine A boolean flag indicating whether if this is called as a routine on saving or as a specific command.
   * @returns
   */
  async run(routine: boolean) {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
      return await vscode.window.showErrorMessage(
        "Hey! You need a valid Python file to run the sideview."
      );
    } else {
      if (
        routine === true &&
        !this.jobs.find(
          (j) =>
            j.config.srcPath ===
            editor.document.fileName
        )
      ) {
        return;
      }
      this.runWhenConfigured(editor.document);
    }
  }

  /**
   * The command for refreshing the active job.
   * This results in having to reset the in time configuration
   * if necessary.
   */
  async refreshConfiguration() {
    this.jobs = [];
  }

  /**
   * The command for setting a specific config file as
   * opposed to the manim.cfg that is at the level of
   * the source directory.
   */
  async setConfigFile() {
    const uri = await vscode.window.showOpenDialog({
      canSelectFolders: false,
      canSelectMany: false,
      title: "Open manim.cfg",
      filters: { config: ["cfg", "config", "ini"] },
    });
    if (uri) {
      const pth: string = path.normalize(uri[0].path);
      this.manimCfgPath = pth.startsWith("\\") ? pth.substring(1) : pth;
    }
  }

  /**
   * The command for setting the name of a rendering scene.
   * This only works when you're using an in time configuration.
   */
  async setRenderingScene(conf?: RunningConfig) {
    if (!conf) {
      var job = this.getActiveJob();
        if (!job) {
          return await vscode.window.showErrorMessage(
            "You do not have an active job to set a scene for."
          );
        }
        conf = job.config;
    }
    const sceneName = await vscode.window.showInputBox({
      title: "Scenes",
      prompt: "Provide the name of the scene you would like to render"
    });
    if (sceneName) {
      conf.sceneName = sceneName;
    }
  }

  /**
   * Executes the command needed to render the scene and opens
   * a sideview per configuration.
   *
   * @param conf running configuration.
   */
  async doRun(conf: RunningConfig) {
    var terminal: vscode.Terminal | undefined;
    vscode.window.terminals.forEach((t) => {
      if (t.name === "Manim") {
        terminal = t;
      }
    });
    if (!terminal) {
      terminal = vscode.window.createTerminal(`Manim`);
    }
    // --video_dir "${conf.videoDir}"
    terminal.sendText(
      `${conf.exePath} ${conf.srcPath} ${
        !conf.usingConfigFile ? conf.args : ""
      } ${conf.sceneName}`
    );

    // Mpeg-4 cross extension dependency guard
    const exists = (await vscode.commands.getCommands(false)).includes(
      "preview-mp4.zoomIn"
    );
    if (!exists) {
      return await vscode.window.showErrorMessage(
        "You have a cross extension dependency missing, please install it here: https://marketplace.visualstudio.com/items?itemName=analytic-signal.preview-mp4"
      );
    }

    await this.openSideview(this.insertContext(conf));
    this.jobs.push({ config: conf, flag: false });
  }

  /**
   * Evaluate a job if it exists from the currently active document or from
   * a source path if given.
   *
   * @param srcPath
   * @returns Job | undefined
   */
  getActiveJob(srcPath?: string): Job | undefined {
    var path: string;
    if (!srcPath) {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "python") {
        return undefined;
      }
      path = editor.document.fileName.toLowerCase();
    } else {
      path = srcPath;
    }

    return this.jobs.find((j) => j.config.srcPath === path);
  }

  /**
   * Changes a given path to an absolute path if it's a relative
   * path.
   *
   * @param path relative path
   * @returns absolute path
   */
  toAbsolutePath(pth: string): string {
    if (!path.isAbsolute(pth)) {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders) {
        throw TypeError("Workspace folders cannot be empty.");
      }
      var rootPath = folders[0].uri.fsPath + "/";
      pth = path.join(rootPath, pth);
    }
    return pth;
  }

  insertContext(conf: RunningConfig): string {
    const CONTEXT_VARIABLES: { [k: string]: string } = {
      "{media_dir}": conf.mediaDir,
      "{module_name}": conf.moduleName,
      "{quality}": "1080p60",
      "{scene_name}": conf.sceneName,
    };
    var path = this.toAbsolutePath(conf.output);
    Object.keys(CONTEXT_VARIABLES).forEach((k) => {
      if (path.includes(k)) {
        path = path.replace(new RegExp(k, "g"), CONTEXT_VARIABLES[k]);
      }
    });

    return path;
  }

  /**
   * Finds the manim.cfg file and if exists returns a
   * ManimConfig object.
   *
   * Returns false if there is a problem with the manim config, undefined if
   * it is undefined.
   *
   * @param sourcePath
   * @returns ManimConfig | undefined | false
   */
  async getManimConfig(
    sourcePath: string
  ): Promise<ManimConfig | undefined | false> {
    // user made manim.cfg files normally must remain on the
    // same directory of the source path thus we can guess this as such
    var cfgPath = this.manimCfgPath
      ? this.manimCfgPath
      : path.join(sourcePath, "../manim.cfg");
    try {
      var parsedRes = ConfigParser.parse(cfgPath);
    } catch (e) {
      return undefined;
    }

    if (!Object.keys(parsedRes).includes(LOCATE.section)) {
      vscode.window.showErrorMessage(`Your config file has no [${LOCATE.section}] section.`);
      return false;
    } else {
      var dict = parsedRes[LOCATE.section];
    }

    const cfgKeys = Object.keys(dict);
    const hasAll = USER_DEF_CONFIGURATION.map((key) =>
      cfgKeys.includes(key)
    ).every((e) => e);

    if (hasAll === true) {
      if (!vscode.workspace.workspaceFolders) {
        vscode.window.showErrorMessage(
          "I couldn't figure out the root path due to the lack of workspaces, please make one!"
        );
        return false;
      }
      let root = vscode.workspace.workspaceFolders[0].uri.path;
      const mp4File = dict["scene_names"] + ".mp4";
      let manimConfig: ManimConfig = {
        output: "",
        sceneName: dict["scene_names"],
        videoDir: "",
        mediaDir: "",
      };
      let subpath = DEFAULT_VIDEO_DIR;

      if (cfgKeys.includes("video_dir")) {
        manimConfig.videoDir = dict["video_dir"];
        subpath = dict["video_dir"];
      } else if (cfgKeys.includes("media_dir")) {
        manimConfig.mediaDir = dict["media_dir"];
        subpath = subpath.replace(
          new RegExp("{media_dir}", "g"),
          dict["media_dir"]
        );
      }
      manimConfig.output = path.join(root, subpath, mp4File);

      return manimConfig;
    } else {
      vscode.window.showErrorMessage(
        `Your configuration file found is incomplete! Please make sure you have all the following defined ${USER_DEF_CONFIGURATION.join(
          ", "
        )}`
      );
      return false;
    }
  }

  /**
   * Get the appropriate configurations and run when configured.
   */
  async runWhenConfigured(doc: vscode.TextDocument) {
    var sourcePath = doc.fileName;
    const moduleName = sourcePath.split("\\").slice(-1).join().replace(".py", "");

    const activeJob = this.getActiveJob(sourcePath);
    var runningCfg: RunningConfig;

    if (!activeJob) {
      const conf = vscode.workspace.getConfiguration("manim-sideview");

      const exe: string = conf.get("defaultManimPath") || "";
      var args: string = conf.get("commandLineArgs") || "";
      var videoFP: string = conf.get("videoDirectory") || "";
      videoFP = path.join(videoFP);

      sourcePath = path.normalize(sourcePath);
      var output: string = "";

      runningCfg = {
        exePath: exe,
        srcPath: sourcePath,
        moduleName: moduleName,
        args: args,
        output: output,
        usingConfigFile: false,
        document: doc,
        videoDir: "",
        sceneName: "",
        mediaDir: "",
      };
    } else {
      runningCfg = activeJob.config;
    }

    // we always load the manim config regardless for every
    // run to catch up
    const cfg = await this.getManimConfig(sourcePath);
    if (cfg === false) {
      return;
    } else if (cfg === undefined) {
      await this.runWithInTimeConfiguration(activeJob, runningCfg);
    } else {
      runningCfg.usingConfigFile = true;
      runningCfg.sceneName = cfg.sceneName;
      runningCfg.output = cfg.output;
      // cfg.output + videoFP.startsWith("/") ? videoFP : "/" + videoFP;
      // we'll let the user know that we're using the manim.cfg if the job had just started
      if (!activeJob) {
        vscode.window.showInformationMessage(
          "I found a mainm.cfg file in the source directory! The sideview is as configured appropriately."
        );
      }
      this.doRun(runningCfg);
    }
  }

  async setInTimeConfiguration(conf?: RunningConfig) {
    if (!conf) {
      var job = this.getActiveJob();
      if (!job || job.config.usingConfigFile) {
        return await vscode.window.showErrorMessage(
          "You can only set an in time configuration if you have an active job without a config file!"
        );
      }
      conf = job.config;
    }
    this.prompt.showInput(conf);
  }

  async runWithInTimeConfiguration(activeJob: Job | undefined, runningCfg: RunningConfig) {
    if (!activeJob) {
      runningCfg.args = DEFAULT_ARGS;
      runningCfg.videoDir = DEFAULT_VIDEO_DIR;
      runningCfg.mediaDir = DEFAULT_MEDIA_DIR;
      await this.setRenderingScene(runningCfg);
      runningCfg.output = path.join(DEFAULT_VIDEO_DIR, runningCfg.sceneName+".mp4");
    }
    runningCfg.usingConfigFile = false;
    this.doRun(runningCfg);
  }

  async openSideview(mediaFp: string) {
    const res = vscode.Uri.file(mediaFp);
    if (!res) {
      vscode.window.showErrorMessage("The output file couldn't be found.");
    } else {
      await vscode.commands.executeCommand(
        "vscode.openWith",
        res,
        "analyticsignal.preview-mp4",
        vscode.ViewColumn.Beside
      );
    }
  }
}

class DueTimeConfiguration {
  constructor(
    public readonly extensionUri: vscode.Uri,
    public readonly disposables: any[]
  ) {
    this.extensionUri = extensionUri;
    this.disposables = disposables;
  }
  private panel: vscode.WebviewPanel | undefined;

  showInput(conf: RunningConfig) {
    if (this.panel) {
      vscode.window.showErrorMessage(
        "You cannot open multiple configuration panels at the same time."
      );
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      "inTimeConfiguration",
      "In Time Configurations",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
      }
    );
    this.panel.webview.html = this.loadHtml(
      this.panel,
      this.extensionUri,
      conf
    );

    this.panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case "dispose":
            if (this.panel) {
              this.panel.dispose();
            }
            return;
          case "configure":
            if (this.panel) {
              conf.args = message.args;
              conf.sceneName = message.sceneName;
              conf.output = path.join(
                message.videoDir,
                message.sceneName + ".mp4"
              );
              this.panel.dispose();
              vscode.window.showInformationMessage(
                "Success, I've configured the running configurations to the details provided for now!"
              );
            }
            return;
        }
      },
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(
      () => {
        this.panel = undefined;
      },
      undefined,
      this.disposables
    );
  }

  /**
   * Provide a nonce for inline scripts inside webviews, this is necessary for
   * script execution.
   * @returns nonce
   */
  getNonce(): string {
    let text = "";
    const possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  loadHtml(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    conf: RunningConfig
  ): string {
    const loads: { [k: string]: vscode.Uri } = {
      "config.css": extensionUri,
      "config.js": extensionUri,
      "config.html": extensionUri,
    };
    Object.keys(loads).forEach((k) => {
      loads[k] = vscode.Uri.joinPath(extensionUri, "webview", k);
    });

    const styleSrc = panel.webview.asWebviewUri(loads["config.css"]);
    const nonce = this.getNonce();

    const vars: { [k: string]: string } = {
      "%styleSrc%": styleSrc.toString(),
      "%cspSource%": panel.webview.cspSource,
      "%nonce%": nonce,
      "%scriptSrc%": loads["config.js"]
        .with({ scheme: "vscode-resource" })
        .toString(),
      "%args%":
        conf.args ||
        vscode.workspace
          .getConfiguration("manim-sideview")
          .get("commandLineArgs") ||
        DEFAULT_ARGS,
      "%video_dir%":
        conf.output ||
        vscode.workspace
          .getConfiguration("manim-sideview")
          .get("videoDirectory") ||
        DEFAULT_VIDEO_DIR,
      "%media_dir%":
        conf.mediaDir ||
        vscode.workspace
          .getConfiguration("manim-sideview")
          .get("mediaDirectory") ||
        DEFAULT_MEDIA_DIR,
    };
    const htmlPth = loads["config.html"].path.toString();
    var htmlDoc = readFileSync(
      htmlPth.startsWith("/") ? htmlPth.substring(1) : htmlPth
    ).toString();

    Object.keys(vars).forEach((k) => {
      if (htmlDoc.includes(k)) {
        htmlDoc = htmlDoc.replace(new RegExp(k, "g"), vars[k]);
      }
    });
    return htmlDoc;
  }
}

export function activate(context: vscode.ExtensionContext) {
  const view = new ManimSideview(context);
  // insert function calls into closures to persist "this"
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "manim-sideview.run",
      async function (routine: boolean = false) {
        await view.run(routine);
      }
    ),
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
    ),
    vscode.commands.registerCommand(
      "manim-sideview.setInTimeConfiguration",
      async function () {
        await view.setInTimeConfiguration();
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
