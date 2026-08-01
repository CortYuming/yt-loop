// ============================================================
// YT Loop — loop any part of a YouTube video
// ============================================================

const STORAGE_KEY = 'yt-loop-data-v1';
const PLAY_DELAY_MS = 1000;

let player = null;
let currentVideoId = null;
let currentVideoTitle = '';
let rafId = null;
let activeLoop = null; // {start, end}
let editingLoopId = null;
let playDelayTimeout = null;
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

// Fill End with the video duration if it's still empty. Called on player
// ready and on New so a fresh session covers the whole clip by default.
function fillDefaultEnd() {
  if (!player || typeof player.getDuration !== 'function') return;
  if (endInput.value.trim() !== '') return;
  const d = player.getDuration();
  if (!d || isNaN(d)) return;
  endInput.value = formatTime(d);
  updateDurationDisplay();
  updateSaveButton();
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
const playLoopBtn     = document.getElementById('playLoopBtn');
const saveBtn         = document.getElementById('saveBtn');
const newBtn          = document.getElementById('newBtn');
const deleteBtn       = document.getElementById('deleteBtn');
const shareBtn        = document.getElementById('shareBtn');
const shareMdBtn      = document.getElementById('shareMdBtn');
const loopList        = document.getElementById('loopList');

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
function setSpeed(v, { apply = true } = {}) {
  const n = parseFloat(v);
  if (isNaN(n)) return;
  currentSpeed = roundTo(Math.min(2, Math.max(0, n)), 2);
  speedRange.value = String(currentSpeed);
  speedSelect.value = hasPresetFor(currentSpeed) ? String(currentSpeed) : '';
  speedDisplay.textContent = `${currentSpeed.toFixed(2)}x`;
  if (apply && player && player.setPlaybackRate) {
    player.setPlaybackRate(currentSpeed);
  }
}

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
      if (s) startInput.value = formatTime(parseFloat(s));
      if (e) endInput.value   = formatTime(parseFloat(e));
      if (r) setSpeed(r);
      adoptMatchingSavedLoop();
      updateDurationDisplay();
      updateSaveButton();
    });
  } else {
    renderLoops();
    updateSaveButton();
  }
};

// When arriving via a shared URL, treat the loaded range as "editing" an
// existing saved loop if start/end/speed match one — otherwise Save would
// offer to create a duplicate on landing. URL times are toFixed(2), so
// compare with a small tolerance instead of strict equality.
function adoptMatchingSavedLoop() {
  if (!currentVideoId) return;
  const s = parseTime(startInput.value);
  const e = parseTime(endInput.value);
  const speed = getSpeed();
  if (s === null || e === null || isNaN(s) || isNaN(e)) return;
  const video = loadData().videos[currentVideoId];
  if (!video) return;
  const match = video.loops.find(l =>
    Math.abs(l.start - s) < 0.005 &&
    Math.abs(l.end - e) < 0.005 &&
    l.speed === speed
  );
  if (!match) return;
  editingLoopId = match.id;
  noteInput.value = match.note || '';
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
// Save state (Save vs Update, based on editingLoopId + dirtiness)
// ============================================================
function computeSaveState() {
  const start = parseTime(startInput.value);
  const end   = parseTime(endInput.value);
  const speed = getSpeed();

  const validTime = start !== null && end !== null && !isNaN(start) && !isNaN(end) && start < end;

  const data = loadData();
  const savedVersion = (editingLoopId && currentVideoId && data.videos[currentVideoId])
    ? (data.videos[currentVideoId].loops.find(l => l.id === editingLoopId) || null)
    : null;

  const note = (noteInput ? noteInput.value : '').trim();
  const isInList = savedVersion !== null;
  const isDirty = !savedVersion || (
    savedVersion.start !== start ||
    savedVersion.end !== end ||
    savedVersion.speed !== speed ||
    (savedVersion.note || '') !== note
  );

  const canSave = isDirty && validTime && !!currentVideoId;
  return { isDirty, isInList, canSave, validTime, savedVersion };
}

function updateSaveButton() {
  const { isInList, canSave } = computeSaveState();

  saveBtn.hidden = !canSave;
  saveBtn.textContent = isInList ? '💾 Update' : '💾 Save';
  saveBtn.title = isInList ? 'Update saved loop' : 'Save as new';

  deleteBtn.hidden = !isInList;
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
  renderLoops();
  updateSaveButton();
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
  // to date by the time we decide where to seek.
  if (state !== (window.YT && YT.PlayerState.UNSTARTED)) runPendingLoad();

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
    renderLoops();
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

function startTimeLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  const tick = () => {
    if (player && typeof player.getCurrentTime === 'function') {
      let t;
      try { t = player.getCurrentTime(); } catch (e) { t = 0; }
      currentTimeEl.textContent = formatTime(t);

      if (activeLoop) {
        const state = safeState();
        if (state === (window.YT && YT.PlayerState.PLAYING)) {
          if (t >= activeLoop.end) {
            // seekTo while PLAYING triggers BUFFERING → PLAYING again;
            // claim it as ours so onPlayerStateChange doesn't warm-up-delay it.
            intentionalPlay = true;
            player.seekTo(activeLoop.start, true);
          }
        }
      }
    }
    rafId = requestAnimationFrame(tick);
  };
  tick();
}

function safeState() {
  try { return player.getPlayerState(); } catch (e) { return -1; }
}

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
startInput.addEventListener('input', () => { updateDurationDisplay(); updateSaveButton(); syncActiveLoop(); });
endInput.addEventListener('input',   () => { updateDurationDisplay(); updateSaveButton(); syncActiveLoop(); });
noteInput.addEventListener('input',  () => { updateSaveButton(); });

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
  updateSaveButton();
});

