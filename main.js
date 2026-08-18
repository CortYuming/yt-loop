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
const chordStrip      = document.getElementById('chordStrip');
const chordViewport   = document.getElementById('chordViewport');
const chordRevisions  = document.getElementById('chordRevisions');
const chordRevList    = document.getElementById('chordRevList');
const chordKeySelect  = document.getElementById('chordKeySelect');
const chordModeBtns   = {
  number: document.getElementById('chordModeInterval'),
  note:   document.getElementById('chordModeNote'),
  solfa:  document.getElementById('chordModeSolfa')
};
const chordShowToggle = document.getElementById('chordShowToggle');
const exportBtn       = document.getElementById('exportBtn');
const importBtn       = document.getElementById('importBtn');
const importFile      = document.getElementById('importFile');
const backupStatus    = document.getElementById('backupStatus');
const importPanel     = document.getElementById('importPanel');
const importFileName  = document.getElementById('importFileName');
const importVideosEl  = document.getElementById('importVideos');
const importHint      = document.getElementById('importHint');
const importApplyBtn  = document.getElementById('importApplyBtn');
const importCancelBtn = document.getElementById('importCancelBtn');
const importPartBoxes = {
  sheet:     document.getElementById('importSheets'),
  revisions: document.getElementById('importRevisions'),
  history:   document.getElementById('importHistory'),
  settings:  document.getElementById('importSettings')
};

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
  // The floor is 0, not YouTube's own 0.25: the slider is allowed to ask for
  // anything down to a standstill and the player takes it as far as it will go.
  currentSpeed = roundTo(Math.min(2, Math.max(0, n)), 2);
  speedRange.value = String(currentSpeed);
  speedSelect.value = hasPresetFor(currentSpeed) ? String(currentSpeed) : '';
  speedDisplay.textContent = `${currentSpeed.toFixed(2)}x`;
  if (apply && player && player.setPlaybackRate) {
    player.setPlaybackRate(currentSpeed);
  }
  updateRampLabel();
  // A speed arriving from anywhere but the ramp itself — loading a saved loop,
  // a share URL — becomes both the new starting line and the speed to return
  // to when the ramp is switched off.
  if (!fromRamp && rampOn) rampBase = currentSpeed;
}

// ============================================================
// Speed-up ramp (⏫)
// ============================================================
// Practice aid: a run from whatever speed is set when it is switched on up to
// the original tempo, gaining a notch on every completed lap. 0.05 is small
// enough that a single lap doesn't announce itself, so the speed creeps up
// without the player noticing. Starting where the slider already is means
// switching it on never jerks the tempo — you slow the part down until it is
// playable, then let it climb from there.
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

// "0.60x → 1.00x": the left side is the speed the ramp would start from while
// idle, and the live speed once it is running — the label doubles as both the
// preview and the progress readout.
function updateRampLabel() {
  rampFrom.textContent = `${getSpeed().toFixed(2)}x`;
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
    // The speed is left exactly where it is; only the lock and the label change.
    rampBase = getSpeed();
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
  // Versions belong to the video, so the list changes with it — and an edit to
  // the one just left never joins with the first edit to this one.
  lastSheetEdit = { source: null, at: 0 };
  if (!chordEditor.hidden) {
    chordInput.value = getSheet(currentVideoId);
    renderChordRevisions();
  }
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

// The sheet is one unbroken row that slides under a playhead fixed two thirds
// across the window: what is playing is always in the same place, and what is
// coming arrives from the right.
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
// Where the playhead sits across the window. Not the middle: a bar of five or
// more chords wraps to a second line inside its own width, so what is sounding
// late in such a bar is drawn well left of the playhead — and off the window
// entirely when only half of it lies behind. Two thirds keeps that in view at
// the cost of some of the lookahead. Keep .chord-playhead's left in style.css
// on the same fraction.
const PLAYHEAD_RATIO = 2 / 3;
let chordAnchors = [];  // {time, x} along the track, ascending by time
// The one bar head whose 📍 buttons are open, if any. Declared up here with the
// rest of the strip's state because the strip can be drawn before this file has
// finished evaluating.
let openTimePins = null;

// Re-reading and re-parsing the sheet on every render would be waste, so the
// parse is kept and only redone when the text can have changed.
let chordCache = { vid: null, bars: [], spans: [], key: null };
// Which fret each diagram in the row starts at, worked out over the whole sheet
// so neighbours that fit one window share it — see Chords.fretWindows. Indexed
// the way the sheet is, [bar][chord]; null where the chord takes no window.
let chordWindows = [];

function refreshChordCache() {
  const text = getSheet(currentVideoId);
  const bars = Chords.parseSheet(text);
  chordCache = {
    vid: currentVideoId, bars, spans: Chords.resolveSpans(bars), key: Chords.parseKey(text),
  };
  return chordCache;
}

// The key the sheet on screen is in. Read from the parse rather than the text,
// so every drawing of a dot costs nothing.
function currentChordKey() {
  if (chordCache.vid !== currentVideoId) refreshChordCache();
  return chordCache.key;
}

function chordSlotWidth() {
  const w = chordViewport.clientWidth || 860;
  return Math.max(60, Math.min(SLOT_MAX, Math.floor(w / SLOTS_PER_BAR)));
}

// `fromCache` redraws from the parsed sheet already in memory instead of
// re-reading the text. Editing works on that copy, and it can hold a chord with
// no name yet — which the text deliberately does not — so adding and removing
// must not go back to the text for the shape of what they have just changed.
function renderChordStrip(fromCache) {
  if (!currentVideoId) {
    chordSection.hidden = true;
    return;
  }
  chordSection.hidden = false;
  updateChordKeySelect();
  // The key decides whether solfège is on offer at all, so the pill is brought
  // up to date wherever the sheet is.
  updateChordModeBtns();
  const visible = getChordsVisible();
  if (!visible) { chordEditor.hidden = true; closeNotePanel(); }
  syncChordEditMode();
  chordViewport.hidden = !visible;
  if (!visible) return;

  const { bars, spans } = fromCache && chordCache.vid === currentVideoId
    ? chordCache
    : refreshChordCache();
  chordWindows = Chords.fretWindows(bars);
  // The clef and signature are drawn outside the strip — see below — so the pair
  // from the last draw is cleared here rather than with the strip's contents.
  const staleHead = chordViewport.querySelector('.chord-staff-head');
  if (staleHead) staleHead.remove();
  chordStrip.textContent = '';
  chordStrip.style.transform = '';
  chordAnchors = [];
  openTimePins = null;   // the head holding them has just been thrown away

  if (bars.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    // With the editor open, saying "🎼 Edit to write some" is telling someone to
    // do what they have already done. What is missing then is a first bar, and
    // the box above is only one of the two ways to make one.
    empty.textContent = chordEditor.hidden
      ? 'No chords for this video yet — 🎼 Edit to write some.'
      : 'Nothing written yet — + Bar starts one, or type in the box above.';
    chordStrip.appendChild(empty);
    if (!chordEditor.hidden) chordStrip.appendChild(addBarButton());
    return;
  }

  const slot = chordSlotWidth();
  chordStrip.style.setProperty('--slot', `${slot}px`);
  // How high and low the staff has to reach, measured over the whole sheet so
  // every bar draws its five lines in the same place and they meet across the
  // row. Null when nothing in the sheet has a fingering — there is no music to
  // put on a staff then, and an empty one is height taken for nothing.
  const key = chordCache.key;
  const staffReach = Chords.staffRange(bars, key);
  // A tab row only where there are single notes to put on it: an empty one is
  // height taken for nothing, and most sheets are chords alone.
  const showTab = Chords.hasNotes(bars);
  // The clef is pinned to the foot of a bar, so it has to know how much of that
  // foot the tab row is taking. 2px is .chord-tab's own margin.
  chordViewport.style.setProperty('--tab-h', showTab ? `${Chords.tabHeight() + 2}px` : '0px');
  // Clef and key signature go at the head of the row, where printed music puts
  // them. They are also what every accidental after them is read against — which
  // notes the staff has already flattened is a question asked in the middle of
  // the tune, not at its start — and a row that scrolls carries them off the
  // left within a bar or two. So the row keeps the space they take, and the
  // signs themselves are drawn in a layer that does not move with it.
  // Everything after starts that much further along, which is why x does not
  // start at zero.
  let x = 0;
  if (staffReach) {
    const gap = document.createElement('div');
    gap.className = 'chord-staff-gap';
    gap.style.width = `${Chords.staffHeadWidth(key)}px`;
    chordStrip.appendChild(gap);
    const head = document.createElement('div');
    head.className = 'chord-staff-head';
    head.appendChild(Chords.staffHead(staffReach, key));
    chordViewport.appendChild(head);
    x = Chords.staffHeadWidth(key);
  }
  let lastTime = null;   // anchor times, which only ever move forward
  let prevEnd = null;    // the furthest the sheet has reached, for spotting holes

  // Along the strip time only goes one way. A sheet can say otherwise — two
  // phrases written from links that overlap, a bar counted in both — and read
  // literally that scrolls the row backwards, which reads as the app losing its
  // place. A bar that starts before the sheet has got there keeps its position
  // in the row and gives up its width in time: the playhead crosses it at once
  // rather than rewinding for it.
  const anchor = (time, at) => {
    const t = lastTime === null ? time : Math.max(time, lastTime);
    chordAnchors.push({ time: t, x: at });
    lastTime = t;
  };

  bars.forEach((bar, i) => {
    const weights = Chords.slotWeights(bar.chords.length);
    // Every bar is the same four slots wide. One holding more chords than that
    // stacks them four to a line within its own width instead of growing wider,
    // which would run it past the others and take the even pace with it.
    const width = SLOTS_PER_BAR * slot;
    const outer = width + BAR_BORDER;

    // A stretch of music the sheet says nothing about is drawn as the blank it
    // is, as wide as this bar's own pace makes those seconds. The row then runs
    // at one speed through the hole and arrives on the next bar in time.
    // Standing still under the playhead until the music caught up looked like
    // scrolling had stopped, which is the one thing the row must never look
    // like — it is how you tell playback is alive.
    if (spans[i].start !== null && spans[i].end !== null
        && prevEnd !== null && spans[i].start > prevEnd) {
      const gap = document.createElement('div');
      gap.className = 'chord-gap';
      const gapW = (spans[i].start - prevEnd) * (outer / (spans[i].end - spans[i].start));
      gap.style.width = `${gapW}px`;
      chordStrip.appendChild(gap);
      x += gapW;
    }

    const barEl = document.createElement('div');
    barEl.className = 'chord-bar';
    barEl.style.width = `${width}px`;
    barEl.dataset.bar = String(i);

    const head = document.createElement('div');
    head.className = 'chord-bar-head';
    const label = document.createElement('span');
    label.className = 'chord-bar-no';
    label.textContent = String(i + 1);
    head.appendChild(label);
    // A bar with a time on it carries the loop controls for that moment; one
    // without is just its number.
    if (spans[i].start !== null) head.appendChild(barTimePins(spans[i].start));
    // Only of use while editing, so it is hidden with the editor closed — see
    // .editing-mode in style.css. Chords are otherwise added from the cell that
    // has the caret; this is how a bar emptied of all of them is started again.
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'chord-add';
    addBtn.textContent = '+';
    addBtn.title = 'Add a chord to this bar';
    addBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const bar = chordCache.bars[i];
      if (bar) insertChord(i, bar.chords.length);
    });
    head.appendChild(addBtn);
    barEl.appendChild(head);

    const cells = document.createElement('div');
    cells.className = 'chord-bar-cells';
    bar.chords.forEach((chord, j) => {
      const cell = renderChord(chord, i, j);
      cell.style.width = `${weights[j] * slot}px`;
      cells.appendChild(cell);
    });
    barEl.appendChild(cells);

    // The same bar again, as the notes it sounds. Each chord sits at the beat
    // it starts on — the left edge of its cell — rather than under the middle
    // of its diagram, since what the staff is showing is when as much as what.
    // Past four chords the cells wrap and there are no beat edges to follow, so
    // those are spread evenly across the bar instead.
    if (staffReach) {
      const wide = bar.chords.length > SLOTS_PER_BAR;
      let cellX = 0;
      const items = bar.chords.map((chord, j) => {
        const at = wide ? (j * width) / bar.chords.length : cellX;
        cellX += weights[j] * slot;
        // Which of this stretch's notes is being edited, so the strip can mark it.
        const sel = notePanelAt && notePanelAt.bar === i && notePanelAt.chord === j
          ? noteSel : null;
        return { x: at, name: chord.name, markers: chord.markers, notes: chord.notes, sel };
      });
      // A bar is four slots wide, so one slot is one beat — which is what the
      // notes inside a chord's stretch are placed by.
      const staff = Chords.staffBar(items, width, staffReach, key, effectiveChordMode(), slot);
      staff.setAttribute('class', 'chord-staff');
      barEl.appendChild(staff);
      if (showTab) {
        const tab = Chords.tabBar(items, width, key, effectiveChordMode(), slot);
        tab.setAttribute('class', 'chord-tab');
        barEl.appendChild(tab);
      }
    }

    chordStrip.appendChild(barEl);

    // Time is pinned to the bar's two edges. Inside, the chords already sit
    // where their beats fall, so a straight line between the edges puts each
    // one under the playhead exactly when it sounds.
    if (spans[i].start !== null) {
      anchor(spans[i].start, x);
      if (spans[i].end !== null) {
        anchor(spans[i].end, x + outer);
        prevEnd = prevEnd === null ? spans[i].end : Math.max(prevEnd, spans[i].end);
      }
    }
    x += outer;
  });

  // The way to a bar that isn't there yet, at the end of the row where the next
  // one goes. Only while editing: with the editor closed the row is something to
  // read, and a button in it is a button in the music.
  if (!chordEditor.hidden) chordStrip.appendChild(addBarButton());

  // Built in the order they are drawn and clamped as they go, so the list is
  // already ascending — sorting it would only shuffle bars the sheet overlapped.
  updateChordScroll(currentPlaybackTime());
  // The panel is drawn against the same parse, so it follows the strip rather
  // than keeping whatever it said before the sheet changed.
  if (notePanelAt) renderNotePanel();
}

