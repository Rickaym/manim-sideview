import path = require("path");
import * as vscode from "vscode";
import { getUserConfiguration, DefaultTerminalName, loadGlobals, Log, LOGGER } from "./globals";
import { ManimSideview } from "./sideview";

export async function activate(context: vscode.ExtensionContext) {
  Log.info("Activating extension.");
  await loadGlobals(context);

  const sideview = new ManimSideview(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("manim-sideview.run", (...args) => sideview.run(...args)),
    vscode.commands.registerCommand("manim-sideview.removeAllJobs", () => sideview.removeAllJobs()),
    vscode.commands.registerCommand("manim-sideview.stop", () => sideview.stopProcess()),
    vscode.commands.registerCommand("manim-sideview.renderNewScene", (...args) =>
      sideview.renderNewScene(...args)
    ),
    vscode.commands.registerCommand("manim-sideview.removeCurrentJob", () => sideview.removeJob()),
    vscode.commands.registerCommand("manim-sideview.showMobjectGallery", () =>
      sideview.showMobjectGallery()
    ),
    vscode.commands.registerCommand("manim-sideview.syncMobjectGallery", () =>
      sideview.syncMobjectGallery()
    ),
    vscode.commands.registerCommand("manim-sideview.syncManimConfig", () =>
      sideview.syncFallbackManimConfig()
    ),
    vscode.commands.registerCommand("manim-sideview.showOutputChannel", () => LOGGER.show(true)),
    vscode.commands.registerCommand("manim-sideview.showExtensionManimConfig", () =>
      vscode.workspace
        .openTextDocument(path.join(context.extensionPath, "./assets/local/manim.cfg.json"))
        .then((doc) => vscode.window.showTextDocument(doc))
    ),
    vscode.commands.registerCommand("manim-sideview.showManimExecTerminal", () => {
      const cli = vscode.window.terminals.find((t) => t.name === DefaultTerminalName);
      if (cli) {
        cli.show();
      } else {
        vscode.window.showErrorMessage(
          "Manim Sideview: There is no internal execution terminal open."
        );
      }
    })
  );

  vscode.workspace.onDidSaveTextDocument(
    (e) => {
      if (getUserConfiguration<boolean>("runOnSave")) {
        vscode.commands.executeCommand("manim-sideview.run", e.fileName, true);
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
