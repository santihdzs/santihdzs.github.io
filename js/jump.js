// text mode number keys: 0 is the top of the page, 1 to 5 the sections by the numbers in their labels ("01 / about").
// the numbers are read from the page, so the keys follow its sections as they change
const INTERACTIVE = [
  'a[href]', 'button', 'input', 'select', 'textarea', 'summary', 'iframe', 'audio[controls]', 'video[controls]',
  '[contenteditable]:not([contenteditable="false"])', '[tabindex]:not([tabindex="-1"])',
  '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="switch"]', '[role="tab"]', '[role="menuitem"]',
  '[role="option"]', '[role="slider"]', '[role="spinbutton"]', '[role="textbox"]', '[role="combobox"]', '[role="dialog"]',
].join(', ');

// busy says whether something else owns the page right now: stars mode, a peek or card, a mode transition, a launch
export function initJump({ reduced, busy }) {
  const root = document.documentElement;

  function sectionFor(n) {
    const sections = [...document.querySelectorAll('main .section')];
    return sections.find((s) => Number.parseInt(s.querySelector('.rail-n')?.textContent ?? '', 10) === n) ?? null;
  }

  // where the section's label rests: the top of the section's content box (a pinned sticky label would mislead a
  // measure of the label itself), less the label's scroll margin, which clears the top bar and the safe area
  function landing(section) {
    const box = getComputedStyle(section);
    const label = section.querySelector('.rail') ?? section;
    const margin = Number.parseFloat(getComputedStyle(label).scrollMarginTop) || 0;
    const top = section.getBoundingClientRect().top + window.scrollY + Number.parseFloat(box.borderTopWidth) + Number.parseFloat(box.paddingTop);
    return top - margin;
  }

  // a section is focusable only while it holds focus, so clicks on its text never land on it
  function land(el) {
    if (!el.hasAttribute('tabindex')) {
      el.tabIndex = -1;
      el.addEventListener('blur', () => el.removeAttribute('tabindex'), { once: true });
    }
    el.focus({ preventScroll: true });
  }

  function onKey(e) {
    if (e.defaultPrevented || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (!/^[0-5]$/.test(e.key)) return;
    if (root.classList.contains('is-stars') || root.classList.contains('is-peek') || busy()) return;
    const at = document.activeElement;
    if (at && at !== document.body && (at.isContentEditable || at.closest(INTERACTIVE))) return;
    const n = Number(e.key);
    const target = n === 0 ? document.querySelector('main') : sectionFor(n);
    if (!target) return;
    e.preventDefault();
    const scroller = document.scrollingElement ?? root;
    const max = Math.max(0, scroller.scrollHeight - window.innerHeight);
    const top = Math.round(Math.min(max, Math.max(0, n === 0 ? 0 : landing(target))));
    // smooth scrolls retarget from wherever they are; the place already in view stays put
    if (Math.abs(top - window.scrollY) >= 1) window.scrollTo({ top, behavior: reduced.matches ? 'instant' : 'smooth' });
    land(target);
  }

  document.addEventListener('keydown', onKey);
  return {
    dispose() {
      document.removeEventListener('keydown', onKey);
    },
  };
}
