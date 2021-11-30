var timestatus = document.querySelector(".color-fill");
var demostatus = document.querySelector(".demo-fill");
var statusbar = document.querySelector(".status-bar");
var controls = document.querySelector(".controls");
var valueReport = document.querySelector(".value");
var moduleNameSpan = document.querySelector(".module-name");

var video = document.getElementById("preview");
var button = document.getElementById("play-pause");
var pipButton = document.getElementById("pip");
var setControlsEnabled = document.getElementById("progress-on-idle");

pipButton.hidden =
  !document.pictureInPictureEnabled || video.disablePictureInPicture;


// it's possible that a controls class starts hidden
// in which case we'll also swap the button
if (controls.classList.contains("hidden-controls")) {
    setControlsEnabled.className = "hidden";
}

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

setControlsEnabled.addEventListener("click", function () {
    if (setControlsEnabled.className === "hidden") {
      setControlsEnabled.className = "shown";
      controls.classList.remove("hidden-controls");
    } else {
      setControlsEnabled.className = "hidden";
      controls.classList.add("hidden-controls");
    };
});

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

window.addEventListener("message", function (e) {
  const message = e.data;
  console.log(message);
  switch (message.command) {
    case "reload":
      video.setAttribute("src", message.resource);
      console.log("Set source to ", message.resource);
      valueReport.innerHTML = `<b>Media File Path</b>: ${message.out}<br>`;
      moduleNameSpan.innerHTML = `<b>${message.moduleName}</b>`;
      video.load();
      video.play();
  }
});