// A bar that isn't there yet. It starts where the last one ends, which is what
// a transcription does — bar after bar — and at the playhead when there is no
// last one to follow. The bar arrives holding one empty chord, so it is a cell
// with a name box and a ♪ rather than an empty box nobody can write into: the
// sheet still keeps nothing until something is actually typed or tapped.
function addBar() {
  const bars = chordCache.bars;
  const spans = Chords.resolveSpans(bars);
  const last = spans[spans.length - 1];
  const after = last ? (last.end !== null ? last.end : last.start) : null;
  const start = roundTo(after === null ? currentPlaybackTime() : after, 2);
  bars.push({ start, end: null, chords: [{ name: '', markers: null }] });
  // The cached spans are worked out per parse, and this adds a bar to that parse
  // without going back through it — so they are recomputed here or the new bar
  // has no timing at all.
  chordCache.spans = Chords.resolveSpans(bars);
  writeSheetFromCache();
  renderChordStrip(true);
  // Straight into the name box of the bar just made: the button was pressed to
  // write something, and the caret is where writing starts.
  const cells = chordStrip.querySelectorAll('.chord-fields');
  const cell = cells[cells.length - 1];
  const box = cell && cell.querySelector('.chord-edit-box');
  if (box) box.focus();
}

function addBarButton() {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chord-add-bar';
  b.textContent = '+ Bar';
  b.title = 'Add a bar, starting where the last one ends';
  b.addEventListener('mousedown', e => e.preventDefault());
  b.addEventListener('click', e => { e.preventDefault(); addBar(); });
  return b;
}

// The time in a bar head, which is also how a loop is marked out from the
// sheet: click it and start📍 / end📍 appear, each dropping that bar's moment
// into the box it names. Setting a range by ear means catching it twice as it
// goes past; the sheet already knows where the bars are, so picking the two
// ends off it is the accurate way — click bar 5's time for the start, bar 9's
// for the end. The buttons stay hidden until asked for because every bar has a
// time, and a pair of them under each would bury the chords.
function barTimePins(time) {
  const wrap = document.createElement('span');
  wrap.className = 'chord-bar-time';

  const face = document.createElement('button');
  face.type = 'button';
  face.className = 'chord-time-face';
  face.textContent = formatTime(time);
  face.title = 'Use this time as the loop start or end';

  const pins = document.createElement('span');
  pins.className = 'chord-time-pins';
  const pin = (text, title, input) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chord-time-pin';
    b.textContent = text;
    b.title = title;
    // Same reason as the chord ops: taking focus can blur an open box, which
    // writes the sheet back and redraws the strip out from under this click.
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      input.value = formatTime(time);
      refreshUI();
      handleValueEdit(input);
      closeChordTimePins();
    });
    pins.appendChild(b);
  };
  pin('start📍', 'Set this time as the loop start', startInput);
  pin('end📍', 'Set this time as the loop end', endInput);

  face.addEventListener('mousedown', e => e.preventDefault());
  face.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    const wasOpen = wrap.classList.contains('open');
    closeChordTimePins();
    if (!wasOpen) {
      wrap.classList.add('open');
      openTimePins = wrap;
    }
  });

  wrap.appendChild(face);
  wrap.appendChild(pins);
  return wrap;
}

