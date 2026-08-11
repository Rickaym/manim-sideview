import { defineConfig } from "@vscode/test-cli";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";

// Integration tests copy fixtures into this throwaway workspace so the
// repository tree stays clean during renders.
const workspace = path.join(tmpdir(), "manim-sideview-it-workspace");
mkdirSync(workspace, { recursive: true });

export default defineConfig({
  files: "out/test/suite/**/*.test.js",
  workspaceFolder: workspace,
  mocha: {
    ui: "tdd",
    // real manim renders; each scene can take a while on cold CI runners
    timeout: 120000,
  },
  env: {
    MANIM_SIDEVIEW_TEST_WORKSPACE: workspace,
  },
});
