/* eslint-disable @typescript-eslint/naming-convention */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

import { ChildProcess, spawn } from "child_process";
import {
  RunningConfig,
  getDefaultMainConfig,
  Log,
  ManimConfig,
  getVideoOutputPath,
  updateFallbackManimCfg,
  getImageOutputPath,
  getUserConfiguration,
} from "./globals";

import { ConfigParser } from "./configParser";
import { MediaPlayer, PlayableMediaType } from "./player";
import { Gallery } from "./gallery";
import { ManimPseudoTerm } from "./pseudoTerm";

const CONFIG_SECTION = "CLI";
const RELEVANT_CONF_FLAGS = [
  "quality",
  "media_dir",
  "video_dir",
  "images_dir",
  "frame_rate",
];
const RE_SCENE_CLASS = /class\s+(?<name>\w+)\(\w*Scene\w*\):/g;
const RE_CFG_OPTIONS = /(\w+)\s?:\s?([^ ]*)/g;
const RE_FILE_READY = /File\s*ready\s*at[^']*'(?<path>[^']*)'/g;

// a process will be killed if this message is seen
const KILL_MSG =
  "Choose number corresponding to desired scene/arguments.\r\n(Use comma separated list for multiple entries)\r\nChoice(s):  ";

const enum JobStatus {
  Error,
  Active,
  Running,
  New,
}

type Job = {
  config: RunningConfig;
  status: JobStatus;
};

class JobStatusItemWrapper {
  constructor() {
    this.jobStatusItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left
    );
    this.jobStatusItem.name = "job-indicator";
    this.jobStatusItem.command = "manim-sideview.removeCurrentJob";
    this.jobStatusItem.tooltip = "Mainm Sideview - Press to stop session.";
  }

  private jobStatusItem: vscode.StatusBarItem;

  getItem() {
    return this.jobStatusItem;
  }

  private setIcon(themeIcon: String) {
    this.jobStatusItem.text = `${themeIcon} Manim SV`;
  }

  setNew() {
    this.jobStatusItem.backgroundColor = new vscode.ThemeColor(
      "button.hoverBackground"
    );
    this.setIcon("$(vm-active)");
    this.setVisibility(true);
  }

  restoreStatus(job: Job) {
    switch (job.status) {
      case JobStatus.New:
        this.setNew();
        break;
      case JobStatus.Active:
        this.setActive(job);
        break;
      case JobStatus.Error:
        this.setError(job);
        break;
      case JobStatus.Running:
        this.setRunning(job);
        break;
    }
  }

  setRunning(job: Job | null) {
    if (job) {
      job.status = JobStatus.Running;
    }
    this.jobStatusItem.color = new vscode.ThemeColor("textLink.foreground");
    this.setIcon("$(sync~spin)");
    this.setVisibility(true);
  }

  setActive(job: Job | null) {
    if (job) {
      job.status = JobStatus.Active;
    }
    this.jobStatusItem.color = new vscode.ThemeColor("textLink.foreground");
    this.setIcon("$(vm-running)");
    this.setVisibility(true);
  }

  setError(job: Job | null) {
    if (job) {
      job.status = JobStatus.Error;
    }
    this.jobStatusItem.color = new vscode.ThemeColor("minimap.errorHighlight");
    this.setIcon("$(vm-outline)");
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
  private activeJobs: { [fsPath: string]: Job } = {};
  private mediaPlayer = new MediaPlayer(
    this.ctx.extensionUri,
    this.ctx.subscriptions
  );
  private gallery = new Gallery(this.ctx.extensionUri, this.ctx.subscriptions);
  private process: ChildProcess | undefined;
  private jobStatusItem: JobStatusItemWrapper;
  private lastChosenSceneNames: { [fsPath: string]: string } = {};

  // the following channels are only created when necessary
  private outputChannel?: vscode.OutputChannel;
  private outputPseudoTerm?: ManimPseudoTerm;

  async run(srcPath?: vscode.Uri | string) {
    let activeJob = srcPath
      ? this.getActiveJob(
          typeof srcPath === "string" ? srcPath : srcPath.fsPath
        )!
      : null;
    let doc: vscode.TextDocument;

    // If we couldn't obtain the active job by the srcPath provided (if it has been)
    // We fallback to fetching the active text editor's document without the
    // requirement for active jobs.
    if (activeJob) {
      doc = activeJob.config.document;
    } else {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage(
          Log.error(
            "Manim Sideview: You need to select a valid Python source file."
          )
        );
        return;
      }
      doc = editor.document;
      activeJob = this.getActiveJob(doc.fileName);
    }

    // load/reload every time the program is running
    let manimConfig = await this.getManimConfigFile(doc.uri.fsPath);
    let isUsingCfgFile = false;

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
    this.activeJobs = {};
    this.manimCfgPath = "";
    this.refreshJobStatus();
  }

  async removeCurrentJob() {
    const job = this.getActiveJob();
    if (job) {
      delete this.activeJobs[job.config.srcPath];
      this.refreshJobStatus();
    }
  }

  refreshJobStatus() {
    const activeJob = this.getActiveJob();
    if (activeJob !== null) {
      this.jobStatusItem.restoreStatus(activeJob);
    } else {
      this.jobStatusItem.setVisibility(false);
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

  async renderNewScene(runningCfgSrcPath?: string) {
    const job = this.getActiveJob(runningCfgSrcPath);
    if (!job) {
      vscode.window.showErrorMessage(
        Log.error(
          "Manim Sideview: Select a Python source file to render a new scene."
        )
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
    this.run(runningCfgSrcPath);
  }

  private async getRenderingSceneName(
    srcFileUri: vscode.Uri
  ): Promise<string | undefined> {
    const contents = (await vscode.workspace.fs.readFile(srcFileUri))
      .toString()
      .replace(/\r|\n/g, "");

    const sceneClasses = [...contents.matchAll(RE_SCENE_CLASS)].map(
      (m) => `$(run-all) ${m.groups?.name}`
    );
    const moreOption = "I'll provide it myself!";

    // we will let the user input custom names by default
    let choice = moreOption;
    if (sceneClasses) {
      if (Object.keys(this.lastChosenSceneNames).includes(srcFileUri.fsPath)) {
        const lastChosenSceneName =
          this.lastChosenSceneNames[srcFileUri.fsPath];
        const decorlastChosenSceneName = `$(run-all) ${lastChosenSceneName}`;
        if (sceneClasses.includes(decorlastChosenSceneName)) {
          sceneClasses.splice(
            sceneClasses.indexOf(decorlastChosenSceneName),
            1
          );
        }
        sceneClasses.push(`$(refresh) ${lastChosenSceneName}`);
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
      this.lastChosenSceneNames[srcFileUri.fsPath] = sceneName;
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

  auditTextEditorChange(editor: vscode.TextEditor | undefined) {
    if (editor && editor.document.languageId === "python") {
      this.gallery.setLastActiveEditor(editor);
    }
  }

  async syncFallbackManimConfig() {
    vscode.window.showInformationMessage(
      Log.info("Preparing to sync fallback manim configurations...")
    );
    const process = spawn(
      path.normalize(getUserConfiguration("defaultManimPath")),
      ["cfg", "show"]
    );

    let fullStdout = "";
    process.stdout.on("data", function (data: string) {
      fullStdout += data.toString();
    });

    process.on("close", function (_, __) {
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
      )},\n{\n\t"predictedVideoOutputPath": ${getVideoOutputPath(
        config
      )},\n\t"predictedImageOutputPath": ${getImageOutputPath(
        config,
        "{version}"
      )}\n}`
    );
    let args = [config.srcPath];
    if (!config.isUsingCfgFile) {
      getUserConfiguration<string>("commandLineArgs")
        .trim()
        .split(" ")
        .forEach((arg) => (arg ? args.push(arg) : undefined));
    }

    args.push(config.sceneName.trim());

    let out: vscode.OutputChannel;
    if (getUserConfiguration("outputToTerminal")) {
      this.ensureOutputChannelCreation();
      this.outputPseudoTerm!.cwd = config.srcRootFolder;
      this.outputPseudoTerm!.isRunning = true;
      out = this.outputPseudoTerm!;
    } else {
      out = this.outputChannel!;
    }

    this.executeTerminalCommand(args, config, out);
  }

  async executeTerminalCommand(
    args: string[],
    config: RunningConfig,
    outputChannel: vscode.OutputChannel
  ) {
    const command = path.normalize(getUserConfiguration("defaultManimPath"));
    const cwd = config.srcRootFolder;

    // mime command without
    outputChannel.append(`${command} ${args.join(" ")}\n`);

    if (getUserConfiguration("focusOutputOnRun")) {
      outputChannel.show(true);
    }

    const startTime = new Date();
    if (this.process) {
      this.stop();
    }
    const process = spawn(command, args, { cwd: cwd, shell: false });
    Log.info(`[${process.pid}] Spawned a new process for command execution.`);
    this.process = process;
    this.jobStatusItem.setRunning(this.getActiveJob(config.srcPath));

    if (
      !this.process ||
      !this.process.stdout ||
      !this.process.stderr ||
      !this.process.stdin
    ) {
      outputChannel.appendLine(
        Log.info(
          `[${process.pid}] Execution returned code=911 in Process: ${process.pid}, stdout: ${process.stdout}, stdout: ${process.stderr}`
        )
      );
      return vscode.window.showErrorMessage(
        "Fatal error, please look at the output channel."
      );
    }
    // We'll keep a closure because this.process is capable of going undefined
    // at any given time, but we still want valid references
    let stdoutLogbook = "";
    process.stdout.on("data", (data: string) => {
      if (!process.killed) {
        const dataStr = data.toString();
        stdoutLogbook += dataStr;

        Log.info(
          `[${process.pid}] Relaying stdout output "${dataStr
            .replace(/\r\n/g, "\\n")
            .replace(/    /g, "\\t")}"`
        );
        outputChannel.append(dataStr);

        if (dataStr.includes(KILL_MSG)) {
          Log.error(
            `[${process.pid}] Kill message is sent, ending the process.`
          );
          this.stop(process);
          outputChannel.appendLine("");
          return;
        }
      }
    });

    process.stderr.on("data", (data: string) => {
      if (!process.killed) {
        outputChannel.append(data.toString());
      }
    });

    process.on("error", (err: Error) => {
      if (!process.killed) {
        outputChannel.append(err.toString());
      }
    });

    process.on("close", async (code: number, signal: string) => {
      const elapsedTime = (new Date().getTime() - startTime.getTime()) / 1000;

      // This process has been user-terminated
      if (signal === "SIGTERM") {
        code = 1;
      }

      outputChannel.appendLine(
        Log.info(
          `[${
            process.pid
          }] Execution returned code=${code} in ${elapsedTime} seconds ${
            code === 1 ? "returned signal " + signal : ""
          } ${
            signal === "SIGTERM"
              ? "Cause: An old process has been terminated due to a termination signal."
              : ""
          }`
        ) + "\n"
      );

      const isMainProcess = this.process && this.process.pid === process.pid;

      if (isMainProcess) {
        this.process = undefined;
      }

      if (signal === "SIGTERM") {
        if (isMainProcess) {
          this.jobStatusItem.setError(this.getActiveJob(config.srcPath));
        }
        return;
      }

      if (code === 0) {
        // parse out outputFileType and loggedImageName from the logbook
        let outputFileType: number | undefined;
        let loggedImageName: string | undefined;

        const fileReSignifier = [...stdoutLogbook.matchAll(RE_FILE_READY)];
        if (fileReSignifier.length > 0) {
          const fileIdentifier = fileReSignifier.find((m) =>
            m.groups?.path.replace(/ |\r|\n/g, "").endsWith(".png")
          );
          if (fileIdentifier) {
            outputFileType = PlayableMediaType.Image;
            loggedImageName = fileIdentifier.groups?.path
              .replace(/ |\r|\n/g, "")
              .split(/\\|\//g)
              .pop();
          } else {
            outputFileType = PlayableMediaType.Video;
          }
          Log.info(
            `[${process.pid}] ${
              outputFileType === PlayableMediaType.Image ? "Image" : "Video"
            } output detected.`
          );
        }

        if (outputFileType === undefined) {
          const fileType = await vscode.window.showWarningMessage(
            Log.warn(
              `Manim Sideview: Unable to infer the file-type for "${config.sceneName}". Please select below.`
            ),
            "Video",
            "Image"
          );
          if (!fileType) {
            return;
          }
          outputFileType =
            fileType === "Video"
              ? PlayableMediaType.Video
              : PlayableMediaType.Image;
        }

        const mediaFp = vscode.Uri.file(
          path.join(
            config.srcRootFolder,
            outputFileType === PlayableMediaType.Video
              ? getVideoOutputPath(config)
              : getImageOutputPath(config, loggedImageName)
          )
        );
        if (!fs.existsSync(mediaFp.fsPath)) {
          vscode.window
            .showErrorMessage(
              Log.error(
                `Manim Sideview: Estimated output file does not exist at "${mediaFp.fsPath}"` +
                  " Make sure that the designated video directories are reflected" +
                  " in the extension log."
              ),
              "Show Log"
            )
            .then((value) =>
              value === "Show Log"
                ? vscode.commands.executeCommand(
                    "manim-sideview.showOutputChannel"
                  )
                : null
            );
          this.jobStatusItem.setError(this.getActiveJob(config.srcPath));
          return;
        }
        // we'll open a side view if we can find the file
        this.mediaPlayer.playMedia(
          mediaFp,
          config,
          outputFileType || PlayableMediaType.Video
        );

        if (!Object.keys(this.activeJobs).includes(config.srcPath)) {
          Log.info(
            `New job added for "${config.srcPath}" as ${JSON.stringify(
              config,
              null,
              4
            )}`
          );
          this.activeJobs[config.srcPath] = {
            config: config,
            status: JobStatus.New,
          };
          this.jobStatusItem.setNew();
        } else {
          this.jobStatusItem.setActive(this.getActiveJob(config.srcPath));
        }
      } else {
        this.jobStatusItem.setError(this.getActiveJob(config.srcPath));
      }
    });
  }

  private ensureOutputChannelCreation() {
    if (!this.outputChannel) {
      this.outputChannel = vscode.window.createOutputChannel("manim");
    }
    if (!this.outputPseudoTerm || this.outputPseudoTerm.isClosed()) {
      this.outputPseudoTerm = new ManimPseudoTerm("manim");
    }
  }

  /**
   * Evaluate a job if it exists from the currently active document or from
   * a source path if given. If the currently active document is the manim
   * sideview webview, the last job will be returned.
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

    return this.activeJobs[path] || null;
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

    for (const flag of RELEVANT_CONF_FLAGS) {
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

    const moduleName = path.basename(srcPath).slice(0, -3);
    const root = path.join(doc.uri.fsPath, "../");

    return {
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
