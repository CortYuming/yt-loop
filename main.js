// ============================================================
// YT Loop - YouTube部分リピート再生
// ============================================================

const STORAGE_KEY = 'yt-loop-data-v1';

let player = null;
let currentVideoId = null;
let currentVideoTitle = '';
let rafId = null;
let activeLoop = null; // {start, end, count, remaining}
let editingLoopId = null;

// ---------- DOM ----------
const urlInput      = document.getElementById('urlInput');
const loadBtn       = document.getElementById('loadBtn');
const controls      = document.querySelector('.controls');
const currentTimeEl = document.getElementById('currentTime');
const speedSelect   = document.getElementById('speedSelect');
const startInput    = document.getElementById('startInput');
const endInput      = document.getElementById('endInput');
const captureStart  = document.getElementById('captureStart');
const captureEnd    = document.getElementById('captureEnd');
const labelInput    = document.getElementById('labelInput');
const loopCountInput = document.getElementById('loopCountInput');
const playLoopBtn   = document.getElementById('playLoopBtn');
const saveBtn       = document.getElementById('saveBtn');
const stopLoopBtn   = document.getElementById('stopLoopBtn');
const clearFormBtn  = document.getElementById('clearFormBtn');
const shareBtn      = document.getElementById('shareBtn');
const loopList      = document.getElementById('loopList');

// ============================================================
// YouTube IFrame API のロード
// ============================================================
(function loadYouTubeAPI() {
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);
})();

