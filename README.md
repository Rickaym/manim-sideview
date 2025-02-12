# Manim Sideview

<img src="https://repository-images.githubusercontent.com/429329947/d3f3cf71-a491-47e0-a629-34e0a4b9051f" height="100%" width="300px">

[![Extension Homepage](https://img.shields.io/badge/vscode-install%20Here-brightgreen?style=for-the-badge&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=Rickaym.manim-sideview) [![Extension Version](https://img.shields.io/visual-studio-marketplace/v/Rickaym.manim-sideview?style=for-the-badge)](https://marketplace.visualstudio.com/items?itemName=Rickaym.manim-sideview) [![Discord](https://img.shields.io/discord/793047973751554088.svg?label=Join%20Extension%20Support&color=blue&style=for-the-badge&logo=discord)](https://discord.gg/UmnzdPgn6g) [![Extension% Homepage](https://img.shields.io/badge/open%20vsx-extension-782A90?style=for-the-badge&logo=eclipse)](https://open-vsx.org/extension/Rickaym/manim-sideview)

A Visual Studio code extension with rich support for working with the **[manim](https://github.com/ManimCommunity/manim)** framework, providing features such as gallery-based code snippet catalogs and video and image live preview with flexible configurations.

Ensure you have manim installed on your `PATH`. Check out [this guide](https://docs.manim.community/en/stable/installation.html) for installing manim. Follow [this guide](https://github.com/Rickaym/manim-sideview?tab=readme-ov-file#2-how-do-i-change-the-default-manim-executable-path) to set a custom executable path.

# Table Of Contents

- [Getting Started](#getting-started)
- [Rendering Scenes](#rendering-scenes)
- [Configuring](#configuring)
- [Mobject Gallery](#mobject-gallery)
- [Frequently Asked Questions](#frequently-asked-questions)
- [Credits](#credits)
- [Changelog](#changelog)

## Getting Started

After the extension is installed, open the source file with the scene classes and press the <image src="https://raw.githubusercontent.com/Rickaym/Manim-Sideview/master/assets/images/rotation.png" height="100%" width= "15px"> icon from the menu bar or use `Ctrl+'` `r` to immediately start rendering with a live preview!

<image src="https://raw.githubusercontent.com/Rickaym/manim-sideview/master/images/quickstart.gif">

_That's it, folks!_

If you have any questions or find any issues, create a GitHub issue [here](https://github.com/Rickaym/manim-sideview/issues/new), seek support through the extension [development discord server](https://discord.gg/UmnzdPgn6g) or you can ping `@rick.aym` with a question on the official manim community discord server.

## Rendering Scenes

<image src="https://raw.githubusercontent.com/Rickaym/Manim-Sideview/master/assets/images/dark_logo.png" height="100%" width= "20px"></image> **We've looked at how to render a scene in quickstart, now how do work with multiple scenes?**

In any event, the extension creates a job tied to the source file to ensure persistence in scene names, and configurations right after it is rendered for the first time.

**Changing the scene name!**

Manim Sideview is made to render a single scene at any given moment recurrently. To hop from scene to scene, you'll have to explicitly change the scene name through:

1. Using the `Manim: Set A New SceneName` command through the command palette `Shift + Command + P (Mac)` / `Ctrl + Shift + P`.
2. Using the following default hotkey `Ctrl + '` `c`.
3. Using the render-change icon from the sideview
   <image src="https://raw.githubusercontent.com/Rickaym/Manim-Sideview/master/images/render-change.png"></image>

## Configuring

<image src="https://raw.githubusercontent.com/Rickaym/Manim-Sideview/master/assets/images/dark_logo.png" height="100%" width= "20px"></image>
There are two main ways to configure your render using
manim-sideview:

1. `manim-sideview.commandLineArgs`

By setting this configuration through `File -> Preferences -> Settings` you can pass CLI arguments to the `manim.exe` call.

> [!WARNING]
>
> Do not use args that change the path of the output file, i.e., quality args like 'ql'. Use the config file instead.

2. `manim.cfg` file

Use a configuration file for your renders! The extension recognizes the manim configuration under the guideline [manim.cfg](https://docs.manim.community/en/stable/guides/configuration.html#the-config-files) that exists
in the current working directory.

If a `manim.cfg` file is found, all command line arguments given through
`manim-sideview.commandLineArgs` is ignored.

## Mobject Gallery

The Mobject gallery is a web view that allows users to insert code snippets for commonly used manim objects, like squares, text, and also complex graphs.

![](images/example_of_mobject_gallery.gif)

### How do I open the gallery?

1. Open the command palette using `Shift + Command + P (Mac)` / `Ctrl + Shift + P`
2. Use the command `Manim: Open Mobject Gallery`

You can place the cursor at the desired location and click the image of the manim object to insert the code into a Python file or Jupyter Notebook!

## Frequently Asked Questions

1. [How do I render on save?](#1-how-do-i-render-on-save)
2. [How do I change the default manim executable path?](#2-how-do-i-change-the-default-manim-executable-path)
3. [How do I execute a command after the rendering is finished?](#3-how-do-i-execute-a-command-after-the-rendering-is-finished)

### 1. How do I render on save?

Enable the `manim-sideview.runOnSave` settings inside vscode `File -> Preferences -> Settings` menu.

<image src="https://raw.githubusercontent.com/Rickaym/Manim-Sideview/master/images/settings_runonsave.png"></image>

### 2. How do I change the default manim executable path?

You can set the default manim executable path by changing the `manim-sideview.defaultManimPath` configuration in `File -> Preferences -> Settings`.

<image src="https://raw.githubusercontent.com/Rickaym/Manim-Sideview/master/images/settings_defaultmanimpath.png"></image>

### 3. How do I execute a command after the rendering is finished?

We can achieve this via the extension preference `manim-sideview.terminalCommand` that accepts a command string.

<image src="https://raw.githubusercontent.com/Rickaym/Manim-Sideview/master/images/settings_terminalcommand.png"></image>

The command is executed in an external terminal as soon as all the rendering is finished.

You can use the following variables in your terminal command:

1. `{outputPath}` - the path to the rendered media output (video/image)
2. `{sourcePath}` - the path to the source file
3. `{sceneName}` - the name of the scene rendered

## Credits

Icons made by <a href="https://www.flaticon.com/authors/smashicons" title="Smashicons">Smashicons</a> and <a href="https://www.freepik.com" title="Freepik">Freepik</a> from <a href="https://www.flaticon.com/" title="Flaticon">www.flaticon.com</a>, [mobject gallery](https://github.com/kolibril13/mobject-gallery/) by [kolibril13](https://github.com/kolibril13) and ofcourse the logo by the [manim](https://raw.githubusercontent.com/3b1b/manim)/[community](https://raw.githubusercontent.com/ManimCommunity/manim/) project!

**Made and Maintained with <3 by Ricky**
Consider supporting this project through starring the repository or buying me a coffee!!

<a href="https://www.buymeacoffee.com/rickaym" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>

## Changelog

#### 0.2.16

- Fix auto save run; user must manually first run a file to be put into watch for run on save
- Feat allow the player to go into portrait mode

#### 0.2.15

- Fix proper handling of absolute defaultManimPath
- Better error message for bad quality values
- Better preference description
- Slight style improvements for the player

#### 0.2.14

- Ignore undefined environments

#### 0.2.13

- Fix missing icons in sideview

#### 0.2.12

- Fix manim config parsing
- Bumped vscode engine to v1.68.0

#### 0.2.11

- Manim command args with special characters are quoted
- Manim config parsing is more reliable

#### 0.2.9

- Fix virtual env detection and activation
- Added settings to enable/disable the checkered background

#### 0.2.8

- Fix video autoplay not working
- Renamed `autoPreview` preference option to `preview`

#### 0.2.7

- Fix commands not found error for VSCode engines under 1.75

#### 0.2.6

- Virtual env detection and activation
- Added portrait mode display

#### 0.2.5

- Allowed `pixel_width` and `pixel_height` as quality flags

#### 0.2.4

- Fix outputFileType always being undefined
- Repackage dependencies

#### 0.2.3

- Saves user given output file type to job.

#### 0.2.1

- Uses Return code 15 for last-process killing `SIGTERM` signals

#### 0.2.0

- Added video preview seeking ✨

#### 0.1.5

- Added `manim-sideview.autoPreview` command
- Added `manim-sideview.terminalCommand` command
- Added `manim-sideview.showManimExecTerminal` option
- Users are able to execute a terminal command at the end of a render

#### 0.1.4

- Source JS files repackaged

#### 0.1.3

- Targeted vscode engine downgraded to `1.62.3`

#### 0.1.2

- (Bugfix) `frame_rate` assumed as 60 on every quality

* Temporarily dropped `frame_rate` key in `manim.cfg` for output directory name

#### 0.1.1 [Latest]

- `@vscode/codicons` dependency changed from devDependency to general dependency

#### 0.1.0

- Extension terminal output format changed & added message persistence<br>
- Video Player renamed to "Media Player" and now handles both image and video media<br>
- Added image support for rendering previews and its corresponding config flags<br>
- New GUI User Interface for the Media Player<br>
- Uses the `plywood-gallery-for-vsce` template engine for Mobject Gallery<br>
- Uses the `plywood-gallery-for-vsce` template engine for Media Player<br>
- Added a new output channel called `Manim Sideview` for the extension to log all window and debug information<br>
- README write simplification and rewrite<br>
- Added support to rendering scenes without loading the source file workspace<br>

* Fontawesome CSS and JS files removed<br>
* Extension excess terminal output removed<br>
* Just in-time configuration

- Changed command `manim-sideview.setRenderingSceneName` name to `manim-sideview.renderNewScene`<br>
- Added command `manim-sideview.showOutputChannel` command for opening the log output channel<br>
- `manim.cfg` files are reloaded every run

#### 0.0.13

- Optional Terminal Output<br>
- Jupyter Notebook Fix<br>
- Webview URI error fix<br>

#### 0.0.12

- Added configurations to disable or enable auto-play
- Added configurations to disable or enable looping

#### 0.0.11

- Patched the local incorrect version file path for mobject gallery

#### 0.0.10

- Run-time configuration settings can be set for jobless scenes where it'll create a new job for the user
- Changed default quality mappings with responsiveness to Manim 0.13.1
- Smarter manim.cfg file analysis and in determining context

* It should be noted that default rendering will still use `-ql` for backward compatibility

- Added manim version re-synchronization command for developer independent compatibility
- Added version signifier to the mobject gallery

#### 0.0.9

- Scene scanner now looks for all class definitions with subclasses with name Scene in them
- Better responsiveness for refocusing selected documents in mobject gallery

#### 0.0.8

- Using axios now to synchronize assets for better performance

#### 0.0.7

- Added force re-download when assets are damaged

#### 0.0.6

- Added video player configurations `previewProgressColor`, `previewShowProgressOnIdle`
- Added `Check For Updates` button in mobject gallery and a sync lock with the repo

#### 0.0.5

- Fixed server links
- Added `manim-sideview.showMobjectGallery`
- Added hide progress button
- Added debrief for the video

#### 0.0.4

- Minor bug fix for Unix machines with trimmed leading slashes

#### 0.0.3

- Added `manim-sideview.stop` for stopping any running processes
- Paths are now normalized to work with both forward and backward slashes
- video directories are now static and will not depend on the verdict of manim
- Setting a valid path no longer replies with "Success" because this can be confusing when there is an exception thrown later down the line that has nothing to do with the scene name
- `manim.cfg` files are now derived from the working path - which is the correct case
- Added support server link

#### 0.0.1 - 0.0.2

The initial release of Manim Sideview.
