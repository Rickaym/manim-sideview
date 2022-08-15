import * as vscode from "vscode";
import * as path from "path";

import { ChildProcess, spawn } from "child_process";
import {
  ContextVars,
  getRootPath,
  insertContext,
  RunningConfig,
  BASE_ARGS,
  BASE_MANIM_EXE,
  BASE_VIDEO_DIR,
  INTERNAL_MANIM_CONFIG,
  updateInternalManimCfg,
  defaultFormatHandler,
} from "./globals";

import { DueTimeConfiguration } from "./config";
import { ConfigParser } from "./configparser";
import { VideoPlayer } from "./player";
import { Gallery } from "./gallery";
import { ManimPseudoTerm } from "./pseudoTerm";

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
    const rootPath = folders[0].uri.fsPath + "/";
    pth = path.join(rootPath, pth);
  }
  return pth;
}

// mandatory cli flags for user configuration currently none
const USER_DEF_CONFIGURATION: string[] = [];
const LOCATE = { section: "CLI" };
const SCENE_CLASSES = /class\s+(?<name>\w+)\(\w*Scene\w*\):/g;
const CFG_OPTIONS = /(\w+)\s?:\s?([^ ]*)/g;

// a process will be killed if this message is seen
const INPUT_REQUEST =
  "Choose number corresponding to desired scene/arguments.\r\n(Use comma separated list for multiple entries)\r\nChoice(s):  ";

// The key and value pairs here directly correlate to USER_DEF_CONFIGURATION
type ManimConfig = {
  mediaDir: string;
  videoDir: string;
  quality: string;
};

type Job = {
  config: RunningConfig;
};

