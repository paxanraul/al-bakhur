// Native playback composites alpha directly. Keep the frame viewer ready for manual rotation.
export function createPhoneVideo(control, onPlaying, onUnavailable) {
  const video = document.createElement('video');
  const appleMobile = /iPhone|iPod|iPad/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const safari = /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|Firefox/.test(navigator.userAgent);
  video.className = 'phone-turn-video';
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute('webkit-playsinline', '');
  video.setAttribute('aria-hidden', 'true');
  video.disablePictureInPicture = true;
  video.loop = true;
  video.preload = 'auto';
  video.src = new URL(appleMobile || safari ? './assets/turn-inline.mov' : './assets/turn-inline.webm', import.meta.url).href;

  let pending = false;
  let timer;
  function pause() {
    pending = false;
    clearTimeout(timer);
    video.pause();
    video.classList.remove('is-playing');
  }

  function fail() {
    const time = video.currentTime;
    pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
    onUnavailable(time);
  }

  function reveal() {
    if (!pending || video.seeking || video.paused || video.readyState < 2) return;
    pending = false;
    clearTimeout(timer);
    video.classList.add('is-playing');
    onPlaying();
  }

  function play(time) {
    pending = true;
    clearTimeout(timer);
    timer = setTimeout(fail, 2200);
    video.currentTime = time;
    video.play().catch(error => {
      if (pending && error.name !== 'AbortError') fail();
    });
  }

  video.addEventListener('playing', reveal);
  video.addEventListener('seeked', reveal);
  video.addEventListener('waiting', () => {
    if (!video.classList.contains('is-playing')) return;
    clearTimeout(timer);
    timer = setTimeout(fail, 1800);
  });
  video.addEventListener('timeupdate', () => {
    if (video.classList.contains('is-playing') && video.readyState >= 3) clearTimeout(timer);
  });
  video.addEventListener('error', () => { if (video.hasAttribute('src')) fail(); });
  control.prepend(video);
  return { video, play, pause };
}
