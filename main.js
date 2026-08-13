// ============================================================
// YT Loop — loop any part of a YouTube video
// ============================================================

const STORAGE_KEY = 'yt-loop-data-v3';
// v1 held hand-saved loops, back when saving was a button. v2 records playback
// history by itself — keeping a range for good is a browser bookmark's job now,
// which the 🔗 / 📝 buttons feed. v3 adds a chord sheet per video: typed work,
// not a by-product of playing. Each older key is migrated on first read and
// then left alone, so rolling back to a previous version still finds its data.
const V2_STORAGE_KEY = 'yt-loop-data-v2';
const LEGACY_STORAGE_KEY = 'yt-loop-data-v1';
const PLAY_DELAY_MS = 1000;

// One cap, and only on the ranges inside a video: playing a range records it,
// so without it a session of nudging a phrase into place fills the list with
// the versions you passed through. Videos themselves are never dropped
// automatically — one can hold a chord sheet, and losing that to a silent
// eviction would be losing work. Clearing a video is a 🗑 away.
const HISTORY_PER_VIDEO = 5;

// Notes ride along in the share URL, and percent-encoding costs 9 characters per
// Japanese character — so the field is capped and share links clamp to the same
// length, which also covers notes saved before the cap existed.
const NOTE_MAX = 30;

let player = null;
let currentVideoId = null;
let currentVideoTitle = '';
let rafId = null;
let activeLoop = null; // {start, end}
let playDelayTimeout = null;
// The history row the running playback owns. Editing Start / End / speed / Note
// while it plays rewrites this row rather than adding another, so a session of
// nudging a phrase into place leaves one entry — the range you settled on —
// instead of filling all five slots with the versions you passed through.
let liveEntryId = null;
// Set right before our own player.playVideo() so onPlayerStateChange knows
// this PLAYING transition came from us (not a user click on the iframe or
// YT's own Space shortcut) and shouldn't be intercepted for the 1s delay.
let intentionalPlay = false;

function setLoopActive(active) {
  activeLoop = active;
  if (loopToggle) loopToggle.checked = !!active;
}

// While a loop is active (playing back), keep activeLoop in sync with the
// visible input values. Without this, editing start/end during playback
// (via 📍 capture or direct typing) updates only the input, not the loop
// that the RAF tick uses to seek back.
function syncActiveLoop() {
  if (!activeLoop) return;
  const s = parseTime(startInput.value);
  const e = parseTime(endInput.value);
  if (s !== null && e !== null && !isNaN(s) && !isNaN(e) && s < e) {
    activeLoop = { start: s, end: e };
  }
}

// Everything that has to be recomputed after the form's values change: the
// duration readout and the live loop range. Callers used to hand-assemble this
// and kept leaving syncActiveLoop out, which left the loop running the old
// range while the inputs showed the new one. The history list is deliberately
// not in here — it only changes when the stored data does, so renderHistory()
// stays an explicit call.
function refreshUI() {
  updateDurationDisplay();
  syncActiveLoop();
}

// Push a loop into the form. Callers pass whatever they know: a history entry
// has all four fields, a share URL may carry only some, and anything left
// undefined keeps whatever the input already holds. Play-from-history and the
// share-URL landing each used to set these inputs by hand — which is how the
// URL path ended up being the only one that never touched Note.
function applyLoopToForm(loop) {
  if (loop.start != null && !isNaN(loop.start)) startInput.value = formatTime(loop.start);
  if (loop.end   != null && !isNaN(loop.end))   endInput.value   = formatTime(loop.end);
  if (loop.speed != null && !isNaN(loop.speed)) setSpeed(loop.speed);
  if (loop.note  !== undefined)                 noteInput.value  = loop.note || '';
  refreshUI();
}

// Fill End with the video duration if it's still empty. Called once the player
// is on a video, so a fresh session covers the whole clip by default.
function fillDefaultEnd() {
  if (!player || typeof player.getDuration !== 'function') return;
  if (endInput.value.trim() !== '') return;
  const d = player.getDuration();
  if (!d || isNaN(d)) return;
  endInput.value = formatTime(d);
  refreshUI();
}

// If the loop toggle is on, initialize activeLoop from the current input
// values. Used after fillDefaultEnd so a freshly loaded video starts
// looping the whole clip without the user touching the toggle.
function activateLoopFromInputs() {
  if (!loopToggle || !loopToggle.checked) return;
  const s = parseTime(startInput.value);
  const e = parseTime(endInput.value);
  if (s === null || e === null || isNaN(s) || isNaN(e) || s >= e) return;
  activeLoop = { start: s, end: e };
}

// ---------- DOM ----------
const urlInput        = document.getElementById('urlInput');
const loadBtn         = document.getElementById('loadBtn');
const controls        = document.querySelector('.controls');
const currentTimeEl   = document.getElementById('currentTime');
const durationDisplay = document.getElementById('durationDisplay');
const speedSelect     = document.getElementById('speedSelect');
const speedRange      = document.getElementById('speedRange');
const speedDisplay    = document.getElementById('speedDisplay');
const startInput      = document.getElementById('startInput');
const endInput        = document.getElementById('endInput');
const noteInput       = document.getElementById('noteInput');
const captureStart    = document.getElementById('captureStart');
const captureEnd      = document.getElementById('captureEnd');
const loopToggle      = document.getElementById('loopToggle');
const rampToggle      = document.getElementById('rampToggle');
const rampFrom        = document.getElementById('rampFrom');
const playLoopBtn     = document.getElementById('playLoopBtn');
const toStartBtn      = document.getElementById('toStartBtn');
const shareBtn        = document.getElementById('shareBtn');
const shareMdBtn      = document.getElementById('shareMdBtn');
const loopList        = document.getElementById('loopList');
const chordSection    = document.querySelector('.chords');
const chordToolbar    = document.querySelector('.chord-toolbar');
const chordEditor     = document.querySelector('.chord-editor');
const chordEditBtn    = document.getElementById('chordEditBtn');
const chordInput      = document.getElementById('chordInput');
const chordStampBtn   = document.getElementById('chordStampBtn');
const chordStrip      = document.getElementById('chordStrip');
const chordViewport   = document.getElementById('chordViewport');
const chordModeBtns   = {
  number: document.getElementById('chordModeInterval'),
  note:   document.getElementById('chordModeNote')
};
const chordShowToggle = document.getElementById('chordShowToggle');

// ============================================================
// Playback speed
// ============================================================
// The preset <select> and the slider are two views of one value, so neither
// element is read directly anywhere else — everything goes through
// getSpeed() / setSpeed(). The slider can hold values the preset list has no
// option for (0.61x), in which case the select shows its hidden "—" entry.
let currentSpeed = 1;

function getSpeed() { return currentSpeed; }

function hasPresetFor(v) {
  return Array.from(speedSelect.options)
    .some(o => o.value !== '' && parseFloat(o.value) === v);
}

// apply: false updates the UI only — used while dragging the slider, where
// firing setPlaybackRate on every 'input' event makes playback stutter.
// fromRamp: true marks the call as the ramp's own step, which is the one case
// that must NOT re-baseline it (see rampBase below).
function setSpeed(v, { apply = true, fromRamp = false } = {}) {
  const n = parseFloat(v);
  if (isNaN(n)) return;
  currentSpeed = roundTo(Math.min(2, Math.max(0.25, n)), 2);
  speedRange.value = String(currentSpeed);
  speedSelect.value = hasPresetFor(currentSpeed) ? String(currentSpeed) : '';
  speedDisplay.textContent = `${currentSpeed.toFixed(2)}x`;
  if (apply && player && player.setPlaybackRate) {
    player.setPlaybackRate(currentSpeed);
  }
  updateRampLabel();
  // A speed arriving from anywhere but the ramp itself — loading a saved loop,
  // a share URL — is remembered as the speed to return to, but the ramp keeps
  // its fixed 0.25x starting line rather than picking up from there.
  if (!fromRamp && rampOn) {
    rampBase = currentSpeed;
    if (currentSpeed !== RAMP_START) setSpeed(RAMP_START, { apply, fromRamp: true });
  }
}

