const vscode = acquireVsCodeApi();
var timestatus = document.querySelector(".color-fill");
var demostatus = document.querySelector(".demo-fill");
var controls = document.querySelector(".progress-bar");

var controlButtons = document.getElementsByClassName("control-button");

var videoPlayer = document.getElementById("video-media-player");
var video = document.getElementById("video-preview");
var imagePlayer = document.getElementById("image-media-player");
var image = document.getElementById("image-preview");

togglePlayPause(false);

function pauseVideo(toggle) {
  if (toggle) {
    video.pause();
  }
}

function playVideo(toggle) {
  if (toggle) {
    video.play();
  }
}

function togglePlayPause(toggle = true) {
  if (video.paused) {
    playVideo(toggle);
  } else {
    pauseVideo(toggle);
  }
}

async function enterPictureInPicture() {
  // If there is no element in Picture-in-Picture yet, let’s request
  // Picture-in-Picture for the video, otherwise leave it.
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else {
      await video.requestPictureInPicture();
    }
  } catch (err) {
    console.log(err);
  }
}

for (const button of controlButtons) {
  button.addEventListener("click", function () {
    switch (button.getAttribute("title")) {
      case "Render a New Scene":
        const srcPath = document.getElementById("source-file").innerHTML;
        vscode.postMessage({
          command: "executeSelfCommand",
          name: "renderNewScene",
          args: [srcPath],
        });
        break;
      case "Picture In Picture":
        if (videoPlayer.hidden) {
          vscode.postMessage({
            command: "errorMessage",
            text: "Manim Sideview: Picture In Picture is not supported on images.",
          });
        } else {
          enterPictureInPicture();
        }
        break;
    }
  });
}

video.addEventListener("click", function () {
  togglePlayPause();
});

video.addEventListener("timeupdate", function () {
  timestatus.style.width = (video.currentTime / video.duration) * 100 + "%";
});

video.addEventListener("ended", function () {
  pauseVideo(false);
});

controls.addEventListener("mousemove", function (e) {
  const brc = this.getBoundingClientRect();
  const seek = (e.clientX - brc.left) / brc.width;
  demostatus.style.width = seek * 100 + "%";
});

controls.addEventListener("click", function (e) {
  const brc = this.getBoundingClientRect();
  const seek = (e.clientX - brc.left) / brc.width;
});

window.addEventListener("message", function (e) {
  const message = e.data;
  switch (message.command) {
    case "reload":
      console.log("Set source to ", message.resource);
      document.getElementById("output-file").innerText = message.out;
      document.getElementById("module-name").innerText = message.moduleName;

      if (message.mediaType === 1) {
        image.setAttribute("src", message.resource);
        videoPlayer.hidden = true;
        imagePlayer.hidden = false;
      } else {
        video.setAttribute("src", message.resource);
        video.removeAttribute("poster");
        video.load();
        video.play();
        imagePlayer.hidden = true;
        videoPlayer.hidden = false;
      }
      break;
  }
});
