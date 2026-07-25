export function runCountdown(el: HTMLElement, startAtMs: number, onGo: () => void): void {
  el.classList.add("countdown--active");
  const tick = () => {
    const remaining = startAtMs - Date.now();
    if (remaining <= 0) {
      el.textContent = "GO!";
      setTimeout(() => {
        el.classList.remove("countdown--active");
        el.textContent = "";
        onGo();
      }, 400);
      return;
    }
    el.textContent = String(Math.ceil(remaining / 1000));
    requestAnimationFrame(tick);
  };
  tick();
}
