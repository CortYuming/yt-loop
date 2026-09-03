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
// A seek made while the video is not playing. YT plays a video that has not
// started yet when it is seeked — dragging the row on a freshly opened page
// started playback, which the state handler then read as someone reaching for
// the iframe and warmed up into playing for real. So the play that a seek
// provokes is claimed here and put straight back to paused.
let seekWhilePaused = false;

// The two boxes read as numbers. Null when either one does not hold a time —
// which is every caller's answer too, since a range with one end missing is not
// a range. Whether the pair also has to run forwards is the caller's own
// question: the loop and the history want a Start before the End, the duration
// display and the emptiness check want to say something about a pair that does
// not.
function formRange() {
  const start = parseTime(startInput.value);
  const end = parseTime(endInput.value);
  if (start === null || end === null || isNaN(start) || isNaN(end)) return null;
  return { start, end };
}

// Where the loop runs, worked out afresh every time it is asked for. The toggle
// says whether to loop and the two boxes say where, so there is nothing to keep
// in step and nothing that can go stale: a range that stops making sense means
// no loop for as long as that lasts, and the moment it makes sense again the
// loop is back.
//
// This used to be a variable, and only one place could ever raise it from
// nothing — a single call as a video loaded. A video that arrived without a
// usable range (a share link whose End equalled its Start, a duration YouTube
// had not reported yet) therefore left the Loop toggle lit with nothing behind
// it, and no later edit to Start or End could bring the loop back; only
// switching the toggle off and on again did.
function loopRange() {
  if (!loopToggle || !loopToggle.checked) return null;
  const r = formRange();
  if (!r || r.start >= r.end) return null;
  return r;
}

// Everything that has to be recomputed after the form's values change. The loop
// is no longer among them — loopRange() reads the boxes at the moment it needs
// them, so there is nothing to push. The history list is deliberately not in
// here either: it only changes when the stored data does, so renderHistory()
// stays an explicit call.
// Would this value leave no range to play? Asked before the value goes in, not
// after: a Start at or past the End describes nothing, and the door is the
// cheapest place to deal with it. Dealing with it is not always refusing — see
// takesRange, which is what the door actually calls.
// Landing exactly on the other end counts. loopRange gives up on `s >= e`, so an
// End set to the Start is a Loop toggle lit over nothing — and nothing is
// reversed there, so no warning was ever going to fire either.
// A value that is not a time at all is somebody else's business — the box holds
// half-typed times all the time.
function refusesRange(box, text) {
  const t = parseTime(text);
  if (t === null || isNaN(t)) return false;
  const other = parseTime((box === startInput ? endInput : startInput).value);
  if (other === null || isNaN(other)) return false;
  return box === startInput ? t >= other : t <= other;
}

// Refused, said on the box that was aimed at. Red where an accepted value
// flashes white, so the two never read as the same thing.
function flashRefused(box) {
  box.classList.remove('refused');
  // Reading offsetWidth restarts the animation; without it a second refusal in a
  // row is silent.
  void box.offsetWidth;
  box.classList.add('refused');
}

// The first bar line after `time`: the end of the bar it falls in, or the head of
// the next bar where it falls between two timed runs. resolveSpans makes a bar's
// end the next bar's start wherever both are known, so those are one boundary
// read from either side and looking at both costs nothing.
function nextBarEdge(time) {
  const spans = chordCache.vid === currentVideoId
    ? chordCache.spans
    : refreshChordCache().spans;
  let best = null;
  for (const span of spans) {
    for (const at of [span.start, span.end]) {
      if (at === null || at === undefined || isNaN(at)) continue;
      if (at > time + RANGE_EPS && (best === null || at < best)) best = at;
    }
  }
  return best;
}

// The End a Start that has outrun it needs. The bar the new Start falls in ends
// where the next one begins, so filling that in leaves a loop of the bar just
// aimed at — which is what walking Start down the sheet is for in the first
// place. With no sheet, or none with times on it, the video's own end is what is
// left. Null when even that is unknown, and the value is refused as it was.
function endForStart(start) {
  const edge = nextBarEdge(start);
  if (edge !== null) return edge;
  const duration = player && player.getDuration ? player.getDuration() : null;
  if (duration && !isNaN(duration) && duration > start + RANGE_EPS) return duration;
  return null;
}

// Take a value the range would otherwise refuse, by moving the end it has
// outrun. Only a Start does this: which box was aimed at is known here, so the
// other one is stale by construction — which is exactly the thing rangeIsEmpty
// cannot work out from two boxes alone, and the reason it does not try.
// An End put in front of the Start is left refused. It is the mirror image and
// not the same act: someone placing an End is saying where to stop, and moving
// their Start for them is a longer guess than moving a stale End.
// True when the pair is now in order, false when there was nothing to move the
// End to and the caller should refuse the value the way it always did.
function takesRange(box, text) {
  if (!refusesRange(box, text)) return true;
  if (box !== startInput) return false;
  const start = parseTime(text);
  if (start === null || isNaN(start)) return false;
  const end = endForStart(start);
  if (end === null) return false;
  endInput.value = formatTime(end);
  // Kept in step with the box's own idea of what it held, or the next blur reads
  // the filled End as an edit to be revert-checked.
  endInput.dataset.was = endInput.value;
  refreshUI();
  // Said where it happened, in the white an accepted value flashes: the End did
  // move, and a range that rearranges itself in silence is the guess this is
  // trying not to be. The history row is left to the caller's own edit, which is
  // one debounced write covering both ends.
  flashElements([endInput]);
  return true;
}

// A pair with nothing between its ends, found after the fact rather than at the
// door. The same `s >= e` loopRange gives up on, so the two never disagree about
// whether there is a range: equal ends are as unplayable as crossed ones, and
// used to slip through here because only crossing was looked for.
// Nothing is corrected — by this point a stale End and a fresh Start look exactly
// alike from the outside, and a range put right by guessing is a range nobody
// asked for. What the app can say for certain is that this pair describes
// nothing, and it says so on the button that was pressed.
// Reachable now only from a link written by hand: every door the form has either
// takes the value or turns it away. See the share-link landing, which drops an
// End it cannot use rather than carrying it in.
function rangeIsEmpty() {
  const r = formRange();
  if (!r) return false;
  return r.start >= r.end;
}

// Said on the button the finger is already on, since that is the one place on
// screen being looked at. Everything else about the form is left alone.
const EMPTY_RANGE_MS = 1800;
function refuseEmptyRange(btn, restore) {
  btn.textContent = '⚠ Start ≥ End';
  setTimeout(restore, EMPTY_RANGE_MS);
}

