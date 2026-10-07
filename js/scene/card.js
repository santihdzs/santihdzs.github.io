import { gsap } from 'gsap';
import { slotColor, hexToRgb } from '../palette.js';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const SVG = 'http://www.w3.org/2000/svg';
const MAX_TILT = 3;

export function formatDate(ts) {
  const d = new Date(ts * 1000);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatMonth(ts) {
  const d = new Date(ts * 1000);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const isoDate = (iso) => formatDate(Date.parse(iso) / 1000);

// one card, two variants: data-c parts belong to commits, data-p parts to pull requests
const TEMPLATE = `
  <div class="card-in">
    <div class="card-body">
      <div class="card-layer card-head">
        <span class="lang-chip" data-c><span class="lang-dot"></span><span data-f="lang"></span></span>
        <span class="org" data-p aria-hidden="true"><img class="org-logo" alt="" width="28" height="28" decoding="async"><span class="org-mono"></span></span>
        <span class="card-repo" data-f="repo"></span>
        <button class="card-close" type="button" aria-label="close">
          <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="card-layer card-main">
        <p class="card-date"><span class="merged-chip" data-f="chip">merged</span><span data-f="date"></span></p>
        <h2 class="card-msg" id="card-msg"><span data-f="msg"></span><span class="pr-num" data-p data-f="num"></span></h2>
      </div>
      <div class="card-layer card-stats">
        <p class="card-diff">
          <span class="add" data-f="add"></span>
          <span class="del" data-f="del"></span>
          <span class="diff-bar" aria-hidden="true"><i class="diff-add"></i><i class="diff-del"></i></span>
          <span class="card-files" data-f="files"></span>
        </p>
        <p class="card-ids" data-c>
          <button class="hash-chip" type="button" data-f="hash"></button>
          <span data-f="count"></span>
          <span data-f="pos"></span>
        </p>
      </div>
      <div class="card-layer card-nav">
        <button class="card-step" type="button" data-c data-step="-1" aria-label="previous commit in this repo">&lsaquo; prev</button>
        <button class="card-step" type="button" data-c data-step="1" aria-label="next commit in this repo">next &rsaquo;</button>
        <a class="tlink" data-f="link" target="_blank" rel="noopener"><span data-f="linkText"></span><svg class="i" aria-hidden="true" focusable="false"><use href="#i-arrow"/></svg></a>
      </div>
    </div>
  </div>`;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

export function createCard({ data, reduced, owner, onClose, onStep }) {
  const el = document.createElement('section');
  el.className = 'card';
  el.hidden = true;
  el.tabIndex = -1;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'card-msg');
  el.innerHTML = TEMPLATE;

  const tether = document.createElementNS(SVG, 'svg');
  tether.setAttribute('class', 'card-tether');
  tether.setAttribute('aria-hidden', 'true');
  tether.innerHTML = '<line></line><circle r="2.25"></circle>';
  const line = tether.querySelector('line');
  const node = tether.querySelector('circle');

  const pulse = document.createElement('div');
  pulse.className = 'focus-pulse';
  pulse.setAttribute('aria-hidden', 'true');

  const live = document.createElement('div');
  live.className = 'sr-only';
  live.setAttribute('aria-live', 'polite');
  document.body.append(tether, pulse, el, live);

  const cardIn = el.querySelector('.card-in');
  const body = el.querySelector('.card-body');
  const layers = [...el.querySelectorAll('.card-layer')];
  const commitOnly = [...el.querySelectorAll('[data-c]')];
  const prOnly = [...el.querySelectorAll('[data-p]')];
  const f = Object.fromEntries([...el.querySelectorAll('[data-f]')].map((n) => [n.dataset.f, n]));
  const [prev, next] = el.querySelectorAll('.card-step');
  const diffAdd = el.querySelector('.diff-add');
  const diffDel = el.querySelector('.diff-del');
  const logo = el.querySelector('.org-logo');
  const mono = el.querySelector('.org-mono');
  const close = el.querySelector('.card-close');

  const pos = { x: 0, y: 0 };
  const tilt = { x: 0, y: 0 };
  let open = false;
  let kind = 'commit';
  let entryKey = null;
  let returnTo = null;
  let side = 'right';
  let width = 0;
  let height = 0;
  let snap = true;
  let copyTimer = 0;
  let sha = '';

  function setKind(k) {
    kind = k;
    el.classList.toggle('is-pr', k === 'pr');
    for (const n of commitOnly) n.hidden = k !== 'commit';
    for (const n of prOnly) n.hidden = k !== 'pr';
  }

  function setDiff(additions, deletions, files) {
    f.add.textContent = additions == null ? '' : `+${additions}`;
    f.del.textContent = deletions == null ? '' : `-${deletions}`;
    const churn = (additions ?? 0) + (deletions ?? 0) || 1;
    diffAdd.style.flexGrow = String((additions ?? 0) / churn);
    diffDel.style.flexGrow = String((deletions ?? 0) / churn);
    f.files.textContent = files == null ? '' : `${files} ${files === 1 ? 'file' : 'files'}`;
  }

  function fillCommit({ index, nav }) {
    const c = data.commits[index];
    const repo = data.repos[c.repo];
    const lang = data.languages[c.lang];
    const color = slotColor(lang.slot);
    const langName = repo.primary ?? lang.name;
    sha = c.sha;
    el.style.setProperty('--lang', color);
    el.style.setProperty('--lang-rgb', hexToRgb(color).map((v) => Math.round(v * 255)).join(' '));
    close.setAttribute('aria-label', 'close commit');
    f.repo.textContent = repo.name;
    f.lang.textContent = langName;
    f.chip.hidden = true;
    f.date.textContent = formatDate(c.ts);
    f.msg.textContent = c.message || '(no message)';
    setDiff(c.additions, c.deletions, c.files);
    clearTimeout(copyTimer);
    f.hash.classList.remove('is-copied');
    f.hash.textContent = c.sha.slice(0, 7);
    f.hash.setAttribute('aria-label', `copy full commit hash, ${c.sha.slice(0, 7)}`);
    f.count.textContent = `${nav.index} of ${nav.total}`;
    f.pos.textContent = `${nav.repoIndex} of ${nav.repoTotal} in this repo`;
    f.link.href = `https://github.com/${owner}/${encodeURIComponent(repo.name)}/commit/${c.sha}`;
    f.linkText.textContent = 'view on github';
    prev.disabled = !nav.canPrev;
    next.disabled = !nav.canNext;
    const files = c.files == null ? '' : `, ${c.files} ${c.files === 1 ? 'file' : 'files'} changed`;
    live.textContent = `${c.message}. ${repo.name}, ${formatDate(c.ts)}. ${c.additions} additions, ${c.deletions} deletions${files}. ${langName}. commit ${nav.index} of ${nav.total}.`;
  }

  function fillPr({ pr }) {
    const slug = `${pr.owner}/${pr.repo}`;
    close.setAttribute('aria-label', 'close pull request');
    f.repo.textContent = slug;
    mono.textContent = pr.owner.slice(0, 1).toUpperCase();
    el.classList.remove('has-logo');
    if (pr.logo) {
      logo.onload = () => el.classList.add('has-logo');
      logo.onerror = () => el.classList.remove('has-logo');
      logo.src = pr.logo;
      if (logo.complete && logo.naturalWidth) el.classList.add('has-logo');
    } else {
      logo.removeAttribute('src');
    }
    f.chip.hidden = !pr.merged;
    f.date.textContent = pr.merged ? isoDate(pr.mergedAt) : `opened ${isoDate(pr.createdAt)}`;
    f.msg.textContent = pr.title;
    f.num.textContent = ` #${pr.number}`;
    setDiff(pr.additions, pr.deletions, pr.files);
    f.link.href = pr.url;
    f.linkText.textContent = 'view pull request on github';
    const state = pr.merged ? `merged ${isoDate(pr.mergedAt)}` : `open since ${isoDate(pr.createdAt)}`;
    live.textContent = `pull request to ${slug}: ${pr.title}, number ${pr.number}. ${state}.`;
  }

  function fill(entry) {
    setKind(entry.kind);
    if (entry.kind === 'pr') fillPr(entry);
    else fillCommit(entry);
    height = 0;
  }

  function focusables() {
    return [...el.querySelectorAll('button:not(:disabled), a[href]')].filter((n) => !n.closest('[hidden]'));
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      if (kind === 'commit') onStep('all', e.key === 'ArrowRight' ? 1 : -1);
    } else if (e.key === 'Tab') {
      const list = focusables();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  // keep focus inside while open
  function onFocusIn(e) {
    if (open && !el.contains(e.target)) el.focus({ preventScroll: true });
  }

  async function onCopy() {
    const ok = await copyText(sha);
    f.hash.textContent = ok ? 'copied' : 'copy failed';
    f.hash.classList.toggle('is-copied', ok);
    live.textContent = ok ? 'full commit hash copied' : 'could not copy the commit hash';
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      f.hash.textContent = sha.slice(0, 7);
      f.hash.classList.remove('is-copied');
    }, 1400);
  }

  el.addEventListener('keydown', onKey);
  close.addEventListener('click', () => onClose());
  prev.addEventListener('click', () => onStep('repo', -1));
  next.addEventListener('click', () => onStep('repo', 1));
  f.hash.addEventListener('click', onCopy);
  document.addEventListener('focusin', onFocusIn);

  function setVisible(on) {
    tether.classList.toggle('is-visible', on);
    pulse.classList.toggle('is-visible', on);
    tether.classList.toggle('is-pr', kind === 'pr');
    pulse.classList.toggle('is-pr', kind === 'pr');
  }

  const keyOf = (entry) => (entry.kind === 'pr' ? `pr:${entry.pr.url}` : `commit:${entry.index}`);

  return {
    get index() {
      return open && kind === 'commit' ? Number(entryKey.slice(7)) : -1;
    },
    get isOpen() {
      return open;
    },
    get kind() {
      return kind;
    },
    // entry is { kind: 'commit', index, nav } or { kind: 'pr', pr }
    show(entry, opener) {
      const rm = reduced.matches;
      const key = keyOf(entry);
      if (open) {
        entryKey = key;
        // a new star: crossfade the text instead of snapping
        if (rm) {
          fill(entry);
          gsap.set(layers, { opacity: 1 });
          return;
        }
        gsap.to(layers, {
          opacity: 0,
          duration: 0.09,
          ease: 'power1.in',
          overwrite: true,
          onComplete: () => {
            if (entryKey !== key) return;
            fill(entry);
            gsap.to(layers, { opacity: 1, duration: 0.09, ease: 'power1.out' });
          },
        });
        return;
      }
      fill(entry);
      entryKey = key;
      open = true;
      snap = true;
      returnTo = opener ?? document.activeElement;
      gsap.killTweensOf([cardIn, ...layers]);
      el.hidden = false;
      setVisible(true);
      // the gold edge sweeps once as a pull request card opens
      el.classList.remove('is-shimmering');
      if (kind === 'pr' && !rm) {
        void el.offsetWidth;
        el.classList.add('is-shimmering');
      }
      if (rm) {
        gsap.set(cardIn, { opacity: 1, y: 0, scale: 1 });
        gsap.set(layers, { opacity: 1, y: 0 });
      } else {
        gsap.fromTo(cardIn, { opacity: 0, y: 10, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: 'power3.out' });
        gsap.fromTo(layers, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out', stagger: 0.04, delay: 0.04 });
      }
      el.focus({ preventScroll: true });
    },
    setMoving(on) {
      gsap.to(layers, { opacity: on ? 0.35 : 1, duration: reduced.matches ? 0 : 0.2, overwrite: true });
    },
    // returns the element that should get focus back, so a caller can restore it later
    hide() {
      if (!open) return null;
      open = false;
      const hadFocus = el.contains(document.activeElement);
      const back = returnTo;
      entryKey = null;
      live.textContent = '';
      setVisible(false);
      gsap.killTweensOf([cardIn, ...layers]);
      if (reduced.matches) el.hidden = true;
      else
        gsap.to(cardIn, {
          opacity: 0,
          y: 6,
          scale: 0.985,
          duration: 0.22,
          ease: 'power2.in',
          onComplete: () => {
            if (!open) el.hidden = true;
          },
        });
      if (hadFocus && back && back !== document.body && document.contains(back) && !back.closest('[inert]')) {
        back.focus({ preventScroll: true });
      } else if (hadFocus) {
        document.activeElement?.blur?.();
      }
      returnTo = null;
      return back;
    },
    // called every frame with the focused target's client position and displayed disc
    frame(dt, target, view, pointer) {
      if (!open || !target) return;
      const rm = reduced.matches;
      const r = target.size / 2;
      const gap = r + 30;
      const margin = 16;
      const top = view.top + 84;
      const bottom = view.top + view.h - 92;
      const w = Math.round(Math.min(352, Math.max(232, view.w / 2 - gap - margin)));
      if (w !== width) {
        width = w;
        el.style.width = `${w}px`;
        height = 0;
      }
      if (!height) height = el.offsetHeight;

      // stay on the current side while it fits, flip when the other side has more room
      const roomRight = view.left + view.w - margin - (target.x + gap);
      const roomLeft = target.x - gap - (view.left + margin);
      if (side === 'right' && roomRight < width && roomLeft > roomRight) side = 'left';
      else if (side === 'left' && roomLeft < width && roomRight > roomLeft) side = 'right';
      const tx = clamp(side === 'right' ? target.x + gap : target.x - gap - width, view.left + margin, view.left + view.w - margin - width);
      const ty = clamp(target.y - height / 2, top, Math.max(top, bottom - height));
      const k = rm || snap ? 1 : 1 - Math.exp(-dt * 7);
      snap = false;
      pos.x += (tx - pos.x) * k;
      pos.y += (ty - pos.y) * k;
      el.style.transform = `translate3d(${pos.x.toFixed(2)}px, ${pos.y.toFixed(2)}px, 0)`;

      // hairline from the target's edge to the nearest card edge
      const ax = side === 'right' ? pos.x : pos.x + width;
      const ay = clamp(target.y, pos.y + 24, pos.y + height - 24);
      const angle = Math.atan2(ay - target.y, ax - target.x);
      const sx = target.x + Math.cos(angle) * (r + 6);
      const sy = target.y + Math.sin(angle) * (r + 6);
      line.setAttribute('x1', sx.toFixed(1));
      line.setAttribute('y1', sy.toFixed(1));
      line.setAttribute('x2', ax.toFixed(1));
      line.setAttribute('y2', ay.toFixed(1));
      node.setAttribute('cx', sx.toFixed(1));
      node.setAttribute('cy', sy.toFixed(1));
      pulse.style.setProperty('--s', `${Math.round(target.size + 18)}px`);
      pulse.style.transform = `translate(${target.x.toFixed(1)}px, ${target.y.toFixed(1)}px)`;

      // the whole card tilts toward the pointer; its text moves with it, never on its own.
      // hold still over controls so they stay easy to hit.
      const overControl = pointer.target instanceof Element && pointer.target.closest('.card button, .card a');
      let gx = 0;
      let gy = 0;
      if (!rm && !overControl && pointer.x >= 0) {
        gy = clamp((pointer.x - (pos.x + width / 2)) / (width / 2), -1, 1);
        gx = clamp((pointer.y - (pos.y + height / 2)) / (height / 2), -1, 1);
      }
      const kt = rm ? 1 : 1 - Math.exp(-dt * 5);
      tilt.x += (gx - tilt.x) * kt;
      tilt.y += (gy - tilt.y) * kt;
      body.style.transform = rm ? '' : `perspective(900px) rotateX(${(-tilt.x * MAX_TILT).toFixed(3)}deg) rotateY(${(tilt.y * MAX_TILT).toFixed(3)}deg)`;
    },
    dispose() {
      clearTimeout(copyTimer);
      gsap.killTweensOf([cardIn, ...layers]);
      document.removeEventListener('focusin', onFocusIn);
      el.remove();
      tether.remove();
      pulse.remove();
      live.remove();
    },
  };
}
