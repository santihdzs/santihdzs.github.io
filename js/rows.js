// cursor following glow inside list rows
export function initRows() {
  for (const row of document.querySelectorAll('.row')) {
    row.addEventListener('pointermove', (e) => {
      const r = row.getBoundingClientRect();
      row.style.setProperty('--mx', `${e.clientX - r.left}px`);
      row.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  }
}
