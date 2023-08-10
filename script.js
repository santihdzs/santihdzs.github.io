// Small title animation
  $(function() {
    var text = $(".text");
    $(window).scroll(function() {
      var scroll = $(window).scrollTop();
  
      if (scroll >= 150) {
        text.removeClass("hidden");
      } else {
        text.addClass("hidden");
      }
    });
  });

// SVG path animation (project previews)
var items = []
, point = document.querySelector('svg').createSVGPoint();

function getCoordinates(e, svg) {
point.x = e.clientX;
point.y = e.clientY;
return point.matrixTransform(svg.getScreenCTM().inverse());
}

function changeColor(e) {
document.body.className = e.currentTarget.className;
}

function Item(config) {
Object.keys(config).forEach(function (item) {
  this[item] = config[item];
}, this);
this.el.addEventListener('mousemove', this.mouseMoveHandler.bind(this));
this.el.addEventListener('touchmove', this.touchMoveHandler.bind(this));
}

Item.prototype = {
update: function update(c) {
  this.clip.setAttribute('cx', c.x);
  this.clip.setAttribute('cy', c.y);
},
mouseMoveHandler: function mouseMoveHandler(e) {
  this.update(getCoordinates(e, this.svg));
},
touchMoveHandler: function touchMoveHandler(e) {
  e.preventDefault();
  var touch = e.targetTouches[0];
  if (touch) return this.update(getCoordinates(touch, this.svg));
}
};

[].slice.call(document.querySelectorAll('.item'), 0).forEach(function (item, index) {
items.push(new Item({
  el: item,
  svg: item.querySelector('svg'),
  clip: document.querySelector('#clip-'+index+' circle'),
}));
});

[].slice.call(document.querySelectorAll('button'), 0).forEach(function (button) {
button.addEventListener('click', changeColor);
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
function NewTabtwtm() {
  window.open(
  "https://twitter.com/SantiHdzs","_self");
}

function NewTabigm() {
  window.open(
  "https://instagram.com/santi.hdzs/","_self");
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