function refreshUI() {
  updateDurationDisplay();
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

// A link's End, or nothing where there is no range to be had from it.
// buildShareUrl never writes an End at or before its Start, so a link carrying one
// was edited by hand or cut short — and half a range is worth more than a broken
// one: dropped, the End is as good as absent, and fillDefaultEnd below covers the
// clip the way it does for any fresh session.
// A link is the one way into the form that is not a door — see takesRange for the
// ones that are — which makes it the only way the ⚠ on Play could still be
// reached. Kept out here rather than warned about there.
// An End with no Start beside it is left alone: there is nothing for it to be on
// the wrong side of.
function linkEndFor(start, end) {
  if (typeof end !== 'number' || isNaN(end)) return undefined;
  if (typeof start !== 'number' || isNaN(start)) return end;
  return end > start ? end : undefined;
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
const startJumpBtn    = document.getElementById('startJumpBtn');
const endJumpBtn      = document.getElementById('endJumpBtn');
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
const chordKeyChord   = document.getElementById('chordKeyChord');
const chordModeBtns   = {
  number: document.getElementById('chordModeInterval'),
  note:   document.getElementById('chordModeNote'),
  solfa:  document.getElementById('chordModeSolfa')
};
const chordShowToggle = document.getElementById('chordShowToggle');
const barJumpInput    = document.getElementById('barJumpInput');
const barJumpBtn      = document.getElementById('barJumpBtn');
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
      const linkStart = s !== null ? parseFloat(s) : undefined;
      // Note is deliberately left out here so the two sources below can be tried
      // in order.
      applyLoopToForm({
        start: linkStart,
        end:   linkEndFor(linkStart, e !== null ? parseFloat(e) : undefined),
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
  const r = formRange();
  if (!r) return false;
  const video = loadData().videos[currentVideoId];
  if (!video) return false;
  const match = video.history.find(h => sameRange(h, r.start, r.end, effectiveSpeed()));
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
  // post-load work before the interception below, so the boxes the loop reads
  // are filled by the time we decide where to seek. -1 is compared as a literal
  // on purpose: YT.PlayerState has no UNSTARTED constant, so naming one gives
  // undefined and the guard silently matches every state.
  if (state !== -1) runPendingLoad();

  if (isPlaying(state)) {
    if (seekWhilePaused) {
      seekWhilePaused = false;
      player.pauseVideo();
      updatePlayButton();
      return;
    }
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
  if (isPlaying()) {
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
      // Playing now, on purpose: whatever a seek left armed no longer applies.
      seekWhilePaused = false;
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
  const loop = loopRange();
  if (loop && typeof player.getCurrentTime === 'function') {
    const t = player.getCurrentTime();
    if (t < loop.start || t >= loop.end) {
      player.seekTo(loop.start, true);
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
  if (!player || typeof player.getCurrentTime !== 'function') return;
  // Cheapest question first: this runs 40 times a second whether or not
  // anything is playing, and reading the range means parsing two strings.
  if (!isPlaying()) return;
  const loop = loopRange();
  if (!loop) return;
  let t;
  try { t = player.getCurrentTime(); } catch (e) { return; }
  if (t < loop.end) { wrapArmed = true; return; }
  if (!wrapArmed) return;
  wrapArmed = false;
  // seekTo while PLAYING triggers BUFFERING → PLAYING again;
  // claim it as ours so onPlayerStateChange doesn't warm-up-delay it.
  intentionalPlay = true;
  player.seekTo(loop.start, true);
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
      // The clock reads the player, except while a seek it has not caught up with
      // is being held — the row is drawn where the hand left it, and a time
      // reading somewhere else next to it says one of the two is wrong.
      currentTimeEl.textContent = formatTime(pendingSeek ? pendingSeek.time : t);
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

// Is it playing? The guard against YT not having loaded rides along, since
// YT.PlayerState.PLAYING is undefined until it has and an unguarded comparison
// would then match a player that reports undefined for its own state. Takes a
// state when the caller already holds one — the state handler is handed one —
// and asks the player otherwise.
function isPlaying(state = safeState()) {
  return state === (window.YT && YT.PlayerState.PLAYING);
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
  const r = formRange();
  if (!r || r.end <= r.start) {
    durationDisplay.textContent = '—';
    return;
  }
  durationDisplay.textContent = formatTime(r.end - r.start);
}
startInput.addEventListener('input', () => { refreshUI(); handleValueEdit(startInput); });
endInput.addEventListener('input',   () => { refreshUI(); handleValueEdit(endInput); });

// Typing is checked when it is finished rather than as it goes: a value passes
// through halves of itself on the way in, and a box that fought every keystroke
// could not be typed in at all. What was in it when the caret arrived is kept, so
// a refused edit has somewhere to go back to.
[startInput, endInput].forEach(box => {
  box.addEventListener('focus', () => { box.dataset.was = box.value; });
  const settle = () => {
    if (takesRange(box, box.value)) { box.dataset.was = box.value; return; }
    box.value = box.dataset.was || '';
    refreshUI();
    handleValueEdit(box);
    flashRefused(box);
  };
  box.addEventListener('change', settle);
  box.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); settle(); }
  });
});
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

// Both 📍 drop the moment the video is at into their box. A Start caught past the
// old End takes the End with it — see takesRange; an End caught in front of the
// Start has nothing to put there, and the box says so instead.
function captureInto(box) {
  if (!player || !player.getCurrentTime) return;
  const text = formatTime(player.getCurrentTime());
  if (!takesRange(box, text)) { flashRefused(box); return; }
  box.value = text;
  refreshUI();
  handleValueEdit(box);
}

captureStart.addEventListener('click', () => captureInto(startInput));
captureEnd.addEventListener('click', () => captureInto(endInput));

playLoopBtn.addEventListener('click', () => {
  if (!player || !player.getPlayerState) return;
  // Only with the toggle on: with looping off the two ends are not being used,
  // and there is nothing to be wrong about.
  if (loopToggle && loopToggle.checked && rangeIsEmpty()) {
    refuseEmptyRange(playLoopBtn, updatePlayButton);
    return;
  }
  if (cancelPendingPlay()) { updatePlayButton(); return; }
  if (isPlaying()) {
    player.pauseVideo();
    return;
  }
  // Loop membership is owned by the toggle; the helper just seeks into range
  // if the toggle is on and playback is currently outside it.
  startPlaybackWithDelay();
});

// Jump to the start of the range without touching play / pause state. Shared by
// the ⏮ at the head of Start and the A shortcut.
function seekToStart() {
  if (!player || !player.seekTo) return;
  const s = parseTime(startInput.value);
  if (s === null || isNaN(s)) return;
  player.seekTo(s, true);
}

// The far edge of the loop, reached the same way. Hearing what the range runs
// into is how you tell whether the end lands on the beat or a hair past it, and
// until now that meant dragging the player's own bar to somewhere near it.
function seekToEnd() {
  if (!player || !player.seekTo) return;
  const e = parseTime(endInput.value);
  if (e === null || isNaN(e)) return;
  player.seekTo(e, true);
}

// The jump sits beside the value it jumps to: reading a time and going to it are
// one thought, and a second ⏮ up on the current-time row said the same thing a
// row away from the time it meant.
startJumpBtn.addEventListener('click', seekToStart);
endJumpBtn.addEventListener('click', seekToEnd);

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
  const sheetWarning = v && v.sheet ? ' Its sheet goes too.' : '';
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

// Which bars a range covers, counted the way the sheet numbers them. A loop is
// shared as a passage — "bars 5-8", which is how anyone talking about a
// transcription says it — and seconds are no way to find that passage again in a
// notes file a month later. So the label carries both.
// A bar counts as covered when it actually sounds inside the range: taking bar
// 5's time for the start and bar 9's for the end plays bars 5 to 8, and that is
// what it says.
// Null where the video has no sheet, none of its bars is timed, or the range
// falls outside all of them — there is nothing to number then.
function barRangeFor(vid, loop) {
  if (typeof loop.start !== 'number' || isNaN(loop.start)) return null;
  if (typeof loop.end !== 'number' || isNaN(loop.end)) return null;
  const bars = Chords.parseSheet(getSheet(vid));
  if (!bars.length) return null;
  const spans = Chords.resolveSpans(bars);
  let from = null;
  let to = null;
  spans.forEach((span, i) => {
    if (span.start === null) return;
    // A bar the sheet gives no end takes up no time here rather than the rest of
    // the video: resolveSpans has already filled in every end it can work out,
    // so what is left is the last bar of a sheet with nothing to measure it by.
    const end = span.end === null ? span.start : span.end;
    if (span.start >= loop.end - RANGE_EPS) return;
    if (end <= loop.start + RANGE_EPS) return;
    if (from === null) from = i;
    to = i;
  });
  if (from === null) return null;
  return from === to ? `bar ${from + 1}` : `bars ${from + 1}-${to + 1}`;
}

// Markdown link label: "<title> (start → end) bars 5-8 <note>", dropping
// whichever pieces aren't available.
function buildShareLabel(vid, loop) {
  const hasRange = typeof loop.start === 'number' && !isNaN(loop.start) &&
                   typeof loop.end === 'number' && !isNaN(loop.end);
  const range = hasRange ? `${formatTime(loop.start)} → ${formatTime(loop.end)}` : '';
  const title = resolveVideoTitle(vid);
  const note  = (loop.note || '').trim();
  const base = (title && range) ? `${title} (${range})` : (title || range || vid || 'YT Loop');
  return [base, barRangeFor(vid, loop), note].filter(Boolean).join(' ');
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
  // A link carrying the two ends the wrong way round does not loop where it
  // lands, and a bookmark is kept for years. So it is not handed out.
  if (rangeIsEmpty()) {
    refuseEmptyRange(shareBtn, () => { shareBtn.textContent = '🔗 URL'; });
    return;
  }
  copyWithFeedback(shareBtn, url, '✅ Copied!', '🔗 URL');
});

shareMdBtn.addEventListener('click', () => {
  if (!currentVideoId) { alert('Load a video first'); return; }
  if (rangeIsEmpty()) {
    refuseEmptyRange(shareMdBtn, () => { shareMdBtn.textContent = '📝 MD'; });
    return;
  }
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
// Where the playhead sits across the window: a little left of the middle, which
// buys the lookahead the extra room without moving now far from where the eye
// rests. It sat at two thirds while the sheet was capped at 860px, to keep a bar
// of five or more chords — which wraps to a second line inside its own width,
// drawing its late chords well left of the playhead — from falling off the
// window. A wide window carries that bar either side of here. Keep
// .chord-playhead's left in style.css on the same fraction.
const PLAYHEAD_RATIO = 0.40;
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
// The row is drawn again from the ground up on every edit, and replacing a
// subtree that size makes the browser re-reckon where the page was: it re-anchors
// its scroll and the page jumps, which under a hand tapping notes reads as the
// board running away. So where the page was is put back, whatever the redraw did
// to it. Only for a page the reader scrolled, not one the row is scrolling: the
// row moves sideways by transform and never touches this.
function renderChordStrip(fromCache) {
  const scrollWas = window.scrollY;
  try {
    drawChordStrip(fromCache);
  } finally {
    if (window.scrollY !== scrollWas) window.scrollTo({ top: scrollWas, behavior: 'instant' });
  }
}

function drawChordStrip(fromCache) {
  if (!currentVideoId) {
    chordSection.hidden = true;
    return;
  }
  chordSection.hidden = false;
  // The sheet is parsed before anything is drawn from it — the select and the
  // pill both read the key off this parse. Read from the one left over from the
  // last draw, the select put the old key back in the box the moment a new one
  // was picked: the first pick looked like it had been ignored, and picking it a
  // second time was what made it stick.
  const { bars, spans } = fromCache && chordCache.vid === currentVideoId
    ? chordCache
    : refreshChordCache();
  updateChordKeySelect();
  // The key decides whether solfège is on offer at all, so the pill is brought
  // up to date wherever the sheet is.
  updateChordModeBtns();
  const visible = getChordsVisible();
  if (!visible) { chordEditor.hidden = true; closeNotePanel(); }
  syncChordEditMode();
  chordViewport.hidden = !visible;
  if (!visible) return;
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
      ? 'Nothing written for this video yet — 🎼 Edit to start.'
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
  // While editing the five lines are drawn whatever the sheet says, and held to
  // the widest reach the board has needed: a row that grows as notes are tapped
  // slides the board out from under the hand, which is the one thing it must not
  // do while someone is writing on it.
  const staffReach = holdStaffReach(Chords.staffRange(
    bars, key, notePanelAt ? 'neck' : !chordEditor.hidden));
  // A tab row only where there are single notes to put on it: an empty one is
  // height taken for nothing, and most sheets are chords alone. Editing keeps
  // the room whatever the sheet holds — the row is where notes are about to be
  // written, and one appearing under the first of them moves everything below.
  const showTab = Chords.hasNotes(bars) || !chordEditor.hidden;
  // The clef is pinned to the foot of a bar, so it has to know how much of that
  // foot the tab row is taking. 2px is .chord-tab's own margin.
  chordViewport.style.setProperty('--tab-h',
    showTab ? `${Chords.tabHeight(staffReach && staffReach.stack) + 2}px` : '0px');
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
    // Not the even split alone: a stretch holding a phrase takes the room it
    // needs from the stretches that have room to spare. See Chords.barWeights.
    const weights = Chords.barWeights(bar, slot);
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

    barEl.appendChild(buildBarHead(i, bar, spans[i]));

    // The same bar again, as the notes it sounds — see staffItems for where each
    // chord lands across it.
    if (staffReach) {
      buildBarStaff(barEl, staffItems(bar, i, width, slot, weights),
        bars, i, width, staffReach, key, slot, showTab);
    }

    // The cells are how a sheet is read: a chord's name with its shape drawn
    // under it. They were how it was written too — a name box and six buttons
    // per stretch — and that was a second sheet stacked over the first, saying
    // the same music in boxes. While editing the bar is its staff: the names are
    // written where they sound, and the notes are tapped out on the board.
    if (chordEditor.hidden) {
      const cells = renderBarLane(bars, i, slot);
      if (cells) barEl.appendChild(cells);
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

  // The clef sits outside the row so it stays put while the row scrolls, which
  // means nothing in the layout keeps it on the five lines. It used to hang off
  // the bottom of the viewport, a fixed distance up; the diagrams moved below
  // the staff and took that distance with them. So it is put where the staff
  // actually is, measured once the row is built.
  const firstStaff = chordStrip.querySelector('.chord-staff');
  const clef = chordViewport.querySelector('.chord-staff-head');
  if (firstStaff && clef) {
    const top = firstStaff.getBoundingClientRect().top
      - chordViewport.getBoundingClientRect().top;
    clef.style.top = `${Math.round(top)}px`;
    clef.style.bottom = 'auto';
  }

  // Built in the order they are drawn and clamped as they go, so the list is
  // already ascending — sorting it would only shuffle bars the sheet overlapped.
  updateChordScroll(currentPlaybackTime());
  // A redraw builds the marks itself rather than going through markNoteSelection,
  // so the caret is brought back into view here too — writing a note can move it
  // as surely as stepping to one does.
  keepCaretInView();
  // The panel is drawn against the same parse, so it follows the strip rather
  // than keeping whatever it said before the sheet changed.
  if (notePanelAt) renderNotePanel();
}

// What sits above a bar's staff: the way to put a bar in before it, which bar
// this is, the loop controls for the moment it starts on, and what it counts.
function buildBarHead(i, bar, span) {
  const head = document.createElement('div');
  head.className = 'chord-bar-head';
  // A bar goes in before this one, so the button is at that edge — the head's
  // own left, where the bar line is. Anywhere else in the head it reads as
  // belonging to the bar on the other side of it. Only while editing — see
  // .editing-mode in style.css. + Bar adds to the end, which is how a
  // transcription grows; this is for the bar found missing later.
  const insertLabel = `Add a bar before bar ${i + 1}`;
  const insertBtn = toolButton('chord-add', '+', insertLabel,
    () => askInsertBar(i), true);
  // The face is a bare +, so the name of the thing it adds is said here.
  insertBtn.setAttribute('aria-label', insertLabel);
  head.appendChild(insertBtn);
  head.appendChild(barNumber(i, span.start));
  // A bar with a time on it carries the loop controls for that moment; one
  // without is just its number.
  if (span.start !== null) head.appendChild(barTimePins(i, span));
  const count = barBeatLabel(bar);
  if (count) head.appendChild(count);
  return head;
}

// A bar's chords as the staff wants them: where each one sits across the bar,
// and what the board open on it has marked. Each chord sits at the beat it
// starts on — the left edge of its cell — rather than under the middle of its
// diagram, since what the staff is showing is when as much as what. Past four
// chords the cells wrap and there are no beat edges to follow, so those are
// spread evenly across the bar instead.
function staffItems(bar, i, width, slot, weights) {
  const wide = bar.chords.length > SLOTS_PER_BAR;
  let cellX = 0;
  return bar.chords.map((chord, j) => {
    const at = wide ? (j * width) / bar.chords.length : cellX;
    cellX += weights[j] * slot;
    // Which of this stretch's notes is being edited, so the strip can mark it.
    const here = notePanelAt && notePanelAt.bar === i && notePanelAt.chord === j;
    const sel = here ? noteSel : null;
    // Writing at the end marks nothing, and then nothing on screen says where
    // the next tap goes. So the note it will follow is marked too, in its own
    // way: what is written there yet is not this note but the one after it.
    const after = here && noteAfter === null && noteSel === null
      && chord.notes && chord.notes.length ? chord.notes.length - 1 : null;
    // Room held open after this note, for what is written next — the staff
    // moves the notes after it over and marks the space.
    const gap = here && noteAfter !== null ? noteAfter : null;
    // Nothing written here yet, and the board open on it: the first beat is
    // where the next tap lands, and with no note to mark there would be
    // nothing at all on screen saying which stretch is being written into.
    const caret = here && !(chord.notes && chord.notes.length);
    return {
      x: at, chord: j, name: chord.name, markers: chord.markers, notes: chord.notes,
      sel, after, caret, gap,
    };
  });
}

// The five lines and the tab row under them, hung on the bar. A bar is four
// slots wide, so one slot is one beat — which is what the notes inside a
// chord's stretch are placed by. What the bar carries in from the one before it
// is worked out here, because a staff is drawn one bar at a time and the music
// is not written that way.
function buildBarStaff(barEl, items, bars, i, width, staffReach, key, slot, showTab) {
  // A bar can open on a tie — a note held over the bar line — and then what it
  // is holding was struck in the bar before it.
  const carryIn = Chords.carriedStops(bars, i);
  // And on a bass move — `/Bb` on a downbeat — and then the harmony it says has
  // not changed was named in the bar before it. See Chords.rulingBefore.
  const heldName = Chords.rulingBefore(bars, i);
  // And a bar can end on one: the arc crossing the bar line is drawn as two
  // halves, one in each bar, since each bar is a staff of its own.
  const carryOut = barOpensOnTie(bars[i + 1])
    && Chords.carriedStops(bars, i + 1).length > 0;
  const staff = Chords.staffBar(
    items, width, staffReach, key, effectiveChordMode(), slot, carryIn, carryOut,
    heldName);
  staff.setAttribute('class', 'chord-staff');
  barEl.appendChild(staff);
  if (showTab) {
    const tab = Chords.tabBar(items, width, key, effectiveChordMode(), slot, carryIn,
      staffReach && staffReach.stack, heldName);
    tab.setAttribute('class', 'chord-tab');
    barEl.appendChild(tab);
  }
}

// What a bar's phrase actually counts, over the whole of it rather than one
// stretch at a time — three eighth triplets under three chords are still one
// beat. Null where nothing is written: a bar of plain chords carries no rhythm
// to be right or wrong about.
function barBeats(bar) {
  let beats = 0;
  let any = false;
  for (const chord of (bar && bar.chords) || []) {
    if (!chord.notes || !chord.notes.length) continue;
    any = true;
    beats += Chords.noteBeats(chord.notes).length;
  }
  return any ? beats : null;
}

// The count in the bar's head, and only where it is not four. A bar that adds up
// is the ordinary case and saying so on every bar of a sheet is noise; a bar that
// does not is the one thing about it nothing on screen used to say. Undoing a
// triplet leaves a bar half a beat long, and beatFit then squeezes the phrase
// into the room the bar has — so the sheet reads as usual and the count is the
// only place the truth shows.
// Short of four is a phrase still being written, so it is said in the head's own
// grey; over four is a bar that cannot be played as written, and that is red.
function barBeatLabel(bar) {
  const beats = barBeats(bar);
  if (beats === null || Math.abs(beats - Chords.BEATS_PER_BAR) < 1e-9) return null;
  const over = beats > Chords.BEATS_PER_BAR;
  const el = document.createElement('span');
  el.className = `chord-bar-beats${over ? ' over' : ''}`;
  // Thirds of a beat do not come out even, so the count is written to as many
  // places as it needs and no more: 4.5 rather than 4.50, 4.33 for a stray
  // triplet.
  const shown = String(Number(beats.toFixed(2)));
  el.textContent = `${shown}/${Chords.BEATS_PER_BAR}`;
  el.title = over
    ? `${shown} beats written in a bar of ${Chords.BEATS_PER_BAR} — more than it can hold`
    : `${shown} beats written of ${Chords.BEATS_PER_BAR}`;
  return el;
}

// Whether a bar's first event is a tie — a note held over the bar line into it.
function barOpensOnTie(bar) {
  for (const chord of (bar && bar.chords) || []) {
    if (chord.notes && chord.notes.length) return !!chord.notes[0].tie;
  }
  return false;
}

// The three steps that follow an edit made on the row rather than in the text
// box: the cached spans are worked out per parse, so a bar added or a bar line
// moved leaves them describing the sheet as it was — recompute, write the text
// back out, and redraw from the cache rather than from the text just written.
// `source` reaches writeSheetFromCache, which uses it to decide what the edit
// was for the history it keeps.
function commitChordEdit(source) {
  chordCache.spans = Chords.resolveSpans(chordCache.bars);
  writeSheetFromCache(source);
  renderChordStrip(true);
}

// A bar that isn't there yet. It starts where the last one ends, which is what
// a transcription does — bar after bar — and at the playhead when there is no
// last one to follow. The bar arrives holding one empty chord, so it is a cell
// with a name box and a ♪ rather than an empty box nobody can write into: the
// sheet still keeps nothing until something is actually typed or tapped.
function addBar() {
  const bars = chordCache.bars;
  // The cache's own spans, not a fresh resolve: they are the resolve of these
  // same bars, kept in step by every edit that touches them.
  const last = chordCache.spans[chordCache.spans.length - 1];
  const after = last ? (last.end !== null ? last.end : last.start) : null;
  const start = roundTo(
    after === null ? settledTime(currentPlaybackTime()) : after, 2);
  bars.push({ start, end: null, chords: [{ name: '', markers: null }] });
  commitChordEdit();
  // Straight into the bar just made: the button was pressed to write something,
  // and the board is where writing happens.
  openNotePanel(chordCache.bars.length - 1, 0);
}

function addBarButton() {
  // No stop: this one sits past the last bar, with no cell under it to guard.
  return toolButton('chord-add-bar', '+ Bar',
    'Add a bar, starting where the last one ends', addBar);
}

// When the new bar starts, asked before it is made. The video is somewhere in
// the bar being listened to, so that moment is the answer offered — a guess to
// correct rather than a value to accept, which is why it is asked at all.
function askInsertBar(at) {
  // Where the row is, not what the player says: a video that has been dragged to
  // a place but never played reports 0 for as long as it stays stopped, and the
  // answer offered would be the head of the track rather than the bar being
  // looked at. settledTime is what the strip itself is drawn against.
  const answer = prompt(
    `Start time of the new bar ${at + 1} — 43.50 or 0:43.50`,
    formatTime(settledTime(currentPlaybackTime())),
  );
  if (answer === null) return;                 // asked, and thought better of it
  const t = answer.trim() ? parseTime(answer) : null;
  if (answer.trim() && t === null) {
    alert(`"${answer}" is not a time. Write it as 43.50 or 0:43.50.`);
    return;
  }
  insertBar(at, t);
}

// A bar between two others, at the moment the video is at — which is what
// someone pressing this is looking at. It arrives holding one empty chord, the
// way a bar added at the end does, so there is something to write into.
function insertBar(at, start) {
  const bars = chordCache.bars;
  const time = start === null || start === undefined ? null : roundTo(start, 2);
  // A new head is a new bar line, so the bar before it ends there. Left alone, a
  // bar written `@0.50-5.20` keeps an end that reaches past the bar just made
  // and swallows it: the row has no room in time for a bar inside another, so it
  // draws it with none — a stretch the playhead crosses in a single frame and
  // every drag settles at the far side of. Only where the written end actually
  // reaches past the new head; one that stops short of it is a hole in the sheet
  // and says so on purpose. setBarStart moves the same bar line from the other
  // side, for the same reason.
  const prev = bars[at - 1];
  if (time !== null && prev && prev.end !== null && prev.end > time
      && (prev.start === null || prev.start < time)) {
    prev.end = time;
  }
  bars.splice(at, 0, {
    start: time,
    end: null,
    chords: [{ name: '', markers: null }],
  });
  commitChordEdit();
  // Straight into the bar just made: it was asked for in order to write in it.
  openNotePanel(at, 0);
}

// The bar's number, which is also the way to the bar: click 9 and the video goes
// to where bar 9 starts. Reading a transcription is jumping about in it — that
// phrase again, then back four bars — and until now the only way there was
// dragging the strip by hand, which is aiming at a time the sheet already knows
// to the hundredth. A bar with no time on it is not a place to go, so that one
// stays the plain number it always was.
function barNumber(index, start) {
  const text = String(index + 1);
  if (start === null) {
    const label = document.createElement('span');
    label.className = 'chord-bar-no';
    label.textContent = text;
    return label;
  }
  return toolButton('chord-bar-no', text, `Jump to bar ${text} — ${formatTime(start)}`,
    () => seekToTime(start), true);
}

// The time in a bar head, which is also how a loop is marked out from the
// sheet: click it and start📍 / end📍 appear, dropping that bar's two edges into
// the boxes they name. Setting a range by ear means catching it twice as it goes
// past; the sheet already knows where the bars are, so picking the ends off it is
// the accurate way — click bar 5's time for the start, bar 9's for the end, and
// the loop holds bars 5 to 9 with the whole of 9 in it. One bar on its own is the
// same gesture twice: its time, then both pins.
// end📍 takes the bar's end rather than its start, which is the moment a player
// means by "the end of bar 9" — its start would cut the bar off before it is
// played. A bar whose end is not known — the last one, with nothing after it to
// borrow a length from — has nothing to offer that pin, and it says so rather
// than writing the start into the End box.
// The buttons stay hidden until asked for because every bar has a time, and a
// pair of them under each would bury the chords.
function barTimePins(index, span) {
  const time = span.start;
  const wrap = document.createElement('span');
  wrap.className = 'chord-bar-time';

  const face = toolButton('chord-time-face', formatTime(time),
    'Use this time as the loop start or end', () => {
      const wasOpen = wrap.classList.contains('open');
      closeChordTimePins();
      if (!wasOpen) {
        wrap.classList.add('open');
        openTimePins = wrap;
      }
    }, true);

  const pins = document.createElement('span');
  pins.className = 'chord-time-pins';
  const row = document.createElement('span');
  row.className = 'chord-time-row';
  // Why a press did nothing, in the panel it was pressed in.
  const refused = document.createElement('span');
  refused.className = 'chord-time-err';
  refused.hidden = true;
  const pin = (text, title, input, at) => {
    const known = at !== null;
    const b = toolButton('chord-time-pin', text, known ? title
      : 'This bar has no end yet — give the next bar a time, or write this one as @start-end',
    () => {
      const value = formatTime(at);
      // A bar picked as the Start after the range's End brings the End along —
      // walking Start down the sheet is the whole point of these — and only an
      // End picked in front of the Start is left with nowhere to go. Nothing is
      // written then and the panel stays open: the other 📍 beside it may well be
      // the one that was meant. See takesRange.
      if (!takesRange(input, value)) {
        const other = input === startInput ? endInput : startInput;
        refused.textContent = input === startInput
          ? `Later than End ${other.value.trim()}`
          : `Earlier than Start ${other.value.trim()}`;
        refused.hidden = false;
        return;
      }
      input.value = value;
      input.dataset.was = value;
      refreshUI();
      handleValueEdit(input);
      closeChordTimePins();
    }, true);
    b.disabled = !known;
    row.appendChild(b);
  };
  pin('start📍', 'Set this bar\'s start as the loop start', startInput, span.start);
  pin('end📍', 'Set this bar\'s end as the loop end — this bar is played through',
    endInput, span.end);
  row.appendChild(refused);
  pins.appendChild(row);
  // Open whether or not the editor is. A time caught slightly late is found by
  // listening, not by editing, and having to open the sheet's text box first put
  // the fix a long way from the noticing.
  pins.appendChild(barTimeEditor(index, time));

  wrap.appendChild(face);
  wrap.appendChild(pins);
  return wrap;
}

// Which bar the video is in, and the way to any other one. Reading a
// transcription is jumping about in it, and past a dozen bars the way there is
// the number rather than the bar itself: bar 29 of 37 is a long drag away, and
// two digits is no distance at all.
// The box stays empty until a number is typed in it, the way a search box does.
// Which bar is playing is written on the bar itself, under the playhead, so a
// second copy of it in here would only be a value nobody typed.
function jumpToBar() {
  if (!barJumpInput) return;
  const spans = chordCache.vid === currentVideoId
    ? chordCache.spans
    : refreshChordCache().spans;
  const n = parseInt(barJumpInput.value.trim(), 10);
  const span = n >= 1 && n <= spans.length ? spans[n - 1] : null;
  // A bar the sheet does not have, or one with no time on it: there is nowhere
  // to go, and the box says so where the number was typed.
  if (!span || span.start === null) {
    barJumpInput.classList.add('bad');
    return;
  }
  barJumpInput.classList.remove('bad');
  seekToTime(span.start);
}

if (barJumpInput) {
  barJumpInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); jumpToBar(); }
  });
  barJumpInput.addEventListener('input', () => {
    barJumpInput.classList.remove('bad');
  });
  barJumpBtn.addEventListener('click', e => { e.preventDefault(); jumpToBar(); });
}

function closeChordTimePins() {
  if (openTimePins) openTimePins.classList.remove('open');
  openTimePins = null;
}

// How far a bar's head can move: past the head of the bar before it and it is
// out of order, past its own end and it has no length left. Either side can be
// unknown — the first bar of a sheet has nothing before it, a bar whose end
// nobody wrote and nothing to work it out from has no end — and then that side
// is not a limit.
function barTimeBounds(index) {
  const spans = chordCache.spans;
  const prev = spans[index - 1];
  const own = spans[index];
  return {
    after: prev && prev.start !== null ? prev.start : null,
    before: own && own.end !== null ? own.end : null,
  };
}

// The bar's own `@`, moved. A time caught by ear is caught slightly late, which
// is a bar line in the wrong place; putting it right meant opening the text box
// and finding that bar among thirty others written the same way. The head knows
// which bar it is.
// Moving a head moves a bar line: the bar before ends where this one starts, and
// a sheet written by playing along is one unbroken chain of them. So the pair
// moves together and nothing after them is touched — what changes is the length
// of the two bars either side of the line.
function setBarStart(index, t) {
  const bars = chordCache.bars;
  const bar = bars[index];
  if (!bar) return;
  const start = roundTo(t, 2);
  const was = bar.start;
  const prev = bars[index - 1];
  bar.start = start;
  // Only where the two were the same moment. A bar deliberately left short of
  // the next one — a hole in the sheet — says so on purpose, and moving this
  // head is no reason to close it.
  if (prev && prev.end !== null && was !== null && Math.abs(prev.end - was) <= RANGE_EPS) {
    prev.end = start;
  }
  commitChordEdit('bar-time');
}

// The box the time is typed in, with the current playback position on a button
// beside it: playing up to the bar line and taking the moment off the clock is
// how the time was found in the first place.
function barTimeEditor(index, time) {
  const row = document.createElement('span');
  row.className = 'chord-time-row';

  const box = document.createElement('input');
  box.type = 'text';
  box.className = 'chord-time-box';
  box.value = formatTime(time);
  box.title = 'Where this bar starts — 10.80 or 0:10.80';
  box.setAttribute('aria-label', `Start time of bar ${index + 1}`);

  const err = document.createElement('span');
  err.className = 'chord-time-err';
  err.hidden = true;

  // What is wrong with the value, where the value is — the panel is two lines
  // over the music and an alert to dismiss on top of that is one thing too many.
  const refuse = msg => { err.textContent = msg; err.hidden = false; };

  const commit = () => {
    const text = box.value.trim();
    // Opened and nothing said: a way out, like Esc or a click on the music.
    if (!text) { closeChordTimePins(); return; }
    const t = parseTime(text);
    if (t === null || isNaN(t)) { refuse(`"${text}" is not a time`); return; }
    const { after, before } = barTimeBounds(index);
    const low = after !== null && t <= after;
    const high = before !== null && t >= before;
    if (low || high) {
      refuse(after !== null && before !== null
        ? `Must fall between ${formatTime(after)} and ${formatTime(before)}`
        : (low ? `Must be later than ${formatTime(after)}`
               : `Must be earlier than ${formatTime(before)}`));
      return;
    }
    setBarStart(index, t);
  };

  const now = toolButton('chord-time-pin', 'now📍',
    'Fill in the current playback time', () => {
      // Where the row is, not what the player says — the same reading the strip
      // itself is drawn against. See askInsertBar.
      box.value = formatTime(settledTime(currentPlaybackTime()));
      err.hidden = true;
      ok.classList.add('dirty');
      box.focus();
    }, true);

  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'chord-time-pin ok';
  ok.textContent = '✓';
  ok.title = 'Move this bar line here';
  // Not mousedown-guarded like the rest: this one wants the box's value, and
  // blurring it first is how the box gets read.
  ok.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    commit();
  });

  box.addEventListener('input', () => {
    err.hidden = true;
    ok.classList.add('dirty');
  });
  box.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
  });

  // now📍 fills the box, so it comes before it; ✓ takes what is in the box, so
  // it comes after. The button that finishes the job is the one under the hand
  // when the job is finished — at the far end of the row it was simply forgotten.
  row.appendChild(now);
  row.appendChild(box);
  row.appendChild(ok);
  row.appendChild(err);
  return row;
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

