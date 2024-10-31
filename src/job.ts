import * as vscode from "vscode";
import { RunningConfig } from "./globals";

const enum JobStatus {
  error,
  active,
  running,
  new,
}

type RuntimeOptions = {
  outputFileType?: number;
};

type Job = {
  config: RunningConfig;
  runtimeOptions: RuntimeOptions;
  status: JobStatus;
};

/**
 * Active jobs are not needed to make changes to the status icons.
 */
export class JobStatusManager {
  constructor() {
    this.jobStatusItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left
    );
    this.jobStatusItem.name = "job-indicator";
    this.jobStatusItem.command = "manim-sideview.removeCurrentJob";
    this.jobStatusItem.tooltip = "Mainm Sideview - Press to discard.";
  }

  private jobStatusItem: vscode.StatusBarItem;
  private activeJobs: { [fsPath: string]: Job } = {};

  getItem() {
    return this.jobStatusItem;
  }

  addJob(config: RunningConfig, fileType: number) {
    this.activeJobs[config.srcPath] = {
      config: config,
      runtimeOptions: { outputFileType: fileType },
      status: JobStatus.new,
    };
    this.setNew();
  }

  removeJob(srcPath: string) {
    delete this.activeJobs[srcPath];
  }

  removeAllActiveJobs() {
    this.activeJobs = {};
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
    if (srcPath) {
      return this.activeJobs[srcPath];
    } else {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "python") {
        return null;
      }
      return this.activeJobs[editor.document.fileName];
    }
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
      case JobStatus.new:
        this.setNew();
        break;
      case JobStatus.active:
        this.setActive(job);
        break;
      case JobStatus.error:
        this.setError(job);
        break;
      case JobStatus.running:
        this.setRunning(job);
        break;
    }
  }

  setRunning(activeJob: Job | null) {
    if (activeJob) {
      activeJob.status = JobStatus.running;
    }
    this.jobStatusItem.color = new vscode.ThemeColor("textLink.foreground");
    this.setIcon("$(sync~spin)");
    this.setVisibility(true);
  }

  setActive(activeJob: Job | null) {
    if (activeJob) {
      activeJob.status = JobStatus.active;
    }
    this.jobStatusItem.color = new vscode.ThemeColor("textLink.foreground");
    this.setIcon("$(vm-running)");
    this.setVisibility(true);
  }

  setError(activeJob: Job | null) {
    if (activeJob) {
      activeJob.status = JobStatus.error;
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