function closeChordTimePins() {
  if (openTimePins) openTimePins.classList.remove('open');
  openTimePins = null;
}

// Anywhere else is a way out: the buttons are a question, and going back to the
// music is a legitimate answer to it.
document.addEventListener('click', e => {
  if (!openTimePins) return;
  if (e.target.closest && e.target.closest('.chord-bar-time')) return;
  closeChordTimePins();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeChordTimePins();
});

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

// The inverse: where along the track a point sits, in seconds. Anchors are
// built left to right, so their x is already ascending and the same walk works
// on either axis.
function chordTimeForX(x) {
  const a = chordAnchors;
  if (a.length === 0) return 0;
  if (a.length === 1) return a[0].time;
  const last = a.length - 1;
  const between = (i, j) => {
    const span = a[j].x - a[i].x;
    return span > 0 ? (a[j].time - a[i].time) / span : 0;
  };
  if (x <= a[0].x) return a[0].time + (x - a[0].x) * between(0, 1);
  if (x >= a[last].x) return a[last].time + (x - a[last].x) * between(last - 1, last);
  for (let i = 0; i < last; i++) {
    if (x < a[i + 1].x) return a[i].time + (x - a[i].x) * between(i, i + 1);
  }
  return a[last].time;
}

// A transform and nothing else, so the compositor can carry it without a
// layout pass. Both the clock and the dragging hand come through here.
function placeChordStrip(x) {
  const playhead = chordViewport.clientWidth * PLAYHEAD_RATIO;
  chordStrip.style.transform = `translateX(${playhead - x}px)`;
}

// A seek takes tens of milliseconds to land, and until it does the player still
// reports the old time. Read literally that snaps the strip back to where the
// drag started for a few frames before it jumps forward, which looks like the
// drag was refused. Hold the dropped position until the clock catches up.
const SEEK_SETTLE_MS = 600;
let pendingSeek = null;   // { time, until }
// Declared up here because updateChordScroll below reads it, and the strip can
// be drawn before this file has finished evaluating.
let chordDrag = null;     // { pointerId, fromX, baseX, moved }

function settledTime(t) {
  if (!pendingSeek) return t;
  if (performance.now() > pendingSeek.until || Math.abs(t - pendingSeek.time) < 0.3) {
    pendingSeek = null;
    return t;
  }
  return pendingSeek.time;
}

// Called from the playback clock.
function updateChordScroll(t) {
  if (!currentVideoId || chordSection.hidden || !getChordsVisible()) return;
  if (chordAnchors.length === 0) return;
  if (chordDrag && chordDrag.moved) return;   // the hand has the row
  // The cell holding the caret stays where it is: sliding a box out from under
  // a word being typed is the one thing worse than not scrolling.
  if (chordStrip.contains(document.activeElement)) return;
  placeChordStrip(chordXForTime(settledTime(t)));
}

// ---------- dragging the strip ----------
// The row is a timeline you can take hold of: drag it and the playhead comes
// with it, so pulling the previous bar under the marker is how you wind the
// music back a phrase. A press that barely moves is left alone — that is a
// click on a chord, and a chord opens the fretboard viewer.
const CHORD_DRAG_SLOP = 6;
let suppressChordClick = false;

function chordDragX(drag, clientX) {
  return drag.baseX - (clientX - drag.fromX);
}

function seekFromStrip(x) {
  const wanted = Math.max(0, chordTimeForX(x));
  let duration = 0;
  try {
    duration = player && typeof player.getDuration === 'function' ? player.getDuration() : 0;
  } catch (e) { duration = 0; }
  const time = duration > 0 ? Math.min(wanted, duration) : wanted;
  // Drawn from the clamped time, so a drag past either end of the video settles
  // on the frame it actually seeks to rather than out in the blank.
  placeChordStrip(chordXForTime(time));
  currentTimeEl.textContent = formatTime(time);
  if (!player || typeof player.seekTo !== 'function') return;
  // seekTo while PLAYING bounces the player through BUFFERING back to PLAYING;
  // claim that as ours so the state handler doesn't read it as someone else
  // starting playback and pause it for the warm-up delay.
  if (safeState() === (window.YT && YT.PlayerState.PLAYING)) intentionalPlay = true;
  player.seekTo(time, true);
  pendingSeek = { time, until: performance.now() + SEEK_SETTLE_MS };
}

chordViewport.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (chordAnchors.length === 0) return;   // a sheet with no times has no timeline
  // A press on a box or a button is aiming at that, not at the strip: the caret
  // has to be placeable and a word has to be selectable by dragging over it.
  if (e.target.closest
      && e.target.closest('.chord-edit-box, .chord-ops, .chord-add, .chord-bar-time')) return;
  chordDrag = {
    pointerId: e.pointerId,
    fromX: e.clientX,
    baseX: chordXForTime(settledTime(currentPlaybackTime())),
    moved: false,
  };
});

chordViewport.addEventListener('pointermove', e => {
  if (!chordDrag || e.pointerId !== chordDrag.pointerId) return;
  if (!chordDrag.moved) {
    if (Math.abs(e.clientX - chordDrag.fromX) < CHORD_DRAG_SLOP) return;
    chordDrag.moved = true;
    chordViewport.classList.add('dragging');
    // Capture, so a fast drag that leaves the strip keeps being followed.
    try { chordViewport.setPointerCapture(e.pointerId); } catch (err) { /* no-op */ }
  }
  placeChordStrip(chordDragX(chordDrag, e.clientX));
  e.preventDefault();
});

function endChordDrag(e, seek) {
  if (!chordDrag || e.pointerId !== chordDrag.pointerId) return;
  const drag = chordDrag;
  chordDrag = null;
  chordViewport.classList.remove('dragging');
  try { chordViewport.releasePointerCapture(drag.pointerId); } catch (err) { /* no-op */ }
  if (!drag.moved) return;   // a tap: leave it to the chord's own link
  // The click this pointerup is about to fire would open the viewer for
  // whichever chord the finger came to rest on. It was a drag, so swallow it.
  suppressChordClick = true;
  if (seek) seekFromStrip(chordDragX(drag, e.clientX));
  else updateChordScroll(currentPlaybackTime());
}

chordViewport.addEventListener('pointerup', e => endChordDrag(e, true));
// A cancelled pointer has no landing place — the browser took the gesture — so
// the strip goes back to following the clock instead of seeking somewhere the
// finger never chose.
chordViewport.addEventListener('pointercancel', e => endChordDrag(e, false));

chordViewport.addEventListener('click', e => {
  if (!suppressChordClick) return;
  suppressChordClick = false;
  e.preventDefault();
  e.stopPropagation();
}, true);

// A note in the strip is a way into the panel: clicking one opens the stretch it
// belongs to and selects it. Only while editing — with the editor closed the
// strip is something you read, and a click on it is the fretboard-viewer link.
chordStrip.addEventListener('click', e => {
  if (chordEditor.hidden) return;
  const hit = e.target.closest && e.target.closest('.staff-hit');
  if (!hit) return;
  const barEl = hit.closest('.chord-bar');
  if (!barEl) return;
  e.preventDefault();
  selectNote(Number(barEl.dataset.bar), Number(hit.dataset.chord), Number(hit.dataset.note));
});

window.addEventListener('resize', () => {
  // The redraw throws the boxes away, so what is in the open one is kept first.
  commitFocusedChordCell();
  renderChordStrip();
});

// A chord in the strip. With the editor closed it is a link to the fretboard
// viewer — the whole cell, diagram included, since the shape is the larger and
// the more obvious half of a chord. With the editor open it is instead the pair
// of boxes the chord is written in, ready to be typed into.
// The time belongs to the bar, printed once in its header — a stamp under every
// chord was four times the number for a quarter of the confidence, since a
// chord's own moment is only its bar divided evenly.
function renderChord(chord, barIndex, chordIndex) {
  const windowFrom = (chordWindows[barIndex] || [])[chordIndex];
  if (!chordEditor.hidden) return renderChordFields(chord, barIndex, chordIndex, windowFrom);
  // A stretch of single notes with no fingering picked has nothing to put in the
  // diagram row: its cell would be the chord name and nothing else, printed a
  // second time directly above the name the staff already carries. So the cell
  // keeps its width — the bar is still four slots — and says nothing.
  if (!chord.markers && chord.notes && chord.notes.length) {
    const blank = document.createElement('div');
    blank.className = 'chord chord-notes-only';
    return blank;
  }
  return renderChordLink(chord, windowFrom);
}