// Reading one of an anchor's two numbers off the other. Both axes ascend — the
// anchors are built left to right and time runs with them — so a single walk
// does either direction, with `from` naming the axis being searched and `to`
// the one being read. Outside the sheet the nearest pair's slope carries on, so
// a point past either end drifts in and out rather than sticking.
function chordInterp(v, from, to) {
  const a = chordAnchors;
  if (a.length === 0) return 0;
  if (a.length === 1) return a[0][to];
  const last = a.length - 1;
  const slope = (i, j) => {
    const span = a[j][from] - a[i][from];
    return span > 0 ? (a[j][to] - a[i][to]) / span : 0;
  };
  // Off `at`, along the slope the pair (i, j) describes. Past the ends the
  // anchor and the pair are not the same two: the walk leans on the last pair
  // there is and keeps going.
  const readAt = (at, i, j) => a[at][to] + (v - a[at][from]) * slope(i, j);
  if (v <= a[0][from]) return readAt(0, 0, 1);
  if (v >= a[last][from]) return readAt(last, last - 1, last);
  for (let i = 0; i < last; i++) {
    if (v < a[i + 1][from]) return readAt(i, i, i + 1);
  }
  return a[last][to];
}

// Where a moment in the music sits along the track, and the inverse: where
// along the track a point sits, in seconds.
function chordXForTime(t) { return chordInterp(t, 'time', 'x'); }
function chordTimeForX(x) { return chordInterp(x, 'x', 'time'); }

// A transform and nothing else, so the compositor can carry it without a
// layout pass. Both the clock and the dragging hand come through here.
function placeChordStrip(x) {
  const playhead = chordViewport.clientWidth * PLAYHEAD_RATIO;
  chordStrip.style.transform = `translateX(${playhead - x}px)`;
}

