# Changelog

## 0.4.0

### Output path resolution

The extension no longer recomputes the render output path from static
configuration alone. It now prefers the actual path manim reports in its
"File ready at" log line, and when logs are unavailable (e.g. low verbosity)
it probes both the predicted video and image paths on disk and picks the
most recently modified one.

This fixes a long-standing family of "Predicted output file does not exist"
errors:

- Quality flags such as `-ql` / `-qm` passed through `commandLineArgs` now
  resolve to the correct quality folder (#99, #132)
- Resolution overrides set inside the Python file via `config.pixel_width` /
  `config.pixel_height` are respected (#115)
- Scenes that output an image are detected even when `verbosity` is set to
  `WARNING` or `ERROR`; when both an image and a stale video exist, the newer
  file wins (#139)

### Environment and executable discovery

- Virtual environment executable discovery now uses the interpreter path
  reported by the Python extension, fixing venv lookups on Linux and macOS
  (#130, #134)
- When `defaultManimPath` points at a directory (such as a Windows `Scripts`
  folder, including Microsoft Store Python installs), the manim executable
  name is appended instead of attempting to spawn the directory (#127, #133)
- The interpreter's bin directory is placed on the spawned process PATH so
  tools installed alongside manim, like ffmpeg in conda or venv environments,
  are found even when they are not on the global PATH (#98)

### Fixes

- Values in `manim.cfg` are trimmed, so trailing whitespace such as
  `quality = low_quality ` no longer fails the render (#137)
- The source file is checked for existence before rendering
- The default `manimExecutableVersion` was bumped from `v0.16.0.post0` to
  `v0.19.0` so image filename prediction matches current manim releases
