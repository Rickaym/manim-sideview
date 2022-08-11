var timestatus = document.querySelector(".color-fill");
var demostatus = document.querySelector(".demo-fill");
var statusbar = document.querySelector(".status-bar");
var controls = document.querySelector(".controls");
var valueReport = document.querySelector(".value");
var moduleNameSpan = document.querySelector(".module-name");

var video = document.getElementById("preview");
var button = document.getElementById("play-pause");
var pipButton = document.getElementById("pip");

pipButton.hidden =
  !document.pictureInPictureEnabled || video.disablePictureInPicture;

togglePlayPause(false);

function pauseVideo(toggle) {
  button.textContent = "Play";
  if (toggle) {
    video.pause();
  }
}

function playVideo(toggle) {
  button.textContent = "Pause";
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

// var setControlsEnabled = document.getElementById("progress-on-idle");
// // it's possible that a controls class starts hidden
// // in which case we'll also swap the button
// if (controls.classList.contains("hidden-controls")) {
//     setControlsEnabled.className = "hidden";
// }

// setControlsEnabled.addEventListener("click", function () {
//     if (setControlsEnabled.className === "hidden") {
//       setControlsEnabled.className = "shown";
//       controls.classList.remove("hidden-controls");
//     } else {
//       setControlsEnabled.className = "hidden";
//       controls.classList.add("hidden-controls");
//     };
// });

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

video.addEventListener('ended', function () {
  pauseVideo(false);
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