// The inverse, read off the row itself rather than off a number kept beside it.
// A redraw clears the transform and only then asks the clock to place the row —
// and the clock declines on a sheet with no times in it, which leaves the row at
// nought with a remembered x that says otherwise. Measured, there is nothing to
// disagree with.
function chordStripX() {
  const vp = chordViewport.getBoundingClientRect();
  const at = chordStrip.getBoundingClientRect().left - vp.left;
  return chordViewport.clientWidth * PLAYHEAD_RATIO - at;
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
// The row, held where the caret put it. Editing walks the selection along a
// stopped video, and the clock — which is what places the row — has nothing to
// say while it is stopped, so a note stepped past the edge would stay past it.
// Released the moment the clock moves again: the music is then what the row is
// following, and it is following it from where it actually is.
let caretHold = null;     // { x, time }
// How far inside the edge the caret is brought back to — declared up here for
// the same reason caretHold is: keepCaretInView reads it, and a redraw can call
// that before this file has finished evaluating.
const CARET_MARGIN = 80;

function settledTime(t) {
  if (!pendingSeek) return t;
  // The player has arrived where it was sent.
  if (Math.abs(t - pendingSeek.time) < 0.3) {
    pendingSeek = null;
    return t;
  }
  // The deadline is for a player that is running. One that has not been played
  // yet reports 0 for as long as it stays stopped, and giving up on the seek then
  // snaps the row back to the head of the track — the drag looks undone, until
  // the video is played once and the clock starts telling the truth.
  if (isPlaying() && performance.now() > pendingSeek.until) {
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
  if (caretHold) {
    // Still the same moment, so nothing has happened that the row should follow
    // instead. Placed again rather than left alone, since a redraw resets the
    // transform and this is what puts it back.
    if (Math.abs(t - caretHold.time) < 0.05) { placeChordStrip(caretHold.x); return; }
    caretHold = null;
  }
  placeChordStrip(chordXForTime(settledTime(t)));
}

// ---------- dragging the strip ----------
// The row is a timeline you can take hold of: drag it and the playhead comes
// with it, so pulling the previous bar under the marker is how you wind the
// music back a phrase. A press that barely moves is left alone — that is a
// click on a chord, and a chord opens the fretboard viewer.
const CHORD_DRAG_SLOP = 6;
// Six pixels is enough once a press has settled, and too little while it is
// still being aimed: a click meant for a note slides that far on a trackpad, and
// taken as a drag it seeks the video and swallows the click, leaving the note
// unselected with nothing on screen to say why. So a young press has to travel
// further to be read as a drag — see the pointermove below.
const CHORD_TAP_MS = 250;
const CHORD_TAP_SLOP = 12;
let suppressChordClick = false;

function chordDragX(drag, clientX) {
  return drag.baseX - (clientX - drag.fromX);
}

function seekFromStrip(x) {
  seekToTime(chordTimeForX(x));
}

// The same landing, asked for as a moment rather than as a place in the row —
// which is what a bar head knows. Everything below is what dropping the strip
// always did: clamp to the video, draw from the clamped time, and claim the
// seek so the state handler doesn't read it as someone else pressing play.
function seekToTime(t) {
  caretHold = null;   // sent somewhere: that is where the row belongs now
  const wanted = Math.max(0, t);
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
  const playing = isPlaying();
  if (playing) intentionalPlay = true;
  else seekWhilePaused = true;
  player.seekTo(time, true);
  // Paused before the seek means paused after it. Said twice — now and again on
  // the PLAYING that may still arrive — since which of the two lands first is
  // the player's business.
  if (!playing && typeof player.pauseVideo === 'function') player.pauseVideo();
  pendingSeek = { time, until: performance.now() + SEEK_SETTLE_MS };
}

chordViewport.addEventListener('pointerdown', e => {
  // Whatever the last gesture left armed is stale the moment a new press starts.
  // It used to be cleared only by a click reaching the viewport, so a gesture the
  // browser took away — a pointercancel, with the button coming up somewhere else
  // — left it armed with no click to spend it on, and the next press on a note
  // was swallowed instead. Cleared here, the leftover can only ever outlive the
  // gesture it came from by nothing at all.
  suppressChordClick = false;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (chordAnchors.length === 0) return;   // a sheet with no times has no timeline
  // A press on a box or a button is aiming at that, not at the strip: the caret
  // has to be placeable and a word has to be selectable by dragging over it.
  if (e.target.closest && e.target.closest('.chord-bar-time, .chord-add, button.chord-bar-no')) return;
  caretHold = null;   // the hand takes the row from the caret
  chordDrag = {
    pointerId: e.pointerId,
    fromX: e.clientX,
    baseX: chordXForTime(settledTime(currentPlaybackTime())),
    moved: false,
    at: performance.now(),
  };
});

chordViewport.addEventListener('pointermove', e => {
  if (!chordDrag || e.pointerId !== chordDrag.pointerId) return;
  if (!chordDrag.moved) {
    // How far the hand has to go to mean it, which is further while the press is
    // young. Taking the row at six pixels took it from presses aimed at a note:
    // the capture below sends the click to the viewport instead of the note, so
    // the note was never selected and nothing said why. A press still in its
    // first quarter second is being aimed, not dragged, so it is given room to
    // shake; one held past that and then moved is a hand winding the music.
    const slop = performance.now() - chordDrag.at < CHORD_TAP_MS
      ? CHORD_TAP_SLOP : CHORD_DRAG_SLOP;
    if (Math.abs(e.clientX - chordDrag.fromX) < slop) return;
    chordDrag.moved = true;
    // Where the row is taken hold of, which is where the hand is now rather than
    // where it went down. Measured from the press, the row jumped the whole slop
    // the moment it was crossed — and the wider slop above would have made that
    // jump twice what it was.
    chordDrag.fromX = e.clientX;
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

// Which bar an element in the row belongs to. Null when it belongs to none —
// which every caller treats as "not a press on the sheet" rather than bar 0.
function barAt(el) {
  const barEl = el && el.closest('.chord-bar');
  return barEl ? Number(barEl.dataset.bar) : null;
}

// What a press on the row does. Two things are answered in either mode — a
// chord's name goes out to the fretboard viewer, and a note is a way into the
// panel — and the empty width between notes is answered only while editing.
chordStrip.addEventListener('click', e => {
  if (!e.target.closest) return;
  // A chord's name, where it is written on the staff: the way out to the viewer,
  // which used to be the ↗ in the cell. Asked before the mode is, since it means
  // the same thing either way — with the editor closed the cell under the staff
  // is that link too, but the name is what the eye reads a chord by, and a name
  // that answers a press in one mode and ignores it in the other reads as broken.
  const named = e.target.closest('.staff-name');
  if (named) {
    const at = barAt(named);
    const bar = at === null ? null : chordCache.bars[at];
    const chord = bar && bar.chords[Number(named.dataset.chord)];
    if (chord) {
      e.preventDefault();
      openNameInViewer(chord, named.dataset.name);
      return;
    }
  }
  // A note is a way in whichever mode the row is in: with the editor open it
  // moves the selection, and with it closed it opens editing on that note.
  // Asking for the mode first and then for the note again was two steps to say
  // one thing, so the note is asked for once and the mode only decides what
  // else has to happen around the selection.
  const hit = e.target.closest('.staff-hit');
  if (hit) {
    // Read before the strip is rebuilt: opening the editor draws it again, and
    // the element these came off is gone by then.
    const bar = barAt(hit);
    if (bar === null) return;
    e.preventDefault();
    const chord = Number(hit.dataset.chord);
    const note = Number(hit.dataset.note);
    const wasShut = chordEditor.hidden;
    // Opening the editor puts the box and the versions list above the strip, and
    // everything under them moves down by their height — the note just pressed
    // included, which walks out from under the finger that pressed it. So the
    // page is scrolled by however far the strip actually moved, leaving what was
    // pressed where it was pressed.
    const wasAt = wasShut ? chordViewport.getBoundingClientRect().top : 0;
    if (wasShut) {
      // Opened on a shape, the board opens ready to write one. Correcting a
      // chord starts with a tap on one of its strings, and with stacking off
      // that first tap threw the rest of the shape away — the one press that
      // meant "this string, not that one" wiped the four that were right. A
      // single note opens as it always did, replacing.
      noteStack = stopCountAt(bar, chord, note) >= 2;
      openChordEditor(false);
    }
    selectNote(bar, chord, note);
    if (wasShut) {
      const moved = chordViewport.getBoundingClientRect().top - wasAt;
      if (moved) window.scrollBy({ top: moved, behavior: 'instant' });
      focusNotePanel();
    }
    return;
  }
  // Past here is editing only: with the editor closed the row is something you
  // read, and the empty width between notes has nothing to open.
  if (chordEditor.hidden) return;
  // Anywhere else in a stretch's own width opens the board on it, at the place
  // writing goes. It is the only way into a stretch with nothing in it: there is
  // no note there to press.
  const slot = e.target.closest('.staff-slot');
  if (slot) {
    const bar = barAt(slot);
    if (bar !== null) {
      e.preventDefault();
      openNotePanel(bar, Number(slot.dataset.slot));
      return;
    }
  }
});

window.addEventListener('resize', () => {
  // The redraw throws the boxes away, so what is in the open one is kept first.
  commitFocusedNameBox();
  renderChordStrip();
});

// Every diagram a bar shows, in time order: the fingering picked for a stretch,
// and every stop in it that strikes more than one string. A fingering is a
// fingering whichever way it was written, so one list holds both — kept apart,
// a chord and a stop drifted at every change and a stretch holding both showed
// only the chord.
// A grip repeating the one before it is left out: it is a second picture of the
// same hand, and the staff above already says the chord was struck again.
function barShapes(bars, barIndex) {
  const chords = (bars[barIndex] && bars[barIndex].chords) || [];
  const all = [];
  // The harmony each shape is read against, walked across the bar: `/Bb` is a
  // bass move and names no chord, so what a shape under one counts from is the
  // chord still in force above it. `name` stays what the sheet wrote either way
  // — that is what a player reads the bass off — so the two are kept apart.
  const walk = Chords.rulingWalk(Chords.rulingBefore(bars, barIndex));
  chords.forEach((chord, j) => {
    const picked = chord.markers && chord.markers.some(f => f !== null);
    const ruling = walk(chord.name);
    if (picked) {
      all.push({ markers: chord.markers, name: chord.name || '', ruling, chord: j });
    }
    for (const sh of Chords.stopShapes(chord.notes, chord.name,
      Chords.soundingBefore(bars, barIndex, j), walk)) {
      all.push({ markers: sh.markers, name: sh.name, ruling: sh.ruling, chord: j });
    }
    // A chord written as a name and nothing else still says what it is. A stretch
    // with notes in it does not: its name would be printed a second time directly
    // above the one the staff already carries.
    if (!picked && chord.name && !(chord.notes && chord.notes.length)) {
      all.push({ markers: null, name: chord.name, ruling, chord: j });
    }
  });
  const keep = [];
  for (const sh of all) {
    const prev = keep[keep.length - 1];
    if (prev && sh.markers && prev.markers
      && prev.markers.join() === sh.markers.join()) continue;
    // And a bare name repeating the name of the shape before it, which is the
    // chord already drawn there.
    if (prev && !sh.markers && prev.name === sh.name) continue;
    keep.push(sh);
  }
  return keep;
}

// The bar's diagrams as the row reads them: left to right in time order, four to
// a line, wrapping inside the bar's own width — the same shape the row has always
// had, counted in diagrams rather than in stretches. Beats are the staff's job;
// down here they were dropping every diagram that landed less than a slot after
// the one before it, which in a bar of eighths is most of them.
function renderBarLane(bars, barIndex, slot) {
  const shapes = barShapes(bars, barIndex);
  if (!shapes.length) return null;
  const weights = Chords.slotWeights(shapes.length);
  const cells = document.createElement('div');
  cells.className = 'chord-bar-cells';
  let shown = null;
  shapes.forEach((shape, k) => {
    const cell = document.createElement('div');
    cell.className = shape.markers ? 'chord' : 'chord chord-notes-only';
    cell.style.width = `${weights[k] * slot}px`;
    // The name sits over the shape it names, which is where it is read. A name
    // repeated over the next diagram says the chord was struck again as a new
    // one, which is not what a second voicing of it is — so it goes unwritten,
    // but the line it would take is kept all the same. Left out entirely, the
    // diagram under it rode up and the row read as two rows.
    const label = shape.name && shape.name !== shown ? shape.name : '';
    cell.appendChild(label ? viewerLink(shapeName(label), shape) : shapeName(''));
    if (shape.name) shown = shape.name;
    if (shape.markers) {
      // With no chord over it a shape is read against C, which is what the staff
      // and the tab above it already do — a shape whose dots went plain while the
      // tab numbers under it kept their colours read as two pictures of one thing.
      const dia = Chords.diagram(
        shape.markers, shape.ruling || shape.name || 'C',
        effectiveChordMode(), currentChordKey(),
        (chordWindows[barIndex] || [])[shape.chord],
      );
      // The shape is the way out to the fretboard viewer — this shape, not
      // whatever the stretch is called. The whole cell used to be the link, which
      // left no way to click a name.
      cell.appendChild(shape.name ? viewerLink(dia, shape) : dia);
    }
    cells.appendChild(cell);
  });
  return cells;
}

function shapeName(name) {
  const el = document.createElement('span');
  el.className = 'chord-name';
  // Empty is a name deliberately left unwritten — see renderBarLane — and it
  // still has to stand as tall as one, or the diagram under it climbs.
  el.textContent = name ? Chords.displayName(name) : '\u00a0';
  return el;
}

// A way out to the fretboard viewer, around the name or around the shape. With
// the editor closed the strip is something to read, so neither of them is a way
// into renaming: that belongs to the editor.
function viewerLink(inner, shape) {
  const link = document.createElement('a');
  link.className = 'chord-shape-link';
  link.href = Chords.viewerUrl({ name: shape.name, markers: shape.markers });
  link.target = '_blank';
  link.rel = 'noopener';
  link.title = 'Open in Guitar Chord Viewer';
  // Without this a drag starting on a shape becomes the browser's own link drag —
  // a ghost of the URL follows the cursor and the strip stays put.
  link.draggable = false;
  link.appendChild(inner);
  return link;
}

// The name of one shape, written where the name is drawn. A box over the third
// stop in a bar names that stop — a chord starting there — and nothing else,
// which is the whole point: the panel's old box renamed the entire stretch and
// nothing on screen said so.
// Committed on the way out rather than as it is typed: the redraw that follows
// would take the box out from under the caret.
function shapeNameBox(chord, shape, target) {
  const stretch = target === 'stretch';
  const held = () => (stretch
    ? chord.name
    : (chord.notes[shape.index] && chord.notes[shape.index].name)) || '';
  const box = document.createElement('input');
  box.className = 'note-name-box';
  box.value = held();
  box.spellcheck = false;
  // Empty means the chord already in force here, so that is what the box says
  // when it is empty: what is typed into it is an override, not a first name.
  box.placeholder = shape.name || 'Chord';
  box.setAttribute('aria-label', stretch ? 'Chord' : 'Chord starting on this stop');
  const commit = () => {
    // A viewer link pasted here is unpacked, the same as in the frets box.
    const typed = Chords.readChord(box.value);
    const name = typed ? typed.name : '';
    if (held() === name) return;
    if (stretch) {
      chord.name = name;
      if (typed && typed.markers) chord.markers = typed.markers;
    } else {
      const ev = chord.notes[shape.index];
      if (!ev) return;
      if (name) ev.name = name;
      else delete ev.name;
    }
    writeSheetFromCache(stretch ? 'text' : 'notes');
    renderChordStrip(true);
  };
  box.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); box.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); box.value = held(); box.blur(); }
    e.stopPropagation();
  });
  box.addEventListener('blur', () => commit());
  return box;
}

// A button that acts on the sheet rather than takes you somewhere. It never
// takes focus: that would blur an open chord box, which writes the sheet back
// and can redraw the strip out from under the click still in flight. `content`
// is a string or a drawing — several of these wear what they write. `stop`
// keeps the click off the cell underneath, which has a mind of its own.
function toolButton(cls, content, title, run, stop) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.title = title;
  if (typeof content === 'string') b.textContent = content;
  else b.appendChild(content);
  b.addEventListener('mousedown', e => e.preventDefault());
  b.addEventListener('click', e => {
    e.preventDefault();
    if (stop) e.stopPropagation();
    run();
  });
  return b;
}

