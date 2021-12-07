// ENTRY POINT OF THE EXTENSION

import * as vscode from "vscode";
import { loadInternalManimCfg, loadPaths } from "./globals";
import { ManimSideview } from "./sideview";

/**
 * TODO: finish manim.cfg default loading for given options
 */

export async function activate(context: vscode.ExtensionContext) {
  // convert raw paths into full paths
  // for accessing PATHS
  loadPaths(context.extensionUri);
  await loadInternalManimCfg();
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
    ),
    vscode.commands.registerCommand(
      "manim-sideview.syncMobjectGallery",
      async function () {
        view.syncMobjectGallery();
      }
    ),
    vscode.commands.registerCommand(
      "manim-sideview.syncManimConfig",
      async function () {
        await view.syncManimConfig();
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
      view.audit(e);
    },
    null,
    context.subscriptions
  );
}
