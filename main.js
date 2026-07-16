// ============================================================
// YT Loop — loop any part of a YouTube video
// ============================================================

const STORAGE_KEY = 'yt-loop-data-v1';

let player = null;
let currentVideoId = null;
let currentVideoTitle = '';
let rafId = null;
let activeLoop = null; // {start, end}
let editingLoopId = null;

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
const startInput      = document.getElementById('startInput');
const endInput        = document.getElementById('endInput');
const captureStart    = document.getElementById('captureStart');
const captureEnd      = document.getElementById('captureEnd');
const loopToggle      = document.getElementById('loopToggle');
const playLoopBtn     = document.getElementById('playLoopBtn');
const saveBtn         = document.getElementById('saveBtn');
const newBtn          = document.getElementById('newBtn');
const deleteBtn       = document.getElementById('deleteBtn');
const shareBtn        = document.getElementById('shareBtn');
const loopList        = document.getElementById('loopList');

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
      if (r) {
        speedSelect.value = r;
        if (player && player.setPlaybackRate) player.setPlaybackRate(parseFloat(r));
      }
      updateDurationDisplay();
      updateSaveButton();
    });
  } else {
    renderLoops();
    updateSaveButton();
  }
};

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
  const speed = parseFloat(speedSelect.value);

  const validTime = start !== null && end !== null && !isNaN(start) && !isNaN(end) && start < end;

  const data = loadData();
  const savedVersion = (editingLoopId && currentVideoId && data.videos[currentVideoId])
    ? (data.videos[currentVideoId].loops.find(l => l.id === editingLoopId) || null)
    : null;

  const isInList = savedVersion !== null;
  const isDirty = !savedVersion || (
    savedVersion.start !== start ||
    savedVersion.end !== end ||
    savedVersion.speed !== speed
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
function createOrLoadPlayer(videoId, onReadyCb) {
  currentVideoId = videoId;
  currentVideoTitle = '';
  const readyHandler = () => {
    try {
      const data = player.getVideoData();
      currentVideoTitle = data.title || '';
    } catch (e) {}
    backfillTitle();
    startTimeLoop();
    if (onReadyCb) onReadyCb();
    fillDefaultEnd();
    activateLoopFromInputs();
    renderLoops();
    updateSaveButton();
  };
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
        onReady: readyHandler,
        onStateChange: onPlayerStateChange
      }
    });
  } else {
    player.loadVideoById(videoId);
    setTimeout(() => {
      try {
        const data = player.getVideoData();
        if (data && data.title) currentVideoTitle = data.title;
      } catch (e) {}
      backfillTitle();
      if (onReadyCb) onReadyCb();
      fillDefaultEnd();
      activateLoopFromInputs();
      renderLoops();
      updateSaveButton();
    }, 800);
  }
  controls.hidden = false;
}

function onPlayerStateChange() {
  try {
    const data = player.getVideoData();
    if (data && data.title) currentVideoTitle = data.title;
  } catch (err) {}
  backfillTitle();
  updatePlayButton();
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
  const state = safeState();
  if (state === (window.YT && YT.PlayerState.PLAYING)) {
    playLoopBtn.textContent = '⏸ Pause';
  } else {
    playLoopBtn.textContent = '▶ Play';
  }
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
speedSelect.addEventListener('change', updateSaveButton);

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
  if (player && player.setPlaybackRate) {
    player.setPlaybackRate(parseFloat(speedSelect.value));
  }
});

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
  const state = safeState();
  if (state === (window.YT && YT.PlayerState.PLAYING)) {
    player.pauseVideo();
    return;
  }
  // Loop membership is owned by the toggle; here we just seek into range
  // if the toggle is on and playback is currently outside it.
  if (player.setPlaybackRate) player.setPlaybackRate(parseFloat(speedSelect.value));
  if (activeLoop) {
    const t = player.getCurrentTime();
    if (t < activeLoop.start || t >= activeLoop.end) {
      player.seekTo(activeLoop.start, true);
    }
  }
  player.playVideo();
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
    speed: parseFloat(speedSelect.value),
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
  editingLoopId = null;
  startInput.value = '0:00.00';
  endInput.value = '';
  speedSelect.value = '1';
  activeLoop = null;
  fillDefaultEnd();
  activateLoopFromInputs();
  updateDurationDisplay();
  updateSaveButton();
  renderLoops();
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

shareBtn.addEventListener('click', async () => {
  if (!currentVideoId) { alert('Load a video first'); return; }
  const params = new URLSearchParams();
  params.set('v', currentVideoId);
  const s = parseTime(startInput.value);
  const e = parseTime(endInput.value);
  if (s !== null && !isNaN(s)) params.set('s', s.toFixed(2));
  if (e !== null && !isNaN(e)) params.set('e', e.toFixed(2));
  const speed = parseFloat(speedSelect.value);
  if (speed !== 1) params.set('r', String(speed));
  const url = `${location.origin}${location.pathname}?${params.toString()}`;
  try {
    await navigator.clipboard.writeText(url);
    shareBtn.textContent = '✅ Copied!';
    setTimeout(() => { shareBtn.textContent = '🔗 Share URL'; }, 1500);
  } catch (e) {
    prompt('Share URL:', url);
  }
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
function renderLoops() {
  const data = loadData();
  loopList.innerHTML = '';
  const entries = Object.entries(data.videos);
  if (entries.length === 0) {
    loopList.innerHTML = '<p class="empty">No saved loops yet.</p>';
    return;
  }
  const groupUpdatedAt = ([, v]) =>
    v.loops.reduce((m, l) => Math.max(m, l.updatedAt || 0), 0);
  entries.sort((a, b) => groupUpdatedAt(b) - groupUpdatedAt(a));

  entries.forEach(([vid, videoData]) => {
    const group = document.createElement('div');
    group.className = 'video-group';
    group.appendChild(renderVideoHeader(vid, videoData));
    const sortedLoops = [...videoData.loops].sort(
      (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
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
  info.innerHTML = `<div class="loop-range">${escapeHtml(range)}</div><div class="meta">${escapeHtml(`${loop.speed}x`)}</div>`;
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
      speedSelect.value = String(loop.speed);
      if (player && player.setPlaybackRate) player.setPlaybackRate(loop.speed);
      updateDurationDisplay();
      updateSaveButton();
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
  delBtn.textContent = '🗑 Delete';
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

  div.appendChild(playBtn);
  div.appendChild(editBtn);
  div.appendChild(delBtn);
  return div;
}

function startLoopFromSaved(loop) {
  editingLoopId = loop.id;
  setLoopActive({ start: loop.start, end: loop.end });
  speedSelect.value = String(loop.speed);
  startInput.value = formatTime(loop.start);
  endInput.value = formatTime(loop.end);
  updateDurationDisplay();
  updateSaveButton();
  renderLoops();
  if (player.setPlaybackRate) player.setPlaybackRate(loop.speed);
  player.seekTo(loop.start, true);
  player.playVideo();
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
    const state = safeState();
    if (state === (window.YT && YT.PlayerState.PLAYING)) player.pauseVideo();
    else player.playVideo();
  } else if (e.key === 's' || e.key === 'S') {
    e.preventDefault();
    const s = parseTime(startInput.value);
    if (s !== null && !isNaN(s)) player.seekTo(s, true);
  } else if (e.key === 'e' || e.key === 'E') {
    e.preventDefault();
    const en = parseTime(endInput.value);
    if (en !== null && !isNaN(en)) player.seekTo(en, true);
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