// ============================================================
// Speed-up ramp (⏫)
// ============================================================
// Practice aid: a fixed run from 0.25x up to the original tempo, gaining a
// notch on every completed lap. 0.05 is small enough that a single lap doesn't
// announce itself, so the speed creeps up without the player noticing. The
// start is fixed rather than "wherever the slider happens to be" so that
// switching it on always means the same thing.
const RAMP_START = 0.25;
const RAMP_STEP = 0.05;
const RAMP_TARGET = 1;

let rampOn = false;
// The speed to go back to when the ramp is switched off. Also stands in for the
// live, drifting speed wherever the *chosen* speed is what matters (saving,
// share links).
let rampBase = null;

function effectiveSpeed() {
  return rampBase !== null ? rampBase : getSpeed();
}

// "0.25x → 1.00x" while idle, with the left side tracking the live speed once
// the ramp is running — the whole label doubles as the progress readout.
function updateRampLabel() {
  rampFrom.textContent = `${(rampOn ? getSpeed() : RAMP_START).toFixed(2)}x`;
}

// Practice mode is playback-only: the speed controls belong to the ramp while it
// runs, and the export buttons are held back so a half-ramped rate can't be
// baked into a copied link by mistake. The history list stays live — picking
// another entry from it is a legitimate way to move on.
function updateRampLock() {
  speedRange.disabled = rampOn;
  speedSelect.disabled = rampOn;
  [shareBtn, shareMdBtn].forEach(b => { b.disabled = rampOn; });
}

// Called once per completed lap, from the loop-end handler.
function bumpRampSpeed() {
  if (!rampOn) return;
  const cur = getSpeed();
  if (cur >= RAMP_TARGET) return; // at (or past) the target: stay there
  setSpeed(Math.min(RAMP_TARGET, roundTo(cur + RAMP_STEP, 2)), { fromRamp: true });
}

rampToggle.addEventListener('change', () => {
  rampOn = rampToggle.checked;
  if (rampOn) {
    rampBase = getSpeed();
    setSpeed(RAMP_START, { fromRamp: true });
  } else if (rampBase !== null) {
    const base = rampBase;
    rampBase = null;
    setSpeed(base);
  }
  updateRampLock();
  updateRampLabel();
});

// ============================================================
// Load YouTube IFrame API
// ============================================================
(function loadYouTubeAPI() {
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);
})();

window.onYouTubeIframeAPIReady = () => {
  const params = new URLSearchParams(location.search);
  const v = params.get('v');
  if (v) {
    urlInput.value = `https://youtu.be/${v}`;
    createOrLoadPlayer(v, () => {
      const s = params.get('s');
      const e = params.get('e');
      const r = params.get('r');
      const n = params.get('n');
      // Note is deliberately left out here so the two sources below can be tried
      // in order.
      applyLoopToForm({
        start: s !== null ? parseFloat(s) : undefined,
        end:   e !== null ? parseFloat(e) : undefined,
        speed: r !== null ? parseFloat(r) : undefined
      });
      // Local history wins over the link's note, and the link only speaks up when
      // this range is one we've never played here — which is exactly the case the
      // param exists for (a different machine, or storage that got cleared). The
      // other way round loses data: an entry you've since refined is newer than
      // whatever got bookmarked, and recordHistory() writes the form's note
      // straight back into it, so a stale `n` would be overwritten in on the next
      // Play. Links made before `n` existed still land on the history path.
      if (!adoptNoteFromHistory() && n) noteInput.value = n.slice(0, NOTE_MAX);
      adoptSheetFromLink(params.get('k'));
      refreshUI();
    });
  } else {
    renderHistory();
  }
};

// Recover the note for a landing range from history. Returns whether an entry
// matched, so the caller knows whether the share URL's own note still has a job
// to do. A match with an empty note still counts: clearing a note is deliberate,
// so it should stay cleared rather than being refilled from the link.
function adoptNoteFromHistory() {
  if (!currentVideoId) return false;
  const s = parseTime(startInput.value);
  const e = parseTime(endInput.value);
  if (s === null || e === null || isNaN(s) || isNaN(e)) return false;
  const video = loadData().videos[currentVideoId];
  if (!video) return false;
  const match = video.history.find(h => sameRange(h, s, e, effectiveSpeed()));
  if (!match) return false;
  noteInput.value = match.note || '';
  return true;
}

// ============================================================
// URL → videoId
// ============================================================
function extractVideoId(input) {
  const s = input.trim();
  if (!s) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (u.hostname.includes('youtube.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live') {
        return parts[1] || null;
      }
    }
  } catch (e) {}
  return null;
}

