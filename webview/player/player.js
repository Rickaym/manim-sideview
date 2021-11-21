var source = document.createElement("source");
var video = document.querySelector(".video");
video.appendChild(source);

var timestatus = document.querySelector(".color-fill");
var demostatus = document.querySelector(".demo-fill");
var statusbar = document.querySelector(".status-bar");
var button = document.getElementById("play-pause");
var pipButton = document.getElementById("pip");

pipButton.hidden =
  !document.pictureInPictureEnabled || video.disablePictureInPicture;

function togglePlayPause() {
  if (video.paused) {
    button.className = "pause";
    video.play();
  } else {
    button.className = "play";
    video.pause();
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

pipButton.addEventListener("click", enterPictureInPicture);

button.addEventListener("click", function () {
  togglePlayPause();
});

video.addEventListener("click", function () {
  togglePlayPause();
});

video.addEventListener("timeupdate", function () {
  timestatus.style.width = (video.currentTime / video.duration) * 100 + "%";
});

statusbar.addEventListener("mousemove", function (e) {
  const brc = this.getBoundingClientRect();
  const seek = (e.clientX - brc.left) / brc.width;
  demostatus.style.width = seek * 100 + "%";
});

statusbar.addEventListener("click", function (e) {
  const brc = this.getBoundingClientRect();
  const seek = (e.clientX - brc.left) / brc.width;
});

window.addEventListener("message", (event) => {
  const message = event.data;
  switch (message.command) {
    case "reload":
      source.setAttribute("src", message.resource);
      source.setAttribute("type", "video/mp4");
      video.load();
      video.play();
  }
});