// A name half-typed when the strip is about to be redrawn. The box writes what
// it holds on the way out, so letting go of it is the whole of saving it — and
// the redraw would otherwise take the box, and what was typed into it, away.
function commitFocusedNameBox() {
  const el = document.activeElement;
  if (el && el.classList && el.classList.contains('note-name-box')) el.blur();
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
    // A bar put between two others is empty until it is written into, and it has
    // to survive being read back or it is gone the moment the caret leaves it.
    // What it holds then is its time, which is the whole of what was said.
    .filter(bar => bar.chords.length || bar.start !== null);
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
// The reach the staff is drawn to while the board is open, only ever widening.
// A note higher than any before it grows the row once, on the tap that writes it,
// rather than every tap re-measuring the sheet and moving the board.
let staffHold = null;

const widerReach = (a, b, pick) =>
  (a === null || a === undefined) ? b : (b === null || b === undefined) ? a : pick(a, b);

function holdStaffReach(reach) {
  if (!notePanelAt) { staffHold = null; return reach; }
  if (!reach) return staffHold;
  if (staffHold) {
    // Everything the reach carries is kept: the row of dots is measured from
    // `stack` and the foot of the staff from `loNote`, so a merge that named only
    // the two lines dropped both — the row lost its label band and its slack on
    // the first tap after the board opened, and the staff shrank under the hand.
    // The dot row widens the same way the lines do, so deleting the last single
    // note does not pull it back down mid-edit either.
    reach = {
      ...reach,
      top: Math.max(reach.top, staffHold.top),
      bottom: Math.min(reach.bottom, staffHold.bottom),
      stack: Math.max(reach.stack || 0, staffHold.stack || 0),
      // A sheet with nothing on the staff yet has no highest or lowest note, and
      // null is what says so — Math.max would read it as zero and put the foot of
      // the staff somewhere nothing is written.
      hiNote: widerReach(reach.hiNote, staffHold.hiNote, Math.max),
      loNote: widerReach(reach.loNote, staffHold.loNote, Math.min),
    };
  }
  staffHold = reach;
  return reach;
}

let noteDur = 0.5;
let noteDotted = false;
// Three in the time of two. It sits with the dot rather than with the durations:
// both of them bend whatever value is chosen rather than being one.
let noteTriplet = false;
// While on, a tap piles onto the last note instead of following it, which is how
// a double stop gets written.
let noteStack = false;
// While on, a fret tapped says that string of the note is muted rather than
// where the note is: the ✕ button, and the way a chord ringing on top of muted
// courses is written — tap the strings the hand kills. Tapping one it already
// mutes lets it ring again.
let noteDeadMode = false;
// Armed by the + between ← and →: the next thing written goes in just after this
// note rather than at the end of the stretch. Which is how a note is put between
// two others, and how the next chord is begun without letting go of stacking —
// what is written lands on a place of its own rather than piling onto the last.
let noteAfter = null;
// Whether the list of keys is open. Remembered rather than reset per note: the
// list is asked for by someone learning the board, and that lasts longer than
// one tap.
let noteKeysOpen = false;

const NOTE_DURATIONS = [
  [4, 'Whole'], [2, 'Half'], [1, 'Quarter'], [0.5, 'Eighth'], [0.25, 'Sixteenth'],
];
// 0 is not a duration but the lack of one: a stop with no length sounds until
// the next thing does, which is what a chord is. It is how a fingering is
// tapped out, so it sits with the durations rather than off on its own.
const NO_DUR = 0;
const noteValue = () => noteDur * (noteDotted ? 1.5 : 1) * (noteTriplet ? 2 / 3 : 1);
// A rest and a tie have to last something, so they fall back to a quarter when
// the board is set to write chords.
const restValue = () => noteValue() || 1;

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
  // The bar's own four beats, split the way a written bar is read — not the room
  // the strip happens to draw this stretch at. The width bends to fit a phrase
  // in (see Chords.barWeights); the beat it falls on does not, and a panel
  // reporting 1.196 beats of room was measuring the drawing rather than the
  // music.
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

// `Bb9:1.1.1.0..` → `Bb9 1/1+2/1+3/1+4/0:0`: the same six frets, written as the
// stop they sound as and with no length of its own, at the head of the stretch
// where the chord was. Done when the shape is tapped rather than when the sheet
// is read, so a sheet nobody has edited is left exactly as it was written.
function chordMarkersToStop(chord) {
  const stops = [];
  (chord.markers || []).forEach((fret, i) => {
    if (fret !== null) stops.push({ string: i + 1, fret });
  });
  // A name with no frets under it is already written the one way.
  if (!stops.length) return;
  chord.notes = chord.notes || [];
  chord.notes.unshift({ d: 1, stops, free: true });
  chord.markers = null;
}

// MIGRATION (temporary): the same turn for a whole sheet at once. Every chord
// still written as a name and six frets becomes the stop it sounds as, so a
// sheet worked on before the two notations were folded together comes back
// written the one way. Hung off the box's own tidy-up, so opening 🎼 and
// leaving the field is the whole of the migration for a sheet.
// Delete this, its call in normalizeChordInput, and the `Name:frets` arm of
// toCompact once no sheet in use is written the old way any more.
function stopsFromOldChords(bars) {
  for (const bar of bars) {
    for (const chord of bar.chords) {
      if (chord.markers) chordMarkersToStop(chord);
    }
  }
}

// The viewer, opened on a name written in the strip — what the cell's ↗ was.
// The shape sent with it is the first one struck under that name, since that is
// the voicing the name is standing over; a name with nothing under it goes on
// its own, which is all the viewer needs to draw one.
function openNameInViewer(chord, name) {
  const shapes = Chords.stopShapes(chord.notes, chord.name);
  const under = shapes.find(sh => sh.name === name);
  const markers = (name === chord.name && chord.markers)
    || (under && under.markers) || null;
  window.open(Chords.viewerUrl({ name, markers }), '_blank', 'noopener');
}

function openNotePanel(barIndex, chordIndex) {
  notePanelAt = { bar: barIndex, chord: chordIndex };
  noteSel = null;
  noteAfter = null;
  // Through the strip rather than the panel alone: what is being written into is
  // marked in the strip, and a panel drawn without it says the caret is nowhere.
  renderChordStrip(true);
  markNoteSelection();
  focusNotePanel();
}

// The board takes the keyboard when it opens. The sheet box holds focus from the
// moment the editor does, and every button here stops itself taking it away — so
// ← → and the duration keys were being typed into the text instead of moving the
// caret on the board. Focused without scrolling: the row is not to move under a
// hand that is writing on it.
// Moving the caret marks a different note and nothing else, so the mark is moved
// where it is drawn instead of the row being drawn again. Rebuilding the row for
// a caret step took the page with it: the browser re-anchors its scroll when a
// subtree that size is replaced, and the page jumped every ← →.
function markNoteSelection() {
  const notes = noteEntries();
  const after = noteAfter !== null ? null
    : (noteSel === null && notes.length ? notes.length - 1 : null);
  for (const hit of chordStrip.querySelectorAll('.staff-hit')) {
    const here = !!notePanelAt && barAt(hit) === notePanelAt.bar
      && Number(hit.dataset.chord) === notePanelAt.chord;
    const index = Number(hit.dataset.note);
    hit.classList.toggle('on', here && index === noteSel);
    hit.classList.toggle('after', here && index === after);
  }
  // And the mark for a stretch with nothing in it, which is where writing starts
  // when there is no note to write after.
  for (const caret of chordStrip.querySelectorAll('.staff-caret')) {
    const on = !notes.length && !!notePanelAt && barAt(caret) === notePanelAt.bar
      && Number(caret.dataset.caret) === notePanelAt.chord;
    caret.classList.toggle('on', on);
  }
  // The marks are what the caret is, so this is the one place that knows it just
  // moved — every path that moves the selection ends here.
  keepCaretInView();
}

// The caret, kept where it can be seen. Walking the selection with ← → runs it
// off whichever edge it was heading for, and the row does not follow: the row is
// placed from the clock, and the clock is stopped while a phrase is being
// written. So the row is moved by however far it takes to bring the caret back
// inside, and no further — a caret one note past the edge should come back one
// note, not land in the middle of the row and take the whole bar with it.
// Only while the video is stopped. Playing, the row is following the music, and
// two things sliding it at once is neither.
function keepCaretInView() {
  if (!notePanelAt || chordEditor.hidden || !getChordsVisible()) return;
  if (chordViewport.hidden || chordDrag) return;
  if (isPlaying()) return;
  // What is being written on, in the order the marks mean: the note selected,
  // the empty stretch's caret, then the place after the last note — which is
  // where writing sits when nothing is selected.
  const el = chordStrip.querySelector('.staff-hit.on')
    || chordStrip.querySelector('.staff-caret.on')
    || chordStrip.querySelector('.staff-hit.after');
  if (!el) return;
  const box = el.getBoundingClientRect();
  if (!box.width && !box.height) return;   // drawn but not shown
  const vp = chordViewport.getBoundingClientRect();
  if (!vp.width) return;
  // Never more than a quarter of the row, so a narrow window still has somewhere
  // to put the note it is bringing back.
  const margin = Math.min(CARET_MARGIN, vp.width / 4);
  const left = box.left - vp.left;
  const right = box.right - vp.left;
  let shift = 0;
  if (left < margin) shift = margin - left;
  else if (right > vp.width - margin) shift = (vp.width - margin) - right;
  if (!shift) return;
  // The transform reads `playhead - x`, so moving the row right by `shift` is
  // taking that much off x.
  caretHold = { x: chordStripX() - shift, time: currentPlaybackTime() };
  placeChordStrip(caretHold.x);
}

function focusNotePanel() {
  if (!notePanel || notePanel.hidden) return;
  notePanel.setAttribute('tabindex', '-1');
  notePanel.focus({ preventScroll: true });
}

function closeNotePanel() {
  const wasOpen = noteAfter !== null;
  // Nothing is being written on any more, so the row goes back to following the
  // clock. Left held, it stayed parked wherever the last caret took it, with
  // nothing on screen to say why.
  caretHold = null;
  notePanelAt = null;
  noteSel = null;
  noteAfter = null;
  if (wasOpen) renderChordStrip(true);
  if (!notePanel) return;
  notePanel.hidden = true;
  notePanel.textContent = '';
  // The marks on the staff say what the panel is open on, so they go out with
  // it. Closing used to leave a note ringed with nothing open on it — the ring
  // says a tap replaces this note, and there was nothing left to tap with.
  markNoteSelection();
}

// Every change goes the same way out: into the sheet, then back onto the strip
// and the panel. The strip is redrawn from the parse rather than from the text,
// since the parse is what was just edited.
function commitNotes() {
  // What the sheet said before this, so ↺ can put it back. Filed here rather
  // than at each caller: everything the board does comes through this door.
  pushNoteUndo();
  writeSheetFromCache('notes');
  // The redraw ends by drawing the panel against the same parse, so the panel is
  // not asked for again here — see the tail of drawChordStrip.
  renderChordStrip(true);
}

// Back to writing at the end of the stretch: nothing selected, and no room being
// held open anywhere.
function endNoteWriting() {
  const wasOpen = noteAfter !== null;
  noteSel = null;
  noteAfter = null;
  // A redraw draws the panel itself; without one the panel still has to hear
  // that nothing is selected any more.
  if (wasOpen) renderChordStrip(true);
  else renderNotePanel();
  markNoteSelection();
}

// A place to write, just after what is selected — or after the last note, when
// writing was already at the end. Nothing goes into the sheet yet: the next tap,
// rest or tie goes in there, and is then what is being edited, so stacking piles
// the rest of a chord onto it.
function insertAfterNote() {
  const notes = noteEntries();
  if (!notes.length) return;
  const at = noteSel !== null ? noteSel : notes.length - 1;
  // Room right where the + was pressed, inside a bracket as readily as outside
  // one: a bracket holds whatever is written in it — see putNote for what the
  // note written into the gap joins.
  noteAfter = at;
  noteSel = null;
  renderChordStrip(true);
  markNoteSelection();
}

// Where what is written goes: into the gap the + opened, which is then what is
// being edited, or at the end of the stretch when no gap is open.
function putNote(ev) {
  const notes = noteEntries();
  if (noteAfter === null) { notes.push(ev); return; }
  const at = Math.min(noteAfter + 1, notes.length);
  // Written between two notes of one bracket, it joins them — which is how a
  // bracket grows. At either edge of one it stays outside, where inside and out
  // is not something the gap can say.
  const before = notes[at - 1], after = notes[at];
  if (before && after && before.trip && before.trip === after.trip) {
    ev.trip = before.trip;
    // The bracket already says the group is a triplet. A value written with the
    // board's triplet mark on would say it a second time, and the note would be
    // two thirds of two thirds of what it looks like.
    ev.d = Chords.tripletBase(ev.d) || ev.d;
  }
  notes.splice(at, 0, ev);
  noteSel = at;
  noteAfter = null;
}

// A tap on the board. With a note selected it replaces that note — which is how
// one written on the wrong string is corrected — and otherwise it writes a new
// one after the last, or into the gap the + opened.
// A stop already lit is a stop taken off: pressing what is on is how you
// unwrite it, stacking or replacing alike. It used to filter that string out and
// put the same fret straight back, so the one press that plainly meant "not this
// one" was the one press that did nothing. Emptied of every string the note
// keeps its place and its length and becomes a rest — what was being corrected
// is the fingering, not the beat — written the way the R button writes one.
// A rest and a tie are turned away, because on them a lit cell means something
// else: a rest keeps the shape it was made from so that pressing it again brings
// the note back, and a tie's lit cells are the strings it is holding on from
// before it. On either, a press is that note struck again, which is what the
// stack and replace branches in pressStop do.
// False where nothing was taken off, so the caller knows to go on.
function unlightStop(ev, string, fret) {
  if (ev.tie || ev.rest) return false;
  const stops = ev.stops || [];
  const lit = stops.findIndex(st => st.string === string && st.fret === fret);
  if (lit < 0) return false;
  stops.splice(lit, 1);
  ev.stops = stops;
  if (!stops.length) {
    delete ev.free;
    delete ev.grace;
    ev.rest = true;
  }
  return true;
}

// A new note holding one stop, at the length the board is set to. No length at
// all is the state a fingering is written in — held until the next note, the way
// a chord is — and that is what `free` says.
function newStopEvent(stop) {
  return noteDur === NO_DUR
    ? { d: 1, stops: [stop], free: true }
    : { d: noteValue(), stops: [stop] };
}

function pressStop(string, fret) {
  const notes = noteEntries();
  // What a tap writes: a stop, muted while the ✕ button is on.
  const stop = () => (noteDeadMode ? { string, fret, dead: true } : { string, fret });
  if (noteAfter !== null) {
    putNote(newStopEvent(stop()));
    commitNotes();
    return;
  }
  const ev = editingNote();
  if (ev) {
    // ✕ on: the tap is about this string of the note rather than about where the
    // note is, so it lands on the shape instead of replacing it. A string it
    // already mutes rings again.
    if (noteDeadMode && !ev.tie) {
      const was = (ev.stops || []).find(st => st.string === string && st.fret === fret);
      if (was && was.dead) delete was.dead;
      else {
        ev.stops = stackStop(ev.stops, string, fret);
        const now = ev.stops.find(st => st.string === string && st.fret === fret);
        if (now) now.dead = true;
        delete ev.rest;
      }
      commitNotes();
      return;
    }
    // A stop already lit is a stop taken off — see unlightStop. A rest and a tie
    // fall through it to the branches below, where a press is that note struck
    // again.
    if (unlightStop(ev, string, fret)) {
      commitNotes();
      return;
    }
    if (noteStack && !ev.tie) {
      ev.stops = stackStop(ev.stops, string, fret);
      delete ev.rest;
    } else {
      // It keeps its place under a bracket: tapping the right string to correct
      // a wrong one is not a reason to fall out of the triplet.
      const put = { d: ev.d, stops: [stop()], free: ev.free };
      if (ev.trip) put.trip = ev.trip;
      notes[noteSel] = put;
    }
    commitNotes();
    return;
  }
  const last = notes[notes.length - 1];
  if (noteStack && last && !last.rest && !last.tie) {
    last.stops = stackStop(last.stops, string, fret);
  } else notes.push(newStopEvent(stop()));
  commitNotes();
}

// A name for a new bracket that no bracket in the bar is using. The sheet is
// written out and read back on every edit, and that is where the names are
// really settled — this one only has to last until then.
function freeTripId() {
  const taken = new Set(barNoteEvents().map(p => p.ev.trip && p.ev.trip.id));
  let n = 1;
  while (taken.has(`g${n}`)) n++;
  return `g${n}`;
}

// One more string in a shape. A string already in it moves to where it was just
// tapped rather than being struck twice at once, which is not a thing a hand can
// do — and which would draw one fret in the diagram while the tab printed two.
function stackStop(stops, string, fret) {
  const kept = (stops || []).filter(st => st.string !== string);
  kept.push({ string, fret });
  // Written 1st string first, the way every other stop in a sheet is written,
  // whatever order it was tapped in.
  return kept.sort((a, b) => a.string - b.string);
}

// The same chord again, written just after it. The name is not copied: a name
// repeated over the next shape reads as a chord change to itself, and what this
// writes is the same chord struck again, which the ruling name already says.
// The same note again: what it sounds and how long for, and nothing about the
// chord — see copyNote.
function noteCopy(src) {
  const copy = { d: src.d, stops: (src.stops || []).map(st => ({ ...st })) };
  if (src.free) copy.free = true;
  if (src.rest) copy.rest = true;
  if (src.tie) copy.tie = true;
  return copy;
}

function copyNote() {
  // Only ever the selected note. Falling back to the last note of the stretch
  // put the copy somewhere nobody had pointed at — the button says "this again",
  // and with nothing selected there is no this. The button is down then, so
  // there is nothing to press and no silent second meaning to it.
  if (noteSel === null) return;
  const notes = noteEntries();
  const at = noteSel;
  const src = notes[at];
  if (!src) return;
  // A note in a triplet is copied as the triplet — three more, written after the
  // three, which is the same figure struck again. One more inside the three has
  // nothing the sheet could say about it.
  const group = tripletGroupPlaces(notePanelAt.chord, at);
  if (group.length) {
    const last = group[group.length - 1];
    const into = chordCache.bars[notePanelAt.bar].chords[last.cell].notes;
    // A bracket of their own: the same figure struck again, rather than six
    // notes crowded under the one bracket the three came from.
    const from = group[0].ev.trip;
    const trip = { id: freeTripId(), num: from.num, den: from.den };
    into.splice(last.index + 1, 0, ...group.map(p => {
      const copy = noteCopy(p.ev);
      copy.trip = trip;
      return copy;
    }));
    notePanelAt = { bar: notePanelAt.bar, chord: last.cell };
    noteSel = last.index + 1;
    noteAfter = null;
    commitNotes();
    return;
  }
  notes.splice(at + 1, 0, noteCopy(src));
  // The copy is what is being written now — the reason to copy one is usually to
  // move a string of it — so it is what the board is holding when it lands.
  noteSel = at + 1;
  noteAfter = null;
  commitNotes();
}

// Rest and tie do the same double duty as the board: they turn the selected note
// into one, or write one at the end.
// Both are marks on a note rather than notes of their own, so pressing one again
// takes it off and the note comes back — it used to write the same mark over
// itself, which is a button that goes down and never comes up. The strings are
// kept on the event while the mark is on, so the note that comes back is the note
// that was there; a mark written before this browser last read the sheet has none
// to keep, and then what comes back is the note it was holding on, which is the
// one the row was already drawing in that place.
function addNoteRest() { markNote('rest'); }

function addNoteTie() { markNote('tie'); }

function markNote(mark) {
  const other = mark === 'rest' ? 'tie' : 'rest';
  const ev = editingNote();
  if (!ev) {
    putNote({ d: restValue(), [mark]: true, stops: [] });
    commitNotes();
    return;
  }
  // A tie is a note held on, so there has to be one: written where nothing is
  // ringing — the first note of a sheet — it would take the note off the staff
  // and put nothing in its place, which is a note deleted by a button that says
  // it ties. The button is down in that case, so this is the second door.
  if (mark === 'tie' && !ev.tie && !heldStops(noteSel).length) return;
  if (ev[mark]) {
    const stops = (ev.stops && ev.stops.length) ? ev.stops : heldStops(noteSel);
    // Nothing to be a note with — a tie written as the first thing in a stretch,
    // holding a note in the bar before it — so the mark stays where it is rather
    // than leaving an event that sounds nothing at all.
    if (!stops.length) return;
    delete ev[mark];
    ev.stops = stops;
  } else {
    delete ev[other];
    // A rest and a tie both take a length, and neither is struck ahead of the
    // note after it: the two states a note can be written in that they cannot.
    delete ev.free;
    delete ev.grace;
    ev[mark] = true;
    ev.stops = ev.stops || [];
  }
  commitNotes();
}

// What a rest or a tie at `at` is sounding: the last thing struck before it,
// counted over the whole bar and then over the bars before it, since a tie at the
// head of a bar holds a note struck in the one before. A tie is that note still
// ringing, so striking it again is the same strings — which is what taking the
// tie off writes.
function heldStops(at) {
  const all = barNoteEvents();
  const pos = all.findIndex(p => p.cell === notePanelAt.chord && p.index === at);
  for (let i = pos - 1; i >= 0; i--) {
    const ev = all[i].ev;
    if (ev.tie) continue;
    // Nothing rings over a rest, so nothing is being held after one.
    if (ev.rest) return [];
    if (ev.stops && ev.stops.length) return ev.stops.map(st => ({ ...st }));
  }
  const over = Chords.carriedStops(chordCache.bars, notePanelAt.bar);
  return over.map(st => ({ ...st }));
}

// The duration buttons set what comes next, or re-time what is selected.
function setNoteDur(d) {
  const ev = editingNote();
  // Writing a duration on a note that had none is what turns a chord back into a
  // note, and taking it away again is what turns a note into a chord — see
  // markFreeNotes.
  if (ev) {
    if (d === NO_DUR) { ev.free = true; delete ev.grace; }
    else {
      // A note under a bracket takes the new value on its own. The bracket says
      // what the group is, so what it holds is free to be an eighth and a
      // quarter — which is how a swung beat is written.
      ev.d = Chords.isDottedDur(ev.d) ? d * 1.5 : d;
      delete ev.free;
    }
    commitNotes();
    return;
  }
  noteDur = d;
  renderNotePanel();
}

// A dot bends one note, and under a bracket it bends it the same way: a dotted
// eighth inside a 3 is ordinary printed music once the bracket is what says the
// group is a triplet, rather than the values inside it. So there is nothing left
// for the button to be down for, and it no longer has a rule of its own.
function toggleNoteDot() {
  const ev = editingNote();
  if (ev) {
    ev.d = Chords.isDottedDur(ev.d) ? ev.d / 1.5 : ev.d * 1.5;
    delete ev.free;
    commitNotes();
    return;
  }
  noteDotted = !noteDotted;
  if (noteDotted) noteTriplet = false;
  renderNotePanel();
}

// Three of these in the time of two. Three notes make a triplet, not one — a
// lone third of a beat is nothing anyone plays — so this works on the selected
// note and the two after it — across a chord change, since three notes under
// three different chords are still a triplet — the way it is done on paper: mark
// three, and they now fill the time two of them used to. The rest of the bar moves up by the one
// note's worth of time that buys, which is the point of writing it.
// Pressing it again on any of the three undoes that group and nothing else.
// A note already dotted gives the dot up: one note is bent one way, and a dotted
// triplet is not something written here.
function toggleNoteTriplet() {
  const ev = editingNote();
  if (!ev) {
    noteTriplet = !noteTriplet;
    if (noteTriplet) noteDotted = false;
    renderNotePanel();
    return;
  }
  if (!noteCanTriplet()) return;
  if (ev.trip) {
    // Pressing it again on a bracket lets the last note out of it, and pressing
    // it on a bracket of two takes the bracket off. So the button counts down —
    // three, two, none — and two notes under one 3, which is how a swung beat is
    // written, is two presses rather than a bracket and a deletion.
    // Nothing is deleted on the way: the note let out keeps its value and its
    // place, and the bar goes back to the length it had.
    const group = tripletGroupPlaces(notePanelAt.chord, noteSel);
    if (group.filter(p => !p.ev.grace).length > 2) {
      // The last note counted, and the grace notes leaning on it, which go with
      // it rather than being left at the end of the bracket alone.
      let last = group.length - 1;
      while (last > 0 && group[last].ev.grace) last--;
      for (let i = group.length - 1; i >= last; i--) delete group[i].ev.trip;
      const out = group[last];
      // The next press goes on counting down the same bracket, so the selection
      // follows it in when the note it was on is the one let out.
      const kept = last > 0 ? group[last - 1] : null;
      if (kept && out.cell === notePanelAt.chord && out.index === noteSel) {
        notePanelAt = { bar: notePanelAt.bar, chord: kept.cell };
        noteSel = kept.index;
      }
    } else {
      for (const p of group) delete p.ev.trip;
    }
  } else {
    // A name of its own, so the bracket is not read as part of one beside it.
    const trip = { id: freeTripId(), num: 3, den: 2 };
    for (const note of tripletGroup()) note.trip = trip;
  }
  commitNotes();
}

// Two notes under one 3 is a swung beat, which is ordinary printed music, so two
// is enough to bracket. Three is what the button reaches for; two is what it
// settles for at the end of a bar, or up against a bracket already there. One is
// not a group, and that is the only place the button is down.
// A grace note and a lengthless stop take no time from the bar, so neither is
// one of the notes counted, and neither can be the note the bracket starts on.
// Taking a bracket off is always allowed — whatever the staff brackets can be
// unbracketed. With no note selected the button is the value the next one is
// written with, and there is nothing yet for it to be wrong about.
function noteCanTriplet() {
  const ev = editingNote();
  if (!ev) return true;
  if (ev.free || ev.grace) return false;
  if (ev.trip) return true;
  return tripletGroup().filter(n => !n.grace).length >= 2;
}

// Beaming a run by hand: this note and the next are drawn as one gesture,
// whatever the beat under them says. Which is what beaming is for once a phrase
// stops agreeing with the beat — four sixteenths straddling two beats are one
// run to play, and the row breaks them into two.
// One join is all this writes, and it is all it needs to: the mark sits on the
// link between two notes, so joining 1–2 and then 2–3 makes a run of three. A
// button per length would be several ways of saying the same thing.
// Pressing it again parts them, and the beats take over there again.
function toggleNoteBeam() {
  if (!noteCanBeam()) return;
  const ev = editingNote();
  if (ev.beam) delete ev.beam;
  else ev.beam = true;
  commitNotes();
}

// Whether there is a note on the other side of the join. A stretch's last note
// looks over the cell edge to the next stretch of the same bar, since that is a
// join staffBar now draws — but not over the bar line, which is drawn as a staff
// of its own, and not past an empty stretch, which has a chord of its own to say.
function noteJoinable() {
  if (noteSel === null) return false;
  if (noteSel + 1 < noteEntries().length) return true;
  const bar = notePanelAt && chordCache.bars[notePanelAt.bar];
  const next = bar && bar.chords[notePanelAt.chord + 1];
  return !!(next && next.notes && next.notes.length);
}

// Beams say a note is shorter than a beat, so only such a note can carry one: a
// quarter has no beam to share, and a fingering written with no length has no
// stem to hang one from. The button is down on those rather than doing nothing
// when pressed.
function noteCanBeam() {
  const ev = editingNote();
  return !!(ev && !ev.free && !ev.rest && !ev.tie && !ev.grace && ev.d < 1
    && noteJoinable());
}

// A grace note — the small one with the stroke through its stem, struck just
// before the note it leans on and taking no time of its own from the bar. Which
// is why it is a mark on a note rather than a length: the run around it is
// measured as if it were not there, and it is drawn ahead of the note it belongs
// to rather than on a beat of its own.
function toggleNoteGrace() {
  if (!noteCanGrace()) return;
  const ev = editingNote();
  if (ev.grace) { delete ev.grace; commitNotes(); return; }
  ev.grace = true;
  // It takes no time from the bar, so it is outside the beats a beam is read
  // off, and a length longer than an eighth has no flag to be drawn small.
  delete ev.beam;
  delete ev.free;
  if (ev.d >= 1) ev.d = 0.5;
  commitNotes();
}

// The ✕ button is a mode rather than a mark on this note: which strings are
// muted is picked on the neck, a tap at a time, because that is the question —
// a chord is muted a course at a time and its top voice often rings.
function toggleNoteDeadMode() {
  noteDeadMode = !noteDeadMode;
  renderNotePanel();
}

function noteDeadOn() {
  return noteDeadMode;
}

// Only a struck note can be one: a rest is silence and has nothing to lean on
// the next note with, a tie is the note before it still sounding, and a fingering
// written with no length has no stem to draw the stroke across.
function noteCanGrace() {
  const ev = editingNote();
  return !!(ev && !ev.rest && !ev.tie && !ev.free && ev.stops && ev.stops.length);
}

function noteGraceOn() {
  const ev = editingNote();
  return !!(ev && ev.grace);
}

// Whether the note being edited is joined to the next by hand — what lights the
// button, and what pressing it takes back.
function noteBeamOn() {
  const ev = editingNote();
  return !!(ev && ev.beam);
}

// The three notes a triplet is made of. Going in, that is the selected note and
// the two after it — and if the phrase ends before that, whatever there is, so
// the last note of a bar can still be marked. Coming out, it is the three of the
// run the selected note belongs to, counted from where that run starts: a run of
// six is two triplets, and undoing one of them leaves the other alone.
// The triplet a note is in, as the places its notes sit in — the stretch and the
// index inside it, since a triplet can cross a cell edge and every edit that
// works on the group has to reach into both. Empty when the note is not in one.
// A triplet is one thing: three notes fill the time of two, so there is nothing
// the sheet can say about four of them or two. Every button that adds, removes or
// re-times a note works on the group for that reason — copyNote, deleteNote,
// insertAfterNote, setNoteDur — and toggleNoteDot is down on one, since a dot
// bends a single note and there is no note here to bend on its own.
function tripletGroupPlaces(cell, index) {
  const all = barNoteEvents();
  const at = all.findIndex(p => p.cell === cell && p.index === index);
  if (at < 0 || !all[at].trip) return [];
  const key = all[at].trip;
  const out = [];
  for (let i = at; i >= 0 && all[i].trip === key; i--) out.unshift(all[i]);
  for (let i = at + 1; i < all.length && all[i].trip === key; i++) out.push(all[i]);
  return out;
}

function tripletGroup() {
  const all = barNoteEvents();
  const at = all.findIndex(p => p.cell === notePanelAt.chord && p.index === noteSel);
  if (at < 0) return [];
  // Going in: the selected note and what follows it, up to three notes.
  // The run stops at a note already under a bracket and at a stop written with
  // no length: neither can be one of the notes a bracket is over, and reaching
  // past one would bracket a note that is somebody else's or no note at all.
  // A grace note takes no time from the bar, so it is not one of the three — but
  // it stands among them and is kept inside the bracket. Left out, the bracket
  // would be written as the two brackets its notes are no longer next to each
  // other in.
  if (!all[at].ev.trip) {
    const out = [];
    let counted = 0;
    for (let i = at; i < all.length && counted < 3; i++) {
      const ev = all[i].ev;
      if (ev.trip || ev.free) break;
      out.push(ev);
      if (!ev.grace) counted++;
    }
    // One leaning on the note after the bracket leans outside it.
    while (out.length && out[out.length - 1].grace) out.pop();
    return out;
  }
  // Coming out: the notes the staff brackets with the selected one. A run of six
  // is two triplets, so undoing one leaves the other alone.
  return tripletGroupPlaces(notePanelAt.chord, noteSel).map(p => p.ev);
}

// Every note in the bar, in playing order, with the stretch each one came from.
// A triplet is three notes and the harmony under them has nothing to do with it:
// a bar of quarter triplets is three chords, each a stretch of its own. Counted
// over the bar rather than inside one stretch's own notes, which is why marking
// one used to shorten a single note and leave it a triplet of nothing.
function barNoteEvents() {
  const bar = notePanelAt && chordCache.bars[notePanelAt.bar];
  if (!bar) return [];
  const out = [];
  // Which triplet each note belongs to, read over the bar the way the staff
  // reads it — see Chords.tripletGroups — so the three the button undoes are the
  // three the bracket is drawn over.
  const all = [];
  bar.chords.forEach((chord, cell) => {
    (chord.notes || []).forEach((ev, index) => {
      all.push({ ev, cell, index });
    });
  });
  const keys = Chords.tripletGroups(all.map(p => p.ev));
  all.forEach((p, i) => out.push({ ...p, trip: keys[i] }));
  return out;
}

function deleteNote() {
  const notes = noteEntries();
  const at = noteSel !== null ? noteSel : notes.length - 1;
  if (at < 0 || at >= notes.length) return;
  // One note, whether or not it is under a bracket. The bracket is written over
  // a range and says nothing about how many notes fill it, so the two left
  // behind are a bracket over two — which is what a swung beat is.
  notes.splice(at, 1);
  noteAfter = null;
  if (noteSel !== null) noteSel = notes.length ? Math.min(at, notes.length - 1) : null;
  commitNotes();
}

// Walking the selection. Off either end lands back on writing at the end, which
// is the state the panel opens in.
// Every stretch in the sheet in playing order, as the pair of indexes the panel
// holds. What ← → walk along once they reach the end of the one they are in: a
// phrase is written across bars, and a caret that stops at the bar line leaves
// the next bar reachable only by going back to the mouse.
function noteStretchList() {
  const out = [];
  (chordCache.bars || []).forEach((bar, bi) => {
    bar.chords.forEach((chord, ci) => out.push({ bar: bi, chord: ci }));
  });
  return out;
}

// Along to the next stretch, or back to the one before, landing at whichever end
// of it the caret arrived from: going right, its first note — or its own writing
// place, if nothing is written in it yet — and going left, the place after its
// last note.
function moveNoteStretch(by) {
  if (!notePanelAt) return false;
  const list = noteStretchList();
  const from = list.findIndex(s => s.bar === notePanelAt.bar && s.chord === notePanelAt.chord);
  const to = from < 0 ? null : list[from + (by > 0 ? 1 : -1)];
  if (!to) return false;
  notePanelAt = { bar: to.bar, chord: to.chord };
  const notes = noteEntries();
  noteSel = by > 0 && notes.length ? 0 : null;
  return true;
}

// ============================================================
// Moving one thing along the sheet (Shift + arrows)
// ============================================================
// What stands on the staff is one thing at a time: a stop, a note, a rest, a
// tie — or a chord written as a name with nothing under it yet. A chord name is
// not a thing of its own; it is written on the moment it starts, so it travels
// with whatever it is written on. That is the whole of the move: the thing
// picked and the one beside it trade places, and nothing else on the sheet is
// touched. A chord does not carry the phrase written after it — those notes did
// not move, the chord did, and the phrase is read against whatever is over it.
//
// The nesting the sheet is parsed into — bar, stretch, note — is not that row.
// A stretch holds a name and the notes after it, and a chord can also be a name
// written on a note inside another stretch. So the row is built first, moved in,
// and the touched bars are written back out of it. Only the bars either end of
// the step are rebuilt: every other bar keeps the objects, and the text, it
// already had.
function sheetEvents() {
  const out = [];
  (chordCache.bars || []).forEach((bar, bi) => {
    // Which triplet each note is in, read over the bar — see barNoteEvents. Held
    // as one list per bar and handed out as the notes are walked.
    const keys = Chords.tripletGroups(
      (bar.chords || []).reduce((all, st) => all.concat(st.notes || []), []));
    let at = 0;
    (bar.chords || []).forEach((st, si) => {
      const notes = st.notes || [];
      if (!notes.length) {
        out.push({ bar: bi, stretch: si, note: null, name: st.name || '',
          markers: st.markers || null, ev: null, trip: null });
        return;
      }
      notes.forEach((ev, k) => {
        // A name written on a stretch's first note rules from the stretch's head
        // — see Chords.rulingNames — so it is that head's name, and the
        // stretch's own has nothing left to say. Which is also what the staff
        // draws: see the marks in Chords.staffBar.
        const name = k === 0 ? (notes[0].name || st.name || '') : (ev.name || '');
        out.push({ bar: bi, stretch: si, note: k, name,
          markers: k === 0 ? (st.markers || null) : null, ev, trip: keys[at] });
        at++;
      });
    });
  });
  return out;
}

// Where a note's length comes from when none is written on it: the note before
// it. Three notes have a new note before them after a step — the two that traded
// places, and whatever followed them — so those three have theirs written out.
// Left alone, a stop that inherited a quarter would come back as an eighth, or
// as no length at all, and the move would have changed the music.
function pinnedNote(item) {
  const ev = Object.assign({}, item.ev);
  delete ev.name;                                   // the event carries it now
  if (item.pin && ev.noDur && !ev.free) delete ev.noDur;
  return ev;
}

// The row back into bars. A thing carrying a name opens a stretch of its own;
// one without a name joins the stretch in front of it, which is what a phrase
// under a chord is.
// Returns where each thing in the row ended up, so the panel can follow the one
// that moved: the rebuild copies every note, and the object the row is holding
// is no longer the object in the sheet.
function writeBarsFromEvents(list, touched) {
  const held = new Map();
  list.forEach((item, i) => {
    if (!touched.has(item.bar)) return;
    if (!held.has(item.bar)) held.set(item.bar, []);
    held.get(item.bar).push({ item, i });
  });
  const homes = new Map();
  for (const bi of touched) {
    const bar = chordCache.bars[bi];
    if (!bar) continue;
    const chords = [];
    let open = null;
    for (const { item, i } of held.get(bi) || []) {
      if (item.name || item.markers || !open) {
        open = { name: item.name, markers: item.markers, notes: [] };
        chords.push(open);
      }
      if (item.ev) open.notes.push(pinnedNote(item));
      homes.set(i, {
        bar: bi, stretch: chords.length - 1,
        note: item.ev ? open.notes.length - 1 : null,
      });
    }
    // A bar every thing moved out of is still a bar of the tune: it keeps its
    // time and an empty stretch to write into, the same as one just inserted.
    bar.chords = chords.length ? chords : [{ name: '', markers: null }];
  }
  return homes;
}

// Which thing in the row the panel is pointing at. With a note selected it is
// that note; with nothing selected it is the chord at the head of the stretch
// being written into, since that is what the panel is open on.
function selectedEventIndex(list) {
  if (!notePanelAt) return -1;
  const at = notePanelAt;
  const want = noteSel === null ? 0 : noteSel;
  let head = -1;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.bar !== at.bar || e.stretch !== at.chord) continue;
    if (head < 0) head = i;
    if (e.note === null || e.note === want) return i;
  }
  return head;
}