// ============================================================
// Time format helpers
// ============================================================
function formatTime(sec) {
  if (sec === null || sec === undefined || isNaN(sec)) return '0:00.00';
  const total = Math.max(0, sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total - Math.floor(total / 60) * 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
  }
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

function parseTime(str) {
  if (str === null || str === undefined) return null;
  const s = String(str).trim();
  if (!s) return null;
  if (!s.includes(':')) {
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }
  const parts = s.split(':');
  let total = 0;
  for (let i = 0; i < parts.length; i++) {
    const n = parseFloat(parts[i]);
    if (isNaN(n)) return null;
    total = total * 60 + n;
  }
  return total;
}

function roundTo(n, digits) {
  const p = Math.pow(10, digits);
  return Math.round(n * p) / p;
}

// ============================================================
// Range identity
// ============================================================
// What makes two history entries "the same range": video, start, end and rate.
// Times coming back from a share URL are toFixed(2), so compare with a small
// tolerance rather than by strict equality.
const RANGE_EPS = 0.005;

function sameRange(entry, start, end, speed) {
  return Math.abs(entry.start - start) < RANGE_EPS &&
         Math.abs(entry.end - end) < RANGE_EPS &&
         entry.speed === speed;
}

// ============================================================
// Player
// ============================================================
// Pull the title out of the player if it has one yet. Only overwrites when the
// player actually reports something, so a title already filled in from oEmbed
// isn't wiped back to empty.
function refreshTitleFromPlayer() {
  try {
    const data = player.getVideoData();
    if (data && data.title) currentVideoTitle = data.title;
  } catch (e) {}
  backfillTitle();
}

// Everything that has to happen once the player is sitting on a new video.
// Both entry points — the very first YT.Player (onReady) and every later
// loadVideoById — run this one sequence. With a copy each they had drifted:
// only one started the clock, and they disagreed about wiping the title.
function afterVideoReady(onReadyCb) {
  refreshTitleFromPlayer();
  startTimeLoop();
  if (onReadyCb) onReadyCb();
  fillDefaultEnd();
  activateLoopFromInputs();
  renderHistory();
  renderChordStrip();
  if (!chordEditor.hidden) chordInput.value = getSheet(currentVideoId);
}

// loadVideoById fires no second onReady, so the post-load work has to wait for
// the player to actually pick the video up. We run on its first state change
// and keep a timer as a backstop in case none arrives. The fixed 800ms delay
// this replaces just fired blind, dropping the callback on a slow load.
const LOAD_FALLBACK_MS = 2000;
let pendingLoad = null; // {cb, timer}

function runPendingLoad() {
  if (!pendingLoad) return;
  const { cb, timer } = pendingLoad;
  pendingLoad = null;
  clearTimeout(timer);
  afterVideoReady(cb);
}

function createOrLoadPlayer(videoId, onReadyCb) {
  currentVideoId = videoId;
  currentVideoTitle = '';
  // A new video gets a new default range. Start back to zero and End cleared so
  // fillDefaultEnd puts this clip's duration in — otherwise the previous video's
  // range stayed in the fields and was played, and recorded, against a clip it
  // had nothing to do with. Callers that know better (a share URL, a history
  // entry) overwrite these from their onReady callback.
  startInput.value = formatTime(0);
  endInput.value = '';
  refreshUI();
  // The previous video's playback owned a history row; this one starts with none.
  liveEntryId = null;
  expandedVideos.add(videoId);
  fetchTitle(videoId);
  if (!player) {
    player = new YT.Player('player', {
      videoId,
      playerVars: {
        enablejsapi: 1,
        rel: 0,
        modestbranding: 1,
        playsinline: 1
      },
      events: {
        onReady: () => afterVideoReady(onReadyCb),
        onStateChange: onPlayerStateChange
      }
    });
  } else {
    // Armed before the call so a fast state change can't beat us to it.
    pendingLoad = { cb: onReadyCb, timer: setTimeout(runPendingLoad, LOAD_FALLBACK_MS) };
    player.loadVideoById(videoId);
  }
  controls.hidden = false;
}

function onPlayerStateChange(e) {
  refreshTitleFromPlayer();

  const state = e && e.data;
  // Any state but "unstarted" means the newly loaded video has landed. Run the
  // post-load work before the interception below, so activeLoop is already up
  // to date by the time we decide where to seek. -1 is compared as a literal
  // on purpose: YT.PlayerState has no UNSTARTED constant, so naming one gives
  // undefined and the guard silently matches every state.
  if (state !== -1) runPendingLoad();

  if (state === (window.YT && YT.PlayerState.PLAYING)) {
    if (intentionalPlay) {
      intentionalPlay = false;
    } else {
      // Playback started from something other than our delayed-play — e.g.
      // clicking the iframe or YT's own Space shortcut. Pause and restart
      // through the 1s warmup so the user has time to pick up their guitar.
      player.pauseVideo();
      startPlaybackWithDelay();
      return;
    }
  }
  updatePlayButton();
}

// getVideoData() has no title until playback starts, so ask YouTube's oEmbed
// endpoint for it right after loading. Best effort: on failure we keep whatever
// the player reports later. Ignored if the user already switched videos or the
// player got there first.
async function fetchTitle(vid) {
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent('https://youtu.be/' + vid)}&format=json`;
    const res = await fetch(url);
    if (!res.ok) return;
    const { title } = await res.json();
    if (!title || vid !== currentVideoId || currentVideoTitle.trim()) return;
    currentVideoTitle = title;
    backfillTitle();
    renderHistory();
  } catch (e) {}
}

function backfillTitle() {
  if (!currentVideoId || !currentVideoTitle) return;
  const data = loadData();
  const v = data.videos[currentVideoId];
  if (v && v.title !== currentVideoTitle) {
    v.title = currentVideoTitle;
    saveData(data);
  }
}

function updatePlayButton() {
  if (playDelayTimeout) {
    playLoopBtn.textContent = '⏳ 1s…';
    return;
  }
  const state = safeState();
  if (state === (window.YT && YT.PlayerState.PLAYING)) {
    playLoopBtn.textContent = '⏸ Pause';
  } else {
    playLoopBtn.textContent = '▶ Play';
  }
}

// A small delay before playVideo() so the user has time to pick up their
// guitar. Clicking Play again while pending cancels the wait.
function cancelPendingPlay() {
  if (!playDelayTimeout) return false;
  clearTimeout(playDelayTimeout);
  playDelayTimeout = null;
  return true;
}

function scheduleDelayedPlay() {
  cancelPendingPlay();
  playDelayTimeout = setTimeout(() => {
    playDelayTimeout = null;
    if (player && player.playVideo) {
      intentionalPlay = true;
      player.playVideo();
      // Recorded here, at the moment playback actually begins, rather than when
      // it was requested: a warmup the user cancels never happened, and every
      // way of starting playback funnels through this one timeout.
      recordHistory();
    }
  }, PLAY_DELAY_MS);
  updatePlayButton();
}

// The single entry point for starting playback: re-apply the speed (YT can
// drop it across loads), pull the playhead into the loop range if it sits
// outside, then warm up. Every trigger — the Play button, Space, and the
// iframe-click interception — goes through here; when Space had its own copy
// of this that skipped the seek, a shared URL played from 0 instead of Start.
function startPlaybackWithDelay() {
  if (!player) return;
  if (player.setPlaybackRate) player.setPlaybackRate(getSpeed());
  if (activeLoop && typeof player.getCurrentTime === 'function') {
    const t = player.getCurrentTime();
    if (t < activeLoop.start || t >= activeLoop.end) {
      player.seekTo(activeLoop.start, true);
    }
  }
  scheduleDelayedPlay();
}

// The loop-end check must NOT live in requestAnimationFrame: Chrome pauses RAF
// entirely while the tab is hidden, so playback ran straight past End until the
// tab was looked at again. Main-thread setInterval is no good either — hidden
// pages only get their timers checked once per second, and a practice loop that
// overshoots by up to 1s is unusable. A Worker's timers run on their own thread
// and are not throttled. Measured on this machine with the tab hidden and a
// 25ms target: worker 25.0ms median / 26.7ms max, main-thread interval 1000ms,
// RAF zero callbacks.
const LOOP_CHECK_MS = 25;
let loopWorker = null;

// Guards against handling one lap twice. seekTo takes tens of milliseconds to
// land, during which the 25ms clock keeps reporting a time past End — enough
// ticks to bump the ramp two or three notches per lap. Handle the crossing
// once, then wait until the playhead is genuinely back inside the range.
let wrapArmed = true;

// Pull the playhead back to Start once it reaches End. Driven by the worker
// clock; the RAF tick calls it too, but only as a fallback for the (unexpected)
// case where the worker could not be created.
function enforceLoopEnd() {
  if (!player || !activeLoop || typeof player.getCurrentTime !== 'function') return;
  if (safeState() !== (window.YT && YT.PlayerState.PLAYING)) return;
  let t;
  try { t = player.getCurrentTime(); } catch (e) { return; }
  if (t < activeLoop.end) { wrapArmed = true; return; }
  if (!wrapArmed) return;
  wrapArmed = false;
  // seekTo while PLAYING triggers BUFFERING → PLAYING again;
  // claim it as ours so onPlayerStateChange doesn't warm-up-delay it.
  intentionalPlay = true;
  player.seekTo(activeLoop.start, true);
  // After the seek, so the new rate lands on the fresh lap rather than on the
  // last few frames of the old one.
  bumpRampSpeed();
}

// Inlined as a blob so the app stays a flat set of files on GitHub Pages.
function startLoopWorker() {
  if (loopWorker) return;
  const src = 'let id = null;' +
              'onmessage = e => {' +
              '  if (id) clearInterval(id);' +
              '  id = setInterval(() => postMessage(0), e.data);' +
              '};';
  try {
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    loopWorker = new Worker(url);
    URL.revokeObjectURL(url);
    loopWorker.onmessage = enforceLoopEnd;
    loopWorker.postMessage(LOOP_CHECK_MS);
  } catch (e) {
    loopWorker = null; // RAF fallback below keeps the visible case working.
  }
}

function startTimeLoop() {
  startLoopWorker();
  if (rafId) cancelAnimationFrame(rafId);
  const tick = () => {
    if (player && typeof player.getCurrentTime === 'function') {
      let t;
      try { t = player.getCurrentTime(); } catch (e) { t = 0; }
      currentTimeEl.textContent = formatTime(t);
      updateChordScroll(t);
      if (!loopWorker) enforceLoopEnd();
    }
    rafId = requestAnimationFrame(tick);
  };
  tick();
}

function safeState() {
  try { return player.getPlayerState(); } catch (e) { return -1; }
}

// ============================================================
// Editing a value
// ============================================================
// Every hand edit of Start / End / speed / Note lands here. Two things follow from
// it, and both have to wait until the value settles — a slider drag and a held
// arrow key fire continuously:
//
//   1. The edited value and the 🔗 / 📝 buttons blink together. Those buttons copy
//      whatever the form holds at the instant they are clicked, which is invisible
//      until you paste; the pair blinking is what says "the link already has this".
//   2. If something is playing, the history row that playback owns is rewritten,
//      so the range you end up practising is the one that gets remembered.
const EDIT_QUIET_MS = 300;
let editTimer = null;
let editTarget = null;

function handleValueEdit(el) {
  editTarget = el;
  clearTimeout(editTimer);
  editTimer = setTimeout(() => {
    editTimer = null;
    const target = editTarget;
    editTarget = null;
    // The history row is looked up after the rewrite, because that call re-renders
    // the list and any element held from before it is detached by then.
    const writtenId = updateLiveEntry();
    flashElements([target, shareBtn, shareMdBtn, historyRowEl(writtenId)]);
  }, EDIT_QUIET_MS);
}

function flashElements(els) {
  els.filter(Boolean).forEach(el => {
    el.classList.remove('flash');
    // Forces a reflow so re-adding the class restarts the animation. Without it a
    // second edit inside the same frame leaves the old one running and the flash
    // is silently skipped.
    void el.offsetWidth;
    el.classList.add('flash');
  });
}

function historyRowEl(entryId) {
  if (!entryId) return null;
  return loopList.querySelector(`[data-entry-id="${entryId}"]`);
}

// One listener for the whole page: animationend bubbles, and 'flash' is the only
// animation here, so this cleans up after every flash without naming elements.
document.addEventListener('animationend', e => {
  if (e.target instanceof Element) e.target.classList.remove('flash');
});

// ============================================================
// Duration display (end − start)
// ============================================================
function updateDurationDisplay() {
  const s = parseTime(startInput.value);
  const e = parseTime(endInput.value);
  if (s === null || e === null || isNaN(s) || isNaN(e) || e <= s) {
    durationDisplay.textContent = '—';
    return;
  }
  durationDisplay.textContent = formatTime(e - s);
}
startInput.addEventListener('input', () => { refreshUI(); handleValueEdit(startInput); });
endInput.addEventListener('input',   () => { refreshUI(); handleValueEdit(endInput); });
// Note changes nothing on screen, but it does go into the copied Markdown label,
// so it flashes like the rest.
noteInput.addEventListener('input',  () => { handleValueEdit(noteInput); });

// ============================================================
// Active target highlight (which value ← → will change)
// ============================================================
const startGroup = startInput.closest('.field-group');
const endGroup   = endInput.closest('.field-group');

function updateActiveTarget() {
  const target = document.activeElement;
  startGroup.classList.toggle('active-target', target === startInput);
  endGroup.classList.toggle('active-target', target === endInput);
}
document.addEventListener('focusin', updateActiveTarget);
document.addEventListener('focusout', () => setTimeout(updateActiveTarget, 0));
updateActiveTarget();

// ============================================================
// Form actions
// ============================================================
loadBtn.addEventListener('click', () => {
  const id = extractVideoId(urlInput.value);
  if (!id) { alert('Invalid URL'); return; }
  createOrLoadPlayer(id);
});

urlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); loadBtn.click(); }
});

speedSelect.addEventListener('change', () => {
  setSpeed(speedSelect.value);
  handleValueEdit(speedDisplay);
});

// 'input' fires continuously while dragging — reflect it in the UI but leave
// the player alone until the drag ends ('change'), which also covers the
// arrow-key case since that fires both events at once.
speedRange.addEventListener('input', () => {
  setSpeed(speedRange.value, { apply: false });
  handleValueEdit(speedDisplay);
});
speedRange.addEventListener('change', () => setSpeed(speedRange.value));

captureStart.addEventListener('click', () => {
  if (!player || !player.getCurrentTime) return;
  startInput.value = formatTime(player.getCurrentTime());
  refreshUI();
  handleValueEdit(startInput);
});
captureEnd.addEventListener('click', () => {
  if (!player || !player.getCurrentTime) return;
  endInput.value = formatTime(player.getCurrentTime());
  refreshUI();
  handleValueEdit(endInput);
});

playLoopBtn.addEventListener('click', () => {
  if (!player || !player.getPlayerState) return;
  if (cancelPendingPlay()) { updatePlayButton(); return; }
  const state = safeState();
  if (state === (window.YT && YT.PlayerState.PLAYING)) {
    player.pauseVideo();
    return;
  }
  // Loop membership is owned by the toggle; the helper just seeks into range
  // if the toggle is on and playback is currently outside it.
  startPlaybackWithDelay();
});

// Jump to the start of the range without touching play / pause state. Shared by
// the ⏮ Start button and the S shortcut.
function seekToStart() {
  if (!player || !player.seekTo) return;
  const s = parseTime(startInput.value);
  if (s === null || isNaN(s)) return;
  player.seekTo(s, true);
}

toStartBtn.addEventListener('click', seekToStart);

loopToggle.addEventListener('change', () => {
  if (loopToggle.checked) {
    const start = parseTime(startInput.value);
    const end   = parseTime(endInput.value);
    if (start === null || end === null || start >= end) {
      loopToggle.checked = false;
      alert('Set a valid start / end time first');
      return;
    }
    activeLoop = { start, end };
  } else {
    activeLoop = null;
  }
});

// Confirm, then drop one history entry — for the odd range you don't want
// suggested back at you. A video left with nothing goes too, so no empty groups
// linger in the list — unless it holds a chord sheet, which is the part of a
// video worth keeping and has no business disappearing with a range.
function deleteHistoryEntry(vid, entry) {
  if (!confirm(`Remove this from history (${formatTime(entry.start)} → ${formatTime(entry.end)})?`)) return;
  const data = loadData();
  const v = data.videos[vid];
  if (v) {
    v.history = v.history.filter(h => h.id !== entry.id);
    if (v.history.length === 0 && !v.sheet) delete data.videos[vid];
    saveData(data);
  }
  renderHistory();
}

// Clear one video's history. Per video rather than one global Clear all: the list
// is grouped by video, so that's the unit you actually want to be rid of. This is
// the only thing that removes a video now, so the prompt spells out that a chord
// sheet goes with it.
function clearVideoHistory(vid) {
  const title = resolveVideoTitle(vid) || vid;
  const data = loadData();
  const v = data.videos[vid];
  const sheetWarning = v && v.sheet ? ' Its chord sheet goes too.' : '';
  if (!confirm(`Clear the history for "${title}"?${sheetWarning} Bookmarked links are not affected.`)) return;
  delete data.videos[vid];
  saveData(data);
  renderHistory();
  renderChordStrip();
}

// ---------- Share (🔗 URL / 📝 MD) ----------
// Everything shareable is a (videoId, loop) pair — either a saved loop from
// the list or the range the form currently describes. Both go through the same
// builders below so the two sets of buttons can't drift apart.

// The form's current state in the shape of a saved loop.
function currentFormLoop() {
  return {
    start: parseTime(startInput.value),
    end:   parseTime(endInput.value),
    speed: effectiveSpeed(),
    note:  noteInput ? noteInput.value.trim() : ''
  };
}

// Title of a video: the live one from the player while it's loaded, otherwise
// the title stored alongside its saved loops. getVideoData() has no title until
// playback starts and currentVideoTitle is cleared on every load, so the stored
// title is what keeps the label filled in.
function resolveVideoTitle(vid) {
  if (vid && vid === currentVideoId && currentVideoTitle.trim()) {
    return currentVideoTitle.trim();
  }
  const v = loadData().videos[vid];
  return ((v && v.title) || '').trim();
}

// Returns null if no video is loaded.
function buildShareUrl(vid, loop) {
  if (!vid) return null;
  const params = new URLSearchParams();
  params.set('v', vid);
  if (typeof loop.start === 'number' && !isNaN(loop.start)) params.set('s', loop.start.toFixed(2));
  if (typeof loop.end === 'number' && !isNaN(loop.end)) params.set('e', loop.end.toFixed(2));
  if (loop.speed && loop.speed !== 1) params.set('r', String(loop.speed));
  const note = (loop.note || '').trim();
  if (note) params.set('n', note.slice(0, NOTE_MAX));
  return `${location.origin}${location.pathname}?${params.toString()}`;
}

// Markdown link label: "<title> (start → end) <note>", dropping whichever
// pieces aren't available.
function buildShareLabel(vid, loop) {
  const hasRange = typeof loop.start === 'number' && !isNaN(loop.start) &&
                   typeof loop.end === 'number' && !isNaN(loop.end);
  const range = hasRange ? `${formatTime(loop.start)} → ${formatTime(loop.end)}` : '';
  const title = resolveVideoTitle(vid);
  const note  = (loop.note || '').trim();
  const base = (title && range) ? `${title} (${range})` : (title || range || vid || 'YT Loop');
  return note ? `${base} ${note}` : base;
}

function buildShareMarkdown(vid, loop) {
  return `[${buildShareLabel(vid, loop)}](${buildShareUrl(vid, loop)})`;
}

// Copy `text` to the clipboard, flashing `btn` to `okLabel` then back to
// `restLabel`. Falls back to a prompt when the Clipboard API is unavailable.
async function copyWithFeedback(btn, text, okLabel, restLabel) {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = okLabel;
    setTimeout(() => { btn.textContent = restLabel; }, 1500);
  } catch (e) {
    prompt('Copy:', text);
  }
}

shareBtn.addEventListener('click', () => {
  const url = buildShareUrl(currentVideoId, currentFormLoop());
  if (!url) { alert('Load a video first'); return; }
  copyWithFeedback(shareBtn, url, '✅ Copied!', '🔗 URL');
});

shareMdBtn.addEventListener('click', () => {
  if (!currentVideoId) { alert('Load a video first'); return; }
  const md = buildShareMarkdown(currentVideoId, currentFormLoop());
  copyWithFeedback(shareMdBtn, md, '✅ Copied!', '📝 MD');
});

// ============================================================
// Chord sheet (🎼)
// ============================================================
// One sheet per video — the chords belong to the song, not to whichever range
// happens to be in the fields. See chords.js for the notation.

// The sheet is one unbroken row that slides under a playhead fixed in the
// middle of the window: what is playing is always in the same place, and what
// is coming arrives from the right.
//
// Every bar is four slots wide whatever it holds — a slot being one diagram —
// and its chords take slots in proportion to the beats they get. That is what
// makes the motion even: equal bars over equal time. (An earlier version let
// each bar be as wide as its contents, which made the sheet speed up and slow
// down bar by bar and was unfollowable.)
//
// The slot narrows on a window too small for four of them, so one whole bar
// always fits across, and the sheet never wraps to a second line.
const SLOTS_PER_BAR = 4;
// A slot holds one diagram, drawn as an SVG scaled to fit it, so this single
// number sets how large the whole sheet draws.
const SLOT_MAX = 142;
const BAR_BORDER = 2;   // the amber rule down the left of a bar
let chordAnchors = [];  // {time, x} along the track, ascending by time

// Re-reading and re-parsing the sheet on every render would be waste, so the
// parse is kept and only redone when the text can have changed.
let chordCache = { vid: null, bars: [], spans: [] };

function refreshChordCache() {
  const bars = Chords.parseSheet(getSheet(currentVideoId));
  chordCache = { vid: currentVideoId, bars, spans: Chords.resolveSpans(bars) };
  return chordCache;
}

function chordSlotWidth() {
  const w = chordViewport.clientWidth || 860;
  return Math.max(60, Math.min(SLOT_MAX, Math.floor(w / SLOTS_PER_BAR)));
}

function renderChordStrip() {
  if (!currentVideoId) {
    chordSection.hidden = true;
    return;
  }
  chordSection.hidden = false;
  const visible = getChordsVisible();
  if (!visible) chordEditor.hidden = true;
  chordViewport.hidden = !visible;
  if (!visible) return;

  const { bars, spans } = refreshChordCache();
  chordStrip.textContent = '';
  chordStrip.style.transform = '';
  chordAnchors = [];

  if (bars.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No chords for this video yet — 🎼 Edit to write some.';
    chordStrip.appendChild(empty);
    return;
  }

  const slot = chordSlotWidth();
  chordStrip.style.setProperty('--slot', `${slot}px`);
  let x = 0;

  bars.forEach((bar, i) => {
    const weights = Chords.slotWeights(bar.chords.length);
    // Every bar is the same four slots wide. One holding more chords than that
    // stacks them four to a line within its own width instead of growing wider,
    // which would run it past the others and take the even pace with it.
    const width = SLOTS_PER_BAR * slot;
    const outer = width + BAR_BORDER;

    const barEl = document.createElement('div');
    barEl.className = 'chord-bar';
    barEl.style.width = `${width}px`;

    const head = document.createElement('div');
    head.className = 'chord-bar-head';
    head.textContent = spans[i].start === null
      ? String(i + 1)
      : `${i + 1}　${formatTime(spans[i].start)}`;
    barEl.appendChild(head);

    const cells = document.createElement('div');
    cells.className = 'chord-bar-cells';
    bar.chords.forEach((chord, j) => {
      const cell = renderChord(chord);
      cell.style.width = `${weights[j] * slot}px`;
      cells.appendChild(cell);
    });
    barEl.appendChild(cells);
    chordStrip.appendChild(barEl);

    // Time is pinned to the bar's two edges. Inside, the chords already sit
    // where their beats fall, so a straight line between the edges puts each
    // one under the playhead exactly when it sounds.
    if (spans[i].start !== null) {
      chordAnchors.push({ time: spans[i].start, x });
      if (spans[i].end !== null) chordAnchors.push({ time: spans[i].end, x: x + outer });
    }
    x += outer;
  });

  chordAnchors.sort((a, b) => a.time - b.time);
  updateChordScroll(currentPlaybackTime());
}

function currentPlaybackTime() {
  if (!player || typeof player.getCurrentTime !== 'function') return 0;
  try { return player.getCurrentTime(); } catch (e) { return 0; }
}

// Where a moment in the music sits along the track. Outside the sheet the
// nearest bar's speed carries on, so it drifts in and out rather than sticking.
function chordXForTime(t) {
  const a = chordAnchors;
  if (a.length === 0) return 0;
  if (a.length === 1) return a[0].x;
  const last = a.length - 1;
  const between = (i, j) => {
    const span = a[j].time - a[i].time;
    return span > 0 ? (a[j].x - a[i].x) / span : 0;
  };
  if (t <= a[0].time) return a[0].x + (t - a[0].time) * between(0, 1);
  if (t >= a[last].time) return a[last].x + (t - a[last].time) * between(last - 1, last);
  for (let i = 0; i < last; i++) {
    if (t < a[i + 1].time) return a[i].x + (t - a[i].time) * between(i, i + 1);
  }
  return a[last].x;
}

// Called from the playback clock: a transform and nothing else, so the
// compositor can carry it without a layout pass.
function updateChordScroll(t) {
  if (!currentVideoId || chordSection.hidden || !getChordsVisible()) return;
  if (chordAnchors.length === 0) return;
  const center = chordViewport.clientWidth / 2;
  chordStrip.style.transform = `translateX(${center - chordXForTime(t)}px)`;
}

window.addEventListener('resize', () => { renderChordStrip(); });

// A chord: its name linking out to the fretboard viewer, and the picked shape.
// The time belongs to the bar, printed once in its header — a stamp under every
// chord was four times the number for a quarter of the confidence, since a
// chord's own moment is only its bar divided evenly.
function renderChord(chord) {
  const box = document.createElement('div');
  box.className = 'chord';

  const link = document.createElement('a');
  link.href = Chords.viewerUrl(chord);
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = chord.name;
  link.title = 'Open in Guitar Chord Viewer';
  box.appendChild(link);

  box.appendChild(Chords.diagram(chord.markers, chord.name, getChordMode()));
  return box;
}

function openChordEditor() {
  // Editing implies looking, so this turns the strip back on rather than
  // opening a box whose result is hidden.
  if (!getChordsVisible()) {
    setChordsVisible(true);
    chordShowToggle.checked = true;
    renderChordStrip();
  }
  chordEditor.hidden = false;
  chordInput.value = getSheet(currentVideoId);
  chordInput.focus();
  chordSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

chordEditBtn.addEventListener('click', () => {
  if (chordEditor.hidden) openChordEditor();
  else chordEditor.hidden = true;
});

// No save button, like everything else here: the box is the stored sheet.
chordInput.addEventListener('input', () => {
  setSheet(currentVideoId, chordInput.value);
  renderChordStrip();
});

// A sheet pasted out of a notes file is a wall of markdown links. Once the
// links have been read there is nothing left in them the short form doesn't
// hold — the viewer link is rebuilt from the chord and its frets — so the box
// is rewritten in the short form, one bar per line. Not while typing, which
// would move the caret out from under you: on paste, and on leaving the field.
function normalizeChordInput() {
  const bars = Chords.parseSheet(chordInput.value);
  if (!bars.length) return;
  const compact = Chords.toCompact(bars, '\n');
  if (compact === chordInput.value) return;
  chordInput.value = compact;
  setSheet(currentVideoId, compact);
  renderChordStrip();
}

chordInput.addEventListener('paste', () => setTimeout(normalizeChordInput, 0));
chordInput.addEventListener('blur', normalizeChordInput);

// Writing `@0:43.50` by hand while a phrase is playing is the fiddly part, so
// the pin drops the current time in at the caret.
chordStampBtn.addEventListener('click', () => {
  if (!player || !player.getCurrentTime) return;
  const stamp = `@${roundTo(player.getCurrentTime(), 2).toFixed(2)} `;
  const start = chordInput.selectionStart ?? chordInput.value.length;
  const end = chordInput.selectionEnd ?? chordInput.value.length;
  chordInput.value = chordInput.value.slice(0, start) + stamp + chordInput.value.slice(end);
  const caret = start + stamp.length;
  chordInput.setSelectionRange(caret, caret);
  chordInput.focus();
  setSheet(currentVideoId, chordInput.value);
  renderChordStrip();
});

// Two halves of one pill with the live one lit, the same control Guitar Chord
// Viewer uses for Degrees / Solfege. A lone button had to be read twice — once
// for what it says and once for whether that is the state or the offer.
function updateChordModeBtns() {
  const mode = getChordMode();
  Object.entries(chordModeBtns).forEach(([value, btn]) => {
    btn.classList.toggle('active', value === mode);
    btn.setAttribute('aria-pressed', String(value === mode));
  });
}

Object.entries(chordModeBtns).forEach(([value, btn]) => {
  btn.addEventListener('click', () => {
    if (getChordMode() === value) return;
    setChordMode(value);
    updateChordModeBtns();
    renderChordStrip();
  });
});

chordShowToggle.addEventListener('change', () => {
  setChordsVisible(chordShowToggle.checked);
  renderChordStrip();
});

// A sheet still arrives in `k` — links made while the app had buttons for it
// keep working, and it is how a sheet reaches another machine. Nothing builds
// one any more: a second pair of 🔗 / 📝 next to the range's own pair was two
// identical-looking buttons meaning different things. The sheet is text in the
// editor, and text is copied by selecting it.
// A sheet in the link fills in only where this browser has none — the same rule
// the note follows. What is stored here was typed here, which makes it newer
// than anything a bookmark carries.
function adoptSheetFromLink(k) {
  if (!k || !currentVideoId) return;
  if (getSheet(currentVideoId)) return;
  const bars = Chords.parseSheet(k);
  if (!bars.length) return;
  setSheet(currentVideoId, Chords.toCompact(bars));
}

// ============================================================
// Data (localStorage)
// ============================================================
function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return migrateV2Data();
  try {
    const d = JSON.parse(raw);
    if (!d.videos) d.videos = {};
    Object.values(d.videos).forEach(v => {
      if (!Array.isArray(v.history)) v.history = [];
      if (typeof v.sheet !== 'string') v.sheet = '';
    });
    return d;
  } catch { return { videos: {} }; }
}

// v3 is v2 plus a sheet per video, so this is a straight copy under the new key
// — what actually changed is that videos stopped being pruned. Falls through to
// the v1 path when there is no v2 either, so a long-dormant browser still lands
// on its data.
function migrateV2Data() {
  const raw = localStorage.getItem(V2_STORAGE_KEY);
  if (!raw) return migrateLegacyData();
  let old;
  try { old = JSON.parse(raw); } catch { return migrateLegacyData(); }
  if (!old || !old.videos) return migrateLegacyData();

  const data = { videos: {} };
  Object.entries(old.videos).forEach(([vid, v]) => {
    data.videos[vid] = {
      title: v.title || '',
      sheet: '',
      history: Array.isArray(v.history) ? v.history : []
    };
  });
  saveData(data);
  return data;
}

// ---------- Chord sheets ----------
function getSheet(vid) {
  if (!vid) return '';
  const v = loadData().videos[vid];
  return (v && v.sheet) || '';
}

function setSheet(vid, text) {
  if (!vid) return;
  const data = loadData();
  if (!data.videos[vid]) {
    data.videos[vid] = { title: currentVideoTitle || '', sheet: '', history: [] };
  }
  data.videos[vid].sheet = text;
  if (vid === currentVideoId && currentVideoTitle) data.videos[vid].title = currentVideoTitle;
  saveData(data);
}

// Degree names or note names inside the diagram dots. Degrees are the default:
// the point of the strip is what the shape does over the chord, not its letters.
function getChordMode() {
  return loadData().chordMode === 'note' ? 'note' : 'number';
}

function setChordMode(mode) {
  const data = loadData();
  data.chordMode = mode === 'note' ? 'note' : 'number';
  saveData(data);
}

// Whether the strip is on show. Off leaves the toolbar in place, so the way
// back is where the way out was. Held in memory as well as stored, since the
// playback clock asks on every frame.
let chordsVisible = true;

function getChordsVisible() {
  return chordsVisible;
}

function setChordsVisible(visible) {
  chordsVisible = !!visible;
  const data = loadData();
  data.chordsHidden = !visible;
  saveData(data);
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function newEntryId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : 'h' + Date.now() + Math.random().toString(36).slice(2);
}

// v1 kept hand-saved loops under videos[vid].loops; v2 keeps automatic history
// under .history. Convert once and write v2, using each loop's own timestamps as
// its played time so the order the user already knows survives. Deliberately
// NOT pruned to the caps here: the old list is the last chance to turn those
// ranges into bookmarks, so everything is shown at least once. The caps take
// over from the first recorded play. The v1 key is left in place as a backstop.
function migrateLegacyData() {
  const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return { videos: {} };
  let old;
  try { old = JSON.parse(raw); } catch { return { videos: {} }; }
  if (!old || !old.videos) return { videos: {} };

  const data = { videos: {} };
  Object.entries(old.videos).forEach(([vid, v]) => {
    const loops = Array.isArray(v.loops) ? v.loops : [];
    // A loop with no usable range would render as 0:00.00 → 0:00.00 and could
    // never be matched again, so it is dropped rather than carried over. A video
    // left with nothing is dropped too — an empty group is just a dead header.
    const history = loops
      .filter(l => typeof l.start === 'number' && typeof l.end === 'number' &&
                   !isNaN(l.start) && !isNaN(l.end) && l.start < l.end)
      .map(l => ({
        id: l.id || newEntryId(),
        start: l.start,
        end: l.end,
        speed: typeof l.speed === 'number' && !isNaN(l.speed) ? l.speed : 1,
        note: l.note || '',
        playedAt: Math.max(l.playedAt || 0, l.updatedAt || 0)
      }));
    if (history.length === 0) return;
    data.videos[vid] = { title: v.title || '', sheet: '', history };
  });
  saveData(data);
  return data;
}

// Log the range currently on screen as played. Replaying a range it already
// holds updates that entry instead of piling up a duplicate, which is what keeps
// the list readable when you loop the same four bars twenty times.
function recordHistory() {
  if (!currentVideoId) return;
  const start = parseTime(startInput.value);
  const end   = parseTime(endInput.value);
  if (start === null || end === null || isNaN(start) || isNaN(end) || start >= end) return;
  // The chosen speed, not the ramp's live one — a ramp run would otherwise log
  // a separate entry for every lap it climbs.
  const speed = effectiveSpeed();
  const note  = noteInput.value.trim();

  const data = loadData();
  if (!data.videos[currentVideoId]) {
    data.videos[currentVideoId] = { title: currentVideoTitle || '', sheet: '', history: [] };
  }
  const video = data.videos[currentVideoId];
  if (currentVideoTitle) video.title = currentVideoTitle;

  const existing = video.history.find(h => sameRange(h, start, end, speed));
  if (existing) {
    // The field wins, even when it's empty: Play on an entry loads its note back
    // into the form, so clearing it there is a deliberate act, not a slip.
    existing.note = note;
    existing.playedAt = Date.now();
    liveEntryId = existing.id;
  } else {
    const entry = { id: newEntryId(), start, end, speed, note, playedAt: Date.now() };
    video.history.push(entry);
    liveEntryId = entry.id;
  }

  pruneHistory(data);
  saveData(data);
  renderHistory();
}

// Rewrite the row the running playback owns, so a range edited mid-practice ends
// up in history as the range you settled on. Does nothing unless something is
// actually playing: editing while paused is just preparation, and the next play
// records it anyway. Returns the id of the row it wrote, so the caller can flash
// it — null when nothing was written.
function updateLiveEntry() {
  if (!liveEntryId || !currentVideoId) return null;
  if (safeState() !== (window.YT && YT.PlayerState.PLAYING)) return null;
  const start = parseTime(startInput.value);
  const end   = parseTime(endInput.value);
  if (start === null || end === null || isNaN(start) || isNaN(end) || start >= end) return null;
  const speed = effectiveSpeed();
  const note  = noteInput.value.trim();

  const data = loadData();
  const video = data.videos[currentVideoId];
  if (!video) return null;
  const own = video.history.find(h => h.id === liveEntryId);
  if (!own) { liveEntryId = null; return null; }

  // The edit can land on a range another row already holds — keep that row and
  // drop ours, so the same range never shows up twice.
  const twin = video.history.find(h => h.id !== liveEntryId && sameRange(h, start, end, speed));
  if (twin) {
    video.history = video.history.filter(h => h.id !== liveEntryId);
    twin.note = note;
    twin.playedAt = Date.now();
    liveEntryId = twin.id;
  } else {
    own.start = start;
    own.end = end;
    own.speed = speed;
    own.note = note;
    own.playedAt = Date.now();
  }
  saveData(data);
  renderHistory();
  return liveEntryId;
}

// Newest first. Both the caps and the list order are "most recently played
// wins", so they share the one comparator — when they had a copy each, the list
// and the pruning could disagree about which entry was about to fall off.
function byPlayedAtDesc(a, b) {
  return (b.playedAt || 0) - (a.playedAt || 0);
}

function videoPlayedAt(video) {
  return video.history.reduce((m, h) => Math.max(m, h.playedAt || 0), 0);
}

// Trim each video's ranges to the cap, newest first. Videos are left alone:
// they only go when the user says so.
function pruneHistory(data) {
  Object.values(data.videos).forEach(v => {
    v.history.sort(byPlayedAtDesc);
    v.history = v.history.slice(0, HISTORY_PER_VIDEO);
  });
}

// The ramp is deliberately NOT persisted: switching it on drops the rate to
// 0.25x, so restoring it across reloads would mean every visit starts crawling
// for no reason the user asked for. It's an action for the session in front of
// you, not a preference.
function initRamp() {
  rampOn = false;
  rampToggle.checked = false;
  rampBase = null;
  updateRampLock();
  updateRampLabel();
}
initRamp();

// The Interval / Note choice and whether the strip is shown are preferences, so
// unlike the ramp they do come back with you.
function initChordControls() {
  chordsVisible = loadData().chordsHidden !== true;
  updateChordModeBtns();
  chordShowToggle.checked = chordsVisible;
}
initChordControls();

// ============================================================
// Render history
// ============================================================
function renderHistory() {
  const data = loadData();
  loopList.innerHTML = '';
  const entries = Object.entries(data.videos);
  if (entries.length === 0) {
    loopList.innerHTML = '<p class="empty">Nothing played yet.</p>';
    return;
  }
  entries.sort((a, b) => videoPlayedAt(b[1]) - videoPlayedAt(a[1]));

  entries.forEach(([vid, videoData]) => {
    const group = document.createElement('div');
    group.className = 'video-group';
    group.appendChild(renderVideoHeader(vid, videoData));
    if (expandedVideos.has(vid)) {
      [...videoData.history]
        .sort(byPlayedAtDesc)
        .forEach(entry => { group.appendChild(renderHistoryItem(vid, entry)); });
    }
    loopList.appendChild(group);
  });
}

// Which video groups show their ranges. Videos aren't capped any more, so a
// list with every group open would run off the screen — the one in the player
// is opened for you (see createOrLoadPlayer) and the rest wait to be asked.
const expandedVideos = new Set();

function renderVideoHeader(vid, videoData) {
  const isCurrent = vid === currentVideoId;
  const isOpen = expandedVideos.has(vid);
  const header = document.createElement('div');
  header.className = 'video-group-header' + (isCurrent ? ' current' : '');
  header.title = isCurrent ? 'Currently loaded' : 'Load this video';

  // Opening a group is not loading its video: reading what you practised on
  // something else shouldn't yank the player off what's in it.
  const toggle = document.createElement('button');
  toggle.className = 'group-toggle';
  toggle.textContent = isOpen ? '▾' : '▸';
  toggle.title = isOpen ? 'Collapse' : `Show ${videoData.history.length} range(s)`;
  toggle.addEventListener('click', e => {
    e.stopPropagation();
    if (isOpen) expandedVideos.delete(vid);
    else expandedVideos.add(vid);
    renderHistory();
  });
  header.appendChild(toggle);

  const thumb = document.createElement('img');
  thumb.className = 'thumb';
  thumb.src = `https://img.youtube.com/vi/${vid}/default.jpg`;
  thumb.alt = '';
  thumb.loading = 'lazy';
  header.appendChild(thumb);

  const meta = document.createElement('div');
  meta.className = 'meta';
  const title = document.createElement('div');
  title.className = 'video-title';
  const titleText = videoData.title || '(no title)';
  if (isCurrent) {
    title.innerHTML = `<span class="now-playing">▶ NOW</span>${escapeHtml(titleText)}`;
  } else {
    title.textContent = titleText;
  }
  // A collapsed group shows nothing of itself, so the counts move up here.
  const idEl = document.createElement('div');
  idEl.className = 'video-id';
  const counts = [`${videoData.history.length} range(s)`];
  if (videoData.sheet) counts.push('🎼');
  idEl.textContent = `${vid} · ${counts.join(' · ')}`;
  meta.appendChild(title);
  meta.appendChild(idEl);
  header.appendChild(meta);

  // Chords are written while the video plays, so this loads it first and drops
  // you in the editor — one sheet, one place to edit it.
  const sheetBtn = document.createElement('button');
  sheetBtn.className = 'sheet-video';
  sheetBtn.textContent = '🎼';
  sheetBtn.title = videoData.sheet ? "Edit this video's chords" : 'Add chords for this video';
  sheetBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (isCurrent) { openChordEditor(); return; }
    urlInput.value = `https://youtu.be/${vid}`;
    createOrLoadPlayer(vid, () => openChordEditor());
  });
  header.appendChild(sheetBtn);

  // Clearing this video's history sits in its own header. stopPropagation keeps
  // the click off the header, whose job is to load the video.
  const clearBtn = document.createElement('button');
  clearBtn.className = 'clear-video';
  clearBtn.textContent = '🗑';
  clearBtn.title = "Clear this video's history";
  clearBtn.addEventListener('click', e => {
    e.stopPropagation();
    clearVideoHistory(vid);
  });
  header.appendChild(clearBtn);

  header.addEventListener('click', () => {
    if (isCurrent) return;
    urlInput.value = `https://youtu.be/${vid}`;
    createOrLoadPlayer(vid);
  });

  return header;
}

