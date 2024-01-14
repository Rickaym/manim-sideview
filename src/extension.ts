import * as path from "path";
import * as vscode from "vscode";
import { getUserConfiguration, DefaultTerminalName, loadGlobals, Log, LOGGER } from "./globals";
import { ManimSideview } from "./sideview";
import { PythonExtension } from "@vscode/python-extension";

export async function activate(context: vscode.ExtensionContext) {
  Log.info("Activating extension.");
  await loadGlobals(context);

  const pythonApi: PythonExtension = await PythonExtension.api();
  const sideview = new ManimSideview(context, pythonApi);

  context.subscriptions.push(
    vscode.commands.registerCommand("manim-sideview.run", (...args) => sideview.cmdRun(...args)),
    vscode.commands.registerCommand("manim-sideview.removeAllJobs", () =>
      sideview.cmdRemoveAllJobs()
    ),
    vscode.commands.registerCommand("manim-sideview.stop", () => sideview.cmdStop()),
    vscode.commands.registerCommand("manim-sideview.renderNewScene", (...args) =>
      sideview.cmdRenderNewScene(...args)
    ),
    vscode.commands.registerCommand("manim-sideview.removeCurrentJob", () =>
      sideview.cmdRemoveJob()
    ),
    vscode.commands.registerCommand("manim-sideview.showMobjectGallery", () =>
      sideview.gallery.show()
    ),
    vscode.commands.registerCommand("manim-sideview.syncMobjectGallery", () =>
      sideview.gallery.synchronize(true)
    ),
    vscode.commands.registerCommand("manim-sideview.updateDefaultManimConfig", () =>
      sideview.cmdUpdateDefaultManimConfig()
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
      if (getUserConfiguration<boolean>("runOnSave") && e.fileName.endsWith(".py")) {
        vscode.commands.executeCommand("manim-sideview.run", e.fileName, true);
      }
    },
    null,
    context.subscriptions
  );
  vscode.window.onDidChangeActiveTextEditor(
    (e) => {
      sideview.cmdRefreshJobStatus();
      sideview.cmdAuditTextEditorChange(e);
    },
    null,
    context.subscriptions
  );
  Log.info("Activated extension.");
}