// Whether the thing the panel is pointing at is a chord — a name is written on
// it — which is the whole difference between the buttons saying Chord and Note.
// A name at the head of a bar is not one of those: it stays where it is, so what
// travels from there is the note by itself. See keepBarHeads.
function selectedIsChord() {
  const list = sheetEvents();
  const i = selectedEventIndex(list);
  if (i < 0 || !list[i].name) return false;
  return list[i] !== barHead(list, list[i].bar);
}

// The first thing in a bar, which is where its chord is written.
function barHead(list, bar) {
  return list.find(e => e.bar === bar);
}

// A bar opens on a chord, and everything written in it is read against that name
// — see Chords.rulingNames, and the parseChord call in staffBar that falls back
// to C without one. So the name at a bar's head belongs to the opening rather
// than to the thing that happens to be written there: step that thing along and
// the name stays, and whatever lands at the head takes it up. Otherwise moving
// the first note of a bar carried its chord away with it, and the notes it left
// behind were read as C.
// Unless what arrives brings a name of its own, which is a chord starting there
// and is the new opening — then both names are where their writer put them and
// there is nothing to hand over.
function keepBarHeads(list, heads) {
  for (const [bar, was] of heads) {
    const now = barHead(list, bar);
    if (!now || now === was || now.name) continue;
    now.name = was.name;
    now.markers = was.markers;
    was.name = '';
    was.markers = null;
  }
}

