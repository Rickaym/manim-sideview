# Manim Sideview

A utility extension that provides a live video preview of the rendering scene in working with the **[mainm](https://github.com/ManimCommunity/manim)** framework for creating mathematical animations with Python.

## Index

1. [Features](#features)
2. [Requirements](#requirements)
3. [Context Variables](#context-variables)
4. [Extension Settings](#extension-settings)
5. [Credits](#credits)

### Features

**What are the rendering configurations?**

The rendering configurations are all that can be accessed via [context variables](#context-variables), some of these are
user-provided provided and some are resolved internally.

The extension only needs to know three things from you when a scene needs to be rendered.
1. quality
2. Media Path
3. Scene Name

These configurations can be provided via extension settings or during single file execution. Read further.

#### Default Rendering
By Default, rendering a Python file will use configurations as provided by the [settings](#extension-settings) so absolutely no tweakings are necessary.

#### Single File Rendering
You can also in certain cases render a single file under a specific set of configurations
* by writing a `manim.cfg` on the same directory as the source file - just like how you would normally
* by providing the configurations on run-time (you will be asked on the first time of rendering)

### Requirements

* For your information this extension relies on `analytic-signal.preview-mp4` for media preview. This is automatically installed alongside the extension.

### Context Variables

Sometimes we don't want to set an absolute path to the media file. Context Variables can only be used in:
* Configuration of `manim-sideview.videoFilePath`
* rendering a single file sideview

The case of variable names matter.
<table>
<tr>
    <th>Variable</th>
    <th>Description</th>
</tr>
<tr>
    <td>${fileName}</td>
    <td>The name of the file being run.</td>
</tr>
<tr>
    <td>${quality}</td>
    <td>The quality of the render.</td>
</tr>
<tr>
    <td>${sceneName}</td>
    <td>The name of the scene being run. Using the -a flag in command line arguments will resolve this into a random scene.</td>
</tr>
</table>

## Extension Settings

The scope of each settings signifies the level at which they can be changed. All the settings are application scoped therefore will remain as default settings when single-file execution is not configured.

<table>
<tr>
    <th>Identifier</th>
    <th>Scope</th>
    <th>Description</th>
    <th>Default</th>
</tr>
<tr>
    <td> manim-sideview.defaultManimPath </td>
    <td> Application </td>
    <td>The absolute path to the manim executable.</td>
    <td>manim</td>
</tr>
<tr>
    <td> manim-sideview.commandLineArgs </td>
    <td> Workspace </td>
    <td> The command line arguments in rendering manim. Refer to https://docs.manim.community/en/stable/tutorials/configuration.html?highlight=configuration#a-list-of-all-cli-flags for existing arugments. </td>
    <td>-ql</td>
</tr>
<tr>
    <td>manim-sideview.videoFilePath</td>
    <td>Workspace</td>
    <td>The video media file path relative from the media folder. This is best left by default if you're not sure what this is.</td>
    <td>videos/${fileName}/${quality}/${sceneName}.mp4</td>
</tr>
<tr>
    <td>manim-sideview.runOnSave</td>
    <td>Application</td>
    <td>Whether to run on save for a started file.</td>
    <td>True</td>
</tr>
</table>

### Known Issues

_-_

#### 0.0.1

Initial release of Manim Sideview.

---

### Credits

Icons made by <a href="https://www.flaticon.com/authors/smashicons" title="Smashicons">Smashicons</a> from <a href="https://www.flaticon.com/" title="Flaticon">www.flaticon.com</a>
