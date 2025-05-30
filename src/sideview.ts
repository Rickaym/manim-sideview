/* eslint-disable @typescript-eslint/naming-convention */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import ConfigParser from "configparser";

import { ChildProcess, spawn, execSync } from "child_process";
import {
  RunningConfig,
  getDefaultConfig,
  Log,
  ManimConfig,
  getVideoOutputPath,
  updateFallbackManimCfg,
  getImageOutputPath,
  getUserConfiguration,
  insertContext,
  DefaultTerminalName,
} from "./globals";

import { JobStatusManager } from "./job";
import { MediaPlayer, PlayableMediaType } from "./player";
import { Gallery } from "./gallery";
import { ManimPseudoTerm } from "./pseudoTerm";
import { PythonExtension } from "@vscode/python-extension";
import { window } from "vscode";

const CONFIG_SECTION = "CLI";
const RELEVANT_CONFIG_OPTIONS = [
  "quality",
  "frame_rate",
  "pixel_width",
  "pixel_height",
  "media_dir",
  "video_dir",
  "images_dir",
];
const RE_SCENE_CLASS = /class\s+(?<name>\w+)\(\w*Scene\w*\):/g;
const RE_CFG_OPTIONS = /(\w+)\s?:\s?([^ ]*)/g;
const RE_FILE_READY = /File\s*ready\s*at[^']*'(?<path>[^']*)'/g;

const PYTHON_ENV_SCRIPTS_FOLDER = {
  win32: "Scripts",
  darwin: "bin",
  linux: "bin",
};

type MediaInfo = {
  fileType: number;
  imageName: string | undefined;
};

// a process will be killed if this message is seen
const KILL_MSG =
  "Choose number corresponding to desired scene/arguments.\r\n(Use comma separated list for multiple entries)\r\nChoice(s):  ";

/**
 * Formats a message from a process and makes it printable
 * @param message The message received from stdout/stderr
 * @returns The result
 */
function formatOutput(message: string): string {
  return message.replace(/\r\n/g, "\\n").replace(/    /g, "\\t");
}

function quoteSpecialChars(text: string): string {
  // special characters
  const specialCharsRegex = /[^\w\s,.]/;
  if (specialCharsRegex.test(text)) {
    return `"${text}"`;
  }
  return text;
}

export class ManimSideview {
  constructor(
    public readonly ctx: vscode.ExtensionContext,
    public readonly pythonApi: PythonExtension
  ) {
    this.ctx = ctx;
    this.pythonApi = pythonApi;
    this.jobManager = new JobStatusManager();
    this.ctx.subscriptions.push(this.jobManager.getItem());
    this.mediaPlayer = new MediaPlayer(
      this.ctx.extensionUri,
      this.ctx.subscriptions
    );
    this.gallery = new Gallery(this.ctx.extensionUri, this.ctx.subscriptions);
  }

  private manimConfPath: string = "";
  // private activeJobs: { [fsPath: string]: Job } = {};
  private process: ChildProcess | undefined;
  private jobManager: JobStatusManager;
  private previousSceneNames: { [fsPath: string]: string } = {};
  private mediaPlayer: MediaPlayer;
  public gallery: Gallery;

  // the pointer to the current output channel
  private outputChannel?: vscode.OutputChannel;
  // the following channels are only created when needed
  private manimOutputChannel?: vscode.OutputChannel;
  private manimPseudoTerm?: ManimPseudoTerm;

  /**
   * The main entry point for executing a render.
   *
   * @param srcPath path to the src file, if undefined, the active text document is used
   * @param autoRun denotes whether if this call is from
   * an automated runner like RunOnSave
   */
  async cmdRun(srcPath?: vscode.Uri | string, autoRun?: boolean) {
    let activeJob = srcPath
      ? this.jobManager.getActiveJob(
        typeof srcPath === "string" ? srcPath : srcPath.fsPath
      )!
      : null;

    if (autoRun === true && !activeJob) {
      Log.info(
        `Ignoring auto-run of ${srcPath} for lack of a first time manual run`
      );
      return;
    }

    let document: vscode.TextDocument;

    if (activeJob) {
      document = activeJob.config.document;
    } else {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        // auto runs can be ignored if the active editor is invalid
        if (!autoRun) {
          vscode.window.showErrorMessage(
            Log.error(
              "Manim Sideview: You need to select a valid Python source file."
            )
          );
        }
        return;
      }
      document = editor.document;
      activeJob = this.jobManager.getActiveJob(document.fileName);
    }

    // configuration is reloaded every run
    let manimConfig = await this.getManimConfigFile(document.uri.fsPath);
    let isConfFile: boolean;

    if (manimConfig) {
      isConfFile = true;

      if (!activeJob || !activeJob.config.isUsingConfFile) {
        // notify config file loading for the first time
        vscode.window.showInformationMessage(
          Log.info(
            "Manim Sideview: Loaded a configuration file from the working directory."
          )
        );
      }
    } else {
      isConfFile = false;
      manimConfig = getDefaultConfig();
    }

    let currentRunningConfig: RunningConfig;
    if (activeJob) {
      // if there is an active job simply resume
      activeJob.config.manimConfig = manimConfig;
      activeJob.config.isUsingConfFile = isConfFile;
      currentRunningConfig = activeJob.config;
    } else {
      const newSceneName = await this.getRenderSceneName(document.uri);
      if (!newSceneName) {
        return;
      }

      Log.info(
        `Asked user for a new scene name and recieved "${newSceneName}".`
      );
      currentRunningConfig = this.createRunningConfig(
        document,
        newSceneName,
        isConfFile,
        manimConfig
      );
    }

    this.render(currentRunningConfig);
  }

  async cmdStop() {
    if (this.process) {
      this.process.kill();
    }
  }

  async cmdRemoveAllJobs() {
    this.jobManager.removeAllActiveJobs();
    this.manimConfPath = "";
    this.refreshJobStatus();
  }

  async cmdRemoveJob(srcPath?: string | undefined) {
    Log.info(`Removing job for file ${srcPath}.`);
    const job = this.jobManager.getActiveJob(srcPath);
    if (job) {
      this.refreshJobStatus();
      if (this.process) {
        this.process.kill();
        this.process = undefined;
      }
      this.jobManager.setError(job);
      this.jobManager.removeJob(job.config.srcPath);
    } else {
      Log.info(`No job found for file ${srcPath}.`);
    }
  }

  refreshJobStatus(srcPath?: string | undefined) {
    Log.info(`Refreshing job status.`);
    const activeJob = this.jobManager.getActiveJob(srcPath);
    if (activeJob !== null) {
      this.jobManager.restoreStatus(activeJob);
    } else {
      this.jobManager.setVisibility(false);
    }
  }

  async cmdRenderNewScene(runningCfgSrcPath?: string) {
    console.log("cmdRenderNewScene", runningCfgSrcPath);
    const job = this.jobManager.getActiveJob(runningCfgSrcPath);
    if (!job) {
      vscode.window.showErrorMessage(
        Log.error(
          "Manim Sideview: Select a Python file first to render a new scene!"
        )
      );
      return;
    }
    const newSceneName = await this.getRenderSceneName(job.config.document.uri);
    if (!newSceneName) {
      return;
    }
    job.config.sceneName = newSceneName;
    this.cmdRun(runningCfgSrcPath);
  }

  auditTextEditorChange(editor: vscode.TextEditor) {
    this.gallery.setLastActiveEditor(editor);
  }

  private async getRenderSceneName(
    srcFileUri: vscode.Uri
  ): Promise<string | undefined> {
    Log.info(`Fetching the scene name for probably render file ${srcFileUri}.`);

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
      if (Object.keys(this.previousSceneNames).includes(srcFileUri.fsPath)) {
        const lastChosenSceneName = this.previousSceneNames[srcFileUri.fsPath];
        const decorlastChosenSceneName = `$(run-all) ${lastChosenSceneName}`;
        if (sceneClasses.includes(decorlastChosenSceneName)) {
          sceneClasses.splice(
            sceneClasses.indexOf(decorlastChosenSceneName),
            1
          );
          sceneClasses.push(`$(refresh) ${lastChosenSceneName}`);
        }
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
        prompt: "Manim Sideview: Input the name of your scene",
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
      this.previousSceneNames[srcFileUri.fsPath] = sceneName;
      return sceneName;
    } else {
      Log.error("Try Again! You provided an invalid scene name.");
      return;
    }
  }

  private async getManimPath() {
    let manimPath = path.normalize(getUserConfiguration("defaultManimPath"));
    let envName = null;

    Log.info(`Default manim path is found as "${manimPath}"`);
    if (!path.isAbsolute(manimPath)) {
      const env = await this.getPythonEnvironment();
      if (env) {
        envName = env.name || "base";
        Log.info(`Using python environment "${envName}" for manim.`);

        let bin =
          PYTHON_ENV_SCRIPTS_FOLDER[
          process.platform as keyof typeof PYTHON_ENV_SCRIPTS_FOLDER
          ];

        if (!bin) {
          Log.error(
            "Manim Sideview: Unsupported platform for python environment. Assuming linux directory."
          );
          bin = PYTHON_ENV_SCRIPTS_FOLDER["linux"];
        }

        // Check if the environment path is a direct path to the Python executable
        const normalizedPath = path.normalize(env.folderUri.fsPath);
        const isPythonPath = ["\\bin\\python", "\\Scripts\\python.exe"].some(
          (execPath) => normalizedPath.endsWith(execPath)
        );

        let pythonDir: string;
        if (isPythonPath) {
          pythonDir = path.dirname(env.folderUri.fsPath);
          Log.info(`Using Python executable directory: ${pythonDir}`);
        } else {
          pythonDir = path.join(env.folderUri.fsPath, bin);
        }

        manimPath = path.join(pythonDir, manimPath);
        Log.info(
          `Resolved manim path: ${manimPath} (from environment: ${env.folderUri.fsPath})`
        );
      }
    }

    // Check if manim path exists
    if (!(await this.checkManimExists(manimPath))) {
      if (await this.checkManimExists("manim")) {
        window.showWarningMessage(
          Log.warn(
            `Manim Sideview: Executable not found at ${manimPath}, but found executable on PATH...`
          )
        );
        manimPath = "manim";
      } else {
        const msg = Log.error(
          `Manim Sideview: Manim is not found in PATH or at the specified location "${manimPath}". Please ensure manim is installed correctly or specify a valid path in settings.`
        );
        window.showErrorMessage(msg, "Go to Settings").then((selection) => {
          if (selection === "Go to Settings") {
            vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "manim-sideview.defaultManimPath"
            );
          }
        });
        throw Error(msg);
      }
    }
    return { manim: manimPath, envName };
  }

  async cmdUpdateDefaultManimConfig() {
    vscode.window.showInformationMessage(
      Log.info(
        "Manim Sideview: Preparing to sync fallback manim configurations..."
      )
    );
    const process = spawn((await this.getManimPath()).manim, ["cfg", "show"]);

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
        "Manim Sideview: Successfully updated internal defaults for manim.cfg files."
      );
    });
  }

  private async getPythonEnvironment() {
    if (!this.pythonApi.environments) {
      return;
    }
    const environmentPath =
      this.pythonApi.environments.getActiveEnvironmentPath();
    const environment = await this.pythonApi.environments.resolveEnvironment(
      environmentPath
    );
    if (environment) {
      return environment.environment;
    }
  }

  /**
   * Executes the post render terminal command.
   *
   * @param commandInput full command string with arguments
   * @param cwd current working directory
   * @param outputChannel output channel
   */
  private executeTerminalCommand(
    outputPath: string,
    srcPath: string,
    sceneName: string,
    cwd: string
  ) {
    const terminalCommand = getUserConfiguration<string>("terminalCommand");
    const commandInput = insertContext(
      {
        "{outputPath}": outputPath,
        "{sourcePath}": srcPath,
        "{sceneName}": sceneName,
      },
      terminalCommand
    );

    let cli = vscode.window.terminals.find(
      (t) => t.name === DefaultTerminalName
    );
    if (!cli) {
      cli = vscode.window.createTerminal({
        name: DefaultTerminalName,
        cwd: cwd,
        hideFromUser: true,
        message:
          "This is an internal terminal for executing post-render manim commands!",
      });
    } else {
      cli.sendText(`cd "${cwd}"`);
    }
    Log.info(`Executing post-render command "${commandInput}" in terminal "${cli.name}".`);
    cli.sendText(commandInput);
  }

  /**
   * Gets the output channel and configures it to the cwd.
   */
  private getOutputChannel(cwd: string, envName: string) {
    let outputChannel: vscode.OutputChannel;
    if (getUserConfiguration("outputToTerminal")) {
      this.ensureOutputChannel(getUserConfiguration("outputToTerminal"));
      this.manimPseudoTerm!.envName = envName;
      this.manimPseudoTerm!.cwd = cwd;
      this.manimPseudoTerm!.isRunning = true;
      outputChannel = this.manimPseudoTerm!;
    } else {
      outputChannel = this.manimOutputChannel!;
    }
    this.outputChannel = outputChannel;
  }

  /**
   * Renders the scene with the given configuration.
   *
   * @param config the running configuration
   */
  private async render(config: RunningConfig) {
    Log.info(
      "Attempting to render via the running configuration " +
      JSON.stringify(config, null, 4) +
      ",\n" +
      JSON.stringify(
        {
          cliArguments: this.getPreferenceArgs(),
          predictedVideoOutputPath: getVideoOutputPath(config),
          predictedImageOutputPath: getImageOutputPath(config, "{version}"),
        },
        null,
        4
      )
    );

    const cwd = config.srcRootFolder;
    const manim = await this.getManimPath();

    this.getOutputChannel(cwd, manim.envName || "");
    if (getUserConfiguration("focusOutputOnRun")) {
      this.outputChannel!.show(true);
    }

    this.jobManager.addJob(config, PlayableMediaType.Video);

    const args: string[] = [
      config.srcPath,
      ...(config.isUsingConfFile ? [] : this.getPreferenceArgs()),
      config.sceneName.trim(),
    ];

    this.spawnManimProcess(
      manim.manim,
      args,
      cwd,
      config.srcPath,
      config.sceneName,
      (mediaInfo) => {
        Log.info(`Running process for "${config.sceneName}" has finished.`);
        const mediaPath =
          mediaInfo.fileType === PlayableMediaType.Video
            ? getVideoOutputPath(config)
            : getImageOutputPath(config, mediaInfo.imageName);

        const filePath = vscode.Uri.file(
          path.join(config.srcRootFolder, mediaPath)
        );
        Log.info(
          `Predicted output file path is "${filePath.fsPath}" for "${config.sceneName}".`
        );

        if (!fs.existsSync(filePath.fsPath)) {
          vscode.window
            .showErrorMessage(
              Log.error(
                `Manim Sideview: Predicted output file does not exist at "${filePath.fsPath}"` +
                " Make sure that the designated video directories are reflected" +
                " in the extension log."
              ),
              "Show Log"
            )
            .then((value?: String) =>
              value === "Show Log"
                ? vscode.commands.executeCommand(
                  "manim-sideview.showOutputChannel"
                )
                : null
            );
          throw new Error(
            "Manim Sideview: Predicted output file does not exist."
          );
        }

        if (getUserConfiguration("preview")) {
          // we'll open a side view
          this.mediaPlayer.playMedia(filePath, config, mediaInfo.fileType);
        }

        // we'll execute the post render terminal command if it exists
        this.executeTerminalCommand(
          filePath.fsPath,
          config.srcPath,
          config.sceneName,
          cwd
        );

        const job = this.jobManager.getActiveJob(config.srcPath);
        if (job) {
          this.jobManager.setActive(job);
        } else {
          Log.info(
            `New job added for "${config.srcPath}" as ${JSON.stringify(
              config,
              null,
              4
            )}`
          );
          this.jobManager.addJob(config, mediaInfo.fileType);
        }
      }
    );
  }

  /**
   * Spawns a new process with the command and attach event handlers on the process
   * to capture the output and manage the job.
   *
   * @param command the command to execute
   * @param args arguments for the command
   * @param cwd the current working directory
   * @param config the running configuration
   * @returns
   */
  private async spawnManimProcess(
    command: string,
    args: string[],
    cwd: string,
    srcPath: string,
    sceneName: string,
    onProcessClose: (m: MediaInfo) => void
  ) {
    const startTime = new Date();
    const process = spawn(command, args, { cwd: cwd, shell: false });
    const job = this.jobManager.getActiveJob(srcPath);

    // String representation of the command process
    const commandString = `"${command}" ${args
      .map((a) => quoteSpecialChars(a))
      .join(" ")}\n`;
    this.outputChannel!.append(commandString);

    // kill any existing old processes if they exist
    if (this.process) {
      this.process.kill();
    }
    this.process = process;
    this.jobManager.setRunning(job);

    process.on("error", (err: Error) => {
      if (!process.killed) {
        this.outputChannel!.append(err.toString());
      }
    });

    process.stderr.on("data", (data: { toString: () => string }) => {
      const dataStr = data.toString();
      Log.warn(
        `[${process.pid}] Captured stderr output "${formatOutput(dataStr)}"`
      );
      this.outputChannel!.append(dataStr);
    });

    // we use the scoped process variable as this.process can
    // become undefined at any given time
    let stdoutLogbook = "";
    process.stdout.on("data", (data: { toString: () => string }) => {
      const dataStr = data.toString();
      Log.info(`[${process.pid}] RE: "${formatOutput(dataStr)}"`);
      if (!process.killed) {
        stdoutLogbook += dataStr;

        this.outputChannel!.append(dataStr);

        if (stdoutLogbook.includes(KILL_MSG)) {
          Log.error(
            `[${process.pid}] Kill message is sent, ending the process.`
          );
          this.outputChannel!.append(
            "\r\n" +
            Log.error(
              `[${process.pid}] Your selected scene name does not exist in the source file.`
            ) +
            "\r\n"
          );

          this.cmdRemoveJob(srcPath);
          return;
        }
      }
    });

    process.on("close", async (code: number, signal: string) => {
      const timeElapsed = (new Date().getTime() - startTime.getTime()) / 1000;

      if (signal === "SIGTERM") {
        code = 15;
      }

      if (code !== 0) {
        if (code === -4058) {
          vscode.window.showErrorMessage(
            Log.error(
              `Manim Sideview: Unable to find the source file. Try opening the folder containing this file instead of a single file, or check file permissions.`
            )
          );
        } else if (code != 15) {
          // only show the error message if the process was not killed by us
          vscode.window
            .showErrorMessage(
              Log.error(
                `Manim Sideview: Error rendering file (exit code ${code}). Check the output for more details.`
              ),
              "Show Logs"
            )
            .then((selection) => {
              if (selection === "Show Logs") {
                vscode.commands.executeCommand(
                  "manim-sideview.showOutputChannel"
                );
              }
            });
        }
      }

      this.outputChannel!.appendLine(
        Log.info(
          `[${process.pid
          }] Execution returned code=${code} in ${timeElapsed} seconds ${code === 1 ? "returned signal " + signal : ""
          } ${signal === "SIGTERM"
            ? "Cause: An old process has been terminated due to a termination signal."
            : ""
          }`
        ) + "\n"
      );

      const isMainProcess = this.process && this.process.pid === process.pid;

      if (isMainProcess) {
        this.process = undefined;
      }

      if (signal === "SIGTERM" || code !== 0) {
        if (isMainProcess) {
          this.jobManager.setError(job);
        }
        return;
      }

      const mediaInfo = await this.getMediaFileInfo(
        stdoutLogbook,
        srcPath,
        sceneName
      );

      onProcessClose(mediaInfo);
    });

    Log.info(
      `[${process.pid}] Spawned a new process for executing "${commandString}".`
    );
  }

  /**
   * Determines the output file type and name (image only) first from a logbook and
   * then from the user input if the logbook is not available.
   *
   * @param stdoutLogbook the recorded log under standard output of the process
   * @returns
   */
  private async getMediaFileInfo(
    stdoutLogbook: string,
    srcPath: string,
    sceneName: string
  ) {
    let fileType: number | undefined;
    let imageName: string | undefined;
    const job = this.jobManager.getActiveJob(srcPath)!;
    Log.info(`Attempting to determine the output file type for "${sceneName}".`);

    // the file output signifier
    const fileReSignifier = [...stdoutLogbook.matchAll(RE_FILE_READY)];
    if (fileReSignifier.length > 0) {
      const fileIdentifier = fileReSignifier.find((m) =>
        m.groups?.path.replace(/ |\r|\n/g, "").endsWith(".png")
      );
      if (fileIdentifier) {
        fileType = PlayableMediaType.Image;
        imageName = fileIdentifier.groups?.path
          .replace(/ |\r|\n/g, "")
          .split(/\\|\//g)
          .pop();
      } else {
        fileType = PlayableMediaType.Video;
      }
      Log.info(
        `[${process.pid}] Render output is predicted as "${fileType === PlayableMediaType.Image ? "Image" : "Video"
        }".`
      );
    }

    if (fileType === undefined) {
      if (job.runtimeOptions.outputFileType === undefined) {
        // we don't have a prior user input to determine the output type
        const inputFileType = await vscode.window.showWarningMessage(
          Log.warn(
            `Manim Sideview: Unable to infer the output filetype for "${sceneName}". Please select one below!`
          ),
          "Video",
          "Image"
        );
        if (!inputFileType) {
          this.jobManager.setError(null);
          throw new Error(
            "Manim Sideview: User did not select an output filetype."
          );
        }
        fileType =
          inputFileType === "Video"
            ? PlayableMediaType.Video
            : PlayableMediaType.Image;
      } else {
        fileType ||= job.runtimeOptions.outputFileType;
      }
    }

    Log.info(`File type is set to "${fileType}".`);
    return { fileType: fileType || PlayableMediaType.Video, imageName };
  }

  /**
   * Gets the command line arguments from the user preferences.
   *
   * @returns the command line arguments as an array
   */
  private getPreferenceArgs() {
    const cmdLineArgs = getUserConfiguration<string>("commandLineArgs");
    return cmdLineArgs.trim().split(" ").filter(Boolean);
  }

  /**
   * Ensure that the output channel is created, whether if it's the pseudo terminal or
   * the vscode output channel.
   */
  private ensureOutputChannel(pseudoTerm: boolean) {
    if (pseudoTerm) {
      if (!this.manimPseudoTerm || this.manimPseudoTerm.isClosed()) {
        this.manimPseudoTerm = new ManimPseudoTerm("manim");
      }
    } else if (!this.manimOutputChannel) {
      this.manimOutputChannel = vscode.window.createOutputChannel("manim");
    }
  }

  /**
   * Finds the manim.cfg file in the cwd and returns it.
   *
   * The configuration is based on the default config so that all parameters are satisified.
   *
   * @param srcfilePath
   * @returns ManimConfig | undefined
   */
  private async getManimConfigFile(
    srcfilePath: string
  ): Promise<ManimConfig | undefined> {
    const filePath = this.manimConfPath
      ? this.manimConfPath
      : path.join(srcfilePath, "../manim.cfg");

    if (!fs.existsSync(filePath)) {
      return;
    }

    Log.info(`Parsing configuration file "${filePath}".`);
    try {
      var parsedConfig = new ConfigParser();
      await parsedConfig.readAsync(filePath);
    } catch (e) {
      vscode.window.showErrorMessage(
        Log.error(
          `Manim Sideview: Error whilst parsing manim.cfg file, ignoring it. ${e}`
        )
      );
      return;
    }

    if (!parsedConfig.sections().includes(CONFIG_SECTION)) {
      vscode.window.showErrorMessage(
        Log.error(
          `Manim Sideview: Config file is missing the [${CONFIG_SECTION}] section.`
        )
      );
      return;
    }

    // since not all configuration options are necessary for rendering but we still
    // need them, we'll use the default config as a base
    let manimConfig = getDefaultConfig();

    for (const flag of RELEVANT_CONFIG_OPTIONS) {
      if (parsedConfig.hasKey(CONFIG_SECTION, flag)) {
        manimConfig[flag as keyof ManimConfig] = parsedConfig.get(
          CONFIG_SECTION,
          flag
        )!;
        Log.info(
          `Set flag "${flag}" to ${parsedConfig.get(CONFIG_SECTION, flag)}.`
        );
      }
    }

    return manimConfig;
  }

  /**
   * Creates a new running configuration object.
   *
   * @returns RunningConfig
   */
  private createRunningConfig(
    document: vscode.TextDocument,
    sceneName: string,
    isUsingCfgFile: boolean,
    manimConfig: ManimConfig
  ): RunningConfig {
    const srcPath = document.uri.fsPath;
    Log.info(`Creating a new running configuration for file "${srcPath}"`);

    const moduleName = path.basename(srcPath).slice(0, -3);
    const root = path.dirname(document.uri.fsPath);

    return {
      srcRootFolder: root,
      srcPath: srcPath,
      moduleName: moduleName,
      isUsingConfFile: isUsingCfgFile,
      manimConfig: manimConfig,
      document: document,
      sceneName: sceneName,
    };
  }

  private async checkManimExists(manimPath: string): Promise<boolean> {
    try {
      // Check if the provided path exists
      if (fs.existsSync(manimPath) || fs.existsSync(manimPath + ".exe")) {
        return true;
      }

      // Check if manim is on the PATH
      const checkCommand = process.platform === "win32" ? "where" : "which";
      execSync(`${checkCommand} ${manimPath}`);
      return true;
    } catch (error) {
      return false;
    }
  }
}
