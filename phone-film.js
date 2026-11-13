import { createPhoneTurn } from './phone-turn.js?v=1';

const FPS = 25;
const RISE_AT = 3300;
const RISE_DURATION = 2400;
const TURN_DURATION = 20000;
const VIEWS = 144;
const TILE_WIDTH = 280;
const RISE_HEIGHT = 464;
const TURN_HEIGHT = 414;

function loadFrames(file) {
  const image = new Image();
  image.src = new URL(file, import.meta.url).href;
  return image.decode().then(() => image).catch(() => null);
}

export function playPhoneFilm(poster, fallback, reduced) {
  const hero = poster.closest('main');
  const control = document.querySelector('#bottle-views');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return;
  canvas.width = TILE_WIDTH;
  canvas.height = RISE_HEIGHT;
  control.append(canvas);

  let riseFrames, turnFrames, turnRenderer, animation, resumeTimer, drag;
  let elapsed = 0;
  let waitingForRise = 0;
  let frameTime = null;
  let nextDraw = 0;
  let view = 0;
  let turning = false;
  let stopped = false;
  const wrap = value => ((value % VIEWS) + VIEWS) % VIEWS;

  function layout() {
    const fit = Math.min(hero.clientWidth / 1050, hero.clientHeight / 1400);
    Object.assign(control.style, {
      left: `${hero.clientWidth / 2 - 338 * fit}px`,
      top: `${hero.clientHeight / 2 - 532 * fit}px`,
      width: `${744 * fit}px`,
      height: `${(turning ? 1100 : 1232) * fit}px`,
    });
  }

  function tile(sheet, index, height) {
    const x = (index % 8) * TILE_WIDTH;
    const y = Math.floor(index / 8) * height;
    context.drawImage(sheet, x, y, TILE_WIDTH, height, 0, 0, TILE_WIDTH, height);
  }

  function drawRise(index) {
    context.clearRect(0, 0, TILE_WIDTH, RISE_HEIGHT);
    tile(riseFrames, index, RISE_HEIGHT);
  }

  function drawTurn(position) {
    const wrapped = wrap(position);
    const first = Math.floor(wrapped);
    const mix = wrapped - first;
    const next = (first + 1) % VIEWS;
    if (turnRenderer) {
      turnRenderer.draw(first, next, mix);
      return;
    }
    context.clearRect(0, 0, TILE_WIDTH, TURN_HEIGHT);
    context.globalAlpha = 1 - mix;
    tile(turnFrames[first % 2], Math.floor(first / 2), TURN_HEIGHT);
    if (mix > 0) {
      context.globalCompositeOperation = 'lighter';
      context.globalAlpha = mix;
      tile(turnFrames[next % 2], Math.floor(next / 2), TURN_HEIGHT);
    }
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
  }

  function announceAngle() {
    const degrees = Math.round(wrap(view) * 360 / VIEWS) % 360;
    control.setAttribute('aria-valuenow', String(degrees));
    control.setAttribute('aria-valuetext', `${degrees}°`);
  }

  function stopFrames() {
    cancelAnimationFrame(animation);
    animation = 0;
    frameTime = null;
  }

  function schedule() {
    if (!animation && !stopped && !document.hidden && !drag && !resumeTimer) {
      animation = requestAnimationFrame(tick);
    }
  }

  function startTurn() {
    turning = true;
    riseFrames = null;
    if (turnRenderer) control.replaceChildren(turnRenderer.canvas);
    else canvas.height = TURN_HEIGHT;
    control.tabIndex = 0;
    control.setAttribute('aria-valuemax', '359');
    control.setAttribute('aria-disabled', 'false');
    hero.dataset.phoneStage = 'turn';
    layout();
    drawTurn(0);
    announceAngle();
  }

  function showPoster() {
    control.hidden = true;
    poster.hidden = false;
    delete hero.dataset.phoneStage;
  }

  function tick(now) {
    animation = 0;
    if (stopped || document.hidden) return;
    const delta = frameTime === null ? 0 : now - frameTime;
    frameTime = now;
    if (turning) {
      view = wrap(view + delta * VIEWS / TURN_DURATION);
      if (turnRenderer || now >= nextDraw) {
        drawTurn(view);
        nextDraw = Math.max(nextDraw + 1000 / FPS, now + 1000 / FPS / 2);
      }
    } else {
      elapsed += delta;
      if (elapsed >= RISE_AT + RISE_DURATION) {
        if (turnFrames && riseFrames && !control.hidden) startTurn();
        else if (elapsed >= RISE_AT + RISE_DURATION + 3000) {
          stopped = true;
          showPoster();
        }
      } else if (elapsed >= RISE_AT) {
        if (!riseFrames) {
          elapsed = RISE_AT;
          waitingForRise += delta;
          if (waitingForRise >= 1500) {
            stopped = true;
            showPoster();
          }
          schedule();
          return;
        }
        if (control.hidden) {
          layout();
          control.hidden = false;
          hero.dataset.phoneStage = 'rise';
        }
        if (now >= nextDraw) {
          // The asset retains all 60 original Cycles frames.
          drawRise(Math.min(59, Math.floor((elapsed - RISE_AT) * FPS / 1000)));
          nextDraw = Math.max(nextDraw + 1000 / FPS, now + 1000 / FPS / 2);
        }
      }
    }
    schedule();
  }

  function deferResume() {
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      resumeTimer = 0;
      schedule();
    }, 2000);
  }

  control.addEventListener('pointerdown', event => {
    if (stopped || !turning || !event.isPrimary || event.button !== 0) return;
    clearTimeout(resumeTimer);
    resumeTimer = 0;
    stopFrames();
    drag = { id: event.pointerId, x: event.clientX, view };
    control.setPointerCapture(event.pointerId);
  });
  control.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    view = wrap(drag.view + (event.clientX - drag.x) * VIEWS / Math.max(320, innerWidth));
    drawTurn(view);
  });
  control.addEventListener('lostpointercapture', () => {
    if (!drag) return;
    drag = null;
    announceAngle();
    deferResume();
  });
  control.addEventListener('keydown', event => {
    if (stopped || !turning || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    stopFrames();
    view = wrap(view + (event.key === 'ArrowRight' ? 2 : -2));
    drawTurn(view);
    announceAngle();
    deferResume();
  });
  addEventListener('resize', layout);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (drag) {
        const id = drag.id;
        drag = null;
        if (control.hasPointerCapture(id)) control.releasePointerCapture(id);
      }
      stopFrames();
    } else schedule();
  });
  reduced.addEventListener?.('change', ({ matches }) => {
    if (!matches) return;
    stopped = true;
    stopFrames();
    showPoster();
  });

  hero.dataset.phoneStage = 'title';
  poster.hidden = true;
  control.tabIndex = -1;
  control.setAttribute('aria-disabled', 'true');
  loadFrames('./assets/rise-frames.webp').then(image => {
    if (!image && !stopped) {
      stopped = true;
      stopFrames();
      showPoster();
      canvas.remove();
      control.removeAttribute('aria-disabled');
      control.tabIndex = 0;
      fallback();
      return;
    }
    riseFrames = image;
  });
  Promise.all([
    loadFrames('./assets/turn-frames.webp'),
    loadFrames('./assets/turn-frames-between.webp'),
  ]).then(images => {
    if (!images.every(Boolean) || stopped) return;
    turnFrames = images;
    try {
      turnRenderer = createPhoneTurn(images, TILE_WIDTH, TURN_HEIGHT);
    } catch {
      // Keep the image viewer operational on phones without WebGL.
      turnRenderer = null;
    }
    turnRenderer?.canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      turnRenderer = null;
      if (!turning || stopped) return;
      canvas.height = TURN_HEIGHT;
      control.replaceChildren(canvas);
      drawTurn(view);
    });
  });
  schedule();
}