function canMoveSelection(by) {
  const list = sheetEvents();
  const i = selectedEventIndex(list);
  if (i < 0) return false;
  return by > 0 ? i + 1 < list.length : i > 0;
}

// What one step carries, which is not always one thing. Three triplets are one
// division of the beat: a note stepping past them steps past all three, or the
// beat they fill comes apart and the sheet says a triplet of two. So the run the
// thing belongs to moves with it — see Chords.tripletGroups for what makes one.
function moveBlock(list, at) {
  const item = list[at];
  if (!item || !item.trip) return { from: at, to: at };
  let from = at, to = at;
  while (from > 0 && list[from - 1].bar === item.bar
    && list[from - 1].trip === item.trip) from--;
  while (to + 1 < list.length && list[to + 1].bar === item.bar
    && list[to + 1].trip === item.trip) to++;
  return { from, to };
}

// One step. The thing picked and its neighbour trade places, each keeping the
// bar of the place it lands in — which is how a step at a bar's edge crosses the
// bar line without the move having to know anything about bar lines.
// A step inside one's own triplet is still a step of one: the three are being
// reordered, and all three are still there. A step out of it moves the triplet.
function moveSelection(by) {
  const list = sheetEvents();
  const from = selectedEventIndex(list);
  if (from < 0) return;
  const sel = list[from];
  const next = from + (by > 0 ? 1 : -1);            // the neighbour stepped towards
  if (next < 0 || next >= list.length) return;
  const inside = !!sel.trip && list[next].bar === sel.bar
    && list[next].trip === sel.trip;
  const mine = inside ? { from, to: from } : moveBlock(list, from);
  const other = inside ? { from: next, to: next }
    : moveBlock(list, by > 0 ? mine.to + 1 : mine.from - 1);
  if (other.from < 0 || other.to >= list.length) return;
  const lo = Math.min(mine.from, other.from);
  const hi = Math.max(mine.to, other.to);
  // The two swap bars as well as places — a run is only ever within one bar, so
  // each has just the one to give. Which is how a step at a bar's edge crosses
  // the bar line, and how it crosses without leaving a triplet with a bar line
  // through the middle of it: the whole run goes over, and the thing it traded
  // with comes back the other way.
  const a = list.slice(mine.from, mine.to + 1);
  const b = list.slice(other.from, other.to + 1);
  const barA = a[0].bar, barB = b[0].bar;
  // What each bar the step touches opens on, read before anything moves.
  const heads = [...new Set([barA, barB])].map(bar => [bar, barHead(list, bar)]);
  list.splice(lo, hi - lo + 1, ...(by > 0 ? b.concat(a) : a.concat(b)));
  for (const e of a) e.bar = barB;
  for (const e of b) e.bar = barA;
  keepBarHeads(list, heads);
  // Everything that has a new thing in front of it now writes its length out —
  // see pinnedNote — which is everything moved, plus whatever follows the lot.
  for (let i = lo; i <= hi + 1; i++) {
    if (list[i] && list[i].ev) list[i].pin = true;
  }
  const touched = new Set([barA, barB]);
  const homes = writeBarsFromEvents(list, touched);
  dropDanglingBeams(touched);
  // The panel follows what was moved rather than the place it left, so pressing
  // again carries the same thing further along.
  const home = homes.get(list.indexOf(sel));
  if (home) {
    notePanelAt = { bar: home.bar, chord: home.stretch };
    noteSel = home.note;
  }
  noteAfter = null;
  commitNotes();
  markNoteSelection();
}

// A beam on the last thing in a bar has nothing to join. Cleared rather than
// kept, so a step never leaves a mark that draws as a beam off the bar's edge.
function dropDanglingBeams(touched) {
  for (const bi of touched) {
    const bar = chordCache.bars[bi];
    if (!bar) continue;
    const notes = [];
    for (const st of bar.chords) for (const ev of st.notes || []) notes.push(ev);
    const last = notes[notes.length - 1];
    if (last && last.beam) delete last.beam;
  }
}

// A stretch holds a place per note, plus the place after the last one where
// writing goes — which is what null is, and what an empty stretch has instead of
// notes. Stepping off either end of that walks into the next stretch.
function stepNote(by) {
  if (!notePanelAt) return;
  if (noteAfter !== null) { noteAfter = null; renderChordStrip(true); }
  const notes = noteEntries();
  const at = noteSel === null ? notes.length : noteSel;
  const next = at + by;
  if (next >= 0 && next < notes.length) noteSel = next;
  else if (next === notes.length) noteSel = null;
  else if (!moveNoteStretch(by)) return;
  renderNotePanel();
  markNoteSelection();
}

// How many strings a note in the sheet strikes at once. A rest strikes none, and
// a tie's strings are the ones before it still ringing rather than anything
// struck here, so neither counts as a shape.
function stopCountAt(barIndex, chordIndex, index) {
  const bar = chordCache.bars[barIndex];
  const stretch = bar && bar.chords[chordIndex];
  const ev = stretch && (stretch.notes || [])[index];
  if (!ev || ev.rest || ev.tie) return 0;
  return (ev.stops || []).length;
}

// Clicking a note in the strip selects it — see the staff's own click handler.
function selectNote(barIndex, chordIndex, index) {
  if (noteAfter !== null) { noteAfter = null; renderChordStrip(true); }
  notePanelAt = { bar: barIndex, chord: chordIndex };
  // Pressing the selected note again keeps it selected. It used to unselect it,
  // and nothing on screen said much about the difference — while the Chord box
  // and ⧉ Copy both quietly change what they act on when nothing is selected,
  // so a press meant to make sure of a note renamed the whole stretch instead.
  // Esc and ▷▷| are how writing goes back to the end of the stretch.
  noteSel = index;
  renderNotePanel();
  markNoteSelection();
}

// One labelled row of tools, hung on the panel's rows.
function noteToolRow(rows, label) {
  const r = document.createElement('div');
  r.className = 'note-row';
  const name = document.createElement('span');
  name.className = 'note-row-label';
  name.textContent = label;
  r.appendChild(name);
  rows.appendChild(r);
  return r;
}

// One tool in a row. `on` is the lit state — what the button is saying about the
// note or the board right now — and `cls` any extra class the face wants.
function noteToolButton(into, content, title, run, on, cls) {
  return into.appendChild(
    toolButton('note-tool' + (cls ? ` ${cls}` : '') + (on ? ' on' : ''),
      content, title, run));
}

// A space between two groups of tools within one row.
function noteToolGap(into) {
  const d = document.createElement('span');
  d.className = 'note-tool-gap';
  into.appendChild(d);
}

function renderNotePanel() {
  if (!notePanel) return;
  const chord = noteStretch();
  // The panel is part of editing: with the editor closed, or the strip hidden,
  // there is nothing for it to be open over.
  if (!chord || chordEditor.hidden || !getChordsVisible()) { closeNotePanel(); return; }
  const notes = noteEntries();
  if (noteSel !== null && noteSel >= notes.length) noteSel = notes.length ? notes.length - 1 : null;
  const ev = editingNote();
  const beats = noteStretchBeats();
  // A grace note takes no time from the bar, so it is not part of what is
  // written into it. A note under a tuplet bracket takes the bracket's share of
  // its written value — see eventDur — so the count here says what the bar hears.
  const used = notes.reduce((a, n) => a + (n.grace ? 0 : Chords.eventDur(n)), 0);

  notePanel.hidden = false;
  notePanel.textContent = '';
  notePanel.appendChild(notePanelHead(notes, ev, beats, used));

  // Degrees are read against a chord. With no chord over these notes there is
  // nothing to read them against — every label would be counted from C, which
  // is a number that means nothing here — so the board falls back to note names.
  // Which name that is depends on where the caret is: a note carrying its own name
  // starts a chord there, and the notes from it on are read against that.
  // Worked out here rather than at the board, because the switch that labels the
  // board has to say the same thing it does.
  // Against the harmony rather than the name written there: a bass move names no
  // chord, and a board labelled from one showed twenty-two frets of blank dots.
  const ruling = Chords.rulingAt(chordCache.bars, notePanelAt.bar, notePanelAt.chord,
    noteSel === null ? null : noteSel);
  // A bass move is a name and still no chord, so it counts as nothing to read
  // against: degrees from it would be counted from C, which is the number this
  // falls back to note names to avoid.
  const boardMode = ruling && !Chords.isBassOnly(ruling)
    ? effectiveChordMode() : 'note';

  // The tools, grouped by what they do to the music: how long a thing is, what
  // to write, and what to fix. One row of fifteen buttons said nothing about
  // which of them belonged together, and it only ever grew.
  const rows = document.createElement('div');
  rows.className = 'note-rows';
  const row = label => noteToolRow(rows, label);
  const button = noteToolButton;
  const gap = noteToolGap;

  // ---- what chord ----
  // The name over what is selected. On a note it names that note — a chord
  // changing there — and with nothing selected it names the stretch, which is
  // the chord this part of the bar started on. This is the box the cells used to
  // hold, moved to where the music is being written rather than printed a second
  // time above it.
  const nameRow = row('Chord');
  // It writes on what is selected and on nothing else. With notes in the stretch
  // and none of them selected there is no such thing, so the box is down: it used
  // to rename the whole stretch instead, which is how naming a copied chord
  // renamed the chord at the head of the bar. A stretch with nothing written in
  // it is the one case with no note to point at — the name is then the only thing
  // the box can be about, so there it stands open.
  // The first note of a stretch is the stretch's own name: the same moment, and
  // printed once at its head. So the box writes there rather than laying a second
  // name over the one already drawn in that spot.
  // The chord in force at each note, which is what the box is writing over. Not
  // the ruling worked out above for the board: that reads through a bass move to
  // the harmony still sounding, while the box is about the name written here.
  const names = Chords.rulingNames(chord);
  const headName = !!ev && noteSel === 0 && !ev.name;
  const onStretch = !ev || headName;
  const nameBox = shapeNameBox(chord,
    onStretch ? { name: '', index: -1 }
      : { name: names[noteSel] || chord.name || '', index: noteSel },
    onStretch ? 'stretch' : 'note');
  nameBox.disabled = !ev && notes.length > 0;
  nameBox.title = nameBox.disabled
    ? 'Select a note to write the chord it starts'
    : onStretch
      ? 'The chord this stretch starts on'
      : 'The chord from this note on — leave it empty to keep the one already sounding';
  nameRow.appendChild(nameBox);

  // ---- how long ----
  const lengthRow = row('Length');
  const shown = ev
    ? (ev.free ? NO_DUR
      : (Chords.isDottedDur(ev.d) ? ev.d / 1.5 : ev.d))
    : noteDur;
  const shownDot = ev ? (!ev.free && Chords.isDottedDur(ev.d)) : noteDotted;
  const shownTriplet = ev ? (!ev.free && !!ev.trip) : noteTriplet;
  NOTE_DURATIONS.forEach(([d, name], i) => {
    const b = button(
      lengthRow,
      Chords.noteGlyph(d, false, 0.8, !ev && noteTriplet),
      `${ev ? `Re-time this note as a ${name.toLowerCase()}` : name} (key ${i + 1})`,
      () => setNoteDur(d), shown === d, 'note-dur',
    );
    const badge = document.createElement('span');
    badge.className = 'note-key';
    badge.textContent = String(i + 1);
    b.appendChild(badge);
  });
  // No length at all — the state a fingering is written in, and the one thing
  // the panel could not say about a note it was showing.
  button(lengthRow, 'None',
    `${ev ? 'Give this note no length of its own' : 'No length'} — held until the next, `
    + 'the way a chord is (key 0)',
    () => setNoteDur(NO_DUR), shown === NO_DUR, 'note-dur note-none');
  // The mark rather than the word, as the rest of the row is: the dot beside a
  // head, which is where it sits on a staff.
  button(lengthRow, Chords.dotGlyph(0.8),
    'Half again as long (key .)',
    toggleNoteDot, shownDot, 'note-dur');
  // The mark itself rather than the number: three stems under the beam the chosen
  // value carries, so the button changes with the value it is about to bend.
  const tripBtn = button(lengthRow, Chords.tripletGlyph(shown === NO_DUR ? 1 : shown, 0.9),
    'Triplet — a bracket over this note and the two after it, three in the time '
    + 'of two (key ,). Press again to let the last note out, and again to take '
    + 'the bracket off, so two notes under one 3 is two presses. What is inside '
    + 'keeps its own value, so an eighth and a quarter under one 3 — a swung '
    + 'beat — is written as it is played. Down where the bar has not three left '
    + 'to bracket',
    toggleNoteTriplet, shownTriplet, 'note-trip');
  if (!noteCanTriplet()) tripBtn.disabled = true;
  // Beaming, beside the triplet: both are about a run rather than a single note,
  // and both are read off the shape drawn on the button. Nothing to join with no
  // note selected, or on the last note of the bar, so it is down until there is
  // something on the other side of the join.
  const beamBtn = button(lengthRow, Chords.beamGlyph(2, shown === NO_DUR ? 0.5 : shown, 0.9),
    'Beam — draw this note and the next under one beam, across the beat if it '
    + 'falls there. Join the next pair too and the run grows (press again to part them)',
    toggleNoteBeam, noteBeamOn(), 'note-trip');
  if (!noteCanBeam()) beamBtn.disabled = true;

  // ---- what to write ----
  const writeRow = row('Write');
  button(writeRow, Chords.restGlyph(ev && !ev.free ? ev.d : restValue(), 0.8),
    `${ev ? (ev.rest ? 'Turn this rest back into the note it was'
      : 'Turn this note into a rest')
      : 'Rest, of the selected duration'} (key R)`,
    addNoteRest, ev && !!ev.rest, 'note-dur');
  // Two heads under one curve, which is what a tie is drawn as.
  const canTie = !ev || !!ev.tie || heldStops(noteSel).length > 0;
  const tieBtn = button(writeRow, Chords.tieGlyph(0.8),
    `${ev ? (ev.tie ? 'Strike this note again instead of holding the one before it on'
      : canTie ? 'Turn this into a tie, holding the note before it on'
        : 'Nothing is ringing here for a tie to hold on')
      : 'Hold the last note on for the selected duration'} (key T)`,
    addNoteTie, ev && !!ev.tie, 'note-dur');
  tieBtn.disabled = !canTie;
  // Beside the rest and the tie, since all three are marks on a note rather than
  // lengths: what is written here is how the note is played, not how long it is.
  const graceBtn = button(writeRow, Chords.graceGlyph(1),
    'Grace note — struck just before the note it leans on, taking no time from '
    + 'the bar (key G)',
    toggleNoteGrace, noteGraceOn(), 'note-dur');
  if (!noteCanGrace()) graceBtn.disabled = true;
  // The cross the staff draws, on the button that turns tapping into muting.
  button(writeRow, Chords.deadGlyph(0.8),
    'While on, a fret you tap mutes that string of the note — struck with the '
    + 'string stopped, drawn as a cross. Tap it again to let it ring (key X)',
    toggleNoteDeadMode, noteDeadMode, 'note-dur');
  // Three notes on one stem: the button wears what it writes, the way the
  // duration buttons do.
  button(writeRow, Chords.chordGlyph(1),
    'While on, a tap piles onto the note — a double stop, or a chord (key S)',
    () => { noteStack = !noteStack; renderNotePanel(); }, noteStack, 'note-dur');

  // ---- what to fix ----
  const fixRow = row('Fix');
  button(fixRow, '◀', 'Select the note before (←)', () => stepNote(-1));
  // Between the two arrows because it is the same walk: ◀ ▶ move to a note, this
  // moves to the space after one. What is written there goes in rather than over.
  const gapBtn = button(fixRow, '+',
    'Make room just after this note — the next tap, rest or tie goes in there, '
    + 'and stacking piles onto it (key I)',
    insertAfterNote, noteAfter !== null);
  gapBtn.disabled = !notes.length;
  button(fixRow, '▶', 'Select the note after (→)', () => stepNote(1));
  button(fixRow, '▷▷|', 'Stop editing that note and write at the end (Esc)',
    endNoteWriting, !ev && noteAfter === null);
  gap(fixRow);
  // Moving what is picked, rather than moving the pick. Beside the walk arrows
  // because the two are read together — ◀ ▶ go to a thing, these take it with
  // you — and told apart by the word on them: a chord is a name written on a
  // moment, so what the button says is what is about to travel.
  const carry = selectedIsChord() ? 'Chord' : 'Note';
  const back = button(fixRow, `⇦ ${carry}`,
    `Swap this ${carry.toLowerCase()} with the one before it, chord name and all `
    + '— nothing else on the sheet moves (Shift + ←)',
    () => moveSelection(-1));
  back.disabled = !canMoveSelection(-1);
  const fwd = button(fixRow, `${carry} ⇨`,
    `Swap this ${carry.toLowerCase()} with the one after it, chord name and all `
    + '— nothing else on the sheet moves (Shift + →)',
    () => moveSelection(1));
  fwd.disabled = !canMoveSelection(1);
  gap(fixRow);
  // The same again, whatever it is. A bar of one chord held while the tune moves
  // is the ordinary shape of a sheet, and tapping out its six strings a second
  // time is the tedious way to say so; a repeated note is the same story.
  // It sits with delete rather than with the things that write: both of them act
  // on whatever is selected, and between the two chord buttons this one read as
  // if a chord were the only thing it would copy.
  // The same marks the strip's own buttons use, so one copy and one delete are
  // one thing wherever they are pressed.
  const copyBtn = button(fixRow, '⧉ Copy',
    'Write the selected note again, just after it — a chord, a note, or a rest',
    copyNote);
  copyBtn.disabled = !ev;
  const undo = button(fixRow, '↺ Undo', 'Undo the last thing tapped here', undoNote);
  undo.disabled = !canUndoNote();
  button(fixRow, '🗑 Delete', 'Remove the selected note, or the last one (Backspace)',
    deleteNote);
  // What the dots are labelled with, where they are being read. The same switch
  // as the one over the strip and the same stored choice — a board labelled one
  // way while the diagrams above it said another was two pictures of one thing.
  fixRow.appendChild(noteModeSwitch(boardMode, !!ruling));
  notePanel.appendChild(rows);

  notePanel.appendChild(noteHelpBox());

  notePanel.appendChild(noteBoard(ruling, boardMode, ev));
}