window.onYouTubeIframeAPIReady = () => {
  // 初期化時にURLパラメータに動画があれば読み込み
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
    });
  } else {
    renderLoops();
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
// 時刻フォーマット
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

// ============================================================
// プレーヤー
// ============================================================
function createOrLoadPlayer(videoId, onReadyCb) {
  currentVideoId = videoId;
  currentVideoTitle = '';
  const readyHandler = () => {
    try {
      const data = player.getVideoData();
      currentVideoTitle = data.title || '';
    } catch (e) {}
    startTimeLoop();
    if (onReadyCb) onReadyCb();
    renderLoops();
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
    // loadVideoById後にonReadyは飛ばないので、少し待ってタイトル取得
    setTimeout(() => {
      try {
        const data = player.getVideoData();
        if (data && data.title) currentVideoTitle = data.title;
      } catch (e) {}
      if (onReadyCb) onReadyCb();
      renderLoops();
    }, 800);
  }
  controls.hidden = false;
}

function onPlayerStateChange() {
  try {
    const data = player.getVideoData();
    if (data && data.title) currentVideoTitle = data.title;
  } catch (err) {}
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
            if (activeLoop.count !== null) {
              activeLoop.remaining -= 1;
              if (activeLoop.remaining <= 0) {
                player.pauseVideo();
                activeLoop = null;
              } else {
                player.seekTo(activeLoop.start, true);
              }
            } else {
              player.seekTo(activeLoop.start, true);
            }
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
// フォーム操作
// ============================================================
loadBtn.addEventListener('click', () => {
  const id = extractVideoId(urlInput.value);
  if (!id) { alert('URLが不正です'); return; }
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
});
captureEnd.addEventListener('click', () => {
  if (!player || !player.getCurrentTime) return;
  endInput.value = formatTime(player.getCurrentTime());
});

playLoopBtn.addEventListener('click', () => {
  const start = parseTime(startInput.value);
  const end   = parseTime(endInput.value);
  if (start === null || end === null || start >= end) {
    alert('開始・終了時間が不正です'); return;
  }
  const count = loopCountInput.value ? parseInt(loopCountInput.value, 10) : null;
  activeLoop = { start, end, count, remaining: count };
  if (player.setPlaybackRate) player.setPlaybackRate(parseFloat(speedSelect.value));
  player.seekTo(start, true);
  player.playVideo();
});

stopLoopBtn.addEventListener('click', () => { activeLoop = null; });

saveBtn.addEventListener('click', () => {
  if (!currentVideoId) { alert('先に動画を読み込んでください'); return; }
  const start = parseTime(startInput.value);
  const end   = parseTime(endInput.value);
  if (start === null || end === null || start >= end) {
    alert('開始・終了時間が不正です'); return;
  }
  const loop = {
    id: editingLoopId || (crypto.randomUUID ? crypto.randomUUID() : 'l' + Date.now() + Math.random().toString(36).slice(2)),
    label: labelInput.value.trim(),
    start,
    end,
    speed: parseFloat(speedSelect.value),
    loopCount: loopCountInput.value ? parseInt(loopCountInput.value, 10) : null
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
  editingLoopId = null;
  renderLoops();
});

clearFormBtn.addEventListener('click', () => {
  editingLoopId = null;
  startInput.value = '';
  endInput.value = '';
  labelInput.value = '';
  loopCountInput.value = '';
  speedSelect.value = '1';
});

shareBtn.addEventListener('click', async () => {
  if (!currentVideoId) { alert('先に動画を読み込んでください'); return; }
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
    shareBtn.textContent = '✅ コピー済み';
    setTimeout(() => { shareBtn.textContent = '🔗 共有URL'; }, 1500);
  } catch (e) {
    prompt('共有URL:', url);
  }
});

// ============================================================
// データ
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
// 一覧描画
// ============================================================
function renderLoops() {
  const data = loadData();
  loopList.innerHTML = '';
  const entries = Object.entries(data.videos);
  if (entries.length === 0) {
    loopList.innerHTML = '<p class="empty">まだ保存されていません</p>';
    return;
  }
  // 現在の動画を先頭に
  entries.sort((a, b) => {
    if (a[0] === currentVideoId) return -1;
    if (b[0] === currentVideoId) return 1;
    return (a[1].title || a[0]).localeCompare(b[1].title || b[0]);
  });
  entries.forEach(([vid, videoData]) => {
    const group = document.createElement('div');
    group.className = 'video-group';
    const h3 = document.createElement('h3');
    const isCurrent = vid === currentVideoId;
    const titleText = videoData.title || vid;
    if (isCurrent) {
      h3.innerHTML = `<span class="current">▶ 再生中:</span> ${escapeHtml(titleText)}`;
    } else {
      h3.textContent = titleText;
    }
    group.appendChild(h3);
    videoData.loops.forEach(loop => {
      group.appendChild(renderLoopItem(vid, loop));
    });
    loopList.appendChild(group);
  });
}

function renderLoopItem(vid, loop) {
  const div = document.createElement('div');
  div.className = 'loop-item';

  const info = document.createElement('div');
  info.className = 'info';
  const label = loop.label || '(無題)';
  const meta = `${formatTime(loop.start)} 〜 ${formatTime(loop.end)}  ${loop.speed}x${loop.loopCount ? '  ' + loop.loopCount + '回' : ''}`;
  info.innerHTML = `<div class="label">${escapeHtml(label)}</div><div class="meta">${escapeHtml(meta)}</div>`;
  div.appendChild(info);

  const playBtn = document.createElement('button');
  playBtn.textContent = '▶ 再生';
  playBtn.addEventListener('click', () => {
    if (vid !== currentVideoId) {
      createOrLoadPlayer(vid, () => startLoopFromSaved(loop));
    } else {
      startLoopFromSaved(loop);
    }
  });

  const editBtn = document.createElement('button');
  editBtn.textContent = '✎ 編集';
  editBtn.addEventListener('click', () => {
    const applyEdit = () => {
      editingLoopId = loop.id;
      startInput.value = formatTime(loop.start);
      endInput.value = formatTime(loop.end);
      labelInput.value = loop.label || '';
      loopCountInput.value = loop.loopCount || '';
      speedSelect.value = String(loop.speed);
      if (player && player.setPlaybackRate) player.setPlaybackRate(loop.speed);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    if (vid !== currentVideoId) {
      createOrLoadPlayer(vid, applyEdit);
    } else {
      applyEdit();
    }
  });

  const delBtn = document.createElement('button');
  delBtn.textContent = '🗑 削除';
  delBtn.addEventListener('click', () => {
    if (!confirm(`「${loop.label || '(無題)'}」を削除しますか？`)) return;
    const data = loadData();
    const v = data.videos[vid];
    if (!v) return;
    v.loops = v.loops.filter(l => l.id !== loop.id);
    if (v.loops.length === 0) delete data.videos[vid];
    saveData(data);
    renderLoops();
  });

  div.appendChild(playBtn);
  div.appendChild(editBtn);
  div.appendChild(delBtn);
  return div;
}

function startLoopFromSaved(loop) {
  activeLoop = { start: loop.start, end: loop.end, count: loop.loopCount, remaining: loop.loopCount };
  speedSelect.value = String(loop.speed);
  startInput.value = formatTime(loop.start);
  endInput.value = formatTime(loop.end);
  labelInput.value = loop.label || '';
  loopCountInput.value = loop.loopCount || '';
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
// キーボードショートカット
// ============================================================
document.addEventListener('keydown', e => {
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (!player || !player.getCurrentTime) return;

  if (e.code === 'Space') {
    e.preventDefault();
    const state = safeState();
    if (state === (window.YT && YT.PlayerState.PLAYING)) player.pauseVideo();
    else player.playVideo();
  } else if (e.key === 's' || e.key === 'S') {
    e.preventDefault();
    startInput.value = formatTime(player.getCurrentTime());
  } else if (e.key === 'e' || e.key === 'E') {
    e.preventDefault();
    endInput.value = formatTime(player.getCurrentTime());
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    const step = e.shiftKey ? 5 : 0.5;
    player.seekTo(Math.max(0, player.getCurrentTime() - step), true);
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    const step = e.shiftKey ? 5 : 0.5;
    player.seekTo(player.getCurrentTime() + step, true);
  }
});
