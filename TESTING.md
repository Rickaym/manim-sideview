# Testing

Four tiers, from fastest to most end-to-end. Fixtures for all tiers live
in `src/test/fixtures/`.

## 1. Unit tests (no manim, no VSCode)

```
npm run test:unit
```

Compiles the sources and runs `src/test/unit/` with Node's built-in test
runner. Covers the output-resolution logic (`src/mediaResolution.ts`) against
recorded manim log samples in `src/test/fixtures/logs/`, the disk-probe
fallback, and path prediction in `src/globals.ts` behind a vscode stub.

## 2. Contract tests (real manim, no VSCode)

```
npm run test:contract
```

Renders the fixture scenes with the local manim installation (override the
binary with `MANIM_BIN=/path/to/manim`) in a temp directory and feeds the
live output through the extension's actual resolution code. This catches
drift in manim's "File ready at" log format, which path prediction relies
on. Cases: video render with `-ql`, image render, silent logs under
`verbosity = WARNING` (disk probe), and a `manim.cfg` with trailing
whitespace in the quality value.

## 3. Integration tests (real manim, real VSCode)

```
npm run test:integration
```

Downloads a real VSCode build via `@vscode/test-cli`, activates the
extension inside it, and drives renders end to end through
`vscode.commands.executeCommand("manim-sideview.run", uri, false, sceneName)`.
The third argument is a scene-name hook: when given, `cmdRun` uses it
directly instead of showing the quick pick, so headless runs never block
on UI. This is the tier that catches activation bugs and command wiring
that the lower tiers cannot see.

The suite (`src/test/suite/`, mocha tdd) copies fixtures into a temp
workspace (`.vscode-test.mjs` opens it as the workspace folder), asserts
on the `RenderResult` returned by the run command, and covers: activation
plus command registration with ms-python.python absent, a `-ql` video
render via `commandLineArgs`, an image render, the silent-log disk probe
(#139), and a custom `media_dir`.

Requirements: a display or `xvfb-run -a npm run test:integration`, and a
manim executable, taken from `MANIM_BIN` (absolute path) or the PATH. If
no manim is found, the render tests skip with a message and only the
activation test runs. The suite syncs `manim-sideview.manimExecutableVersion`
to the detected manim version automatically.

## 4. Manual checks (Extension Development Host)

Press F5 in this repo, then in the dev host window open the fixture folder
listed per row. All fixtures render in under a minute at low quality.

| Scenario | Setup | Expect |
| --- | --- | --- |
| Quality flag via settings (#99, #132) | Open `src/test/fixtures/scenes/`, set `manim-sideview.commandLineArgs` to `-ql`, render `video_scene.py` scene `VideoScene` | 480p15 video previews without a predicted-path error |
| In-file resolution override (#115) | Open `src/test/fixtures/issues/115_custom_resolution/`, render `scene.py` scene `VerticalScene` | 1080x1920 video previews |
| Silent logs, image output (#139) | Open `src/test/fixtures/issues/139_low_verbosity/`, render `scene.py` scene `ImageScene`; set `manim-sideview.manimExecutableVersion` to your manim version if not v0.19.0 | image previews, no stale-video preview, no error |
| Trailing whitespace in cfg (#137) | Open `src/test/fixtures/issues/137_trailing_space/`, render `scene.py` scene `VideoScene` | renders normally, no "quality is invalid" error |
| Env-local ffmpeg (#98) | conda or venv with ffmpeg installed inside it and not on the global PATH; set `manim-sideview.defaultManimPath` to that env's `bin/manim` | no pydub ffmpeg warning, render completes |
| Scripts directory as manim path (#127, #133) | Windows: set `manim-sideview.defaultManimPath` to a `Scripts` directory containing manim.exe | manim resolved inside the directory, render runs |

## CI

`.github/workflows/ci.yml` runs lint, both compile targets, and the unit
tests on every push and pull request, the contract tests against a real
pip-installed manim on ubuntu, and the integration tests in a downloaded
VSCode under xvfb (`integration` job). The integration job intentionally
does not install ms-python.python, which exercises the activation path
that tolerates a missing python extension.
