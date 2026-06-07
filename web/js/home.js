// =====================================================
// HOME — landing screen logic.
// Manages the #home-view / #design-view toggle and the
// cross-fading hero background.
// =====================================================
import { openProjectOptions } from './options.js';

// ---------------------------------------------------------------------------
// HERO MEDIA CONFIG — optional full-bleed media layer behind the home view.
// Each entry: { type: 'video'|'image', src: 'path/to/file' }
// Empty by default; the CSS grid background is used instead.
// To add footage: push entries here. No other changes needed.
// TODO: add real footage/imagery here when available.
// ---------------------------------------------------------------------------
const HERO_MEDIA = [
  // { type: 'video', src: 'assets/hero-build.mp4' },
  // { type: 'image', src: 'assets/hero-still.jpg' },
];

// Milliseconds between cross-fades. Keep in sync with comment in home.css.
const FADE_INTERVAL_MS = 6000;

const _reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let _frames = [];
let _currentFrame = 0;
let _fadeTimer = null;

// ---------------------------------------------------------------------------
// Hero frame construction
// ---------------------------------------------------------------------------
function buildHeroFrames() {
  const container = document.getElementById('hero-media-layer');
  _frames = [];

  HERO_MEDIA.forEach((item, i) => {
    let el;

    if (item.type === 'video' && item.src) {
      el = document.createElement('video');
      el.src = item.src;
      el.muted = true;
      el.loop = true;
      el.playsInline = true;
      if (!_reduced) el.autoplay = true;
    } else {
      el = document.createElement('div');
      if (item.src) {
        el.style.backgroundImage = `url('${item.src}')`;
      } else if (item._placeholderBg) {
        el.style.backgroundImage = item._placeholderBg;
      }
    }

    el.className = 'hero-frame';
    el.style.opacity = i === 0 ? '1' : '0';
    container.appendChild(el);
    _frames.push(el);
  });
}

function startFade() {
  if (_reduced || _frames.length < 2 || _fadeTimer) return;
  _fadeTimer = setInterval(() => {
    const prev = _currentFrame;
    _currentFrame = (_currentFrame + 1) % _frames.length;
    _frames[prev].style.opacity = '0';
    _frames[_currentFrame].style.opacity = '1';
  }, FADE_INTERVAL_MS);
}

function stopFade() {
  clearInterval(_fadeTimer);
  _fadeTimer = null;
}

function pauseVideos() {
  _frames.forEach(f => { if (f.tagName === 'VIDEO') f.pause(); });
}

function resumeVideos() {
  if (_reduced) return;
  _frames.forEach((f, i) => {
    if (f.tagName === 'VIDEO' && i === _currentFrame) {
      f.play().catch(() => {});
    }
  });
}

// ---------------------------------------------------------------------------
// View switching — called from buttons and from main.js boot
// ---------------------------------------------------------------------------
export function showHome() {
  document.getElementById('home-view').style.display = '';
  if (!_reduced) {
    resumeVideos();
    startFade();
  }
}

export function showDesign() {
  document.getElementById('home-view').style.display = 'none';
  pauseVideos();
  stopFade();
  // Let render2d recalculate canvas dimensions now that design view is visible.
  window.dispatchEvent(new Event('resize'));
}

// ---------------------------------------------------------------------------
// LOAD button — triggers existing #load-input picker, then navigates.
// Cancel → stay on home view. File chosen → switch to design view.
// ---------------------------------------------------------------------------
function onLoadClick() {
  const loadInput = document.getElementById('load-input');
  let fileChosen = false;

  function cleanup() {
    loadInput.removeEventListener('change', onFileChange);
    window.removeEventListener('focus', onWindowFocus);
  }

  function onFileChange() {
    fileChosen = true;
    cleanup();
    showDesign();
  }

  // When the OS file picker closes (cancel or pick), window regains focus.
  // A short delay lets the 'change' event fire first on file-chosen paths.
  function onWindowFocus() {
    setTimeout(() => {
      if (!fileChosen) cleanup(); // cancelled — already on home, no action needed
    }, 300);
  }

  loadInput.addEventListener('change', onFileChange);
  window.addEventListener('focus', onWindowFocus, { once: true });
  loadInput.click();
}

// ---------------------------------------------------------------------------
// Init — call once from main.js after initUI()
// ---------------------------------------------------------------------------
export function initHome() {
  buildHeroFrames();

  // DESIGN ECO HOME → enter design view AND open the write-once setup modal on
  // the fresh design. LOAD ECO HOME (onLoadClick) does NOT open it — a loaded
  // file already carries its project data (io.js supplies defaults for old files).
  document.getElementById('btn-home-design').addEventListener('click', () => {
    showDesign();
    openProjectOptions();
  });
  document.getElementById('btn-home-load').addEventListener('click', onLoadClick);

  // Tutorial link is a placeholder — prevent navigation until real URL is set.
  document.getElementById('btn-home-tutorial').addEventListener('click', (e) => {
    if (e.currentTarget.getAttribute('href') === '#') e.preventDefault();
  });

  // HOME button inside design area — confirm before discarding unsaved work.
  document.getElementById('btn-go-home').addEventListener('click', () => {
    if (confirm('Leave design? Unsaved changes may be lost.')) showHome();
  });

  showHome();
}
