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
  backspace: "\x7f"
};
const actions = {
  cursorBack: "\x1b[D",
  deleteChar: "\x1b[P",
  columnZero: "^M",
  clear: "\x1b[2J\x1b[3J\x1b[;H"
};

const defPrompt = "MSV";

// cleanup inconsitent line breaks
const formatText = (text: string) => `\r${text.split(/(\r?\n)/g).join("\r")}\r`;

/* A pseudoterminal implemented in the form of an outputchannel
this is so that they can be implemented without coupling directly
to how either form of output is used in the sideview */
export class ManimPseudoTerm implements vscode.OutputChannel {
  constructor(public readonly name: string) {
    this.name = name;
  }
  public envName = "";
  public cwd = path.dirname(vscode.workspace.textDocuments[0]?.fileName || process.cwd());
  public isRunning = false;

  public writeEmitter = new vscode.EventEmitter<string>();
  private prompt = () => (this.envName ? `(${this.envName})` : defPrompt) + ` ${this.cwd}>`;
  private intro =
    "Manim Extension XTerm\n\rServes as a terminal for logging purpose.\n\r\n\r" +
    `Extension Version ${EXTENSION_VERSION}\n\r\n\r${this.prompt()}`;
  private content = "";
  public appendedBefore = false;
  private stickyNotes = "";
  private pty: vscode.Pseudoterminal = {
    onDidWrite: this.writeEmitter.event,
    open: () => this.writeEmitter.fire(this.intro),
    close: () => { },
    handleInput: async (char: string) => {
      if (this.isRunning) {
        return;
      }
      switch (char) {
        case keys.enter:
          // preserve the run command line for history
          this.writeEmitter.fire(`\r\n${this.prompt()}`);
          if (this.content) {
            this.isRunning = true;
            try {
              // run the command
              const { stdout, stderr } = await exec(this.content, {
                encoding: "utf8",
                cwd: this.cwd
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
            this.writeEmitter.fire(`\r${this.prompt()}`);
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
    }
  };
  private terminal: vscode.Terminal = vscode.window.createTerminal({
    name: this.name,
    pty: this.pty
  });

  /**
   * Appends the string directly if the terminal has been appended to before.
   * Else waits until another `append` call is made.
   * This ensures that early append calls are made through.
   *
   * @param value
   */
  append(value: string): void {
    if (!this.appendedBefore) {
      this.stickyNotes += value;
      this.appendedBefore = true;
      return;
    }

    this.writeEmitter.fire(`${this.stickyNotes}${value}`.replace(/\n/g, "\n\r"));
    this.stickyNotes = "";
  }

  /**
   * Appends the string directly if the terminal has been appended to before.
   * Else waits until another `append` call is made.
   * This ensures that early append calls are made through.
   * Additionally append the prompt.
   *
   * @param value
   */
  appendLine(value: string): void {
    if (!this.appendedBefore) {
      this.stickyNotes += value;
      this.appendedBefore = true;
      return;
    }

    this.writeEmitter.fire(`${this.stickyNotes}${value}`.replace(/\n/g, "\n\r"));
    this.newPrompt();
    this.stickyNotes = "";
  }

  newPrompt(): void {
    this.isRunning = false;
    if (this.pty.handleInput) {
      this.pty.handleInput(keys.enter);
    }
  }

  replace(value: string): void {
    this.clear();
    this.writeEmitter.fire(value);
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

  isClosed(): boolean {
    return !!this.terminal.exitStatus;
  }
}
