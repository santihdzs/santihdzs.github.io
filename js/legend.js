import { slotColor } from './palette.js';
import { setAccent, DEFAULT_ACCENT } from './accent.js';

// the stoplight: one dot per language. hover or focus previews the stars, click pins,
// escape clears. only a pin moves the interface accent, previews never do.
export function createLegend({ data, scene, reduced }) {
  const root = document.querySelector('.legend');
  const total = data.commits.length;
  const langs = data.languages.filter((l) => l.count > 0);
  if (!root || !langs.length) return { dispose() {} };

  const label = document.createElement('span');
  label.className = 'legend-label';
  label.setAttribute('aria-hidden', 'true');

  const makeButton = (lang) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = lang ? 'legend-dot' : 'legend-dot legend-all';
    b.dataset.lang = lang ? String(lang.index) : '';
    b.setAttribute('aria-pressed', lang ? 'false' : 'true');
    b.setAttribute('aria-label', lang ? `${lang.name}, ${lang.count} commits` : `all languages, ${total} commits`);
    if (lang) b.style.setProperty('--c', slotColor(lang.slot));
    b.innerHTML = '<span class="dot"></span>';
    return b;
  };

  const all = makeButton(null);
  const buttons = langs.map(makeButton);
  root.replaceChildren(all, ...buttons, label);
  root.hidden = false;

  let pinned = null;
  let hovered = null;
  let focused = null;

  const byIndex = (i) => langs.find((l) => l.index === i);

  function render() {
    const active = hovered ?? focused ?? pinned;
    // previews only light the stars; browsing follows the pin alone
    scene.setLanguageFocus(active === 'all' ? null : active, pinned);
    const lit = active === 'all' ? null : active;
    root.classList.toggle('is-filtering', lit !== null);
    for (const b of buttons) b.classList.toggle('is-lit', Number(b.dataset.lang) === lit);

    if (active === null) {
      label.classList.remove('is-visible');
    } else {
      const lang = active === 'all' ? null : byIndex(active);
      label.innerHTML = '';
      const name = document.createElement('b');
      name.textContent = lang ? lang.name : 'all';
      label.append(name, ` ${lang ? lang.count : total}`);
      label.classList.add('is-visible');
    }
  }

  function pin(index) {
    if (index !== pinned) {
      const lang = index === null ? null : byIndex(index);
      setAccent(lang ? slotColor(lang.slot) : DEFAULT_ACCENT, { instant: reduced.matches });
    }
    pinned = index;
    all.setAttribute('aria-pressed', String(pinned === null));
    for (const b of buttons) b.setAttribute('aria-pressed', String(Number(b.dataset.lang) === pinned));
    render();
  }

  const keyOf = (b) => (b === all ? 'all' : Number(b.dataset.lang));

  function onEnter(e) {
    hovered = keyOf(e.currentTarget);
    render();
  }
  function onLeave() {
    hovered = null;
    render();
  }
  function onFocus(e) {
    // only keyboard focus previews, a mouse click should not leave a sticky highlight
    if (e.currentTarget.matches(':focus-visible')) {
      focused = keyOf(e.currentTarget);
      render();
    }
  }
  function onBlur() {
    focused = null;
    render();
  }
  function onClick(e) {
    const key = keyOf(e.currentTarget);
    pin(key === 'all' || key === pinned ? null : key);
  }
  function onKey(e) {
    if (e.key === 'Escape' && pinned !== null && !e.defaultPrevented) {
      e.preventDefault();
      pin(null);
    }
  }

  for (const b of [all, ...buttons]) {
    b.addEventListener('pointerenter', onEnter);
    b.addEventListener('pointerleave', onLeave);
    b.addEventListener('focus', onFocus);
    b.addEventListener('blur', onBlur);
    b.addEventListener('click', onClick);
  }
  document.addEventListener('keydown', onKey);

  return {
    dispose() {
      document.removeEventListener('keydown', onKey);
      scene.setLanguageFocus(null);
      setAccent(DEFAULT_ACCENT, { instant: true });
      root.replaceChildren();
      root.hidden = true;
    },
  };
}