function renderChordLink(chord, windowFrom) {
  const box = document.createElement('a');
  box.className = 'chord';
  box.href = Chords.viewerUrl(chord);
  box.target = '_blank';
  box.rel = 'noopener';
  box.title = 'Open in Guitar Chord Viewer';
  // Without this a drag starting on a chord becomes the browser's own link
  // drag — a ghost of the URL follows the cursor and the strip stays put.
  box.draggable = false;

  const name = document.createElement('span');
  name.className = 'chord-name';
  name.textContent = Chords.displayName(chord.name);
  box.appendChild(name);
  box.appendChild(
    Chords.diagram(chord.markers, chord.name, effectiveChordMode(), currentChordKey(), windowFrom),
  );
  return box;
}

// ---------- editing, in place ----------
// With the editor open every chord is already its two boxes — name and frets —
// with the diagram under them redrawn as they are typed. Nothing has to be
// clicked first: the mode is the invitation. The controls for adding and
// removing chords belong to whichever cell holds the caret, since four buttons
// under every chord in the sheet would be unreadable.
function renderChordFields(chord, barIndex, chordIndex, windowFrom) {
  const box = document.createElement('div');
  box.className = 'chord chord-fields';
  box.dataset.bar = String(barIndex);
  box.dataset.chord = String(chordIndex);

  const name = document.createElement('input');
  name.className = 'chord-edit-box';
  name.value = chord.name;
  name.spellcheck = false;
  name.placeholder = 'Chord';
  name.setAttribute('aria-label', `Bar ${barIndex + 1}, chord ${chordIndex + 1}`);

  const frets = document.createElement('input');
  frets.className = 'chord-edit-box chord-edit-frets';
  frets.value = chord.markers ? Chords.markersToText(chord.markers) : '';
  frets.spellcheck = false;
  frets.placeholder = '6.8.7.6..';
  frets.setAttribute('aria-label', 'Frets, 1st string first');

  // The buttons sit with the boxes rather than under the diagram. Under it they
  // read as belonging to the picture, and which chord a row of them acted on was
  // a guess; directly below what they edit, they belong to it plainly.
  const ops = chordOps(barIndex, chordIndex, name, frets);
  box.appendChild(name);
  box.appendChild(frets);
  box.appendChild(ops);
  box.appendChild(
    Chords.diagram(chord.markers, chord.name, effectiveChordMode(), currentChordKey(), windowFrom),
  );

  const redraw = () => {
    const old = box.querySelector('svg');
    if (old) old.remove();
    box.appendChild(
      // The window the row settled on is offered to what is being typed too, so
      // the board does not jump about mid-edit; a shape that outgrows it falls
      // back to its own window until the next redraw settles the row again.
      Chords.diagram(
        Chords.readMarkers(frets.value), name.value, effectiveChordMode(), currentChordKey(),
        windowFrom,
      ),
    );
  };

  [name, frets].forEach(input => {
    input.addEventListener('input', () => {
      // A link dropped in either box is unpacked into both: that is how a shape
      // arrives from the viewer, and splitting it by hand is the fiddly part.
      // Only a link is taken apart — plain typing is left exactly as typed,
      // since rewriting a name halfway through it is maddening.
      if (/^\s*\[|^\s*https?:\/\//i.test(input.value)) {
        const pasted = Chords.readChord(input.value);
        if (pasted) {
          name.value = pasted.name;
          frets.value = pasted.markers ? Chords.markersToText(pasted.markers) : '';
        }
      }
      redraw();
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') {
        // Back to what the sheet last agreed to, which is what `chord` still
        // holds — nothing is written until the caret leaves the cell.
        e.preventDefault();
        name.value = chord.name;
        frets.value = chord.markers ? Chords.markersToText(chord.markers) : '';
        redraw();
        input.blur();
      }
    });
    // Moving between the boxes and the buttons is one visit to the cell;
    // leaving it altogether is what writes the sheet back.
    input.addEventListener('blur', e => {
      if (e.relatedTarget && box.contains(e.relatedTarget)) return;
      commitChordCell(box);
    });
  });

  return box;
}

// Add before, add after, remove, and a way out to the viewer — the last of
// which the cell used to be, before it became something you type in.
function chordOps(barIndex, chordIndex, name, frets) {
  const ops = document.createElement('div');
  ops.className = 'chord-ops';
  const button = (text, title, run) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chord-op';
    b.textContent = text;
    b.title = title;
    // Taking focus would blur the box, which writes the sheet back and can
    // redraw the strip out from under the click that is still in flight.
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); run(); });
    ops.appendChild(b);
  };
  // Laid out as the sheet reads: the arrows point at the gaps they fill, and
  // remove sits between them where the chord itself is. A run of the same chord
  // is the common shape of a bar — one voicing held while the tune moves — so
  // beside each empty insert there is one that carries this chord with it.
  button('+←', 'Add a chord before this one', () => insertChord(barIndex, chordIndex));
  button('⧉←', 'Copy this chord to the left', () => copyChord(barIndex, chordIndex, chordIndex));
  button('🗑', 'Remove this chord', () => removeChord(barIndex, chordIndex));
  button('⧉→', 'Copy this chord to the right', () => copyChord(barIndex, chordIndex, chordIndex + 1));
  button('+→', 'Add a chord after this one', () => insertChord(barIndex, chordIndex + 1));
  // The way in to the notes played over this chord. A stretch of single notes is
  // a different kind of thing from a voicing — a row of moments rather than one
  // — so it is written on a board of its own rather than in a third box here.
  button('♪', 'Write the single notes played over this chord',
    () => openNotePanel(barIndex, chordIndex));
  button('↗', 'Open in Guitar Chord Viewer', () => {
    const url = Chords.viewerUrl({ name: name.value, markers: Chords.readMarkers(frets.value) });
    window.open(url, '_blank', 'noopener');
  });
  return ops;
}

// The boxes read back into the parsed sheet, and the sheet rewritten from it.
// Nothing is redrawn: the cell already shows what it says, and rebuilding the
// strip would take the caret with it.
function commitChordCell(box) {
  if (!box || chordCache.vid !== currentVideoId) return;
  // A restore throws these boxes away while one of them still holds the caret.
  // The blur that follows would write the old text straight back over what was
  // just restored, so during a restore a cell has nothing to say.
  if (restoringSheet) return;
  const bar = chordCache.bars[Number(box.dataset.bar)];
  const chord = bar && bar.chords[Number(box.dataset.chord)];
  if (!chord) return;
  const boxes = box.querySelectorAll('.chord-edit-box');
  const typed = Chords.readChord(boxes[0].value);
  const name = typed ? typed.name : '';
  const markers = Chords.readMarkers(boxes[1].value);
  const same = name === chord.name
    && Chords.markersToText(markers || []) === Chords.markersToText(chord.markers || []);
  if (same) return;
  chord.name = name;
  chord.markers = markers;
  writeSheetFromCache();
}

function commitFocusedChordCell() {
  const el = document.activeElement;
  commitChordCell(el && el.closest ? el.closest('.chord-fields') : null);
}

// An unnamed chord is one still being written, not one to keep: it stays in the
// parsed sheet and on the screen, but the text is built without it. So a box
// left empty leaves no trace, and a bar emptied of chords drops out with them —
// the sheet only ever holds what someone actually wrote.
// A stretch carrying notes is kept whether it has a name or not: a phrase
// written with nothing said about the harmony is a perfectly ordinary thing to
// write down, and it is certainly not a half-typed chord.
function writeSheetFromCache(source) {
  const kept = c => c.name || (c.notes && c.notes.length);
  const bars = chordCache.bars
    .map(bar => ({ start: bar.start, end: bar.end, chords: bar.chords.filter(kept) }))
    .filter(bar => bar.chords.length);
  const key = chordCache.key;
  const text = Chords.toCompact(bars, '\n', key ? key.label : '');
  editSheet(text, source || 'cell');
  chordInput.value = text;
}

// ============================================================
// Single notes (♪)
// ============================================================
// The notes played over a chord, written by tapping them on a board of the whole
// neck. Where a note falls is never typed: it lands after the one before it and
// the durations stack up, so re-timing one slides everything after it along —
// which is the whole reason the position is not a number you have to keep.
//
// The panel sits under the strip rather than inside the cell it edits. The strip
// scrolls sideways under a fixed playhead, and a panel riding in it would leave
// the window as soon as the music moved.
const notePanel = document.getElementById('notePanel');
// Which stretch is being written into, held as a position rather than as the
// object: the sheet can be re-parsed under the panel — someone types in the
// textarea — and a held object would then be editing a copy nobody can see.
let notePanelAt = null;
// The note being edited, or null while writing at the end. Clicking a note in
// the strip is what puts one here.
let noteSel = null;
let noteDur = 0.5;
let noteDotted = false;
// While on, a tap piles onto the last note instead of following it, which is how
// a double stop gets written.
let noteStack = false;

