const vscode = acquireVsCodeApi();

const configForm = document.getElementById("config-form");
const buttCancel = document.getElementById("cancel");

configForm.addEventListener("submit", function () {
  vscode.postMessage({
    command: "configure",
    args: document.getElementById("args").value,
    videoDir: document.getElementById("video_dir").value,
    sceneName: document.getElementById("scene_name").value
  });
});
buttCancel.addEventListener("click", function () {
  vscode.postMessage({
    command: "dispose"
  });
});
