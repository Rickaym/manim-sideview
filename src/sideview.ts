/* eslint-disable @typescript-eslint/naming-convention */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

import { ChildProcess, spawn } from "child_process";
import {
  RunningConfig,
  BASE_ARGS,
  BASE_MANIM_EXE,
  getDefaultMainConfig,
  Log,
  ManimConfig,
  getVideoOutputPath,
  updateFallbackManimCfg,
  getImageOutputPath,
} from "./globals";

import { ConfigParser } from "./configParser";
import { MediaPlayer, PlayableMediaType } from "./player";
import { Gallery } from "./gallery";
import { ManimPseudoTerm } from "./pseudoTerm";

const CONFIG_SECTION = "CLI";

const RE_SCENE_CLASS = /class\s+(?<name>\w+)\(\w*Scene\w*\):/g;
const RE_CFG_OPTIONS = /(\w+)\s?:\s?([^ ]*)/g;
const RE_FILE_READY = /File ready at '(?<path>[^']+)'/g;
const RE_MANIM_VERSION = /Manim Community v(?<version>[.0-9]+)/g;

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
    this.jobStatusItem.command = "manim-sideview.removeCurrentJob";
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
    this.setIcon("$(vm-active)");
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
  private mediaPlayer = new MediaPlayer(
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
        vscode.window.showInformationMessage(
          Log.info(
            "Manim Sideview: Extension successfully loaded a configuration file from the current working directory!"
          )
        );
      }
    } else {
      // if we fail load it / we're not using a file: we'll use fallback values
      manimConfig = getDefaultMainConfig();
    }

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

    this.runConfig(runningCfg);
  }

  stop(process?: ChildProcess) {
    if (!process) {
      process = this.process;
    }
    if (process) {
      process.kill();
    }
  }

  async removeAllJobs() {
    this.activeJobs = [];
    this.manimCfgPath = "";
    this.refreshJobStatus();
  }

  async removeCurrentJob() {
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
        title: "Manim Sideview: Pick your scene name!",
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
   * @param config the running config
   */
  private async runConfig(config: RunningConfig) {
    Log.info(
      `Attempting to render via the running configuration ${JSON.stringify(
        config,
        null,
        4
      )}\n{\n"videoOutputPath": ${getVideoOutputPath(
        config
      )},\n"imageOutputPath": ${getImageOutputPath(config, "{version}")}\n}`
    );
    let args = [config.srcPath];
    if (!config.isUsingCfgFile) {
      args.push(...config.cliArgs.trim().split(" "));
    }
    args.push(config.sceneName.trim());

    let out: vscode.OutputChannel;
    if (
      vscode.workspace
        .getConfiguration("manim-sideview")
        .get("outputToTerminal")
    ) {
      this.outputPseudoTerm.cwd = config.srcRootFolder;
      this.outputPseudoTerm.isRunning = true;
      out = this.outputPseudoTerm;
    } else {
      out = this.outputChannel;
    }

    this.executeTerminalCommand(args, config, out);
  }

  async executeTerminalCommand(
    args: string[],
    config: RunningConfig,
    outputChannel: vscode.OutputChannel
  ) {
    const command = config.executablePath;
    const cwd = config.srcRootFolder;
    var manimVersion: string | undefined;
    var outputFileType: number | undefined;

    // mime command without "
    outputChannel.append(`${command} ${args.join(" ")}\n`);

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
      outputChannel.append(
        Log.info(
          `Execution returned code=911 in Process: ${this.process}, stdout: ${this.process?.stdout}, stdout: ${this.process?.stderr}\n`
        )
      );
      return vscode.window.showErrorMessage(
        "Fatal error, please look at the output channel."
      );
    }
    // We'll keep a closure because this.process is capable of going undefined
    // at any given time, but we still want valid references
    const process = this.process;
    this.process.stdout.on("data", (data: string) => {
      if (!process.killed) {
        const dataStr = data.toString();
        outputChannel.append(dataStr);

        if (dataStr.includes(KILL_MSG)) {
          this.stop(process);
          outputChannel.append("\n");
          return;
        }

        if (!outputFileType) {
          const fileSignifier = [...dataStr.matchAll(RE_FILE_READY)];
          if (!fileSignifier) {
            return;
          }

          // Change output file type to image if the "File ready" message
          // tells us that the media ready has the png extension.
          if (
            fileSignifier.some((m) =>
              m.groups?.path.replace(/ |\r|\n/g, "").endsWith(".png")
            )
          ) {
            outputFileType = PlayableMediaType.Image;
          } else {
            outputFileType = PlayableMediaType.Video;
          }
        }
        if (!manimVersion) {
          const versionSignifier = [...dataStr.matchAll(RE_MANIM_VERSION)];
          if (!versionSignifier) {
            return;
          }
          manimVersion = versionSignifier[0].groups?.version;
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
        Log.info(
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
        const mediaFp = vscode.Uri.file(
          path.join(
            config.srcRootFolder,
            outputFileType === PlayableMediaType.Video
              ? getVideoOutputPath(config)
              : getImageOutputPath(config, manimVersion || "")
          )
        );

        vscode.workspace.fs.stat(mediaFp).then(
          (fs) => {
            // we'll open a side view if we can find the file
            this.mediaPlayer.playMedia(
              mediaFp,
              config,
              outputFileType || PlayableMediaType.Video
            );
            this.newJob(config);
          },
          (res) => {
            Log.error(`${res}`);
            vscode.window.showErrorMessage(
              Log.error(
                `Manim Sideview: "${mediaFp}" does not exist to be loaded in the sideview.` +
                  " Please make sure that the designated video and image directories" +
                  " are reflected in the extension log."
              )
            );
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
