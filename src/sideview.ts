/* eslint-disable @typescript-eslint/naming-convention */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

import { ChildProcess, spawn } from "child_process";
import {
  insertContext,
  RunningConfig,
  BASE_ARGS,
  BASE_MANIM_EXE,
  getDefaultMainConfig,
  FALLBACK_CONFIG,
  Log,
  ManimConfig,
  getOutputPath,
  updateFallbackManimCfg,
} from "./globals";

import { ConfigParser } from "./configParser";
import { VideoPlayer } from "./player";
import { Gallery } from "./gallery";
import { ManimPseudoTerm } from "./pseudoTerm";

const CONFIG_SECTION = "CLI";

const RE_SCENE_CLASS = /class\s+(?<name>\w+)\(\w*Scene\w*\):/g;
const RE_CFG_OPTIONS = /(\w+)\s?:\s?([^ ]*)/g;

// a process will be killed if this message is seen
const KILL_MSG =
  "Choose number corresponding to desired scene/arguments.\r\n(Use comma separated list for multiple entries)\r\nChoice(s):  ";

type Job = {
  config: RunningConfig;
};

class JobStatusItemWrapper {
  constructor() {
    this.jobStatusItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left
    );
    this.jobStatusItem.name = "job-indicator";
    this.jobStatusItem.command = "manim-sideview.refreshCurrentConfiguration";
    this.jobStatusItem.tooltip = "Mainm Sideview - Press to stop session.";
    this.jobStatusItem.color = new vscode.ThemeColor("textLink.foreground");
    this.setActive();
  }

  private jobStatusItem: vscode.StatusBarItem;

  getItem() {
    return this.jobStatusItem;
  }

  private setIcon(themeIcon: String) {
    this.jobStatusItem.text = `${themeIcon} Manim SV`;
  }

  setNew() {
    this.jobStatusItem.color = new vscode.ThemeColor(
      "minimapGutter.addedBackground"
    );
    this.setIcon("$(vm-active)");
    this.setVisibility(true);
  }

  setRunning() {
    this.jobStatusItem.color = new vscode.ThemeColor("textLink.foreground");
    this.setIcon("$(sync~spin)");
    this.setVisibility(true);
  }

  setActive() {
    this.jobStatusItem.backgroundColor = new vscode.ThemeColor(
      "button.hoverBackground"
    );
    this.setIcon("$(vm-active)");
    this.setVisibility(true);
  }

  setError() {
    this.jobStatusItem.color = new vscode.ThemeColor("minimap.errorHighlight");
    this.setVisibility(true);
  }

  setVisibility(activeJob: boolean) {
    if (activeJob) {
      this.jobStatusItem.show();
    } else {
      this.jobStatusItem.hide();
    }
  }
}

export class ManimSideview {
  constructor(public readonly ctx: vscode.ExtensionContext) {
    this.ctx = ctx;
    this.jobStatusItem = new JobStatusItemWrapper();
    this.ctx.subscriptions.push(this.jobStatusItem.getItem());
  }

  private manimCfgPath: string = "";
  private activeJobs: Job[] = [];
  private videoPlayer = new VideoPlayer(
    this.ctx.extensionUri,
    this.ctx.subscriptions
  );
  private gallery = new Gallery(this.ctx.extensionUri, this.ctx.subscriptions);
  private process: ChildProcess | undefined;
  private jobStatusItem: JobStatusItemWrapper;
  private lastChosenSceneName: string | undefined;

  private outputChannel: vscode.OutputChannel =
    vscode.window.createOutputChannel("manim");
  private outputPseudoTerm: ManimPseudoTerm = new ManimPseudoTerm("manim");

  refreshJobStatus() {
    if (this.getActiveJob() !== null) {
      this.jobStatusItem.setActive();
    } else {
      this.jobStatusItem.setVisibility(false);
    }
  }

