import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// hidden state is applied here, never in css, so the page is complete without js.
// anything already on screen at init is left alone to avoid a flash.
export function initReveal({ reduced }) {
  const fold = window.innerHeight * 0.92;
  const onScreen = (el) => el.getBoundingClientRect().top < fold;

  const reveal = (targets, from, stagger = 0) => {
    const list = gsap.utils.toArray(targets).filter((el) => !onScreen(el));
    if (!list.length) return;
    gsap.set(list, reduced.matches ? { opacity: 0 } : { opacity: 0, ...from });
    ScrollTrigger.batch(list, {
      start: 'top 90%',
      once: true,
      // read live: the setting can change after the page loads
      onEnter: (batch) => {
        const still = reduced.matches;
        gsap.to(batch, {
          opacity: 1,
          x: 0,
          y: 0,
          duration: still ? 0.2 : 0.9,
          ease: 'power3.out',
          stagger: still ? 0 : stagger,
          overwrite: true,
        });
      },
    });
  };

  reveal('[data-reveal="rail"]', { x: -16 });
  reveal('[data-reveal]:not([data-reveal="rail"])', { y: 24 });
  for (const group of document.querySelectorAll('[data-reveal-group]')) {
    reveal(group.children, { y: 24 }, 0.07);
  }
}
