const vscode = acquireVsCodeApi();

// --- Get DOM Elements ---
const mediaContainer = document.querySelector(".media-container");
const videoPlayer = document.getElementById("video-media-player");
const video = document.getElementById("video-preview");
const imagePlayer = document.getElementById("image-media-player");
const image = document.getElementById("image-preview");

// Controls
const controlsContainer = document.querySelector(".controls-container");
const progressBar = document.querySelector(".progress-bar");
const progressBarBackground = document.querySelector(
  ".progress-bar-background"
);
const progressFill = document.querySelector(".color-fill");
const seekTooltip = document.querySelector(".demo-fill"); // Renamed for clarity

// Buttons
const playPauseButton = document.getElementById("play-pause-button");
const playIcon = document.getElementById("play-icon");
const pauseIcon = document.getElementById("pause-icon");
const volumeButton = document.getElementById("volume-button");
const volumeHighIcon = document.getElementById("volume-high-icon");
const volumeMutedIcon = document.getElementById("volume-muted-icon");
const volumeSlider = document.getElementById("volume-slider");
const loopButton = document.getElementById("loop-button");
const speedButton = document.getElementById("speed-button");
const speedOptionsList = document.getElementById("speed-options-list");
const pipButton = document.getElementById("pip-button");
const fullscreenButton = document.getElementById("fullscreen-button");
const fullscreenEnterIcon = document.getElementById("fullscreen-enter-icon");
const fullscreenExitIcon = document.getElementById("fullscreen-exit-icon");
const renderButton = document.getElementById("render-button"); // New ID

// Displays & Details
const timeDisplay = document.getElementById("time-display");
const moduleNameDisplay = document.getElementById("module-name");
const outputFileDisplay = document.getElementById("output-file");
const sourceFileDisplay = document.getElementById("source-file");

// --- State Variables ---
let isVideoMode = !videoPlayer.hidden;
let controlsTimeout;
let wasPausedBeforeSeek = false;

// --- Helper Functions ---

function formatTime(timeInSeconds) {
  const result = new Date(timeInSeconds * 1000).toISOString().slice(14, 19); // MM:SS format
  return result;
}

function updatePlayPauseIcon() {
  if (video.paused) {
    playIcon.style.display = "block";
    pauseIcon.style.display = "none";
    // Keep controls visible when paused
    controlsContainer.classList.add("visible");
    clearTimeout(controlsTimeout);
  } else {
    playIcon.style.display = "none";
    pauseIcon.style.display = "block";
    // Hide controls after delay when playing
    hideControlsWithDelay();
  }
}

function updateVolumeIcon() {
  if (video.muted || video.volume === 0) {
    volumeHighIcon.style.display = "none";
    volumeMutedIcon.style.display = "block";
    volumeSlider.value = 0;
  } else {
    volumeHighIcon.style.display = "block";
    volumeMutedIcon.style.display = "none";
    volumeSlider.value = video.volume; // Sync slider
  }
}

function updateFullscreenIcon() {
  if (document.fullscreenElement) {
    fullscreenEnterIcon.style.display = "none";
    fullscreenExitIcon.style.display = "block";
  } else {
    fullscreenEnterIcon.style.display = "block";
    fullscreenExitIcon.style.display = "none";
  }
}

function hideControlsWithDelay() {
  // Don't hide if video isn't the active element or if paused
  if (document.activeElement === video || !video.paused) {
    clearTimeout(controlsTimeout);
    controlsTimeout = setTimeout(() => {
      // Check again in case state changed
      if (
        !video.paused &&
        document.activeElement !== video &&
        !controlsContainer.matches(":hover") &&
        !progressBar.matches(":hover")
      ) {
        controlsContainer.classList.remove("visible");
      }
    }, 2000); // Hide after 2 seconds of inactivity
  }
}

function showControls() {
  clearTimeout(controlsTimeout);
  controlsContainer.classList.add("visible");
}

// --- Core Functionality ---

function togglePlayPause() {
  if (!isVideoMode) return;
  if (video.paused) {
    video.play();
  } else {
    video.pause();
  }
  updatePlayPauseIcon();
}

function setVideoProgress(seekRatio) {
  if (!isVideoMode || isNaN(video.duration)) return;
  video.currentTime = seekRatio * video.duration;
}

function skip(duration) {
  if (!isVideoMode || isNaN(video.duration)) return;
  video.currentTime += duration;
}

function toggleMute() {
  if (!isVideoMode) return;
  video.muted = !video.muted;
  if (!video.muted && video.volume === 0) {
    // Unmuting but volume was 0
    video.volume = 0.1; // Set a small volume
  }
  updateVolumeIcon();
}

