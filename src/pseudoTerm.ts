/**
 * The pseudoterminal used by manim-sideview to output stdout.
 * The container implements the OutputChannel interface.
 */

import * as vscode from "vscode";
import * as path from "path";
import { exec as cpExec } from "child_process";
import { promisify } from "util";
import { EXTENSION_VERSION } from "./globals";

// promisified Node executable (Node 10+)
const exec = promisify(cpExec);

const keys = {
  enter: "\r",
  backspace: "\x7f",
};
const actions = {
  cursorBack: "\x1b[D",
  deleteChar: "\x1b[P",
  columnZero: "^M",
  clear: "\x1b[2J\x1b[3J\x1b[;H",
};

const defPrompt = "MS";

// cleanup inconsitent line breaks
const formatText = (text: string) => `\r${text.split(/(\r?\n)/g).join("\r")}\r`;

/* A pseudoterminal implemented in the form of an outputchannel
this is so that they can be implemented without coupling directly
to how either form of output is used in the sideview */
export class ManimPseudoTerm implements vscode.OutputChannel {
  constructor(public readonly name: string) {
    this.name = name;
  }

  public cwd = path.dirname(vscode.workspace.textDocuments[0].fileName);
  private prompt = `${defPrompt} ${this.cwd}>`;
  private intro = "Manim Extension XTerm\n\rServes as a terminal for logging purpose." +
              "\n\r\n\rUtilize the powershell for anything else.\n\r\n\r" +
              `Extension Version ${EXTENSION_VERSION}\n\r`;
  public isRunning = false;
  private content = "";
  public writeEmitter = new vscode.EventEmitter<string>();
  private pty: vscode.Pseudoterminal = {
    onDidWrite: this.writeEmitter.event,
    open: () =>
      this.writeEmitter.fire(
        `${this.intro}\n${this.prompt}`
      ),
    close: () => {},
    handleInput: async (char: string) => {
      if (this.isRunning) {
        return;
      }
      const c = this.content;
      switch (char) {
        case keys.enter:
          // preserve the run command line for history
          this.writeEmitter.fire(`\r${this.prompt}\r\n`);
          if (this.content) {
            this.isRunning = true;
            try {
              // run the command
              const { stdout, stderr } = await exec(this.content, {
                encoding: "utf8",
                cwd: this.cwd,
              });

              if (stdout) {
                this.writeEmitter.fire(formatText(stdout));
              }

              if (stderr && stderr.length) {
                this.writeEmitter.fire(formatText(stderr));
              }
            } catch (error: any) {
              this.writeEmitter.fire(`\r${formatText(error.message)}`);
            }
            this.isRunning = false;
            this.content = "";
            this.writeEmitter.fire(`\r${this.prompt}`);
          }
        case keys.backspace:
          if (!this.content || !this.content.length) {
            return;
          }
          // Remove backspaced char
          this.content = this.content.slice(0, -1);
          this.writeEmitter.fire(actions.cursorBack);
          this.writeEmitter.fire(actions.deleteChar);
          return;
        default:
          // typing a new character
          this.content += char;
          this.writeEmitter.fire(char);
      }
    },
  };
  private terminal: vscode.Terminal = vscode.window.createTerminal({
    name: this.name,
    pty: this.pty,
  });

  append(value: string): void {
    this.writeEmitter.fire(value.replace(/\n/g, "\n\r"));
  }

  appendLine(value: string): void {
    this.writeEmitter.fire(value.replace(/\n/g, "\n\r"));
    this.newPrompt();
  }

  newPrompt(): void {
    this.isRunning = false;
    if (this.pty.handleInput) {
      this.pty.handleInput(keys.enter);
    }
  }

  clear(): void {
    this.writeEmitter.fire(actions.clear);
    this.writeEmitter.fire(this.intro);
  }

  show(column?: any, preserveFocus?: boolean): void {
    this.terminal.show(preserveFocus || column);
  }

  hide(): void {
    this.terminal.hide();
  }

  dispose(): void {
    this.terminal.dispose();
  }
}