const NOTE_DURATIONS = [
  [4, 'Whole'], [2, 'Half'], [1, 'Quarter'], [0.5, 'Eighth'], [0.25, 'Sixteenth'],
];
const noteValue = () => noteDur * (noteDotted ? 1.5 : 1);

function noteStretch() {
  if (!notePanelAt || chordCache.vid !== currentVideoId) return null;
  const bar = chordCache.bars[notePanelAt.bar];
  const chord = bar && bar.chords[notePanelAt.chord];
  return chord || null;
}

// How many beats this chord holds — its share of the bar, the same split the
// cells above are laid out by. What the panel measures a phrase against.
function noteStretchBeats() {
  const bar = notePanelAt && chordCache.bars[notePanelAt.bar];
  if (!bar) return Chords.BEATS_PER_BAR;
  const weights = Chords.beatWeights(bar.chords.length);
  return weights[notePanelAt.chord] || weights[weights.length - 1];
}

function noteEntries() {
  const chord = noteStretch();
  if (!chord) return [];
  if (!chord.notes) chord.notes = [];
  return chord.notes;
}

function editingNote() {
  const notes = noteEntries();
  return noteSel !== null ? notes[noteSel] || null : null;
}

function openNotePanel(barIndex, chordIndex) {
  notePanelAt = { bar: barIndex, chord: chordIndex };
  noteSel = null;
  renderNotePanel();
  notePanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeNotePanel() {
  notePanelAt = null;
  noteSel = null;
  if (!notePanel) return;
  notePanel.hidden = true;
  notePanel.textContent = '';
}

// Every change goes the same way out: into the sheet, then back onto the strip
// and the panel. The strip is redrawn from the parse rather than from the text,
// since the parse is what was just edited.
function commitNotes() {
  writeSheetFromCache('notes');
  renderChordStrip(true);
  renderNotePanel();
}

// A tap on the board. With a note selected it replaces that note — which is how
// one written on the wrong string is corrected — and otherwise it writes a new
// one after the last.
function pressStop(string, fret) {
  const notes = noteEntries();
  const ev = editingNote();
  if (ev) {
    if (noteStack && !ev.tie) {
      ev.stops = (ev.stops || []).concat([{ string, fret }]);
      delete ev.rest;
    } else {
      notes[noteSel] = { d: ev.d, stops: [{ string, fret }] };
    }
    commitNotes();
    return;
  }
  const last = notes[notes.length - 1];
  if (noteStack && last && !last.rest && !last.tie) last.stops.push({ string, fret });
  else notes.push({ d: noteValue(), stops: [{ string, fret }] });
  commitNotes();
}

// Rest and tie do the same double duty as the board: they turn the selected note
// into one, or write one at the end.
function addNoteRest() {
  const notes = noteEntries();
  const ev = editingNote();
  if (ev) notes[noteSel] = { d: ev.d, rest: true, stops: [] };
  else notes.push({ d: noteValue(), rest: true, stops: [] });
  commitNotes();
}

function addNoteTie() {
  const notes = noteEntries();
  const ev = editingNote();
  if (ev) notes[noteSel] = { d: ev.d, tie: true, stops: [] };
  else notes.push({ d: noteValue(), tie: true, stops: [] });
  commitNotes();
}

// The duration buttons set what comes next, or re-time what is selected.
function setNoteDur(d) {
  const ev = editingNote();
  if (ev) { ev.d = Chords.isDottedDur(ev.d) ? d * 1.5 : d; commitNotes(); return; }
  noteDur = d;
  renderNotePanel();
}

function toggleNoteDot() {
  const ev = editingNote();
  if (ev) {
    ev.d = Chords.isDottedDur(ev.d) ? ev.d / 1.5 : ev.d * 1.5;
    commitNotes();
    return;
  }
  noteDotted = !noteDotted;
  renderNotePanel();
}

function deleteNote() {
  const notes = noteEntries();
  const at = noteSel !== null ? noteSel : notes.length - 1;
  if (at < 0 || at >= notes.length) return;
  notes.splice(at, 1);
  if (noteSel !== null) noteSel = notes.length ? Math.min(at, notes.length - 1) : null;
  commitNotes();
}

// Walking the selection. Off either end lands back on writing at the end, which
// is the state the panel opens in.
function stepNote(by) {
  const notes = noteEntries();
  if (!notes.length) return;
  const at = noteSel !== null ? noteSel + by : (by > 0 ? 0 : notes.length - 1);
  noteSel = at < 0 || at >= notes.length ? null : at;
  renderNotePanel();
}

// Clicking a note in the strip selects it — see the staff's own click handler.
function selectNote(barIndex, chordIndex, index) {
  const same = notePanelAt && notePanelAt.bar === barIndex && notePanelAt.chord === chordIndex;
  notePanelAt = { bar: barIndex, chord: chordIndex };
  noteSel = same && noteSel === index ? null : index;
  renderNotePanel();
}

function renderNotePanel() {
  if (!notePanel) return;
  const chord = noteStretch();
  // The panel is part of editing: with the editor closed, or the strip hidden,
  // there is nothing for it to be open over.
  if (!chord || chordEditor.hidden || !getChordsVisible()) { closeNotePanel(); return; }
  // Typing in the panel's own name box redraws the strip, and the strip redraws
  // the panel — which would take the caret out of the box mid-word. So while it
  // holds the caret the panel is left exactly as it is.
  if (document.activeElement && document.activeElement.classList
      && document.activeElement.classList.contains('note-panel-name')) return;
  const notes = noteEntries();
  if (noteSel !== null && noteSel >= notes.length) noteSel = notes.length ? notes.length - 1 : null;
  const ev = editingNote();
  const beats = noteStretchBeats();
  const used = notes.reduce((a, n) => a + n.d, 0);

  notePanel.hidden = false;
  notePanel.textContent = '';

  const head = document.createElement('p');
  head.className = 'note-panel-head';
  const what = document.createElement('span');
  what.className = 'note-panel-what';
  what.textContent = `♪ bar ${notePanelAt.bar + 1}, `
    + `${beats} beat${beats === 1 ? '' : 's'}`;
  const mode = document.createElement('span');
  mode.className = 'note-panel-mode';
  mode.textContent = ev
    ? `editing note ${noteSel + 1} of ${notes.length} — a tap replaces it`
    : 'adding at the end — a tap follows the last note';
  // A phrase is often written before there is a chord over it — the notes are
  // what was heard, the harmony is what it turns out to be. So the name can be
  // put on from here, without going back up to the cell.
  const nameBox = document.createElement('input');
  nameBox.className = 'note-panel-name';
  nameBox.value = chord.name;
  nameBox.placeholder = 'Chord';
  nameBox.spellcheck = false;
  nameBox.setAttribute('aria-label', 'Chord over these notes');
  nameBox.addEventListener('input', () => {
    // A viewer link pasted here is unpacked, the same as in the cell's box.
    const typed = Chords.readChord(nameBox.value);
    chord.name = typed ? typed.name : '';
    if (typed && typed.markers) chord.markers = typed.markers;
    writeSheetFromCache('text');
    renderChordStrip(true);
  });
  nameBox.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); nameBox.blur(); }
    e.stopPropagation();
  });
  nameBox.addEventListener('blur', () => renderNotePanel());

  const room = document.createElement('span');
  // What is written against what there is room for. Overrunning is allowed —
  // a phrase is often written before its bar's timing is right — but it is said
  // out loud, since the overrun is drawn past the bar and reads as a mistake in
  // the sheet otherwise.
  room.className = 'note-panel-room' + (used > beats + 1e-6 ? ' over' : '');
  room.textContent = `${notes.length} note${notes.length === 1 ? '' : 's'}, ${used} beat`
    + `${used === 1 ? '' : 's'} written`;
  head.append(what, nameBox, mode, room);
  notePanel.appendChild(head);

  const tools = document.createElement('div');
  tools.className = 'note-tools';
  const button = (content, title, run, on, cls) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'note-tool' + (cls ? ` ${cls}` : '') + (on ? ' on' : '');
    b.title = title;
    if (typeof content === 'string') b.textContent = content;
    else b.appendChild(content);
    // Taking focus would blur an open chord box, which writes the sheet back and
    // redraws the strip out from under the click that is still in flight.
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', e => { e.preventDefault(); run(); });
    tools.appendChild(b);
    return b;
  };
  const gap = () => {
    const d = document.createElement('span');
    d.className = 'note-tool-gap';
    tools.appendChild(d);
  };

  const shown = ev ? (Chords.isDottedDur(ev.d) ? ev.d / 1.5 : ev.d) : noteDur;
  const shownDot = ev ? Chords.isDottedDur(ev.d) : noteDotted;
  NOTE_DURATIONS.forEach(([d, name], i) => {
    const b = button(
      Chords.noteGlyph(d, false, 0.8),
      `${ev ? `Re-time this note as a ${name.toLowerCase()}` : name} (key ${i + 1})`,
      () => setNoteDur(d), shown === d, 'note-dur',
    );
    const badge = document.createElement('span');
    badge.className = 'note-key';
    badge.textContent = String(i + 1);
    b.appendChild(badge);
  });
  button('Dot', 'Half again as long (key .)', toggleNoteDot, shownDot);
  gap();
  button(Chords.restGlyph(ev ? ev.d : noteValue(), 0.8),
    `${ev ? 'Turn this note into a rest' : 'Rest, of the selected duration'} (key R)`,
    addNoteRest, false, 'note-dur');
  button('Tie',
    `${ev ? 'Turn this into a tie, holding the note before it on'
      : 'Hold the last note on for the selected duration'} (key T)`,
    addNoteTie);
  button('Stack', 'While on, a tap piles onto the last note — a double stop (key S)',
    () => { noteStack = !noteStack; renderNotePanel(); }, noteStack);
  gap();
  button('◀', 'Select the note before (←)', () => stepNote(-1));
  button('▶', 'Select the note after (→)', () => stepNote(1));
  button('At end', 'Stop editing that note and write at the end (Esc)',
    () => { noteSel = null; renderNotePanel(); }, !ev);
  button('Delete', 'Remove the selected note, or the last one (Backspace)', deleteNote);
  gap();
  button('Close', 'Close this panel', closeNotePanel);
  notePanel.appendChild(tools);

  const keys = document.createElement('p');
  keys.className = 'note-keys';
  keys.textContent = '← → select · 1–5 duration (whole, half, quarter, eighth, sixteenth) · '
    + '. dot · R rest · T tie · S stack · Backspace delete · Esc back to the end, then close';
  notePanel.appendChild(keys);

  const boardWrap = document.createElement('div');
  boardWrap.className = 'note-board';
  // Degrees are read against a chord. With no chord over these notes there is
  // nothing to read them against — every label would be counted from C, which
  // is a number that means nothing here — so the board falls back to note names.
  const boardMode = chord.name ? effectiveChordMode() : 'note';
  boardWrap.appendChild(Chords.board(chord.name, boardMode, currentChordKey()));
  // One listener for the whole neck: every cell says which string and fret it is.
  boardWrap.addEventListener('mousedown', e => e.preventDefault());
  boardWrap.addEventListener('click', e => {
    const cell = e.target.closest && e.target.closest('.board-cell');
    if (!cell) return;
    pressStop(Number(cell.dataset.string), Number(cell.dataset.fret));
  });
  notePanel.appendChild(boardWrap);

  const hint = document.createElement('p');
  hint.className = 'note-hint';
  hint.textContent = (chord.name
    ? 'The dots are labelled by the Interval / Note switch above'
    : 'The dots show note names until this stretch has a chord over it')
    + ', and the notes themselves are read off the staff and tab in the strip — '
    + 'click one there to edit it.';
  notePanel.appendChild(hint);
}

