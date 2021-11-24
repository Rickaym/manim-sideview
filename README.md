# Manim Sideview

A utility extension that provides a live video preview of the rendering scene in working with the **[mainm](https://github.com/ManimCommunity/manim)** framework.


Before you can start a live preview you'll have to setup a few configuration settings for rendering! As well as the media path. This is because the extension combines the sideview and the file execution into a single workflow, read further ~

## Index

1. [Rendering](#rendering)
2. [Preview](#Preview)
3. [Context Variables](#context-variables)
4. [Extension Settings](#extension-settings)
5. [Credits](#credits)

### Rendering

Rendering a scene can be done in two ways.
*  The first option is to proivde a runtime/in time (i will use them interchangeably) configuration - where we'll ask you a few questions to tweak the settings on run time
* For the second option you'll have to configure a `manim.cfg` with a few mandatory flags. Importantly, you must have the config file in the same directory as the source file.

### Preview

To serve a live preview, the extension needs a relative path to the media file (it can be absolute for an intime configuration).

Those using a `manim.cfg` file can skip this part as we derive programmatically where the media file will be with the given flags.

For those using the runtime configurations, you'll have to provide the media path in the same dialog. When doing so, you can use a few context variables with as privillege as you can when changing the settings as provided [here](#variables).

### Context Variables

Sometimes we don't want to set an absolute path to the media file. Context Variables can only be used in:
* Configuration of `manim-sideview.videoFilePath`
* In time configurations

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

## Extension Settings

The scope of each settings signifies the level at which they can be changed. All the settings are application scoped therefore will remain as default settings when single-file execution is not configured.

<table>
<tr>
    <th>Identifier</th>
    <th>Description</th>
    <th>Default</th>
</tr>
<tr>
    <td> manim-sideview.defaultManimPath </td>
    <td>The absolute path to the manim executable.</td>
    <td>manim</td>
</tr>
<tr>
    <td> manim-sideview.commandLineArgs </td>
    <td> The command line arguments in rendering manim. Refer to https://docs.manim.community/en/stable/tutorials/configuration.html?highlight=configuration#a-list-of-all-cli-flags for existing arugments. </td>
    <td>-ql</td>
</tr>
<tr>
    <td>manim-sideview.videoDirectory</td>
    <td>The video output directory. We can use context variables here to place them under the media directory. This does not include the `.mp4` file itself.</td>
    <td>{media_dir}/videos/{module_name}/480p15</td>
</tr>
<tr>
    <td>manim-sideview.mediaDirectory</td>
    <td>The root folder for all media output.</td>
    <td>media</td>
</tr>
<tr>
    <td>manim-sideview.runOnSave</td>
    <td>Whether to run on save for a file that has been run before.</td>
    <td>false</td>
</tr>
<tr>
    <td>manim-sideview.focusOutputOnRun</td>
    <td>Whether to focus on the output log when running.</td>
    <td>true</td>
</tr>
</table>

### Known Issues

_-_

#### 0.0.1

Initial release of Manim Sideview.

---

### Credits

Icons made by <a href="https://www.flaticon.com/authors/smashicons" title="Smashicons">Smashicons</a> and <a href="https://www.freepik.com" title="Freepik">Freepik</a> from <a href="https://www.flaticon.com/" title="Flaticon">www.flaticon.com</a> and ofcourse the logo by the [manim](https://github.com/3b1b/manim)/[community](https://github.com/ManimCommunity/manim/) project themselves!

**Made with <3 by Ricky,**