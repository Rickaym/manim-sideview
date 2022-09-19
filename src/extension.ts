import * as vscode from "vscode";
import { getUserConfiguration, loadGlobals, Log, LOGGER } from "./globals";
import { ManimSideview } from "./sideview";

export async function activate(context: vscode.ExtensionContext) {
  Log.info("Activating extension.");
  await loadGlobals(context);

  const sideview = new ManimSideview(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("manim-sideview.run", (...args) =>
      sideview.run(...args)
    ),
    vscode.commands.registerCommand("manim-sideview.removeAllJobs", () =>
      sideview.removeAllJobs()
    ),
    vscode.commands.registerCommand("manim-sideview.stop", () =>
      sideview.stop()
    ),
    vscode.commands.registerCommand(
      "manim-sideview.renderNewScene",
      (...args) => sideview.renderNewScene(...args)
    ),
    vscode.commands.registerCommand("manim-sideview.removeCurrentJob", () =>
      sideview.removeCurrentJob()
    ),
    vscode.commands.registerCommand("manim-sideview.showMobjectGallery", () =>
      sideview.showMobjectGallery()
    ),
    vscode.commands.registerCommand("manim-sideview.syncMobjectGallery", () =>
      sideview.syncMobjectGallery()
    ),
    vscode.commands.registerCommand("manim-sideview.syncManimConfig", () =>
      sideview.syncFallbackManimConfig()
    ),
    vscode.commands.registerCommand("manim-sideview.showOutputChannel", () =>
      LOGGER.show(true)
    ),
  );

  vscode.workspace.onDidSaveTextDocument(
    (e) => {
      if (
        getUserConfiguration<boolean>("runOnSave")
      ) {
        vscode.commands.executeCommand("manim-sideview.run", e.fileName);
      }
    },
    null,
    context.subscriptions
  );
  vscode.window.onDidChangeActiveTextEditor(
    (e) => {
      sideview.refreshJobStatus();
      sideview.auditTextEditorChange(e);
    },
    null,
    context.subscriptions
  );
  Log.info("Activated extension.");
}