// The panel takes the keyboard while it is open, ← → included: the player's own
// seek keys would otherwise fire on the same press. Registered on the way down
// and stopped dead here, since the shortcut handler further down the file is
// listening on the same document.
document.addEventListener('keydown', e => {
  if (!notePanelAt || notePanel.hidden) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const n = parseInt(e.key, 10);
  if (e.key === 'ArrowLeft') stepNote(-1);
  else if (e.key === 'ArrowRight') stepNote(1);
  else if (n >= 1 && n <= NOTE_DURATIONS.length) setNoteDur(NOTE_DURATIONS[n - 1][0]);
  else if (e.key === '.') toggleNoteDot();
  else if (e.key === 'r' || e.key === 'R') addNoteRest();
  else if (e.key === 't' || e.key === 'T') addNoteTie();
  else if (e.key === 's' || e.key === 'S') { noteStack = !noteStack; renderNotePanel(); }
  else if (e.key === 'Backspace' || e.key === 'Delete') deleteNote();
  else if (e.key === 'Escape') {
    if (noteSel !== null) { noteSel = null; renderNotePanel(); }
    else closeNotePanel();
  } else return;
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);

// ---------- versions ----------
// Every edit is written straight through to storage, which leaves nothing to
// take back. So each one first files the sheet as it stood — a list of states
// to drop back into rather than a stack of steps, since a mistake is usually
// noticed a few edits after it was made and the way back should be a thing you
// can look at and choose.
const REVISION_CAP = 20;
// Typing is filed once a hand comes to rest, not once per keystroke: a version
// per letter is a list nobody can read.
const REVISION_COALESCE_MS = 3000;
let lastSheetEdit = { source: null, at: 0 };
let restoringSheet = false;

// The one door every edit goes through. What is filed is the text being
// replaced, so the newest version in the list is the state before the last
// thing you did.
function editSheet(text, source) {
  if (!currentVideoId) return;
  const before = getSheet(currentVideoId);
  if (before === text) return;
  const now = Date.now();
  // Typing and tapping are both runs of small edits — a version per keystroke,
  // or per note put on the board, is a list nobody can read. Editing a cell is
  // not: one chord changed is one thing done.
  const continuing = (source === 'text' || source === 'notes')
    && lastSheetEdit.source === source
    && now - lastSheetEdit.at < REVISION_COALESCE_MS;
  lastSheetEdit = { source, at: now };
  const filed = continuing ? false : pushRevision(currentVideoId, before);
  setSheet(currentVideoId, text);
  if (filed) renderChordRevisions();
}

function restoreRevision(id) {
  const revs = getRevisions(currentVideoId);
  const rev = revs.find(r => r.id === id);
  if (!rev) return;
  const current = getSheet(currentVideoId);
  if (current === rev.text) return;
  restoringSheet = true;
  // With the guard up, an open box is closed before the strip is rebuilt under
  // it — deliberately, rather than leaving it to whatever the browser does with
  // the focus when the element holding it is thrown away.
  const open = document.activeElement;
  if (open && chordStrip.contains(open) && open.blur) open.blur();
  // Where you were is filed too, so a restore is itself something to come back
  // from and there is no way to fall out of the list.
  pushRevision(currentVideoId, current);
  setSheet(currentVideoId, rev.text);
  chordInput.value = rev.text;
  renderChordStrip();
  restoringSheet = false;
  lastSheetEdit = { source: null, at: 0 };   // the next edit files a version of its own
  renderChordRevisions();
}

// A row is an edit: when it happened and which bar it touched. Printing the
// sheet itself was worse — the sheets are long and nearly identical, so the one
// line a row gets went on text that was the same on every row, with the part
// that differed off the end of it. What is left is the two things that tell one
// edit from another: the moment, and where in the tune it landed.
function renderChordRevisions() {
  if (!chordRevList) return;
  chordRevList.textContent = '';
  const revs = getRevisions(currentVideoId);
  // Shown even with nothing in it. Hiding the empty list meant the way back
  // only appeared once you were already lost, which is too late to learn that
  // it was there.
  if (!revs.length) {
    const empty = document.createElement('p');
    empty.className = 'chord-rev-empty';
    empty.textContent = 'No edits yet — each one files a version here.';
    chordRevList.appendChild(empty);
    return;
  }
  const current = getSheet(currentVideoId);
  revs.forEach((rev, i) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'chord-rev';

    const when = document.createElement('span');
    when.className = 'chord-rev-when';
    when.textContent = revisionTime(rev.at);

    const what = document.createElement('span');
    what.className = 'chord-rev-what';
    // The edit that followed this version is what the row offers to take back,
    // so it is read against whatever replaced it.
    what.textContent = describeSheetChange(rev.text, i === 0 ? current : revs[i - 1].text);

    row.appendChild(when);
    row.appendChild(what);
    // Same reason as the chord ops: taking focus blurs an open box, which
    // writes the sheet back and redraws this list out from under the click.
    row.addEventListener('mousedown', e => e.preventDefault());
    row.addEventListener('click', e => { e.preventDefault(); restoreRevision(rev.id); });
    chordRevList.appendChild(row);
  });
}

