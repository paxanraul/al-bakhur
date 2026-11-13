// The same Cycles turn sampled every five degrees. This path needs no video decoder or WebGL.
export function enableBottleViews(poster, mobile, entrance) {
  const viewer = document.querySelector('#bottle-views');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const image = new Image();
  let angle = 0;
  let drag = null;

  function layout() {
    const fit = Math.min(innerWidth / (mobile ? 1050 : 1200), innerHeight / 1400);
    viewer.style.left = `${innerWidth / 2 - 338 * fit}px`;
    viewer.style.top = `${innerHeight / 2 - 532 * fit}px`;
    viewer.style.width = `${744 * fit}px`;
    viewer.style.height = `${1100 * fit}px`;
  }

  function showAngle(next) {
    angle = ((next % 72) + 72) % 72;
    const column = angle % 8;
    const row = Math.floor(angle / 8);
    viewer.style.backgroundPosition = `${column * 100 / 7}% ${row * 100 / 8}%`;
    viewer.setAttribute('aria-valuenow', String(angle));
    viewer.setAttribute('aria-valuetext', `${angle * 5}°`);
  }

  image.addEventListener('load', async () => {
    await entrance?.catch(() => {});
    if (reduced.matches) return;
    viewer.style.backgroundImage = `url("${image.src}")`;
    layout();
    showAngle(0);
    poster.hidden = true;
    viewer.hidden = false;
  }, { once: true });
  image.src = new URL('./assets/turn-frames.webp', import.meta.url).href;

  addEventListener('resize', layout);
  reduced.addEventListener?.('change', ({matches}) => {
    if (matches) {
      viewer.hidden = true;
      poster.hidden = false;
    }
  });

  viewer.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, angle };
    viewer.setPointerCapture(event.pointerId);
  });
  viewer.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    const offset = Math.round((event.clientX - drag.x) * 72 / Math.max(320, innerWidth));
    showAngle(drag.angle + offset);
  });
  viewer.addEventListener('lostpointercapture', () => { drag = null; });
  viewer.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    showAngle(angle + (event.key === 'ArrowRight' ? 1 : -1));
  });
}
