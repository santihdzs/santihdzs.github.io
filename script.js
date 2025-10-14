// ScrollTrigger animations
function hide(elem) {
  gsap.set(elem, {autoAlpha: 0});
}

document.addEventListener("DOMContentLoaded", function() {
  gsap.registerPlugin(ScrollTrigger);
  
  gsap.utils.toArray(".gs_reveal").forEach(function(elem) {
    hide(elem); // assure that the element is hidden when scrolled into view
    
    ScrollTrigger.create({
      trigger: elem,
      onEnter: function() { animateFrom(elem) }, 
      onEnterBack: function() { animateFrom(elem, -1) },
      onLeave: function() { hide(elem) } // assure that the element is hidden when scrolled into view
    });
  });
});

// ScrollTrigger animations
function animateFrom(elem, direction) {
  direction = direction || 1;
  var x = 0,
      y = direction * 100;
  if(elem.classList.contains("gs_reveal_fromLeft")) {
    x = -100;
    y = 0;
  } else if (elem.classList.contains("gs_reveal_fromRight")) {
    x = 100;
    y = 0;
  }
  elem.style.transform = "translate(" + x + "px, " + y + "px)";
  elem.style.opacity = "0";
  gsap.fromTo(elem, {x: x, y: y, autoAlpha: 0}, {
    duration: 1.25, 
    x: 0,
    y: 0, 
    autoAlpha: 1, 
    ease: "expo", 
    overwrite: "auto"
  });
}

// Spotlight effect
document.getElementById("cards").onmousemove = e => {
  for(const card of document.getElementsByClassName("card")) {
    const rect = card.getBoundingClientRect(),
          x = e.clientX - rect.left,
          y = e.clientY - rect.top;

    card.style.setProperty("--mouse-x", `${x}px`);
    card.style.setProperty("--mouse-y", `${y}px`);
  };
}

// Theme switcher
const root = document.querySelector(":root"),
      inputs = document.querySelectorAll("input[name='theme']");

const theme = localStorage.getItem("theme-color");

const updateRoot = value => root.style.setProperty("--theme-color", `var(--${value})`);

for(const input of inputs) {
  if(theme && input.value === theme) {
    input.checked = true;
    
    updateRoot(theme);
  }
  
  input.onchange = e => {
    updateRoot(e.target.value);
    
    localStorage.setItem("theme-color", e.target.value);
  }
}
/* MOBILE */
function NewTabigm() {
  window.open(
  "https://instagram.com/sanxti","_self");
}

function NewTabgitm() {
  window.open(
  "https://github.com/santihdzs","_self");
}

function NewTabytm() {
  window.open(
  "https://youtube.com/c/SantiHdzs","_self");
}

function NewTabscm() {
  window.open(
  "https://www.snapchat.com/add/santihdzs?share_id=Eeg1tvp3SBaSz7kvjckZTg&locale=en_MX","_self");
}

function NewTabspm() {
  window.open(
  "https://open.spotify.com/user/santihs-mx?si=e8835d63503648f6","_self");
}

$(".card1").click(function() {
  window.location = $(this).find("a").attr("href"); 
  return false;
});

$(".card2").click(function() {
  window.location = $(this).find("a").attr("href"); 
  return false;
});

$(".card3").click(function() {
  window.location = $(this).find("a").attr("href"); 
  return false;
});

$(".card4").click(function() {
  window.location = $(this).find("a").attr("href"); 
  return false;
});

$(".card5").click(function() {
  window.location = $(this).find("a").attr("href"); 
  return false;
});

$(".card6").click(function() {
  window.location = $(this).find("a").attr("href"); 
  return false;
});

$(".card7").click(function() {
  window.location = $(this).find("a").attr("href"); 
  return false;
});