import * as vscode from "vscode";
import { loadGlobals, Log } from "./globals";
import { ManimSideview } from "./sideview";

export async function activate(context: vscode.ExtensionContext) {
  Log.info("Activating extension.");
  await loadGlobals(context);

  const sideview = new ManimSideview(context);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "manim-sideview.run",
      (onSave: boolean = false) => sideview.run(onSave)
    ),
    vscode.commands.registerCommand(
      "manim-sideview.refreshAllConfiguration",
      () => sideview.refreshAllConfiguration()
    ),
    vscode.commands.registerCommand("manim-sideview.stop", () =>
      sideview.stop()
    ),
    vscode.commands.registerCommand("manim-sideview.setRenderingScene", () =>
      sideview.setRenderingScene()
    ),
    vscode.commands.registerCommand(
      "manim-sideview.refreshCurrentConfiguration",
      () => sideview.refreshCurrentConfiguration()
    ),
    vscode.commands.registerCommand("manim-sideview.showMobjectGallery", () =>
      sideview.showMobjectGallery()
    ),
    vscode.commands.registerCommand("manim-sideview.syncMobjectGallery", () =>
      sideview.syncMobjectGallery()
    ),
    vscode.commands.registerCommand("manim-sideview.syncManimConfig", () =>
      sideview.syncFallbackManimConfig()
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
      sideview.updateJobStatus();
      sideview.audit(e);
    },
    null,
    context.subscriptions
  );
  Log.info("Activated extension.");
}