function renderHistoryItem(vid, entry) {
  const div = document.createElement('div');
  div.className = 'loop-item';
  // Lets a rewritten row be found again after the re-render, so it can flash.
  div.dataset.entryId = entry.id;

  const info = document.createElement('div');
  info.className = 'info';
  const range = `${formatTime(entry.start)} → ${formatTime(entry.end)}`;
  const noteHtml = entry.note ? `<div class="loop-note meta">${escapeHtml(entry.note)}</div>` : '';
  info.innerHTML =
    `<div class="loop-range-row">` +
      `<span class="loop-range">${escapeHtml(range)}</span>` +
      `<span class="meta">${escapeHtml(`${entry.speed}x`)}</span>` +
    `</div>` +
    noteHtml;
  div.appendChild(info);

  // Play doubles as "load this into the form": the entry's range, speed and note
  // land in the controls, so editing from here means playing it and nudging the
  // fields — which then records as a new entry of its own.
  const playBtn = document.createElement('button');
  playBtn.textContent = '▶ Play';
  playBtn.addEventListener('click', () => {
    if (vid !== currentVideoId) {
      createOrLoadPlayer(vid, () => playHistoryEntry(entry));
    } else {
      playHistoryEntry(entry);
    }
  });

  const delBtn = document.createElement('button');
  delBtn.textContent = '🗑';
  delBtn.title = 'Remove from history';
  delBtn.addEventListener('click', () => deleteHistoryEntry(vid, entry));

  const urlBtn = document.createElement('button');
  urlBtn.textContent = '🔗 URL';
  urlBtn.title = 'Copy share URL for this loop';
  urlBtn.addEventListener('click', () => {
    const url = buildShareUrl(vid, entry);
    copyWithFeedback(urlBtn, url, '✅ Copied!', '🔗 URL');
  });

  const mdBtn = document.createElement('button');
  mdBtn.textContent = '📝 MD';
  mdBtn.title = 'Copy Markdown link for this loop';
  mdBtn.addEventListener('click', () => {
    const md = buildShareMarkdown(vid, entry);
    copyWithFeedback(mdBtn, md, '✅ Copied!', '📝 MD');
  });

  div.appendChild(playBtn);
  div.appendChild(delBtn);
  div.appendChild(urlBtn);
  div.appendChild(mdBtn);
  return div;
}