// The neck, where the notes are tapped out — and where what is already written
// can be read back.
function noteBoard(ruling, boardMode, ev) {
  const boardWrap = document.createElement('div');
  boardWrap.className = 'note-board';
  const boardSvg = Chords.board(ruling, boardMode, currentChordKey());
  boardWrap.appendChild(boardSvg);
  // Where the selected note is already stopped, marked on the neck. Reading the
  // note back off the board is how you check what you wrote without playing it,
  // and a stack shows every stop at once. Only what is selected is marked: with
  // the caret at the end nothing is being edited, and marking the last note
  // there would say a tap replaces it when a tap follows it.
  for (const st of (ev && ev.stops) || []) {
    const cell = boardSvg.querySelector(
      `.board-cell[data-string="${st.string}"][data-fret="${st.fret}"]`);
    if (!cell) continue;
    cell.classList.add('sel');
    // A muted string wears the cross the staff draws over its head.
    if (st.dead) { cell.classList.add('dead'); Chords.markDeadCell(cell); }
  }
  // One listener for the whole neck: every cell says which string and fret it is.
  boardWrap.addEventListener('mousedown', e => e.preventDefault());
  boardWrap.addEventListener('click', e => {
    const cell = e.target.closest && e.target.closest('.board-cell');
    if (!cell) return;
    pressStop(Number(cell.dataset.string), Number(cell.dataset.fret));
  });
  return boardWrap;
}

// The keys behind a ?, rather than a line of them under the tools. Every one of
// them is already written on the button it works, so the list is a reminder to
// ask for — and printed always, it was three lines of grey between the tools and
// the board they act on.
function noteHelpBox() {
  const help = document.createElement('div');
  help.className = 'note-help';
  const helpBtn = toolButton('note-help-toggle' + (noteKeysOpen ? ' on' : ''), '?',
    'The keys, for the tools above', () => {
      noteKeysOpen = !noteKeysOpen;
      renderNotePanel();
    });
  helpBtn.setAttribute('aria-expanded', noteKeysOpen ? 'true' : 'false');
  help.appendChild(helpBtn);
  if (noteKeysOpen) {
    const keys = document.createElement('p');
    keys.className = 'note-keys';
    keys.textContent = '← → select · Shift + ← → move it one place · '
      + '1–5 duration (whole, half, quarter, eighth, sixteenth) · '
      + '0 no length · . dot · , triplet · R rest · T tie · G grace · '
      + 'X mute the strings you tap · '
      + 'S stack · '
      + 'I room after this note · Backspace delete · '
      + 'Esc back to the end, then close';
    help.appendChild(keys);
  }
  return help;
}

// What the panel says about itself: which bar and stretch is open, what the next
// tap will do to it, and how much of the bar is spoken for.
// Naming is done where the name is drawn — over the shape it belongs to, in the
// strip — so there is no name box here. A box in the panel wrote a name nothing
// on screen pointed at, and what it renamed was the whole stretch: naming one
// stop renamed every chord in the bar.
function notePanelHead(notes, ev, beats, used) {
  // Thirds of a beat do not add up to whole numbers in binary — three triplet
  // eighths come to 0.9999999999999999, and a bar split six ways gives a stretch
  // 0.6666666666666666 of a beat — so what is printed is rounded to where the ear
  // stops caring rather than where the arithmetic does.
  const beatsText = n => String(Math.round(n * 1000) / 1000);

  const head = document.createElement('p');
  head.className = 'note-panel-head';
  const what = document.createElement('span');
  what.className = 'note-panel-what';
  what.textContent = `♪ bar ${notePanelAt.bar + 1}, `
    + `${beatsText(beats)} beat${beats === 1 ? '' : 's'}`;
  const mode = document.createElement('span');
  mode.className = 'note-panel-mode';
  mode.textContent = noteAfter !== null
    ? `writing after note ${noteAfter + 1} — a tap goes in there`
    : ev
      ? `editing note ${noteSel + 1} of ${notes.length} — a tap replaces it`
      : 'adding at the end — a tap follows the last note';

  const room = document.createElement('span');
  // What is written against what there is room for. Overrunning is allowed —
  // a phrase is often written before its bar's timing is right — but it is said
  // out loud, since the overrun is drawn past the bar and reads as a mistake in
  // the sheet otherwise.
  room.className = 'note-panel-room' + (used > beats + 1e-6 ? ' over' : '');
  room.textContent = `${notes.length} note${notes.length === 1 ? '' : 's'}, `
    + `${beatsText(used)} beat${used === 1 ? '' : 's'} written`;
  head.append(what, mode, room);
  // The way out of the panel is not one of the tools: it sits where a window's
  // close sits, rather than at the end of a row of things that write music.
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'note-panel-close';
  close.textContent = '×';
  close.title = 'Close this panel (Esc)';
  close.setAttribute('aria-label', 'Close this panel');
  close.addEventListener('mousedown', e => e.preventDefault());
  close.addEventListener('click', e => { e.preventDefault(); closeNotePanel(); });
  head.appendChild(close);
  return head;
}

// Interval / Note / Solfège, small, at the end of the Fix row. It sets the same
// stored choice the pill above the strip does, so the two can never disagree.
function noteModeSwitch(shown, hasChord) {
  const wrap = document.createElement('span');
  wrap.className = 'note-modes';
  const active = shown;
  const hasKey = !!currentChordKey();
  const items = [
    ['number', 'Int', 'Label the dots with degrees'],
    ['note', 'Note', 'Label the dots with note names'],
    ['solfa', 'Sol', 'Label the dots with movable-do solfège, read from the key'],
  ];
  for (const [value, text, title] of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'note-mode' + (value === active ? ' on' : '');
    b.textContent = text;
    // Solfège is read from the key and from nothing else, so until a sheet names
    // one there is nothing to switch to. Degrees and solfège are both read
    // against a chord, so with none over these notes neither is on offer — the
    // board is showing names and the switch says so.
    const noSolfa = value === 'solfa' && !hasKey;
    b.disabled = noSolfa || (value !== 'note' && !hasChord);
    b.title = noSolfa ? 'Set the key first — solfège reads do from it'
      : b.disabled ? 'Name this bar\'s chord first — the labels are read against it'
        : title;
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', e => {
      e.preventDefault();
      if (getChordMode() === value) return;
      setChordMode(value);
      updateChordModeBtns();
      // From the parse in memory, since a chord being written may have no name
      // yet and the text deliberately does not hold one. The redraw takes the
      // panel with it.
      renderChordStrip(true);
    });
    wrap.appendChild(b);
  }
  return wrap;
}

// One step back, a tap at a time. The Versions list files an edit at a time —
// a run of taps is one entry there, which is what makes it readable — so undo
// keeps its own record: what the sheet said before each thing done on the board.
let noteUndo = { vid: null, stack: [] };
const NOTE_UNDO_MAX = 60;

function pushNoteUndo() {
  if (!currentVideoId) return;
  if (noteUndo.vid !== currentVideoId) noteUndo = { vid: currentVideoId, stack: [] };
  const text = getSheet(currentVideoId);
  if (noteUndo.stack[noteUndo.stack.length - 1] === text) return;
  noteUndo.stack.push(text);
  if (noteUndo.stack.length > NOTE_UNDO_MAX) noteUndo.stack.shift();
}

function canUndoNote() {
  return noteUndo.vid === currentVideoId && noteUndo.stack.length > 0;
}

function undoNote() {
  if (!canUndoNote()) return;
  const text = noteUndo.stack.pop();
  if (text === getSheet(currentVideoId)) { undoNote(); return; }
  editSheet(text, 'undo');
  chordInput.value = text;
  // From the text, not the cache: the cache is what was just undone.
  renderChordStrip();
  renderChordRevisions();
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
  // Shift turns the walk into a carry: the same arrows, taking the thing under
  // the caret with them.
  if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    moveSelection(e.key === 'ArrowLeft' ? -1 : 1);
  } else if (e.key === 'ArrowLeft') stepNote(-1);
  else if (e.key === 'ArrowRight') stepNote(1);
  else if (e.key === '0') setNoteDur(NO_DUR);
  else if (n >= 1 && n <= NOTE_DURATIONS.length) setNoteDur(NOTE_DURATIONS[n - 1][0]);
  else if (e.key === '.') toggleNoteDot();
  else if (e.key === ',') toggleNoteTriplet();
  else if (e.key === 'r' || e.key === 'R') addNoteRest();
  else if (e.key === 't' || e.key === 'T') addNoteTie();
  else if (e.key === 'g' || e.key === 'G') toggleNoteGrace();
  else if (e.key === 'x' || e.key === 'X') toggleNoteDeadMode();
  else if (e.key === 'i' || e.key === 'I') insertAfterNote();
  else if (e.key === 's' || e.key === 'S') { noteStack = !noteStack; renderNotePanel(); }
  // The one player key the panel hands back: writing a phrase is playing it
  // again from the top over and over, and closing the panel to do it lost the
  // selection you were writing at.
  else if (e.key === 'a' || e.key === 'A') seekToStart();
  else if (e.key === 'Backspace' || e.key === 'Delete') deleteNote();
  else if (e.key === 'Escape') {
    if (noteSel !== null || noteAfter !== null) endNoteWriting();
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

// `focusInput` is false when the editor was opened by the keyboard: the caret
// would land in the sheet box, and the key that opened it would then type
// itself into the sheet instead of closing it again.
function openChordEditor(focusInput) {
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
  if (focusInput !== false) chordInput.focus({ preventScroll: true });
}

// With the editor open the strip is a form: every chord is the pair of boxes it
// is written in, and each bar offers a +. The whole look hangs off one class so
// the strip and the editor can never disagree about which mode it is in.
function syncChordEditMode() {
  chordViewport.classList.toggle('editing-mode', !chordEditor.hidden);
}

function toggleChordEditor(focusInput) {
  if (chordEditor.hidden) { openChordEditor(focusInput); return; }
  // Closing puts the chords back to being links, so whatever is in the open box
  // is banked before the strip is rebuilt without it.
  commitFocusedNameBox();
  chordEditor.hidden = true;
  closeNotePanel();
  syncChordEditMode();
  renderChordStrip();
}

chordEditBtn.addEventListener('click', () => toggleChordEditor(true));

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
  stopsFromOldChords(bars); // MIGRATION (temporary) — see stopsFromOldChords
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
  updateKeyChordLink(key);
}

// The key as one chord, out on the fretboard viewer: every note of the scale in
// a single shape, which is what the neck positions are read off.
// Major is Δ13 — the seven notes of the major scale and nothing else, where a
// plain 13 would bring a ♭7 the key does not have. Minor is m13, the dorian
// seven: the natural minor's ♭13 sits a semitone under the 5th and is not a note
// anyone voices, and a dorian minor is what a minor tonic is played as.
// Written with the triangle rather than as maj13, which is how it is read on a
// chart. The viewer takes either.
function updateKeyChordLink(key) {
  if (!chordKeyChord) return;
  const name = key ? key.label.replace(/m$/, '') + (key.minor ? 'm13' : 'Δ13') : '';
  chordKeyChord.classList.toggle('off', !name);
  if (!name) {
    chordKeyChord.removeAttribute('href');
    chordKeyChord.title = 'Set the key to open it as a chord';
    return;
  }
  // Labelled in solfège, since the chord being opened is the key: the viewer
  // reads do from the chord's root, so here its do is the song's do — which is
  // the reading the scale is being looked at for.
  chordKeyChord.href = Chords.viewerUrl({ name }, { solfege: true });
  chordKeyChord.title = `Open ${Chords.displayName(name)} in Guitar Chord Viewer`;
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

// The record a video gets the first time this browser has anything to keep for
// it, made if it isn't there and returned either way. The title is the one the
// caller knows — the player's, for a video being played here; none at all for
// one arriving from a backup file, which carries its own.
function ensureVideo(data, vid, title) {
  if (!data.videos[vid]) {
    data.videos[vid] = { title: title || '', sheet: '', history: [], revisions: [] };
  }
  return data.videos[vid];
}

function setSheet(vid, text) {
  if (!vid) return;
  const data = loadData();
  ensureVideo(data, vid, currentVideoTitle);
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
  const v = ensureVideo(data, vid, currentVideoTitle);
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
  const r = formRange();
  if (!r || r.start >= r.end) return;
  const { start, end } = r;
  // The chosen speed, not the ramp's live one — a ramp run would otherwise log
  // a separate entry for every lap it climbs.
  const speed = effectiveSpeed();
  const note  = noteInput.value.trim();

  const data = loadData();
  const video = ensureVideo(data, currentVideoId, currentVideoTitle);
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
  if (!isPlaying()) return null;
  const r = formRange();
  if (!r || r.start >= r.end) return null;
  const { start, end } = r;
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
  sheetBtn.title = videoData.sheet ? "Edit this video's sheet" : 'Add a sheet for this video';
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
  // Picking a range out of the history means looping it. The range itself needs
  // no setting — applyLoopToForm fills the boxes and loopRange() reads them.
  if (loopToggle) loopToggle.checked = true;
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
    const next = formatTime(Math.max(0, roundTo(base + delta, 2)));
    // The step that would cross the other end is the step that doesn't happen —
    // refused outright rather than taken by moving the other end, the way the 📍
    // and the boxes do it. A nudge is a hair's adjustment, and sending the End to
    // the next bar line off one keypress is a jump nobody pressing this wanted.
    if (refusesRange(target, next)) { flashRefused(target); return; }
    target.value = next;
    target.dataset.was = next;
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
    if (isPlaying()) player.pauseVideo();
    else startPlaybackWithDelay();
  } else if (e.key === 'a' || e.key === 'A') {
    // Not S, which is stack while the note panel is open: one key doing two
    // unrelated things depending on a mode is a key you have to stop and think
    // about, and going back to the start is the press you make without thinking.
    e.preventDefault();
    seekToStart();
  } else if (e.key === 'l' || e.key === 'L') {
    e.preventDefault();
    // Nothing listens for the change: the toggle is read where the loop is
    // needed, so flipping it is the whole of the work.
    loopToggle.checked = !loopToggle.checked;
  } else if (e.key === 'e' || e.key === 'E') {
    // Transcribing is going in and out of the editor all the time, and the
    // button for it is at the top of a strip that has scrolled away by then.
    // The guard above means this never fires while a box holds the caret.
    e.preventDefault();
    toggleChordEditor(false);
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
    const dst = ensureVideo(data, vid);
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