// What one edit did to the sheet, as a verb and a place — written as the moment
// before it, since that is where clicking the row lands you. Naming the edit
// itself put the row the wrong way round: "added @50.61" on a row that removes
// it when clicked is a sentence you have to invert before you can act on it.
// Bars are a line each, so the untouched ones at either end fall away and what
// is left in the middle is the edit.
function describeSheetChange(from, to) {
  const a = from ? from.split('\n') : [];
  const b = to ? to.split('\n') : [];
  if (!a.length) return 'before the sheet was written';
  if (!b.length) return 'before the sheet was cleared';
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head
         && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const was = a.slice(head, a.length - tail);
  const now = b.slice(head, b.length - tail);
  const rest = n => (n > 1 ? ` +${n - 1} more` : '');
  if (!was.length) return `before adding ${barTime(now[0])}${rest(now.length)}`;
  if (!now.length) return `before removing ${barTime(was[0])}${rest(was.length)}`;
  return `before changing ${barTime(was[0])}${rest(Math.max(was.length, now.length))}`;
}

// Where in the tune a bar sits. Its end is left off — the start is enough to
// find the place, and the pair is twice the number to read.
function barTime(line) {
  const m = /^\s*@(\S+)/.exec(line || '');
  return m ? `@${m[1].split('-')[0]}` : 'an untimed bar';
}

// The clock, not the distance from now. Versions outlive the session that made
// them, and "3d ago" on four rows in a row tells you nothing about which of
// them is the one — where a date and a time still do.
function revisionTime(ts) {
  const d = new Date(ts);
  // Seconds and all: edits land within the same minute all the time, and two
  // rows reading 14:32 are two rows you cannot tell apart.
  const clock = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
    + `:${String(d.getSeconds()).padStart(2, '0')}`;
  const today = new Date();
  const sameDay = d.getFullYear() === today.getFullYear()
    && d.getMonth() === today.getMonth()
    && d.getDate() === today.getDate();
  return sameDay ? clock : `${d.getMonth() + 1}/${d.getDate()} ${clock}`;
}

// Added to the parsed sheet and drawn from it, without going through the text:
// a chord with no name has nothing to write yet. The strip is rebuilt from the
// cache so the bar's four slots are shared out afresh and the indexes after the
// new one shift up.
function insertChord(barIndex, at) {
  commitFocusedChordCell();
  const bar = chordCache.bars[barIndex];
  if (!bar) return;
  bar.chords.splice(at, 0, { name: '', markers: null });
  renderChordStrip(true);
  focusChordCell(barIndex, at);
}

// The same chord again, next to itself. Unlike an empty insert this one has
// something to say the moment it exists, so the sheet is written straight away.
function copyChord(barIndex, chordIndex, at) {
  commitFocusedChordCell();
  const bar = chordCache.bars[barIndex];
  const source = bar && bar.chords[chordIndex];
  if (!source) return;
  bar.chords.splice(at, 0, {
    name: source.name,
    markers: source.markers ? source.markers.slice() : null,
  });
  writeSheetFromCache();
  renderChordStrip(true);
  focusChordCell(barIndex, at);
}

function removeChord(barIndex, chordIndex) {
  commitFocusedChordCell();
  const bar = chordCache.bars[barIndex];
  if (!bar) return;
  bar.chords.splice(chordIndex, 1);
  writeSheetFromCache();
  renderChordStrip(true);
  // The caret lands on the neighbour that took its place, or on the one before
  // it when the last chord in the bar went.
  focusChordCell(barIndex, Math.min(chordIndex, bar.chords.length - 1));
}

