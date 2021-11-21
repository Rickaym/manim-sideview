import * as vscode from "vscode";
import * as path from "path";
import { DueTimeConfiguration } from "./config";
import { ConfigParser } from "./configparser";

import {
  ContextVars,
  DEFAULT_ARGS,
  DEFAULT_MEDIA_DIR,
  DEFAULT_VIDEO_DIR,
  getRootPath,
  insertContext,
  RunningConfig,
} from "./globals";
import { VideoPlayer } from "./player";

/**
 * ENTRY POINT OF THE EXTENSION
 */

/**
 * TODO: executeCommandInoutputChannel needs to be fixed to resolve ENONET
 */

const USER_DEF_CONFIGURATION = ["scene_names"];
const LOCATE = { section: "CLI", key: "media_dir" };

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
  flag: boolean;
};

/**
 * Changes a given path to an absolute path if it's a relative
 * path.
 *
 * @param path relative path
 * @returns absolute path
 */
function toAbsolutePath(pth: string): string {
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

class ManimSideview {
  constructor(public readonly ctx: vscode.ExtensionContext) {
    this.ctx = ctx;
    this.manimCfgPath = "";
    this.jobs = [];
    this.prompt = new DueTimeConfiguration(
      this.ctx.extensionUri,
      this.ctx.subscriptions
    );
    this.player = new VideoPlayer(
      this.ctx.extensionUri,
      this.ctx.subscriptions
    );
    this.outputChannel = vscode.window.createOutputChannel("Manim");
    this.isRunning = false;
  }
  private manimCfgPath: string;
  // a list of running jobs tied to each file
  // starting a job will allow auto-save rendering
  // unless explicitely disabled
  private jobs: Job[];
  private prompt: DueTimeConfiguration;
  private player: VideoPlayer;
  private outputChannel: vscode.OutputChannel;
  private isRunning: boolean;

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
        !this.jobs.find((j) => j.config.srcPath === editor.document.fileName)
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
      this.manimCfgPath =
        pth.startsWith("\\") || pth.startsWith("/") ? pth.substring(1) : pth;
    }
  }

  /**
   * The command for setting the name of a rendering scene.
   * This only works when you're using an in time configuration.
   */
  async setRenderingScene(conf?: RunningConfig): Promise<boolean> {
    if (!conf) {
      var job = this.getActiveJob();
      if (!job) {
        await vscode.window.showErrorMessage(
          "You do not have an active job to set a scene for."
        );
        return false;
      }
      conf = job.config;
    }
    const sceneName = await vscode.window.showInputBox({
      title: "Scenes",
      prompt: "Provide the name of the scene you would like to render",
    });
    if (sceneName) {
      conf.sceneName = sceneName;
      return true;
    } else {
      vscode.window.showErrorMessage(
        "You provided an invalid rendering scene."
      );
      return false;
    }
  }

  /**
   * Executes the command needed to render the scene and opens
   * a sideview per configuration.
   *
   * @param conf running configuration.
   */
  private async doRun(conf: RunningConfig) {
    const root = getRootPath();
    if (!root) {
      return;
    }
    var args = [];
    if (!conf.usingConfigFile) {
      args.push(conf.args.trim());
    }
    args.push(conf.sceneName.trim());
    this.executeCommandInoutputChannel(
      `${conf.exePath} ${conf.srcPath}`,
      args,
      path.normalize(root),
      conf
    );
  }

  private async executeCommandInoutputChannel(
    command: string,
    args: string[],
    cwd: string,
    conf: RunningConfig
  ) {
    this.isRunning = true;

    this.outputChannel.clear();
    this.outputChannel.appendLine("[Executing] " + command);

    const spawn = require("child_process").spawn;
    const startTime = new Date();
    process = spawn(command, args, { cwd: cwd, shell: true });

    process.stdout.on("data", (data) => {
      this.outputChannel.append(data.toString());
    });

    process.stderr.on("data", (data) => {
      this.outputChannel.append(data.toString());
    });

    process.on("exit", (code: number) => {
      this.isRunning = false;
      const endTime = new Date();
      const elapsedTime = (endTime.getTime() - startTime.getTime()) / 1000;
      this.outputChannel.appendLine(
        "\n[Done] rendered within code=" +
          code +
          " in " +
          elapsedTime +
          " seconds\n"
      );
      if (code === 0) {
        const CONTEXT_VARIABLES: ContextVars = {
          "{media_dir}": conf.mediaDir,
          "{module_name}": conf.moduleName,
          "{quality}": "480p15",
          "{scene_name}": conf.sceneName,
        };
        this.openSideview(
          insertContext(CONTEXT_VARIABLES, toAbsolutePath(conf.output))
        ).then(() => this.jobs.push({ config: conf, flag: false }));
      }
    });
  }

  /**
   * Evaluate a job if it exists from the currently active document or from
   * a source path if given.
   *
   * @param srcPath
   * @returns Job | undefined
   */
  private getActiveJob(srcPath?: string): Job | undefined {
    var path: string;
    if (!srcPath) {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "python") {
        return undefined;
      }
      path = editor.document.fileName;
    } else {
      path = srcPath;
    }

    return this.jobs.find((j) => j.config.srcPath === path);
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
  private async getManimConfig(
    sourcePath: string
  ): Promise<ManimConfig | undefined | false> {
    // user made manim.cfg files normally must remain on the
    // same directory of the source path thus we can guess this as such
    var cfgPath = this.manimCfgPath
      ? this.manimCfgPath
      : path.join(sourcePath, "../manim.cfg");
    try {
      var parsedRes = await ConfigParser.parse(cfgPath);
    } catch (e) {
      return undefined;
    }

    if (!Object.keys(parsedRes).includes(LOCATE.section)) {
      vscode.window.showErrorMessage(
        `Your config file has no [${LOCATE.section}] section.`
      );
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
  private async runWhenConfigured(doc: vscode.TextDocument) {
    var sourcePath = doc.fileName;
    const moduleName = sourcePath
      .split("\\")
      .slice(-1)
      .join()
      .replace(".py", "");

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
      runningCfg.sceneName = cfg.sceneName;
      runningCfg.output = cfg.output;
      // cfg.output + videoFP.startsWith("/") ? videoFP : "/" + videoFP;
      // we'll let the user know that we're using the manim.cfg if the job had just started
      if (!activeJob || !runningCfg.usingConfigFile) {
        vscode.window.showInformationMessage(
          "I found a mainm.cfg file in the source directory. The sideview is as configured appropriately."
        );
      }
      runningCfg.usingConfigFile = true;
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

  private async runWithInTimeConfiguration(
    activeJob: Job | undefined,
    runningCfg: RunningConfig
  ) {
    if (!activeJob) {
      runningCfg.args = DEFAULT_ARGS;
      runningCfg.videoDir = DEFAULT_VIDEO_DIR;
      runningCfg.mediaDir = DEFAULT_MEDIA_DIR;
      if (!(await this.setRenderingScene(runningCfg))) {
        return;
      }
      runningCfg.output = path.join(
        DEFAULT_VIDEO_DIR,
        runningCfg.sceneName + ".mp4"
      );
    }
    runningCfg.usingConfigFile = false;
    this.doRun(runningCfg);
  }

  private async openSideview(mediaFp: string) {
    const res = vscode.Uri.file(mediaFp);
    if (!res) {
      vscode.window.showErrorMessage("The output file couldn't be found.");
    } else {
      this.player.show(res);
      /*
      await vscode.commands.executeCommand(
        "vscode.openWith",
        res,
        "analyticsignal.preview-mp4",
        vscode.ViewColumn.Beside
      );*/
    }
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
