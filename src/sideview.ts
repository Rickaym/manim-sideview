/* eslint-disable @typescript-eslint/naming-convention */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import ConfigParser from "configparser";

import { spawn, execSync } from "child_process";
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
} from "./globals";

import { JobStatusManager } from "./job";
import { MediaPlayer, PlayableMediaType } from "./player";
import { Gallery } from "./gallery";
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

const PYTHON_ENV_SCRIPTS_FOLDER = {
  win32: "Scripts",
  darwin: "bin",
  linux: "bin",
};

const postRenderTerminalName = "manim-exc";

type MediaInfo = {
  fileType: number;
  imageName: string | undefined;
  // Absolute path to the rendered file, when known either from manim's
  // "File ready at ..." log line or from a filesystem probe. Preferred over
  // recomputing the path from the static config, which ignores CLI overrides
  // like -ql / -qm / -qh that change the output directory.
  mediaPath?: string;
};

export class ManimSideview {
  constructor(
    public readonly ctx: vscode.ExtensionContext,
    public readonly pythonApi: PythonExtension,
  ) {
    this.ctx = ctx;
    this.pythonApi = pythonApi;
    this.jobManager = new JobStatusManager();
    this.ctx.subscriptions.push(this.jobManager.getItem());
    this.mediaPlayer = new MediaPlayer(
      this.ctx.extensionUri,
      this.ctx.subscriptions,
    );
    this.gallery = new Gallery(this.ctx.extensionUri, this.ctx.subscriptions);

    // Detect when a render has finished executing in the terminal
    this.ctx.subscriptions.push(
      vscode.window.onDidEndTerminalShellExecution(
        async (event: vscode.TerminalShellExecutionEndEvent) => {
          if (event.terminal === this.mainTerminal && this.isRendering) {
            this.isRendering = false;
            await this.onRenderComplete();
          }
        },
      ),
    );
  }

  private manimConfPath: string = "";
  private jobManager: JobStatusManager;
  private previousSceneNames: { [fsPath: string]: string } = {};
  private mediaPlayer: MediaPlayer;
  public gallery: Gallery;