  async run(onSave: boolean) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      if (!onSave) {
        await vscode.window.showErrorMessage(
          Log.error("Hey! You need a valid Python file to run the sideview.")
        );
      }
      return;
    }
    if (
      onSave === true &&
      !this.activeJobs.find(
        (j) => j.config.srcPath === editor.document.fileName
      )
    ) {
      Log.error(
        `Triggered run with "onSave" on ${editor.document.fileName} but couldn't be found.`
      );
      return;
    }

    const doc = editor.document;
    const activeJob = this.getActiveJob(doc.fileName);

    let manimConfig: ManimConfig | undefined;
    let isUsingCfgFile = false;

    // load/reload the file config if this is the first time or if the active job
    // uses a config file
    if (!activeJob || (activeJob && activeJob.config.isUsingCfgFile)) {
      manimConfig = await this.getManimConfigFile(doc.uri.fsPath);
    }

    if (manimConfig) {
      isUsingCfgFile = true;

      if (!activeJob || !activeJob.config.isUsingCfgFile) {
        // loaded the file config for the first time
        const choice = await vscode.window.showInformationMessage(
          Log.info(
            "Manim Sideview: Would you like to use the configuration file from the current working directory?"
          ),
          "Yes",
          "No"
        );
        if (choice === "No") {
          manimConfig = getDefaultMainConfig();
        }
      }
    } else {
      // if we fail load it / we're not using a file: we'll use fallback values
      manimConfig = getDefaultMainConfig();
    }

    // fix in the frame_rate value
    let quality = FALLBACK_CONFIG.qualityMap[manimConfig.quality];
    if (manimConfig.frame_rate !== quality.slice(-2)) {
      quality = quality.replace(quality.slice(-2), manimConfig.frame_rate);
    }

    // insert video_dir related variables
    manimConfig.video_dir = insertContext(
      {
        "{quality}": quality,
        "{media_dir}": manimConfig.media_dir,
      },
      manimConfig.video_dir
    );

    let runningCfg: RunningConfig;
    if (activeJob) {
      activeJob.config.manimConfig = manimConfig;
      activeJob.config.isUsingCfgFile = isUsingCfgFile;
      runningCfg = activeJob.config;
    } else {
      Log.info("Asking user for the new scene name.");
      const newSceneName = await this.getRenderingSceneName(doc.uri);
      if (!newSceneName) {
        return;
      }

      runningCfg = this.getNewRunningConfig(
        doc,
        newSceneName,
        isUsingCfgFile,
        manimConfig
      );
    }

    this.renderShows(runningCfg);
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
    this.activeJobs = [];
    this.manimCfgPath = "";
    this.refreshJobStatus();
  }

  async refreshCurrentConfiguration() {
    const job = this.getActiveJob();
    if (job) {
      this.activeJobs.splice(this.activeJobs.indexOf(job), 1);
      this.refreshJobStatus();
    }
  }

  async setConfigFilePath() {
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

  async setRenderingScene() {
    const job = this.getActiveJob();
    if (!job) {
      vscode.window.showErrorMessage(
        Log.error("You need an active job to set a new scenename!")
      );
      return;
    }
    const newSceneName = await this.getRenderingSceneName(
      job.config.document.uri
    );
    if (!newSceneName) {
      return;
    }
    job.config.sceneName = newSceneName;
  }

  private async getRenderingSceneName(
    srcFileUri: vscode.Uri
  ): Promise<string | undefined> {
    const contents = (await vscode.workspace.fs.readFile(srcFileUri))
      .toString()
      .replace(/\r/g, "")
      .replace(/\n/g, "");

    const sceneClasses = [...contents.matchAll(RE_SCENE_CLASS)].map(
      (m) => "$(run-all) " + m.groups?.name
    );
    const moreOption = "I'll provide it myself!";

    // we will let the user input custom names by default
    let choice = moreOption;
    if (sceneClasses) {
      if (this.lastChosenSceneName) {
        sceneClasses.push(`$(refresh) ${this.lastChosenSceneName}`);
      }
      sceneClasses.push(moreOption);

      const pick = await vscode.window.showQuickPick(sceneClasses, {
        title: "Pick The Name Of Your Scene",
        placeHolder: "Search..",
      });
      if (pick) {
        choice = pick;
      } else {
        Log.error("Try Again! You didn't pick a scene name.");
        return;
      }
    }

    const isCustomInput = choice === moreOption;
    if (isCustomInput || !sceneClasses) {
      const pick = await vscode.window.showInputBox({
        prompt: "Input the name of your scene",
      });
      if (pick) {
        choice = pick;
      } else {
        Log.error("Try Again! You didn't input a custom scene name.");
        return;
      }
    }

    const sceneName = choice
      ?.replace("$(run-all)", "")
      .replace("$(refresh)", "")
      .trim();

    if (sceneName) {
      return sceneName;
    } else {
      Log.error("Try Again! You provided an invalid scene name.");
      return;
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

  async syncFallbackManimConfig() {
    vscode.window.showInformationMessage(
      Log.info("Preparing to sync fallback manim configurations...")
    );
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

      const matches = payload?.match(RE_CFG_OPTIONS);
      if (!matches) {
        return;
      }
      const cfgOptions: { [tp: string]: string } = {};
      matches?.forEach((op) => {
        const options = op.split(":");
        cfgOptions[options[0].trim()] = options[1].trim();
      });
      updateFallbackManimCfg(cfgOptions);
      vscode.window.showInformationMessage(
        "Successfully updated internal defaults for manim.cfg files."
      );
    });
  }

  /**
   * Creates necessary arguments and solutions to run per a running configuration.
   *
   * @param conf the running config
   */
  private async renderShows(conf: RunningConfig) {
    Log.info(`Attempting to render via the running configuration ${conf}`);
    let args = [conf.srcPath];
    if (!conf.isUsingCfgFile) {
      args.push(conf.cliArgs.trim());
    }
    args.push(conf.sceneName.trim());

    let out: vscode.OutputChannel;
    if (
      vscode.workspace
        .getConfiguration("manim-sideview")
        .get("outputToTerminal")
    ) {
      this.outputPseudoTerm.cwd = conf.srcRootFolder;
      this.outputPseudoTerm.isRunning = true;
      out = this.outputPseudoTerm;
    } else {
      out = this.outputChannel;
    }

    this.executeTerminalCommand(args, conf, out);
  }

  async executeTerminalCommand(
    args: string[],
    conf: RunningConfig,
    outputChannel: vscode.OutputChannel
  ) {
    const command = conf.executablePath;
    const cwd = conf.srcRootFolder;
    const mediaFp = path.join(conf.srcRootFolder, getOutputPath(conf));

    // Output channels will not keep historical logs
    outputChannel.clear();

    if (conf.isUsingCfgFile) {
      outputChannel.appendLine(
        Log.format("info", `Configuration status ${conf.isUsingCfgFile}`)
      );
    }

    outputChannel.append(
      Log.format("info", `Current working directory "${cwd}"\n`) +
        Log.format("info", `Manim Executable Path at "${command}"\n`) +
        Log.format("info", `Added arguments ${args.join(" | ")}\n`) +
        Log.format(
          "info",
          `Relative Output Video Path at "${conf.manimConfig.video_dir}"\n`
        ) +
        Log.format("debug", `${command} ${args.join(" ")}\n`) +
        Log.format("info", `Output Video Path at "${mediaFp}"\n`)
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

    this.jobStatusItem.setRunning();

    if (
      !this.process ||
      !this.process.stdout ||
      !this.process.stderr ||
      !this.process.stdin
    ) {
      outputChannel.appendLine(
        Log.format(
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

        if (outs.includes(KILL_MSG)) {
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
        Log.format(
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
          this.jobStatusItem.setError();
          this.process = undefined;
        }
        return;
      }

      if (isMainProcess) {
        this.process = undefined;
      }

      if (code === 0) {
        if (!fs.existsSync(mediaFp)) {
          vscode.window.showErrorMessage(
            Log.error(
              `Video file at "${mediaFp}" not found.` +
                " Please make sure that the designated video and media directories" +
                " are reflected in the extension log."
            )
          );
          this.jobStatusItem.setError();
          return;
        }

        vscode.workspace.fs.stat(vscode.Uri.file(mediaFp)).then(
          (fs) => {
            // we'll open a side view if we can find the file
            const res = vscode.Uri.file(mediaFp);
            if (!res) {
              vscode.window.showErrorMessage(
                "The output file couldn't be found."
              );
            } else {
              this.videoPlayer.showVideo(res, conf);
            }
            this.newJob(conf);
          },
          (res) => {
            vscode.window.showErrorMessage(`${res}`);
            this.jobStatusItem.setError();
          }
        );
      } else {
        this.jobStatusItem.setError();
      }
    });
  }

  private newJob(conf: RunningConfig) {
    this.activeJobs.push({ config: conf });
    this.jobStatusItem.setNew();
  }

  /**
   * Evaluate a job if it exists from the currently active document or from
   * a source path if given.
   *
   * @param srcPath
   * @returns Job | null
   */
  getActiveJob(srcPath?: string): Job | null {
    let path: string;
    if (!srcPath) {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "python") {
        return null;
      }
      path = editor.document.fileName;
    } else {
      path = srcPath;
    }

    return this.activeJobs.find((j) => j.config.srcPath === path) || null;
  }

  /**
   * Finds the manim.cfg file and if exists returns a
   * ManimConfig object.
   *
   * Returns false if there is a problem with the manim config, undefined if
   * it is undefined.
   *
   * @param srcfilePath
   * @returns ManimConfig | undefined | false
   */
  private async getManimConfigFile(
    srcfilePath: string
  ): Promise<ManimConfig | undefined> {
    const rootPath = path.join(srcfilePath, "../");

    const filePath = this.manimCfgPath
      ? this.manimCfgPath
      : path.join(rootPath, "manim.cfg");

    if (!fs.existsSync(filePath)) {
      return;
    }

    Log.info(`Parsing configuration file at ${filePath}.`);
    try {
      var parsedConfig = await ConfigParser.parse(filePath);
    } catch (e) {
      vscode.window.showErrorMessage(
        Log.error("Failed parsing the manim.cfg file, ignoring the file...")
      );
      return;
    }

    if (!Object.keys(parsedConfig).includes(CONFIG_SECTION)) {
      vscode.window.showErrorMessage(
        Log.error(`Config file is missing the [${CONFIG_SECTION}] section.`)
      );
      return;
    }

    const cliConfig = parsedConfig[CONFIG_SECTION];

    // we always need a fully configured ManimConfig so this requires us to
    // start from fallback values
    let manimConfig = getDefaultMainConfig();

    const relevantFlags = ["quality", "media_dir", "video_dir", "frame_rate"];
    for (const flag of relevantFlags) {
      if (Object.keys(cliConfig).includes(flag)) {
        manimConfig[flag as keyof ManimConfig] = cliConfig[flag];
        Log.info(`Set flag "${flag}" to ${cliConfig[flag]}.`);
      }
    }

    return manimConfig;
  }

  private getNewRunningConfig(
    doc: vscode.TextDocument,
    sceneName: string,
    isUsingCfgFile: boolean,
    manimConfig: ManimConfig
  ): RunningConfig {
    const srcPath = doc.uri.fsPath;
    Log.info(`Creating a new configuration for file at path ${srcPath}`);

    const settings = vscode.workspace.getConfiguration("manim-sideview");
    const moduleName = path.basename(srcPath).slice(0, -3);
    const root = path.join(doc.uri.fsPath, "../");

    return {
      executablePath: path.normalize(
        settings.get("defaultManimPath") || BASE_MANIM_EXE
      ),
      cliArgs: settings.get("commandLineArgs") || BASE_ARGS,
      srcRootFolder: root,
      srcPath: srcPath,
      moduleName: moduleName,
      isUsingCfgFile: isUsingCfgFile,
      manimConfig: manimConfig,
      document: doc,
      sceneName: sceneName,
    };
  }
}