function toggleLoop() {
  if (!isVideoMode) return;
  video.loop = !video.loop;
  // Visual feedback: Add/remove a class for styling
  loopButton.classList.toggle("active", video.loop);
  // Simple example: change background, define .active in CSS if needed
  loopButton.style.backgroundColor = video.loop
    ? "rgba(255, 255, 255, 0.3)"
    : "";
}

function setPlaybackSpeed(speed) {
  if (!isVideoMode) return;
  video.playbackRate = speed;
  speedButton.textContent = `${speed}x`;
  // Update active class on list items
  speedOptionsList.querySelectorAll("li").forEach((li) => {
    li.classList.toggle("active", parseFloat(li.dataset.value) === speed);
  });
}

async function enterPictureInPicture() {
  if (!isVideoMode) {
    vscode.postMessage({
      command: "errorMessage",
      text: "Manim Sideview: Picture In Picture is not supported on images.",
    });
    return;
  }
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else {
      await video.requestPictureInPicture();
    }
  } catch (err) {
    console.error("PiP Error:", err);
    vscode.postMessage({
      command: "errorMessage",
      text: "Manim Sideview: Picture In Picture failed. " + err.message,
    });
  }
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    mediaContainer.requestFullscreen().catch((err) => {
      console.error("Fullscreen Error:", err);
      vscode.postMessage({
        command: "errorMessage",
        text: "Manim Sideview: Fullscreen failed. " + err.message,
      });
    });
  }
}

function renderNew() {
  const srcPath = sourceFileDisplay.innerHTML;
  vscode.postMessage({
    command: "executeSelfCommand",
    name: "renderNewScene",
    args: [srcPath],
  });
}

// --- Event Listeners ---

// Video Player Events
video.addEventListener("loadedmetadata", () => {
  if (!isNaN(video.duration)) {
    timeDisplay.textContent = `${formatTime(0)} / ${formatTime(
      video.duration
    )}`;
  }
  updatePlayPauseIcon(); // Set initial icon
  updateVolumeIcon(); // Set initial volume icon/slider
  // Set initial loop button state
  loopButton.classList.toggle("active", video.loop);
  loopButton.style.backgroundColor = video.loop
    ? "rgba(255, 255, 255, 0.3)"
    : "";
});

video.addEventListener("play", updatePlayPauseIcon);
video.addEventListener("pause", updatePlayPauseIcon);

video.addEventListener("timeupdate", () => {
  if (isNaN(video.duration)) return;
  const progressPercent = (video.currentTime / video.duration) * 100;
  progressFill.style.width = `${progressPercent}%`;
  timeDisplay.textContent = `${formatTime(video.currentTime)} / ${formatTime(
    video.duration
  )}`;
});

video.addEventListener("volumechange", updateVolumeIcon);

video.addEventListener("click", togglePlayPause); // Click on video toggles play/pause

// Progress Bar Events
progressBar.addEventListener("mousemove", (e) => {
  if (!isVideoMode || isNaN(video.duration)) return;
  const rect = progressBar.getBoundingClientRect();
  const seekRatio = Math.max(
    0,
    Math.min(1, (e.clientX - rect.left) / rect.width)
  );
  seekTooltip.style.width = `${seekRatio * 100}%`;
});

progressBar.addEventListener("mouseleave", () => {
  // Optionally hide seek tooltip when mouse leaves
  // seekTooltip.style.width = `0%`;
});

progressBar.addEventListener("mousedown", (e) => {
  if (!isVideoMode || isNaN(video.duration)) return;
  wasPausedBeforeSeek = video.paused;
  if (!wasPausedBeforeSeek) video.pause(); // Pause while seeking for smoother experience
});

progressBar.addEventListener("click", (e) => {
  if (!isVideoMode || isNaN(video.duration)) return;
  const rect = progressBar.getBoundingClientRect();
  const seekRatio = Math.max(
    0,
    Math.min(1, (e.clientX - rect.left) / rect.width)
  );
  setVideoProgress(seekRatio);
  // Resume playing only if it was playing before starting the seek
  if (!wasPausedBeforeSeek) {
    // A small delay might be needed if the click causes immediate pause/play confusion
    setTimeout(() => video.play(), 50);
  }
});

// Button Events
playPauseButton.addEventListener("click", togglePlayPause);
volumeButton.addEventListener("click", toggleMute);
volumeSlider.addEventListener("input", (e) => {
  if (!isVideoMode) return;
  video.volume = e.target.value;
  video.muted = video.volume === 0; // Mute if slider dragged to 0
  updateVolumeIcon(); // Update icon immediately
});
loopButton.addEventListener("click", toggleLoop);
pipButton.addEventListener("click", enterPictureInPicture);
fullscreenButton.addEventListener("click", toggleFullscreen);
renderButton.addEventListener("click", renderNew);