function focusChordCell(barIndex, chordIndex) {
  const cell = chordStrip.querySelector(
    `.chord-fields[data-bar="${barIndex}"][data-chord="${chordIndex}"]`,
  );
  const input = cell && cell.querySelector('.chord-edit-box');
  if (!input) return;
  input.focus();
  input.select();
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
  // The strip is drawn differently in this mode — boxes rather than links — so
  // it is rebuilt rather than restyled.
  syncChordEditMode();
  renderChordStrip();
  chordInput.value = getSheet(currentVideoId);
  renderChordRevisions();
  chordInput.focus();
  chordSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// With the editor open the strip is a form: every chord is the pair of boxes it
// is written in, and each bar offers a +. The whole look hangs off one class so
// the strip and the editor can never disagree about which mode it is in.
function syncChordEditMode() {
  chordViewport.classList.toggle('editing-mode', !chordEditor.hidden);
}

chordEditBtn.addEventListener('click', () => {
  if (chordEditor.hidden) openChordEditor();
  // Closing puts the chords back to being links, so whatever is in the open box
  // is banked before the strip is rebuilt without it.
  else {
    commitFocusedChordCell();
    chordEditor.hidden = true;
    closeNotePanel();
    syncChordEditMode();
    renderChordStrip();
  }
});

// No save button, like everything else here: the box is the stored sheet.
chordInput.addEventListener('input', () => {
  editSheet(chordInput.value, 'text');
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
  const key = Chords.parseKey(chordInput.value);
  const compact = Chords.toCompact(bars, '\n', key ? key.label : '');
  if (compact === chordInput.value) return;
  chordInput.value = compact;
  // Filed under the same source as the typing it tidies up, so a paste and the
  // rewrite that follows it are one version rather than two.
  editSheet(compact, 'text');
  renderChordStrip();
}

chordInput.addEventListener('paste', () => setTimeout(normalizeChordInput, 0));
chordInput.addEventListener('blur', normalizeChordInput);

// Two halves of one pill with the live one lit, the same control Guitar Chord
// Viewer uses for Degrees / Solfege. A lone button had to be read twice — once
// for what it says and once for whether that is the state or the offer.
// What the dots are actually labelled with. The stored choice can be solfège
// on a sheet that names no key — switch videos and it is — and there is no
// reading of do then, so the strip and the pill both fall back to degrees
// rather than disagreeing about what is on screen.
function effectiveChordMode() {
  const mode = getChordMode();
  return mode === 'solfa' && !currentChordKey() ? 'number' : mode;
}

function updateChordModeBtns() {
  const mode = effectiveChordMode();
  Object.entries(chordModeBtns).forEach(([value, btn]) => {
    btn.classList.toggle('active', value === mode);
    btn.setAttribute('aria-pressed', String(value === mode));
  });
  // Solfège is read from the key and from nothing else, so until a sheet names
  // one the button has nothing to switch to. Disabled rather than hidden: the
  // way in is to set the key, and the title is where that is said.
  const hasKey = !!currentChordKey();
  chordModeBtns.solfa.disabled = !hasKey;
  chordModeBtns.solfa.title = hasKey
    ? 'Label the dots with movable-do solfège, read from the key'
    : 'Set the key first — solfège reads do from it';
}

Object.entries(chordModeBtns).forEach(([value, btn]) => {
  btn.addEventListener('click', () => {
    if (getChordMode() === value) return;
    setChordMode(value);
    updateChordModeBtns();
    renderChordStrip();
  });
});

// The select and the sheet's own `key: Bb` line are two views of one value —
// the sheet is what is stored, and picking from the list is a way of writing
// that line without having to remember how it is spelled. A key typed into the
// editor that the list has no entry for (`key: Cb`) is added to it rather than
// silently reading as no key at all.
let extraKeyOption = null;

function updateChordKeySelect() {
  if (extraKeyOption) { extraKeyOption.remove(); extraKeyOption = null; }
  const key = currentChordKey();
  const label = key ? key.label : '';
  if (label && !Array.from(chordKeySelect.options).some(o => o.value === label)) {
    extraKeyOption = new Option(label, label);
    chordKeySelect.appendChild(extraKeyOption);
  }
  chordKeySelect.value = label;
}

chordKeySelect.addEventListener('change', () => {
  if (!currentVideoId) return;
  const key = Chords.parseKeyName(chordKeySelect.value);
  const text = Chords.withKey(getSheet(currentVideoId), key ? key.label : '');
  editSheet(text, 'key');
  chordInput.value = text;
  renderChordStrip();
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
  const key = Chords.parseKey(k);
  setSheet(currentVideoId, Chords.toCompact(bars, '|', key ? key.label : ''));
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
      // Videos stored before versions existed simply have none yet.
      if (!Array.isArray(v.revisions)) v.revisions = [];
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
    data.videos[vid] = { title: currentVideoTitle || '', sheet: '', history: [], revisions: [] };
  }
  data.videos[vid].sheet = text;
  if (vid === currentVideoId && currentVideoTitle) data.videos[vid].title = currentVideoTitle;
  saveData(data);
}

// Past states of a sheet, newest first, kept with the video they belong to so
// they survive a reload — the edit you want back is often one you only spot the
// next time you sit down with the tune.
function getRevisions(vid) {
  if (!vid) return [];
  const v = loadData().videos[vid];
  return (v && Array.isArray(v.revisions)) ? v.revisions : [];
}

function pushRevision(vid, text) {
  if (!vid) return false;
  const data = loadData();
  if (!data.videos[vid]) {
    data.videos[vid] = { title: currentVideoTitle || '', sheet: '', history: [], revisions: [] };
  }
  const v = data.videos[vid];
  if (!Array.isArray(v.revisions)) v.revisions = [];
  if (v.revisions.length && v.revisions[0].text === text) return false;
  v.revisions.unshift({ id: newEntryId(), at: Date.now(), text });
  // The oldest go first. Twenty is far enough back to cover a session's worth
  // of second thoughts without turning the list into an archive to read.
  if (v.revisions.length > REVISION_CAP) v.revisions.length = REVISION_CAP;
  saveData(data);
  return true;
}

// Degrees, note names or solfège inside the diagram dots. Degrees are the
// default: the point of the strip is what the shape does over the chord, not
// its letters.
const CHORD_MODES = ['note', 'solfa'];

function getChordMode() {
  const mode = loadData().chordMode;
  return CHORD_MODES.includes(mode) ? mode : 'number';
}

function setChordMode(mode) {
  const data = loadData();
  data.chordMode = CHORD_MODES.includes(mode) ? mode : 'number';
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

// The ramp is deliberately NOT persisted: it locks the speed controls and
// starts creeping the rate up on its own, which is not a state a reload should
// drop you into unasked. It's an action for the session in front of you, not a
// preference.
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

// ============================================================
// Backup (export / import)
// ============================================================
// Everything here lives in one localStorage key and nowhere else, so a browser
// wiped is work gone. Export writes the whole store — leaving something out of
// a backup only shows up on the day it is needed. Import is the other way
// round: what comes in is picked, because the usual reason to open a file from
// another machine is the chord sheets in it, and the loop history and display
// settings that rode along belong to the session they were made in.
const BACKUP_FORMAT = 'yt-loop-backup';

function backupFilename() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `yt-loop-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

function setBackupStatus(text) {
  backupStatus.textContent = text;
}

exportBtn.addEventListener('click', () => {
  const payload = {
    format: BACKUP_FORMAT,
    version: 3,
    exportedAt: new Date().toISOString(),
    data: loadData()
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFilename();
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  const count = Object.keys(payload.data.videos).length;
  setBackupStatus(`Exported ${count} video(s) to ${a.download}.`);
});

// The file waiting to be picked over, or null when the panel is closed.
let pendingBackup = null;

importBtn.addEventListener('click', () => importFile.click());

// Reset first: picking the same file twice in a row fires no change event
// otherwise, which reads as the button being broken.
importFile.addEventListener('change', () => {
  const file = importFile.files && importFile.files[0];
  importFile.value = '';
  if (!file) return;
  file.text()
    .then(text => {
      const backup = readBackup(text);
      if (!backup) {
        closeImportPanel();
        setBackupStatus('That file is not a YT Loop backup.');
        return;
      }
      pendingBackup = backup;
      openImportPanel(file.name);
    })
    .catch(() => {
      closeImportPanel();
      setBackupStatus('That file could not be read.');
    });
});

// A backup written by this app, or — since the store is plain JSON — the store
// itself, pasted out of devtools. Every field is rebuilt rather than trusted:
// the file has been on a disk and through whatever else since it was written.
function readBackup(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const data = (raw.data && typeof raw.data === 'object') ? raw.data : raw;
  if (!data.videos || typeof data.videos !== 'object') return null;

  const videos = {};
  Object.entries(data.videos).forEach(([vid, v]) => {
    if (!vid || !v || typeof v !== 'object') return;
    videos[vid] = {
      title: typeof v.title === 'string' ? v.title : '',
      sheet: typeof v.sheet === 'string' ? v.sheet : '',
      history: Array.isArray(v.history) ? v.history : [],
      revisions: Array.isArray(v.revisions) ? v.revisions : []
    };
  });
  if (!Object.keys(videos).length) return null;

  return {
    videos,
    chordMode: CHORD_MODES.includes(data.chordMode) ? data.chordMode : 'number',
    chordsHidden: data.chordsHidden === true
  };
}

function openImportPanel(filename) {
  const vids = Object.keys(pendingBackup.videos);
  importFileName.textContent = `${filename} — ${vids.length} video(s)`;
  renderImportVideos();
  importPanel.hidden = false;
  setBackupStatus('Tick what to bring in, then Import.');
  updateImportApply();
}

function closeImportPanel() {
  pendingBackup = null;
  importPanel.hidden = true;
  importVideosEl.innerHTML = '';
}

importCancelBtn.addEventListener('click', () => {
  closeImportPanel();
  setBackupStatus('Import cancelled — nothing was changed.');
});

// One row per video in the file, saying plainly whether it is new here or about
// to be written over. Sorted by title so the row you are looking for is where
// the eye expects it, not in whatever order the file happens to hold.
function renderImportVideos() {
  const here = loadData().videos;
  importVideosEl.innerHTML = '';
  Object.entries(pendingBackup.videos)
    .sort((a, b) => (a[1].title || a[0]).localeCompare(b[1].title || b[0]))
    .forEach(([vid, v]) => {
      const row = document.createElement('div');
      row.className = 'import-video';

      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = true;
      box.dataset.vid = vid;
      box.addEventListener('change', updateImportApply);
      const title = document.createElement('span');
      title.className = 'import-video-title';
      title.textContent = v.title || vid;
      title.title = `${v.title || '(no title)'} — ${vid}`;
      label.appendChild(box);
      label.appendChild(title);

      const tag = document.createElement('span');
      const known = !!here[vid];
      tag.className = 'import-tag ' + (known ? 'is-overwrite' : 'is-new');
      tag.textContent = known ? 'overwrite' : 'new';

      row.appendChild(label);
      row.appendChild(tag);
      importVideosEl.appendChild(row);
    });
}

function importSelection() {
  const parts = {};
  Object.entries(importPartBoxes).forEach(([key, box]) => { parts[key] = box.checked; });
  const vids = Array.from(importVideosEl.querySelectorAll('input[type="checkbox"]'))
    .filter(box => box.checked)
    .map(box => box.dataset.vid);
  return { parts, vids };
}

// Nothing ticked would import nothing, so the button says so before it is
// pressed rather than after. Display settings are their own row: they belong to
// no video and can come in on their own.
function updateImportApply() {
  const { parts, vids } = importSelection();
  const perVideo = parts.sheet || parts.revisions || parts.history;
  const doesSomething = (perVideo && vids.length > 0) || parts.settings;
  importApplyBtn.disabled = !doesSomething;
  importHint.textContent = doesSomething
    ? ''
    : (perVideo ? 'Tick at least one video.' : 'Tick at least one thing to bring in.');
}

Object.values(importPartBoxes).forEach(box => box.addEventListener('change', updateImportApply));

importApplyBtn.addEventListener('click', () => {
  if (!pendingBackup) return;
  const { parts, vids } = importSelection();
  const data = loadData();

  // Only when something per-video was asked for. Without this an import of the
  // display settings alone walks the ticked videos anyway and leaves an entry
  // for each — titles with nothing in them, sitting in History as videos that
  // were never played here.
  const perVideo = parts.sheet || parts.revisions || parts.history;
  (perVideo ? vids : []).forEach(vid => {
    const src = pendingBackup.videos[vid];
    if (!src) return;
    if (!data.videos[vid]) {
      data.videos[vid] = { title: '', sheet: '', history: [], revisions: [] };
    }
    const dst = data.videos[vid];
    // The title comes along with whatever is taken: without it a video new to
    // this browser would sit in History as a bare id until it is next played.
    if (src.title) dst.title = src.title;
    if (parts.sheet) dst.sheet = src.sheet;
    // Capped on the way in, the same as they are on the way up: a file written
    // by a build with roomier caps must not leave this one holding more than it
    // would ever write itself.
    if (parts.revisions) dst.revisions = src.revisions.slice(0, REVISION_CAP);
    if (parts.history) dst.history = src.history.slice(0, HISTORY_PER_VIDEO);
  });

  if (parts.settings) {
    data.chordMode = pendingBackup.chordMode;
    data.chordsHidden = pendingBackup.chordsHidden;
  }
  saveData(data);

  const changed = perVideo ? vids.length : 0;
  closeImportPanel();
  refreshAfterImport();
  setBackupStatus(
    changed
      ? `Imported ${changed} video(s).` + (parts.settings ? ' Display settings too.' : '')
      : 'Imported the display settings.'
  );
});

// The store has changed under everything on screen — the strip is drawn from
// the current video's sheet, the Versions list from its revisions, and the key
// select and mode pill are read out of the sheet as well.
function refreshAfterImport() {
  initChordControls();
  renderHistory();
  if (currentVideoId) {
    if (!chordEditor.hidden) chordInput.value = getSheet(currentVideoId);
    renderChordRevisions();
  }
  updateChordKeySelect();
  updateChordModeBtns();
  renderChordStrip();
}
