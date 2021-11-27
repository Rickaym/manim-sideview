import * as vscode from "vscode";
import * as path from "path";

import { ChildProcess } from "child_process";
import {
  ContextVars,
  DEFAULT_ARGS,
  DEFAULT_MANIM_EXE,
  DEFAULT_MEDIA_DIR,
  DEFAULT_VIDEO_DIR,
  getRootPath,
  insertContext,
  RunningConfig
} from "./globals";
import { DueTimeConfiguration } from "./config";
import { ConfigParser } from "./configparser";
import { VideoPlayer } from "./player";
import { Gallery } from "./gallery";

/**
 * ENTRY POINT OF THE EXTENSION
 */

// mandatory cli flags for user configuration
// currently none
const USER_DEF_CONFIGURATION: string[] = [];
const LOCATE = { section: "CLI" };
const SCENE_CLASSES = /(?:\s*class\s+(?<name>\w+)\(Scene\):\s*)/g;

// a process will be killed if this message is seen
const INPUT_REQUEST =
  "Choose number corresponding to desired scene/arguments.\r\n(Use comma separated list for multiple entries)\r\nChoice(s):  ";

// The key and value pairs here directly correlate to
// USER_DEF_CONFIGURATION
type ManimConfig = {
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
    this.prompt = new DueTimeConfiguration(ctx);
    this.player = new VideoPlayer(ctx);
    this.gallery = new Gallery(ctx);
    this.outputChannel = vscode.window.createOutputChannel("Manim");

    this.jobStatus = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left
    );
    this.jobStatus.name = "Job Indicator";
    this.jobStatus.text = "$(vm-active) Active Job";
    this.jobStatus.command = "manim-sideview.refreshCurrentConfiguration";

    this.jobStatus.backgroundColor = new vscode.ThemeColor(
      "button.hoverBackground"
    );
    this.jobStatus.color = new vscode.ThemeColor("textLink.foreground");
    this.jobStatus.tooltip = "Press To Deactivate Your Manim Job";
    this.ctx.subscriptions.push(this.jobStatus);
  }
  private manimCfgPath: string;
  // a list of running jobs tied to each file
  // starting a job will allow auto-save rendering
  // unless explicitely disabled
  private jobs: Job[];
  private prompt: DueTimeConfiguration;
  private player: VideoPlayer;
  private gallery: Gallery;
  private outputChannel: vscode.OutputChannel;
  private process: ChildProcess | undefined;
  private jobStatus: vscode.StatusBarItem;
  private lastChosenSceneName: string | undefined;

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
   * The command for stopping a process
   */
  stop(process?: ChildProcess) {
    if (!process) {
      process = this.process;
    }
    if (process) {
      process.kill();
    }
  }

  /**
   * The command for refreshing all active jobs.
   */
  async refreshAllConfiguration() {
    this.jobs = [];
    this.updateJobStatus();
  }

  /**
   * The command for refreshing the active job.
   */
  async refreshCurrentConfiguration() {
    const job = this.getActiveJob();
    if (job) {
      this.jobs.splice(this.jobs.indexOf(job), 1);
      this.updateJobStatus();
    }
  }

  /**
   * The command for setting a specific config file as
   * opposed to the manim.cfg that is at the level of
   * the source directory.
   *
   * BETA
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
    // light weight regex scene class matching,
    // this is not as effective as using an ast tool but this will do
    const contents = (await vscode.workspace.fs.readFile(conf.document.uri))
      .toString()
      .replace(/\r/g, "")
      .replace(/\n/g, "");

    var sceneClasses = contents
      .match(SCENE_CLASSES)
      ?.map((m) => "$(run-all) " + m.substr(5).replace("(Scene):", "").trim());
    const askMore = "I'll provide it myself!";

    var sceneName;
    if (sceneClasses) {
      if (this.lastChosenSceneName) {
        sceneClasses.push(`$(refresh) ${this.lastChosenSceneName}`);
      }
      sceneClasses.push(askMore);
      var choice = await vscode.window.showQuickPick(sceneClasses, {
        title: "Pick The Name Of Your Scene",
        placeHolder: "Search..",
      });
      if (!choice) {
        return false;
      }
    }
    const customInp = choice === askMore;
    if (customInp || !sceneClasses) {
      choice = await vscode.window.showInputBox({
        prompt: "Input the name of your scene",
      });
    }

    sceneName = choice
      ?.replace("$(run-all)", "")
      .replace("$(refresh)", "")
      .trim();
    if (sceneName) {
      conf.sceneName = sceneName;
      // we'll cache the last provided custom input for better accessibility
      if (customInp) {
        this.lastChosenSceneName = sceneName;
      }
      const mediaFile = conf.sceneName + ".mp4";
      conf.output = path.join(conf.videoDir, mediaFile);
      return true;
    } else {
      vscode.window.showErrorMessage(
        "You provided an invalid rendering scene."
      );
      return false;
    }
  }

  updateJobStatus(color?: vscode.ThemeColor, text?: string) {
    if (this.getActiveJob()) {
      if (!text) {
        text = "$(vm-active) Active Job";
      }
      if (!color) {
        color = new vscode.ThemeColor("textLink.foreground");
      }
      this.jobStatus.color = color;
      this.jobStatus.text = text;
      this.jobStatus.show();
    } else {
      this.jobStatus.hide();
    }
  }

  /**
   * The command for loading the m object gallery
   */
  showMobjectGallery() {
    this.gallery.show();
  }

  /**
   * Executes the command needed to render the scene and opens
   * a sideview per configuration.
   *
   * @param conf running configuration.
   */
  private async doRun(conf: RunningConfig) {
    const CONTEXT_VARIABLES: ContextVars = {
      "{media_dir}": conf.mediaDir,
      "{module_name}": conf.moduleName,
      "{scene_name}": conf.sceneName,
    };
    var args = [conf.srcPath];
    if (!conf.usingConfigFile) {
      //args.push(
      //  `--video_dir ${insertContext(CONTEXT_VARIABLES, conf.videoDir)}`
      //);
      args.push(conf.args.trim());
    }
    args.push(conf.sceneName.trim());
    args = args.map((a) => `"${a}"`);
    this.executeCommandInoutputChannel(
      conf.exePath,
      args,
      conf.root,
      conf,
      CONTEXT_VARIABLES
    );
  }

  private async executeCommandInoutputChannel(
    command: string,
    args: string[],
    cwd: string,
    conf: RunningConfig,
    CONTEXT_VARIABLES: ContextVars
  ) {
    this.outputChannel.clear();
    this.outputChannel.appendLine(
      `[Log] EXE : "${command}"\n[Log] CWD : "${cwd}"\n[Log] VDir: "${insertContext(
        CONTEXT_VARIABLES,
        conf.videoDir
      )}"\n[Log] Args: ${args.join(" | ")}\n[Log] Conf: ${conf.usingConfigFile}`
    );
    const mediaFp = insertContext(
      CONTEXT_VARIABLES,
      toAbsolutePath(conf.output)
    );
    this.outputChannel.appendLine(
      `[Running] IN  : ${command} ${args.join(
        " "
      )} \n[Running] OUT : ${mediaFp}\n`
    );
    if (
      vscode.workspace
        .getConfiguration("manim-sideview")
        .get("focusOutputOnRun")
    ) {
      this.outputChannel.show(true);
    }
    const startTime = new Date();
    if (this.process) {
      if (this.process) {
        this.stop();
      }
    }
    const { spawn } = require("child_process");
    this.process = spawn(command, args, { cwd: cwd, shell: true });
    this.updateJobStatus(
      new vscode.ThemeColor("textLink.foreground"),
      "$(sync~spin) Active Job"
    );
    if (
      !this.process ||
      !this.process.stdout ||
      !this.process.stderr ||
      !this.process.stdin
    ) {
      this.outputChannel.appendLine(
        `[Done] returned code=911 in Process: ${this.process}, stdout: ${this.process?.stdout}, stdout: ${this.process?.stderr}`
      );
      return vscode.window.showErrorMessage(
        "Process stumbled on a fatal error, please look at the output channel."
      );
    }
    const process = this.process;
    this.process.stdout.on("data", (data: string) => {
      if (!process.killed) {
        const outs = data.toString();
        this.outputChannel.append(outs);
        if (outs.includes(INPUT_REQUEST)) {
          this.stop(process);
          this.outputChannel.append("\n");
        }
      }
    });

    this.process.stderr.on("data", (data: string) => {
      if (!process.killed) {
        this.outputChannel.append(data.toString());
      }
    });

    this.process.on("error", (err: Error) => {
      if (!process.killed) {
        this.outputChannel.append(err.toString());
      }
    });

    this.process.on("close", (code: number, signal: string) => {
      const endTime = new Date();
      const elapsedTime = (endTime.getTime() - startTime.getTime()) / 1000;
      if (signal === "SIGTERM") {
        code = 1;
      }
      this.outputChannel.appendLine(
        `\n[Done] returned code=${code} in ${elapsedTime} seconds ${
          code === 1 ? "returned signal " + signal : ""
        } ${
          signal === "SIGTERM"
            ? "Cause: An old process has been terminated due to a termination signal."
            : ""
        }\n`
      );
      const isMainProcess = this.process && this.process.pid === process.pid;

      if (signal === "SIGTERM") {
        if (isMainProcess) {
          this.updateJobStatus(new vscode.ThemeColor("minimap.errorHighlight"));
          this.process = undefined;
        }
        return;
      }

      if (isMainProcess) {
        this.process = undefined;
      }

      if (code === 0) {
        vscode.workspace.fs.stat(vscode.Uri.file(mediaFp)).then(
          (fs) => {
            // we'll open a side view if we can find the file
            this.openSideview(mediaFp);
            this.jobs.push({ config: conf, flag: false });
            this.updateJobStatus(
              new vscode.ThemeColor("minimapGutter.addedBackground")
            );
          },
          (res) => {
            vscode.window.showErrorMessage(`${res}`);
            this.updateJobStatus(
              new vscode.ThemeColor("minimap.errorHighlight")
            );
          }
        );
      } else {
        this.updateJobStatus(new vscode.ThemeColor("minimap.errorHighlight"));
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
    rootPath: string
  ): Promise<ManimConfig | undefined | false> {
    // user made manim.cfg files normally must remain on the
    // same directory of the source path thus we can guess this as such
    var cfgPath = this.manimCfgPath
      ? this.manimCfgPath
      : path.join(rootPath, "manim.cfg");
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
      let manimConfig: ManimConfig = {
        videoDir: DEFAULT_VIDEO_DIR,
        mediaDir: DEFAULT_MEDIA_DIR,
      };

      if (cfgKeys.includes("video_dir")) {
        manimConfig.videoDir = dict["video_dir"];
      }
      if (cfgKeys.includes("media_dir")) {
        manimConfig.mediaDir = dict["media_dir"];
      }

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
      .replace(new RegExp("/", "g"), "\\")
      .split("\\")
      .slice(-1)
      .join()
      .replace(".py", "");

    const activeJob = this.getActiveJob(sourcePath);
    var runningCfg: RunningConfig;

    if (!activeJob) {
      const conf = vscode.workspace.getConfiguration("manim-sideview");

      sourcePath = path.normalize(sourcePath);
      const root = path.normalize(getRootPath() || "");
      if (!root) {
        return;
      }
      runningCfg = {
        exePath: path.normalize(
          conf.get("defaultManimPath") || DEFAULT_MANIM_EXE
        ),
        args: conf.get("commandLineArgs") || DEFAULT_ARGS,
        root: root,
        videoDir: path.normalize(
          conf.get("videoDirectory") || DEFAULT_VIDEO_DIR
        ),
        srcPath: sourcePath,
        moduleName: moduleName,
        usingConfigFile: false,
        document: doc,
        output: "",
        sceneName: "",
        mediaDir: "",
      };
    } else {
      runningCfg = activeJob.config;
    }

    // we will only try to load a manim config if it is started as
    // such
    if ((activeJob && runningCfg.usingConfigFile) || !activeJob) {
      const cfg = await this.getManimConfig(runningCfg.root);

      if (cfg) {
        runningCfg.mediaDir = cfg.mediaDir;
        runningCfg.videoDir = cfg.videoDir;

        if (!activeJob || !runningCfg.usingConfigFile) {
          vscode.window.showInformationMessage(
            "We've found a mainm.cfg file in the source directory. The sideview is as configured appropriately, we just need the scene name now!"
          );
          if (!(await this.setRenderingScene(runningCfg))) {
            return;
          }
        }
        runningCfg.output = path.join(
          cfg.videoDir,
          runningCfg.sceneName + ".mp4"
        );
        runningCfg.usingConfigFile = true;
        this.doRun(runningCfg);
        return;
      } else if (cfg === false) {
        return;
      }
    }
    // fall back to running with in time configuration
    if (!activeJob || !runningCfg.sceneName) {
      if (!(await this.setRenderingScene(runningCfg))) {
        return;
      }
      const mediaFile = runningCfg.sceneName + ".mp4";
      runningCfg.output = path.join(runningCfg.videoDir, mediaFile);
    }
    runningCfg.usingConfigFile = false;
    this.doRun(runningCfg);
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
    this.prompt.show(conf);
  }

  private async openSideview(mediaFp: string) {
    const res = vscode.Uri.file(mediaFp);
    if (!res) {
      vscode.window.showErrorMessage("The output file couldn't be found.");
    } else {
      await this.player.show(res);
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
      "manim-sideview.refreshAllConfiguration",
      async function () {
        await view.refreshAllConfiguration();
      }
    ),
    vscode.commands.registerCommand("manim-sideview.stop", async function () {
      view.stop();
    }),
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
    ),
    vscode.commands.registerCommand(
      "manim-sideview.refreshCurrentConfiguration",
      async function () {
        await view.refreshCurrentConfiguration();
      }
    ),
    vscode.commands.registerCommand(
      "manim-sideview.showMobjectGallery",
      async function () {
        view.showMobjectGallery();
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
  vscode.window.onDidChangeActiveTextEditor(
    (e) => {
      view.updateJobStatus();
    },
    null,
    context.subscriptions
  );
}

export function deactivate() {}