// 'input' fires continuously while dragging — reflect it in the UI but leave
// the player alone until the drag ends ('change'), which also covers the
// arrow-key case since that fires both events at once.
speedRange.addEventListener('input', () => {
  setSpeed(speedRange.value, { apply: false });
  updateSaveButton();
});
speedRange.addEventListener('change', () => setSpeed(speedRange.value));

captureStart.addEventListener('click', () => {
  if (!player || !player.getCurrentTime) return;
  startInput.value = formatTime(player.getCurrentTime());
  updateDurationDisplay();
  updateSaveButton();
  syncActiveLoop();
});
captureEnd.addEventListener('click', () => {
  if (!player || !player.getCurrentTime) return;
  endInput.value = formatTime(player.getCurrentTime());
  updateDurationDisplay();
  updateSaveButton();
  syncActiveLoop();
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

saveBtn.addEventListener('click', () => {
  const { canSave } = computeSaveState();
  if (!canSave) return;

  const newId = editingLoopId || (crypto.randomUUID
    ? crypto.randomUUID()
    : 'l' + Date.now() + Math.random().toString(36).slice(2));

  const loop = {
    id: newId,
    start: parseTime(startInput.value),
    end:   parseTime(endInput.value),
    speed: getSpeed(),
    note:  noteInput.value.trim(),
    updatedAt: Date.now()
  };

  const data = loadData();
  if (!data.videos[currentVideoId]) {
    data.videos[currentVideoId] = { title: currentVideoTitle || '', loops: [] };
  }
  if (currentVideoTitle) data.videos[currentVideoId].title = currentVideoTitle;
  const loops = data.videos[currentVideoId].loops;
  const idx = loops.findIndex(l => l.id === loop.id);
  if (idx >= 0) loops[idx] = loop;
  else loops.push(loop);
  saveData(data);

  // After save, keep editing the same loop (subsequent edits → Update)
  editingLoopId = newId;
  renderLoops();
  updateSaveButton();
});

newBtn.addEventListener('click', () => {
  // "New" here means "detach from the currently-edited loop and treat the
  // current form values (start/end/speed) as the seed for a fresh loop".
  // The next Save creates a new record instead of updating the previous one.
  // We deliberately do NOT reset the inputs — losing the speed the user
  // dialed in was the whole reason this fix exists.
  editingLoopId = null;
  renderLoops();
  updateSaveButton();
});

deleteBtn.addEventListener('click', () => {
  const { isInList, savedVersion } = computeSaveState();
  if (!isInList || !savedVersion) return;
  if (!confirm(`Delete this loop (${formatTime(savedVersion.start)} → ${formatTime(savedVersion.end)})?`)) return;
  const data = loadData();
  const v = data.videos[currentVideoId];
  if (v) {
    v.loops = v.loops.filter(l => l.id !== savedVersion.id);
    if (v.loops.length === 0) delete data.videos[currentVideoId];
    saveData(data);
  }
  editingLoopId = null;
  renderLoops();
  updateSaveButton();
});

// ---------- Share (🔗 URL / 📝 MD) ----------
// Everything shareable is a (videoId, loop) pair — either a saved loop from
// the list or the range the form currently describes. Both go through the same
// builders below so the two sets of buttons can't drift apart.

// The form's current state in the shape of a saved loop.
function currentFormLoop() {
  return {
    start: parseTime(startInput.value),
    end:   parseTime(endInput.value),
    speed: getSpeed(),
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
// Data (localStorage)
// ============================================================
function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { videos: {} };
  try {
    const d = JSON.parse(raw);
    if (!d.videos) d.videos = {};
    return d;
  } catch { return { videos: {} }; }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ============================================================
// Render saved loops
// ============================================================
// Sort key for saved loops: the most recent of "saved" and "played". Lets a
// loop rise to the top when the user replays it, not only when they edit it.
function loopSortKey(loop) {
  return Math.max(loop.updatedAt || 0, loop.playedAt || 0);
}

function renderLoops() {
  const data = loadData();
  loopList.innerHTML = '';
  const entries = Object.entries(data.videos);
  if (entries.length === 0) {
    loopList.innerHTML = '<p class="empty">No saved loops yet.</p>';
    return;
  }
  const groupSortKey = ([, v]) =>
    v.loops.reduce((m, l) => Math.max(m, loopSortKey(l)), 0);
  entries.sort((a, b) => groupSortKey(b) - groupSortKey(a));

  entries.forEach(([vid, videoData]) => {
    const group = document.createElement('div');
    group.className = 'video-group';
    group.appendChild(renderVideoHeader(vid, videoData));
    const sortedLoops = [...videoData.loops].sort(
      (a, b) => loopSortKey(b) - loopSortKey(a)
    );
    sortedLoops.forEach(loop => {
      group.appendChild(renderLoopItem(vid, loop));
    });
    loopList.appendChild(group);
  });
}

function renderVideoHeader(vid, videoData) {
  const isCurrent = vid === currentVideoId;
  const header = document.createElement('div');
  header.className = 'video-group-header' + (isCurrent ? ' current' : '');
  header.title = isCurrent ? 'Currently loaded' : 'Load this video';

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
  const idEl = document.createElement('div');
  idEl.className = 'video-id';
  idEl.textContent = vid;
  meta.appendChild(title);
  meta.appendChild(idEl);
  header.appendChild(meta);

  header.addEventListener('click', () => {
    if (isCurrent) return;
    urlInput.value = `https://youtu.be/${vid}`;
    createOrLoadPlayer(vid);
  });

  return header;
}

function renderLoopItem(vid, loop) {
  const div = document.createElement('div');
  div.className = 'loop-item' + (loop.id === editingLoopId ? ' editing' : '');

  const info = document.createElement('div');
  info.className = 'info';
  const range = `${formatTime(loop.start)} → ${formatTime(loop.end)}`;
  const noteHtml = loop.note ? `<div class="loop-note meta">${escapeHtml(loop.note)}</div>` : '';
  info.innerHTML =
    `<div class="loop-range-row">` +
      `<span class="loop-range">${escapeHtml(range)}</span>` +
      `<span class="meta">${escapeHtml(`${loop.speed}x`)}</span>` +
    `</div>` +
    noteHtml;
  div.appendChild(info);

  const playBtn = document.createElement('button');
  playBtn.textContent = '▶ Play';
  playBtn.addEventListener('click', () => {
    if (vid !== currentVideoId) {
      createOrLoadPlayer(vid, () => startLoopFromSaved(loop));
    } else {
      startLoopFromSaved(loop);
    }
  });

  const editBtn = document.createElement('button');
  editBtn.textContent = '✎ Edit';
  editBtn.addEventListener('click', () => {
    const applyEdit = () => {
      editingLoopId = loop.id;
      startInput.value = formatTime(loop.start);
      endInput.value = formatTime(loop.end);
      setSpeed(loop.speed);
      noteInput.value = loop.note || '';
      updateDurationDisplay();
      updateSaveButton();
      // Programmatic .value = does not fire 'input' events, so the loop
      // toggle keeps looping the OLD range unless we sync it explicitly.
      syncActiveLoop();
      renderLoops();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    if (vid !== currentVideoId) {
      createOrLoadPlayer(vid, applyEdit);
    } else {
      applyEdit();
    }
  });

  const delBtn = document.createElement('button');
  delBtn.textContent = '🗑';
  delBtn.title = 'Delete this loop';
  delBtn.addEventListener('click', () => {
    if (!confirm(`Delete this loop (${formatTime(loop.start)} → ${formatTime(loop.end)})?`)) return;
    const data = loadData();
    const v = data.videos[vid];
    if (!v) return;
    v.loops = v.loops.filter(l => l.id !== loop.id);
    if (v.loops.length === 0) delete data.videos[vid];
    saveData(data);
    if (editingLoopId === loop.id) editingLoopId = null;
    renderLoops();
    updateSaveButton();
  });

  const urlBtn = document.createElement('button');
  urlBtn.textContent = '🔗 URL';
  urlBtn.title = 'Copy share URL for this loop';
  urlBtn.addEventListener('click', () => {
    const url = buildShareUrl(vid, loop);
    copyWithFeedback(urlBtn, url, '✅ Copied!', '🔗 URL');
  });

  const mdBtn = document.createElement('button');
  mdBtn.textContent = '📝 MD';
  mdBtn.title = 'Copy Markdown link for this loop';
  mdBtn.addEventListener('click', () => {
    const md = buildShareMarkdown(vid, loop);
    copyWithFeedback(mdBtn, md, '✅ Copied!', '📝 MD');
  });

  div.appendChild(playBtn);
  div.appendChild(editBtn);
  div.appendChild(delBtn);
  div.appendChild(urlBtn);
  div.appendChild(mdBtn);
  return div;
}

function startLoopFromSaved(loop) {
  editingLoopId = loop.id;
  // Bump playedAt so this loop rises to the top on the next render.
  const data = loadData();
  const video = data.videos[currentVideoId];
  const stored = video && video.loops.find(l => l.id === loop.id);
  if (stored) {
    stored.playedAt = Date.now();
    saveData(data);
  }
  setLoopActive({ start: loop.start, end: loop.end });
  setSpeed(loop.speed);
  startInput.value = formatTime(loop.start);
  endInput.value = formatTime(loop.end);
  noteInput.value = loop.note || '';
  updateDurationDisplay();
  updateSaveButton();
  renderLoops();
  player.seekTo(loop.start, true);
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

  // Arrow keys inside Start / End: nudge the field value instead of the player
  if (inStartEnd && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    const step = e.shiftKey ? 1 : 0.05;
    const delta = e.key === 'ArrowLeft' ? -step : step;
    const cur = parseTime(target.value);
    const base = (cur === null || isNaN(cur)) ? 0 : cur;
    target.value = formatTime(Math.max(0, roundTo(base + delta, 2)));
    updateDurationDisplay();
    updateSaveButton();
    syncActiveLoop();
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
    const s = parseTime(startInput.value);
    if (s !== null && !isNaN(s)) player.seekTo(s, true);
  } else if (e.key === 'e' || e.key === 'E') {
    e.preventDefault();
    const en = parseTime(endInput.value);
    if (en !== null && !isNaN(en)) player.seekTo(en, true);
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
