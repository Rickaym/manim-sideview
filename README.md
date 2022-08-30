# Manim Sideview

<a href="https://marketplace.visualstudio.com/items?itemName=Rickaym.manim-sideview"><img alt="Extension Homepage" src="https://img.shields.io/badge/vscode-install%20Here-brightgreen?logo=visualstudiocode"></a> <a href="https://marketplace.visualstudio.com/items?itemName=Rickaym.manim-sideview"><img alt="Extension Version" src="https://img.shields.io/visual-studio-marketplace/v/Rickaym.manim-sideview"></a> <a href="https://discord.gg/UmnzdPgn6g/"><img src="https://img.shields.io/discord/793047973751554088.svg?label=Extension Support&color=blue&logo=discord" alt="Discord"></a> <a href="https://www.manim.community/discord/"><img src="https://img.shields.io/discord/581738731934056449.svg?label=Manim Community&color=yellow&logo=discord" alt="Discord"></a>

An extension for Visual Studio Code that provides a live preview and various other features in working with **[manim](https://raw.githubusercontent.com/ManimCommunity/manim)**.


## Index

1. [Quickstart](#quickstart)
2. [Rendering The Scene](#rendering)
2. [Mobject Gallery](#mobject-gallery)
3. [Context Variables](#context-variables)
4. [Extension Settings](#extension-settings)
5. [Status Bar Item](#utilities)
6. [Credits](#credits)

## Frequently Asked Questions
1. [How do I render on save?](#how-do-i-render-on-save)
2. [How do I change the scene name after running?](#how-do-i-change-the-scene-name-after-running)
3. [How do I change the default manim executable path?](#how-do-i-change-the-default-manim-executable-path)

## Quickstart
1. Install this Extension!
2. Open up a Python file with the scene code
3. Press the <image src="https://raw.githubusercontent.com/Rickaym/Manim-Sideview/master/assets/images/rotation.png" height="100%" width= "15px"> icon from the menu bar to start rendering and preview the scene immediately! (or use `Ctrl+'` `r`)

![](images/example_preview.gif)


## Rendering

This extension does not come prepackaged with the Python manim executable or any of its necessary packages, it assumes an installation of manim on `PATH`, if the executable is not on `PATH` you may set a custom path by following [this guide](#how-do-i-change-the-default-manim-executable-path).

When a scene is successfully rendered for the first time, the extension creates a active job tied to the source file, you can look at [this](#utilities) to make sure - as long as this job is active, all your settings will persist. Note that run on save does not get activated on files that don't have jobs.

#### Configuration

It can be done in two ways.

<image src="https://raw.githubusercontent.com/Rickaym/Manim-Sideview/master/assets/images/settings.png" height="100%" width= "20px"> The first option is to provide in a runtime/in time (can be used interchangeably) configuration - where we'll ask you a few questions to tweak the settings on run time

**HOTKEY** - `ctrl + '` `s` *press, release and then press s, this is not simultaneous*

<image src="https://raw.githubusercontent.com/Rickaym/Manim-Sideview/master/assets/images/dark_logo.png" height="100%" width= "20px"></image> For the second option you'll have to configure a `manim.cfg` with a few mandatory flags. Importantly, you must have the config file in the working directory.

#### Preview

To serve a live preview, the extension needs a relative path to the media file (it can be absolute for an intime configuration).

Those using a `manim.cfg` file can skip this part as we derive programmatically where the media file will be with the given flags.

For those using the runtime configurations, you'll have to provide the media path in the same dialog. When doing so, you can use a few context variables with as privillege as you can when changing the settings as provided [here](#variables).

<image src="https://raw.githubusercontent.com/Rickaym/Manim-Sideview/master/images/video_dir.png"></image>
* *figure taken from the in time configuration menu*

## Mobject Gallery

An Mobject gallery is a webview that allow users to insert code snippets for commonly used manim objects, e.g., shapes, text, etc...

E.g.
![](images/example_of_mobject_gallery.gif)

Open the command palette using `Shift + Command + P (Mac)` / `Ctrl + Shift + P` and use the command `Manim: Open MObject Gallery` to open the gallery.

Click on the shape you'd like to insert the Mobject code into a Python or Jupyter Notebook!

## Context Variables

Sometimes we don't want to set an absolute path to the media file. Context Variables can only be used in:
* Configuration of `manim-sideview.videoDirectory`

The case of variable names matter.
#### Variables
<table>
<tr>
    <th>Variable</th>
    <th>Description</th>
</tr>
<tr>
    <td>{module_name}</td>
    <td>The name of the file being run.</td>
</tr>
<tr>
    <td>{media_dir}</td>
    <td>The directory of the media files.</td>
</tr>
<tr>
    <td>{scene_name}</td>
    <td>The name of the scene being run.</td>
</tr>
</table>

Using unset variables will result in default values being used.

## Frequently Asked Questions

### How do I render on save?

Enable the `manim-sideview.runOnSave` settings inside vscode `File -> Preferences -> Settings` menu.

<image src="https://raw.githubusercontent.com/Rickaym/Manim-Sideview/master/images/settings_runonsave.png"></image>

### How do I change the scene name after running?

You can change the scene name after a job by using the `Manim: Set A New SceneName` command through the command palette `Shift + Command + P (Mac)` / `Ctrl + Shift + P`.

Alternatively, you can also use the following default hotkey `Ctrl + '` `c`.

### How do I change the default manim executable path?

You can set the default manim executable path by changing the `manim-sideview.defaultManimPath` configuration in `File -> Preferences -> Settings`.

<image src="https://raw.githubusercontent.com/Rickaym/Manim-Sideview/master/images/settings_defaultmanimpath.png"></image>

## Utilities

You can find a status bar item inside the status bar (the one at the very bottom) an icon that looks like:

<image src="https://raw.githubusercontent.com/Rickaym/Manim-Sideview/master/images/statusbaritem.png"></image>

This is a visual reminder that the file in current focus has an active renderer. Relevantly, this icon will change colors to either green or red depending on the results of an execution at times.

### Known Issues

1. Buttons from Picture in Picture unresponsive [*linked issue*](https://github.com/Rickaym/Manim-Sideview/issues/7).
2. Seeking video duration [*linked issue*](https://github.com/Rickaym/Manim-Sideview/issues/7).

## Changelog

#### 0.0.14

+ Manim Gallery View now use the `plywood-gallery-for-vsce` template engine.<br>
+ Video player now use the same template engine.<br>
+ Video player revamped--now simple and straight forward<br>
+ User Extension log format changed<br>
+ "Mobject" to "MObject" change extension-wide
- Fontawesome CSS and JS files removed<br>
+ Complete rewrite of the readme file for less word content<br>

#### 0.0.13

+ Optional Terminal Output<br>
+ Jupyter Notebook Fix<br>
+ Webview URI error fix<br>

#### 0.0.12

+ Added configurations to disable or enable auto-play
+ Added configurations to disable or enable looping

#### 0.0.11

+ Patched the local incorrect version filepath for mobject gallery

#### 0.0.10

+ Run-time configuration settings can be set for jobless scene where it'll create a new job for the user
+ Changed default quality mappings with responsiveness to Manim 0.13.1
+ Smarter manim.cfg file analysis and in determining context
* It should be noted that default rendering will still use `-ql` for backwards compatibility
+ Added manim version re-synchronization command for developer independent compatibility
+ Added version signifier to the mobject gallery

#### 0.0.9

+ Scene scanner now looks for all class definitions with subclasses with name Scene in them
+ Better responsiveness for refocusing selected documents in mobject gallery

#### 0.0.8

+ Using axios now to synchronize assets for better performance

#### 0.0.7

+ Added force redownload when assets are damaged

#### 0.0.6

+ Added video player configurations `previewProgressColor`, `previewShowProgressOnIdle`
+ Added `Check For Updates` button in mobject gallery and a sync lock with the repo

#### 0.0.5

+ Fixed server links
+ Added `manim-sideview.showMobjectGallery`
+ Added hide progress button
+ Added debrief for the video

#### 0.0.4

+ Minor bug fix for Unix machines with trimmed leading slashes

#### 0.0.3

+ Added `manim-sideview.stop` for stopping any running processes
+ Paths are now normalized to work with both forward and backward slashes
+ video directories are now static and will not depend on the verdict of manim
+ Setting a valid path no longer replies with "Success" because this can be confusing when there is an exception thrown later down the line that has has nothing to do with the scene name
+ `manim.cfg` files are now derived from the working path - which is the correct case
+ Added support server link

#### 0.0.1 - 0.0.2

Initial release of Manim Sideview.

## Credits

Icons made by <a href="https://www.flaticon.com/authors/smashicons" title="Smashicons">Smashicons</a> and <a href="https://www.freepik.com" title="Freepik">Freepik</a> from <a href="https://www.flaticon.com/" title="Flaticon">www.flaticon.com</a>, [mobject gallery](https://github.com/kolibril13/mobject-gallery/) by [kolibril13](https://github.com/kolibril13) and ofcourse the logo by the [manim](https://raw.githubusercontent.com/3b1b/manim)/[community](https://raw.githubusercontent.com/ManimCommunity/manim/) project themselves!

**Made with <3 by Ricky,**