  // Terminal-based rendering (replaces the old spawn + pseudoTerm approach)
  private mainTerminal: vscode.Terminal | undefined;
  private isRendering: boolean = false;
  private activeRenderConfig: RunningConfig | undefined;

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
          typeof srcPath === "string" ? srcPath : srcPath.fsPath,
        )!
      : null;

    if (autoRun === true && !activeJob) {
      Log.info(
        `Ignoring auto-run of ${srcPath} for lack of a first time manual run`,
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
              "Manim Sideview: You need to select a valid Python source file.",
            ),
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
            "Manim Sideview: Loaded a configuration file from the working directory.",
          ),
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
        `Asked user for a new scene name and recieved "${newSceneName}".`,
      );
      currentRunningConfig = this.createRunningConfig(
        document,
        newSceneName,
        isConfFile,
        manimConfig,
      );
    }

    this.render(currentRunningConfig);
  }

  async cmdStop() {
    if (this.isRendering && this.mainTerminal) {
      // Send Ctrl+C (ETX) to interrupt the running manim process
      this.mainTerminal.sendText("\x03");
      this.isRendering = false;
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
      if (this.isRendering) {
        this.mainTerminal?.sendText("\x03");
        this.mainTerminal?.dispose();
        this.mainTerminal = undefined;
        this.isRendering = false;
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
          "Manim Sideview: Select a Python file first to render a new scene!",
        ),
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
    srcFileUri: vscode.Uri,
  ): Promise<string | undefined> {
    Log.info(`Fetching the scene name for probably render file ${srcFileUri}.`);

    if (!fs.existsSync(srcFileUri.fsPath)) {
      vscode.window.showWarningMessage(
        Log.warn(
          `Manim Sideview: Source file "${srcFileUri.fsPath}" does not exist.`,
        ),
      );
      return;
    }

    const contents = (await vscode.workspace.fs.readFile(srcFileUri))
      .toString()
      .replace(/\r|\n/g, "");

    const sceneClasses = [...contents.matchAll(RE_SCENE_CLASS)].map(
      (m) => `$(run-all) ${m.groups?.name}`,
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
            1,
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
    if (manimPath === ".") {
      manimPath = "manim";
    }
    let envName = null;

    Log.info(`Default manim path is found as "${manimPath}"`);

    // The user pointed defaultManimPath at a directory (e.g. pasted a Scripts
    // folder), append the executable name so we don't spawn the directory itself.
    if (
      path.isAbsolute(manimPath) &&
      fs.existsSync(manimPath) &&
      fs.statSync(manimPath).isDirectory()
    ) {
      manimPath = path.join(manimPath, "manim");
      Log.info(
        `Configured manim path was a directory; resolved to "${manimPath}".`,
      );
    }

    if (!path.isAbsolute(manimPath)) {
      const env = await this.getPythonEnvironment();
      if (env) {
        envName = env.environment?.name || "base";
        Log.info(`Using python environment "${envName}" for manim.`);

        // Prefer the canonical interpreter path from the Python extension API.
        // Fall back to the env folder + platform bin dir only if the API doesn't
        // expose an executable (rare: envs created without a python interpreter).
        let pythonBinDir: string | undefined;
        const executableUri = env.executable?.uri;
        if (executableUri) {
          pythonBinDir = path.dirname(executableUri.fsPath);
          Log.info(`Using interpreter directory: ${pythonBinDir}`);
        } else if (env.environment) {
          let bin =
            PYTHON_ENV_SCRIPTS_FOLDER[
              process.platform as keyof typeof PYTHON_ENV_SCRIPTS_FOLDER
            ];
          if (!bin) {
            Log.error(
              "Manim Sideview: Unsupported platform for python environment. Assuming linux directory.",
            );
            bin = PYTHON_ENV_SCRIPTS_FOLDER["linux"];
          }
          pythonBinDir = path.join(env.environment.folderUri.fsPath, bin);
          Log.info(
            `No interpreter URI; falling back to env folder: ${pythonBinDir}`,
          );
        }

        if (pythonBinDir) {
          manimPath = path.join(pythonBinDir, manimPath);
          Log.info(`Resolved manim path: ${manimPath}`);
        }
      }
    }

    // Check if manim path exists
    if (!(await this.checkExecutableExists(manimPath))) {
      if (await this.checkExecutableExists("manim")) {
        window.showWarningMessage(
          Log.warn(
            `Manim Sideview: Executable not found at ${manimPath}, but found executable on PATH...`,
          ),
        );
        manimPath = "manim";
      } else {
        const msg = Log.error(
          `Manim Sideview: Manim is not found in PATH or at the specified location "${manimPath}". Please ensure manim is installed correctly or specify a valid path in settings.`,
        );
        window.showErrorMessage(msg, "Go to Settings").then((selection) => {
          if (selection === "Go to Settings") {
            vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "manim-sideview.defaultManimPath",
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
        "Manim Sideview: Preparing to sync fallback manim configurations...",
      ),
    );
    const process = spawn((await this.getManimPath()).manim, ["cfg", "show"]);

    let fullStdout = "";
    process.stdout.on("data", function (data: string) {
      fullStdout += data.toString();
    });

    process.on(
      "close",
      function (_code: number | null, _signal: NodeJS.Signals | null) {
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
          "Manim Sideview: Successfully updated internal defaults for manim.cfg files.",
        );
      },
    );
  }

  private async getPythonEnvironment() {
    if (!this.pythonApi.environments) {
      return;
    }
    const environmentPath =
      this.pythonApi.environments.getActiveEnvironmentPath();
    return this.pythonApi.environments.resolveEnvironment(environmentPath);
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
    cwd: string,
  ) {
    const terminalCommand = getUserConfiguration<string>("terminalCommand");
    const commandInput = insertContext(
      {
        "{outputPath}": outputPath,
        "{sourcePath}": srcPath,
        "{sceneName}": sceneName,
      },
      terminalCommand,
    );

    let cli = vscode.window.terminals.find(
      (t) => t.name === postRenderTerminalName,
    );
    if (!cli) {
      cli = vscode.window.createTerminal({
        name: postRenderTerminalName,
        cwd: cwd,
        hideFromUser: true,
        message:
          "This is an internal terminal for executing post-render manim commands!",
      });
    } else {
      cli.sendText(`cd "${cwd}"`);
    }
    Log.info(
      `Executing post-render command "${commandInput}" in terminal "${cli.name}".`,
    );
    cli.sendText(commandInput);
  }

  /**
   * Creates or returns the main "Manim Sideview" terminal used for rendering.
   */
  private getOrCreateMainTerminal(): vscode.Terminal {
    if (this.mainTerminal) {
      return this.mainTerminal;
    }
    this.mainTerminal = vscode.window.createTerminal({
      name: "Manim Sideview",
      color: new vscode.ThemeColor("terminal.ansiBlue"),
      iconPath: new vscode.ThemeIcon("device-camera-video"),
    });
    vscode.window.onDidCloseTerminal((event) => {
      if (event === this.mainTerminal) {
        this.mainTerminal = undefined;
      }
    });
    return this.mainTerminal;
  }

  /**
   * Renders the scene with the given configuration using a standard
   * VS Code terminal. This gives users native ANSI colors, shell integration,
   * and history.
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
          4,
        ),
    );

    const cwd = config.srcRootFolder;
    const manim = await this.getManimPath();

    // If a render is already running, interrupt it before starting a new one.
    // Clear activeRenderConfig first so onDidEndTerminalShellExecution doesn't
    // process the old render's output when the Ctrl+C terminates it.
    if (this.isRendering && this.mainTerminal) {
      this.activeRenderConfig = undefined;
      this.mainTerminal.sendText("\x03");
      this.isRendering = false;
    }

    // Store the config for use when the terminal shell execution ends
    this.activeRenderConfig = config;

    const terminal = this.getOrCreateMainTerminal();
    terminal.show(true);

    this.jobManager.addJob(config, PlayableMediaType.Video);

    // Build arguments
    const args: string[] = [
      config.srcPath,
      ...(config.isUsingConfFile ? [] : this.getPreferenceArgs()),
      config.sceneName.trim(),
    ];

    // Quote paths with spaces and join the full command
    const quote = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
    const commandString = `cd ${quote(cwd)} && ${quote(manim.manim)} ${args.map(quote).join(" ")}`;

    Log.info(`Sending render command to terminal: ${commandString}`);
    terminal.sendText(commandString);

    this.isRendering = true;
    this.jobManager.setRunning(this.jobManager.getActiveJob(config.srcPath));
  }

  /**
   * Called when the terminal shell execution finishes after a render.
   * Handles output file detection, preview, post-render commands, and job status.
   */
  private async onRenderComplete() {
    const config = this.activeRenderConfig;
    if (!config) {
      return;
    }

    const srcPath = config.srcPath;
    const sceneName = config.sceneName;
    Log.info(`Terminal render for "${sceneName}" has finished.`);

    try {
      const mediaInfo = await this.getMediaFileInfo(srcPath, sceneName);

      // Trust the filesystem probe over the static config path
      const resolvedPath =
        mediaInfo.mediaPath ??
        (mediaInfo.fileType === PlayableMediaType.Video
          ? getVideoOutputPath(config)
          : getImageOutputPath(config, mediaInfo.imageName));

      const filePath = vscode.Uri.file(
        path.isAbsolute(resolvedPath)
          ? resolvedPath
          : path.join(config.srcRootFolder, resolvedPath),
      );
      Log.info(
        `Predicted output file path is "${filePath.fsPath}" for "${sceneName}".`,
      );

      if (!fs.existsSync(filePath.fsPath)) {
        vscode.window
          .showErrorMessage(
            Log.error(
              `Manim Sideview: Output file does not exist at "${filePath.fsPath}". ` +
                "Check the terminal output for errors, or verify your video directory settings.",
            ),
            "Show Log",
          )
          .then((value?: String) =>
            value === "Show Log"
              ? vscode.commands.executeCommand(
                  "manim-sideview.showOutputChannel",
                )
              : null,
          );
        const job = this.jobManager.getActiveJob(srcPath);
        if (job) {
          this.jobManager.setError(job);
        }
        return;
      }

      if (getUserConfiguration("preview")) {
        this.mediaPlayer.playMedia(filePath, config, mediaInfo.fileType);
      }

      // Execute post-render terminal command if configured
      this.executeTerminalCommand(
        filePath.fsPath,
        config.srcPath,
        config.sceneName,
        config.srcRootFolder,
      );

      const job = this.jobManager.getActiveJob(config.srcPath);
      if (job) {
        this.jobManager.setActive(job);
      } else {
        Log.info(
          `New job added for "${config.srcPath}" as ${JSON.stringify(
            config,
            null,
            4,
          )}`,
        );
        this.jobManager.addJob(config, mediaInfo.fileType);
      }
    } finally {
      this.activeRenderConfig = undefined;
    }
  }

  /**
   * Determines the output file type and path purely from the filesystem
   * (no longer parses manim's stdout logbook since we use a real terminal).
   *
   * @param srcPath absolute path to the Python source file
   * @param sceneName the scene that was rendered
   */
  private async getMediaFileInfo(srcPath: string, sceneName: string) {
    let fileType: number | undefined;
    let imageName: string | undefined;
    let mediaPath: string | undefined;
    const job = this.jobManager.getActiveJob(srcPath)!;
    Log.info(
      `Attempting to determine the output file type for "${sceneName}" from filesystem.`,
    );

    // Probe both predicted paths on disk and pick whichever exists.
    const predictedVideo = path.join(
      job.config.srcRootFolder,
      getVideoOutputPath(job.config),
    );
    const predictedImage = path.join(
      job.config.srcRootFolder,
      getImageOutputPath(job.config),
    );
    const videoMtime = fs.existsSync(predictedVideo)
      ? fs.statSync(predictedVideo).mtimeMs
      : undefined;
    const imageMtime = fs.existsSync(predictedImage)
      ? fs.statSync(predictedImage).mtimeMs
      : undefined;
    if (
      imageMtime !== undefined &&
      (videoMtime === undefined || imageMtime >= videoMtime)
    ) {
      fileType = PlayableMediaType.Image;
      imageName = path.basename(predictedImage);
      mediaPath = predictedImage;
    } else if (videoMtime !== undefined) {
      fileType = PlayableMediaType.Video;
      mediaPath = predictedVideo;
    }
    if (fileType !== undefined) {
      Log.info(
        `Render output inferred from filesystem as "${
          fileType === PlayableMediaType.Image ? "Image" : "Video"
        }".`,
      );
    }

    if (fileType === undefined) {
      if (job.runtimeOptions.outputFileType === undefined) {
        // we don't have a prior user input to determine the output type
        const inputFileType = await vscode.window.showWarningMessage(
          Log.warn(
            `Manim Sideview: Unable to infer the output filetype for "${sceneName}". Please select one below!`,
          ),
          "Video",
          "Image",
        );
        if (!inputFileType) {
          this.jobManager.setError(null);
          throw new Error(
            "Manim Sideview: User did not select an output filetype.",
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
    return {
      fileType: fileType || PlayableMediaType.Video,
      imageName,
      mediaPath,
    };
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
   * Finds the manim.cfg file in the cwd and returns it.
   *
   * The configuration is based on the default config so that all parameters are satisified.
   *
   * @param srcfilePath
   * @returns ManimConfig | undefined
   */
  private async getManimConfigFile(
    srcfilePath: string,
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
          `Manim Sideview: Error whilst parsing manim.cfg file, ignoring it. ${e}`,
        ),
      );
      return;
    }

    if (!parsedConfig.sections().includes(CONFIG_SECTION)) {
      vscode.window.showErrorMessage(
        Log.error(
          `Manim Sideview: Config file is missing the [${CONFIG_SECTION}] section.`,
        ),
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
          flag,
        )!;
        Log.info(
          `Set flag "${flag}" to ${parsedConfig.get(CONFIG_SECTION, flag)}.`,
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
    manimConfig: ManimConfig,
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

  private async checkExecutableExists(path: string): Promise<boolean> {
    try {
      // Check if the provided path exists and is a file (not a directory).
      for (const candidate of [path, path + ".exe"]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return true;
        }
      }

      // Check if manim is on the PATH
      const checkCommand = process.platform === "win32" ? "where" : "which";
      execSync(`${checkCommand} ${path}`);
      return true;
    } catch (error) {
      return false;
    }
  }
}