// Playback Speed Selection
speedOptionsList.addEventListener("click", (e) => {
  if (e.target.tagName === "LI") {
    const speed = parseFloat(e.target.dataset.value);
    setPlaybackSpeed(speed);
  }
});

// Controls Visibility Events
mediaContainer.addEventListener("mouseenter", showControls);
mediaContainer.addEventListener("mousemove", () => {
  showControls();
  if (!video.paused) {
    hideControlsWithDelay();
  }
});
mediaContainer.addEventListener("mouseleave", () => {
  // Start hide timer immediately if not paused and focus isn't inside
  if (!video.paused && !controlsContainer.matches(":hover")) {
    hideControlsWithDelay();
  }
});
controlsContainer.addEventListener("mouseenter", showControls); // Keep visible if mouse enters controls
controlsContainer.addEventListener("mouseleave", () => {
  // Hide when mouse leaves controls (if appropriate)
  if (!video.paused) {
    hideControlsWithDelay();
  }
});

// Fullscreen Change Event (handles Esc key)
document.addEventListener("fullscreenchange", updateFullscreenIcon);
document.addEventListener("webkitfullscreenchange", updateFullscreenIcon); // Safari

// Keyboard Shortcuts
window.addEventListener("keydown", (e) => {
  // Ignore shortcuts if typing in an input, textarea, etc.
  const targetTagName = document.activeElement.tagName.toLowerCase();
  if (targetTagName === "input" || targetTagName === "textarea") return;

  // Allow focus styles without triggering actions immediately
  if (
    [" ", "Enter"].includes(e.key) &&
    document.activeElement.classList.contains("control-button")
  ) {
    // Let the button's click handler manage the action
    return;
  }

  switch (e.key.toLowerCase()) {
    case " ": // Space bar
      e.preventDefault(); // Prevent page scroll
      togglePlayPause();
      break;
    case "m": // Mute
      toggleMute();
      break;
    case "l": // Loop
      toggleLoop();
      break;
    case "f": // Fullscreen
      toggleFullscreen();
      break;
    case "arrowleft": // Seek back
      skip(-5); // Skip 5 seconds back
      break;
    case "arrowright": // Seek forward
      skip(5); // Skip 5 seconds forward
      break;
  }
});

// --- VS Code Message Handling ---
window.addEventListener("message", (e) => {
  const message = e.data;
  switch (message.command) {
    case "reload":
      outputFileDisplay.innerText = message.outputFile;
      moduleNameDisplay.innerText = message.moduleName;
      sourceFileDisplay.innerText = message.sourceFile;

      // Add titles dynamically in case paths change (optional, but good practice)
      outputFileDisplay.title = `Click to reveal ${message.outputFile} in Explorer`;
      sourceFileDisplay.title = `Click to open ${message.sourceFile}`;

      isVideoMode = message.mediaType !== 1; // 1 is image type
      videoPlayer.hidden = !isVideoMode;
      imagePlayer.hidden = isVideoMode;

      // Reset controls based on type
      controlsContainer.style.display = isVideoMode ? "" : "none"; // Hide controls for images

      if (isVideoMode) {
        video.setAttribute("src", message.resource);
        video.removeAttribute("poster"); // Ensure no poster interferes
        video.load(); // Important to load new source
        // Autoplay might be handled by the {{ autoplay }} attribute,
        // but explicitly calling play ensures it tries if allowed.
        video.play().catch((err) => console.log("Autoplay prevented:", err)); // Play new video (browser might block)
        // Reset state for new video
        video.loop = message.loop; // Assuming loop state comes from extension
        setPlaybackSpeed(1); // Reset speed
        updatePlayPauseIcon();
        updateVolumeIcon();
        timeDisplay.textContent = `0:00 / 0:00`;
        progressFill.style.width = `0%`;
        updateFullscreenIcon(); // Update in case state changed externally
      } else {
        image.setAttribute("src", message.resource);
        // Ensure video is paused if switching away
        video.pause();
      }
      break;
  }
});

// --- Initial Setup ---
updatePlayPauseIcon();
updateVolumeIcon();
updateFullscreenIcon(); // Set initial fullscreen icon state
setPlaybackSpeed(1); // Set initial speed text/state

// Show controls initially if video is preloaded/autoplayed potentially
if (isVideoMode) {
  showControls();
  hideControlsWithDelay(); // Start the timer if playing
} else {
  controlsContainer.style.display = "none"; // Ensure controls are hidden for images
}