// playedAt isn't touched here: the warmup timer records the play once it
// actually starts, and since the range matches this entry that's the same write.
function playHistoryEntry(entry) {
  setLoopActive({ start: entry.start, end: entry.end });
  applyLoopToForm(entry);
  player.seekTo(entry.start, true);
  scheduleDelayedPlay();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ============================================================
// Keyboard shortcuts
// ============================================================
document.addEventListener('keydown', e => {
  const target = document.activeElement;
  const tag = target && target.tagName;
  const inStartEnd = target === startInput || target === endInput;

  // Arrow keys inside Start / End: plain ← → are left to the browser so the
  // caret can move through the value; only Shift + ← → nudges it, by 0.05s.
  // Nudging on the bare arrows made the field impossible to edit by hand.
  if (inStartEnd && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    if (!e.shiftKey) return;
    e.preventDefault();
    const delta = e.key === 'ArrowLeft' ? -0.05 : 0.05;
    const cur = parseTime(target.value);
    const base = (cur === null || isNaN(cur)) ? 0 : cur;
    target.value = formatTime(Math.max(0, roundTo(base + delta, 2)));
    refreshUI();
    handleValueEdit(target);
    return;
  }

  // Other input/select focused → let native behavior run
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (!player || !player.getCurrentTime) return;

  if (e.code === 'Space') {
    e.preventDefault();
    if (cancelPendingPlay()) { updatePlayButton(); return; }
    const state = safeState();
    if (state === (window.YT && YT.PlayerState.PLAYING)) player.pauseVideo();
    else startPlaybackWithDelay();
  } else if (e.key === 's' || e.key === 'S') {
    e.preventDefault();
    seekToStart();
  } else if (e.key === 'l' || e.key === 'L') {
    e.preventDefault();
    loopToggle.checked = !loopToggle.checked;
    loopToggle.dispatchEvent(new Event('change'));
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    const step = e.shiftKey ? 1 : 0.05;
    player.seekTo(Math.max(0, player.getCurrentTime() - step), true);
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    const step = e.shiftKey ? 1 : 0.05;
    player.seekTo(player.getCurrentTime() + step, true);
  }
});