export class ManimSideview {
  constructor(public readonly ctx: vscode.ExtensionContext) {
    this.ctx = ctx;
    this.manimCfgPath = "";
    this.jobs = [];
    this.prompt = new DueTimeConfiguration(ctx);
    this.player = new VideoPlayer(ctx.extensionUri, ctx.subscriptions);
    this.gallery = new Gallery(ctx.extensionUri, ctx.subscriptions);

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
  private process: ChildProcess | undefined;
  private jobStatus: vscode.StatusBarItem;
  private lastChosenSceneName: string | undefined;
  private outputChannel: vscode.OutputChannel =
    vscode.window.createOutputChannel("manim");
  private outputPseudoTerm: ManimPseudoTerm = new ManimPseudoTerm("manim");

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

  stop(process?: ChildProcess) {
    if (!process) {
      process = this.process;
    }
    if (process) {
      process.kill();
    }
  }

  async refreshAllConfiguration() {
    this.jobs = [];
    this.updateJobStatus();
  }

  async refreshCurrentConfiguration() {
    const job = this.getActiveJob();
    if (job) {
      this.jobs.splice(this.jobs.indexOf(job), 1);
      this.updateJobStatus();
    }
  }

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
   * This only works when you're using an in time configuration.
   */
  async setRenderingScene(conf?: RunningConfig): Promise<boolean> {
    if (!conf) {
      const job = this.getActiveJob();
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

    const sceneClasses = [...contents.matchAll(SCENE_CLASSES)].map(
      m =>
        "$(run-all) " +
        m.groups?.name
    );
    const askMore = "I'll provide it myself!";

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

    const sceneName = choice
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

  showMobjectGallery() {
    this.gallery.show();
  }

  syncMobjectGallery() {
    this.gallery.synchronize(true);
  }

  audit(editor: vscode.TextEditor | undefined) {
    if (editor && editor.document.languageId === "python") {
      this.gallery.setLastActiveEditor(editor);
    }
  }

  async syncManimConfig() {
    vscode.window.showInformationMessage("Collecting necessary information..");
    const conf = vscode.workspace.getConfiguration("manim-sideview");
    const process = spawn(
      path.normalize(conf.get("defaultManimPath") || BASE_MANIM_EXE),
      ["cfg", "show"]
    );

    let fullStdout = "";
    process.stdout.on("data", function (data: string) {
      fullStdout += data.toString();
    });

    process.on("close", function (code: number, signal: string) {
      const payload = fullStdout
        .split("\r\n\r\n\r\n")
        .find((p) => p.includes("CLI"))
        ?.replace(/\r\n/g, " ");
      if (!payload) {
        return;
      }
      const matches = payload?.match(CFG_OPTIONS);
      if (!matches) {
        return;
      }
      const cfgOptions: { [tp: string]: string } = {};
      matches?.forEach((op) => {
        const options = op.split(":");
        cfgOptions[options[0].trim()] = options[1].trim();
      });
      updateInternalManimCfg(cfgOptions);
      vscode.window.showInformationMessage(
        "Successfully updated internal defaults for manim.cfg files."
      );
    });
  }
  /**
   * Executes the command needed to render the scene and opens
   * a sideview per configuration.
   *
   * @param conf running configuration.
   */
  private async doRun(conf: RunningConfig) {
    const ctxVars: ContextVars = {
      "{media_dir}": conf.mediaDir,
      "{module_name}": conf.moduleName,
      "{scene_name}": conf.sceneName,
    };
    let args = [conf.srcPath];
    if (!conf.usingConfigFile) {
      //args.push(
      //  `--video_dir ${insertContext(ctxVars, conf.videoDir)}`
      //);
      args.push(conf.args.trim());
    }
    args.push(conf.sceneName.trim());
    // args = args.map((a) => `"${a}"`);

    let out;
    if (
      vscode.workspace
        .getConfiguration("manim-sideview")
        .get("outputToTerminal")
    ) {
      this.outputPseudoTerm.cwd = conf.root;
      this.outputPseudoTerm.isRunning = true;
      out = this.outputPseudoTerm;
    } else {
      out = this.outputChannel;
    }
    this.executeCommand(args, conf, ctxVars, out);
  }

  async executeCommand(
    args: string[],
    conf: RunningConfig,
    ctxVars: ContextVars,
    outputChannel: vscode.OutputChannel
  ) {
    const command = conf.exePath;
    const cwd = conf.root;
    const mediaFp = insertContext(ctxVars, toAbsolutePath(conf.output));

    // Output channels will not keep historical logs
    outputChannel.clear();

    if (conf.usingConfigFile) {
      outputChannel.appendLine(
        defaultFormatHandler(
          "info",
          `Configuration status ${conf.usingConfigFile}`
        )
      );
    }

    outputChannel.append(
      defaultFormatHandler("info", `Current working directory "${cwd}"\n`) +
        defaultFormatHandler(
          "info",
          `Manim Executable Path at "${command}"\n`
        ) +
        defaultFormatHandler("info", `Added arguments ${args.join(" | ")}\n`) +
        defaultFormatHandler(
          "info",
          `Relative Output Video Path at "${insertContext(
            ctxVars,
            conf.videoDir
          )}"\n`
        ) +
        defaultFormatHandler("debug", `${command} ${args.join(" ")}\n`) +
        defaultFormatHandler("info", `Output Video Path at "${mediaFp}"\n`)
    );

    if (
      vscode.workspace
        .getConfiguration("manim-sideview")
        .get("focusOutputOnRun")
    ) {
      outputChannel.show(true);
    }

    const startTime = new Date();
    if (this.process) {
      this.stop();
    }

    this.process = spawn(command, args, { cwd: cwd, shell: false });

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
      outputChannel.appendLine(
        defaultFormatHandler(
          "info",
          `Execution returned code=911 in Process: ${this.process}, stdout: ${this.process?.stdout}, stdout: ${this.process?.stderr}`
        )
      );
      outputChannel.append("\n");
      return vscode.window.showErrorMessage(
        "Fatal error, please look at the output channel."
      );
    }
    // We'll keep a closure because this.process is capable of going undefined
    // at any given time, but we still want valid references
    const process = this.process;
    this.process.stdout.on("data", (data: string) => {
      if (!process.killed) {
        const outs = data.toString();
        outputChannel.append(outs);

        if (outs.includes(INPUT_REQUEST)) {
          this.stop(process);
          outputChannel.append("\n");
        }
      }
    });

    this.process.stderr.on("data", (data: string) => {
      if (!process.killed) {
        outputChannel.append(data.toString());
      }
    });

    this.process.on("error", (err: Error) => {
      if (!process.killed) {
        outputChannel.append(err.toString());
      }
    });

    this.process.on("close", (code: number, signal: string) => {
      const elapsedTime = (new Date().getTime() - startTime.getTime()) / 1000;

      // This process has been user-terminated
      if (signal === "SIGTERM") {
        code = 1;
      }

      outputChannel.appendLine(
        defaultFormatHandler(
          "info",
          `Execution returned code=${code} in ${elapsedTime} seconds ${
            code === 1 ? "returned signal " + signal : ""
          } ${
            signal === "SIGTERM"
              ? "Cause: An old process has been terminated due to a termination signal."
              : ""
          }\n`
        )
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
            const res = vscode.Uri.file(mediaFp);
            if (!res) {
              vscode.window.showErrorMessage("The output file couldn't be found.");
            } else {
              this.player.showVideo(res, conf);
            }
            this.newJob(conf);
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

  private newJob(conf: RunningConfig) {
    this.jobs.push({ config: conf });
    this.updateJobStatus(
      new vscode.ThemeColor("minimapGutter.addedBackground")
    );
  }

  /**
   * Evaluate a job if it exists from the currently active document or from
   * a source path if given.
   *
   * @param srcPath
   * @returns Job | undefined
   */
  private getActiveJob(srcPath?: string): Job | undefined {
    let path: string;
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
    let cfgPath = this.manimCfgPath
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
    const hasAll = USER_DEF_CONFIGURATION.every(key => cfgKeys.includes(key));

    if (hasAll === true) {
      if (!vscode.workspace.workspaceFolders) {
        vscode.window.showErrorMessage(
          "I couldn't figure out the root path due to the lack of workspaces, please make one!"
        );
        return false;
      }
      let manimConfig: ManimConfig = {
        videoDir: INTERNAL_MANIM_CONFIG.video_dir,
        mediaDir: INTERNAL_MANIM_CONFIG.media_dir,
        quality: INTERNAL_MANIM_CONFIG.quality,
      };

      if (cfgKeys.includes("quality")) {
        manimConfig.quality = dict["quality"];
      }

      if (cfgKeys.includes("media_dir")) {
        manimConfig.mediaDir = dict["media_dir"];
      }

      if (cfgKeys.includes("video_dir")) {
        manimConfig.videoDir = dict["video_dir"];
      }
      manimConfig.videoDir = insertContext(
        {
          "{quality}": INTERNAL_MANIM_CONFIG.quality_map[manimConfig.quality],
          "{media_dir}": manimConfig.mediaDir,
        },
        manimConfig.videoDir
      );

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

  private newRunningConfig(doc: vscode.TextDocument): RunningConfig | false {
    let sourcePath = doc.fileName;
    const conf = vscode.workspace.getConfiguration("manim-sideview");
    const moduleName = sourcePath
      .replace(new RegExp("/", "g"), "\\")
      .split("\\")
      .slice(-1)
      .join()
      .replace(".py", "");

    sourcePath = path.normalize(sourcePath);
    const root = path.normalize(getRootPath() || "");
    if (!root) {
      return false;
    }
    return {
      exePath: path.normalize(conf.get("defaultManimPath") || BASE_MANIM_EXE),
      args: conf.get("commandLineArgs") || BASE_ARGS,
      root: root,
      videoDir: path.normalize(conf.get("videoDirectory") || BASE_VIDEO_DIR),
      srcPath: sourcePath,
      moduleName: moduleName,
      usingConfigFile: false,
      document: doc,
      output: "",
      sceneName: "",
      mediaDir: "",
    };
  }

  /**
   * Get the appropriate configurations and run when configured.
   */
  private async runWhenConfigured(doc: vscode.TextDocument) {
    const activeJob = this.getActiveJob(doc.fileName);
    let runningCfg: RunningConfig;

    if (!activeJob) {
      const newConf = this.newRunningConfig(doc);
      if (!newConf) {
        return;
      } else {
        runningCfg = newConf;
      }
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
            "Found a mainm.cfg file in the source directory. The sideview is as configured appropriately, we just need the scene name now!"
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
      let job = this.getActiveJob();
      if (!job || job.config.usingConfigFile) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          return vscode.window.showErrorMessage(
            "You do not have an active editor."
          );
        }
        const newConf = this.newRunningConfig(editor.document);
        if (!newConf) {
          return;
        }
        conf = newConf;
        this.newJob(conf);
      } else {
        conf = job.config;
      }
    }
    this.prompt.show(conf);
  }
}
