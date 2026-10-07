// adaptive resolution: if the average frame over a window of 60 runs slower than
// 20ms, step the pixel ratio down toward 1. it never steps back up in a session,
// though moving to a screen with a lower device ratio still lowers it.
export function createPerf({ maxDpr = 2, onChange }) {
  let ceiling = maxDpr;
  let device = window.devicePixelRatio || 1;
  let dpr = Math.min(device, ceiling);
  let last = 0;
  let total = 0;
  let count = 0;

  return {
    get dpr() {
      return dpr;
    },
    setDevice(ratio) {
      device = ratio || 1;
      const next = Math.min(device, ceiling);
      if (next !== dpr) {
        dpr = next;
        onChange(dpr);
      }
    },
    frame(now) {
      const dt = now - last;
      last = now;
      // long gaps are pauses, not slow frames
      if (dt <= 0 || dt > 250) return;
      total += dt;
      count++;
      if (count < 60) return;
      const avg = total / count;
      total = 0;
      count = 0;
      if (avg > 20 && dpr > 1) {
        ceiling = Math.max(1, dpr - 0.5);
        dpr = ceiling;
        onChange(dpr, avg);
      }
    },
    reset() {
      last = 0;
      total = 0;
      count = 0;
    },
  };
}
