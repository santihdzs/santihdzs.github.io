// Theme switcher
const root = document.querySelector(":root"),
  inputs = document.querySelectorAll("input[name='theme']");

let theme = localStorage.getItem("theme-color");

const updateRoot = (value) =>
  root.style.setProperty("--theme-color", `var(--${value})`);

for (const input of inputs) {
  if (theme && input.getAttribute("color") === theme) {
    input.checked = true;
    updateRoot(theme);
  }

  input.onchange = (e) => {
    const color = e.target.getAttribute("color");
    updateRoot(color);
    localStorage.setItem("theme-color", color);
  };
}

updateRoot(theme);


// Background animation
import gsap from "https://cdn.skypack.dev/gsap@3.12.0";
import { ScrollTrigger } from "https://cdn.skypack.dev/gsap/ScrollTrigger.js";

// Canvas setup
const CONTAINER = document.querySelector(".bgcontainer");
let CONFIG = {
  cell: localStorage.getItem("cell-color") || "white", // Retrieve the color from localStorage or use "white"
  track: "rgb(15, 15, 15)",
  frame: "rgb(20, 20, 20)",
  fps: 24,
  amount: 5500,
  noise: 0.03,
  hOffset: undefined,
  vOffset: undefined,
  columns: undefined,
  rows: undefined,
  size: 12,
  border: 2,
};
const DPR = window.devicePixelRatio;
const canvas = Object.assign(document.createElement("canvas"), {
  width: window.innerWidth * DPR,
  height: window.innerHeight * DPR,
});
const context = canvas.getContext("2d");
const gridCanvas = Object.assign(document.createElement("canvas"), {
  width: window.innerWidth * DPR,
  height: window.innerHeight * DPR,
});
const gridContext = gridCanvas.getContext("2d");
CONTAINER.appendChild(canvas);

const setGrid = () => {
  gridContext.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
  gridContext.fillStyle = CONFIG.track;
  const hTracks = Math.ceil(gridCanvas.width / CONFIG.size);
  const hOffset = (gridCanvas.width % CONFIG.size) * 0.5;
  for (let h = 0; h < hTracks; h++) {
    gridContext.fillRect(
      h * CONFIG.size + hOffset - CONFIG.border,
      0,
      CONFIG.border * 2,
      gridCanvas.height
    );
  }
  const vTracks = Math.ceil(gridCanvas.height / CONFIG.size);
  const vOffset = (gridCanvas.height % CONFIG.size) * 0.5;
  for (let v = 0; v < vTracks; v++) {
    gridContext.fillRect(
      0,
      v * CONFIG.size + vOffset - CONFIG.border,
      gridCanvas.width,
      CONFIG.border * 2
    );
  }
  CONFIG.columns = hTracks;
  CONFIG.hOffset = hOffset;
  CONFIG.rows = vTracks;
  CONFIG.vOffset = vOffset;
  CONFIG.cells = new Array(CONFIG.amount)
    .fill(0)
    .map(() => [
      Math.floor(Math.random() * CONFIG.columns),
      Math.floor(Math.random() * CONFIG.rows),
    ]);
};

const updateCells = () => {
  CONFIG.cells = CONFIG.cells.map(([x, y]) => {
    return [
      Math.random() > 1 - CONFIG.noise
        ? Math.floor(Math.random() * CONFIG.columns)
        : x,
      Math.random() > 1 - CONFIG.noise
        ? Math.floor(Math.random() * CONFIG.rows)
        : y,
    ];
  });
};

const draw = () => {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(gridCanvas, 0, 0, gridCanvas.width, gridCanvas.height);
  updateCells();
  for (let i = 0; i < CONFIG.cells.length; i++) {
    const [x, y] = CONFIG.cells[i];
    context.fillStyle = CONFIG.cell;
    context.fillRect(
      x * CONFIG.size + CONFIG.hOffset + CONFIG.border,
      y * CONFIG.size + CONFIG.vOffset + CONFIG.border,
      CONFIG.size - CONFIG.border * 2,
      CONFIG.size - CONFIG.border * 2
    );
  }
};

const refresh = () => {
  gsap.ticker.remove(draw);
  canvas.width = gridCanvas.width = window.innerWidth * DPR;
  canvas.height = gridCanvas.height = window.innerHeight * DPR;
  context.clearRect(0, 0, canvas.width, canvas.height);
  setGrid();
  draw();
  gsap.ticker.add(draw);
};

gsap.ticker.fps(CONFIG.fps);
const CanvasObserver = new ResizeObserver(() => refresh());
CanvasObserver.observe(canvas);

const radioButtons = document.querySelectorAll('input[name="theme"]');
radioButtons.forEach((radio) => {
  radio.addEventListener("change", function () {
    CONFIG.cell = this.value;
    localStorage.setItem("cell-color", this.value); // Store the selected color in localStorage
    draw();
  });
});

// ScrollTrigger animations
function hide(elem) {
  gsap.set(elem, { autoAlpha: 0 });
}

document.addEventListener("DOMContentLoaded", function () {
  gsap.registerPlugin(ScrollTrigger);

  gsap.utils.toArray(".gs_reveal").forEach(function (elem) {
    hide(elem);
    ScrollTrigger.create({
      trigger: elem,
      onEnter: function () {
        animateFrom(elem);
      },
      onEnterBack: function () {
        animateFrom(elem, -1);
      },
      onLeave: function () {
        hide(elem);
      },
    });
  });
});

function animateFrom(elem, direction) {
  direction = direction || 1;
  var x = 0,
    y = direction * 100;
  if (elem.classList.contains("gs_reveal_fromLeft")) {
    x = -100;
    y = 0;
  } else if (elem.classList.contains("gs_reveal_fromRight")) {
    x = 100;
    y = 0;
  }
  elem.style.transform = "translate(" + x + "px, " + y + "px)";
  elem.style.opacity = "0";
  gsap.fromTo(
    elem,
    { x: x, y: y, autoAlpha: 0 },
    {
      duration: 1.25,
      x: 0,
      y: 0,
      autoAlpha: 1,
      ease: "expo",
      overwrite: "auto",
    }
  );
}

// Spotlight effect
document.getElementById("cards").onmousemove = (e) => {
  for (const card of document.getElementsByClassName("card")) {
    const rect = card.getBoundingClientRect(),
      x = e.clientX - rect.left,
      y = e.clientY - rect.top;

    card.style.setProperty("--mouse-x", `${x}px`);
    card.style.setProperty("--mouse-y", `${y}px`);
  }
};

/* MOBILE */
function NewTabtwtm() {
  window.open("https://twitter.com/SantiHdzs", "_self");
}

function NewTabigm() {
  window.open("https://instagram.com/sanxti", "_self");
}

function NewTabgitm() {
  window.open("https://github.com/santihdzs", "_self");
}

function NewTabytm() {
  window.open("https://youtube.com/c/SantiHdzs", "_self");
}

function NewTabscm() {
  window.open(
    "https://www.snapchat.com/add/santihdzs?share_id=Eeg1tvp3SBaSz7kvjckZTg&locale=en_MX",
    "_self"
  );
}

function NewTabspm() {
  window.open(
    "https://open.spotify.com/user/santihs-mx?si=e8835d63503648f6",
    "_self"
  );
}

["card1", "card2", "card3", "card4", "card5", "card6", "card7"].forEach(
  (className) => {
    $(`.${className}`).click(function () {
      window.location = $(this).find("a").attr("href");
      return false;
    });
  }
);
