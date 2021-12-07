const vscode = acquireVsCodeApi();
const container = document.getElementById("Mobjects");
const updates = document.getElementById("updates");
const fdownload = document.getElementById("download-again");


container.addEventListener("click", (event) => {
  if (event.target.className === "image-button") {
    vscode.postMessage({
      command: "code-insert",
      code: event.target.alt,
    });
  }
});

updates.addEventListener("click", (event) => {
  vscode.postMessage({
    command: "update",
  });
});

fdownload.addEventListener("click", (event) => {
  vscode.postMessage({
    command: "download-again",
  });
});
