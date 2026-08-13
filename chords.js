// ============================================================
// Chord sheets — notation, theory and the little fretboard diagrams
// ============================================================
// A sheet is one line of text per phrase, bars split by | or a newline:
//
//   @43.50 Bb9:1.1.1.0.. Eb9:.6.6.5.6.|@45.90 D7+9:.6.5.4.5. G7+9:13.11.10.9..
//
// `Name:markers` is a chord and the fingering picked for it in Guitar Chord
// Viewer — six dot-separated frets, 1st string first, blank for a muted string,
// the same `m=` string that viewer puts in its own URL. `@` sets where the bar
// starts (`@43.50-45.85` pins its end too). Markdown links pasted straight out
// of a notes file are accepted as chords as well, so an existing sheet can be
// dropped in without being rewritten by hand.
//
// Everything here is pure: text in, data or an <svg> out. It leans on
// parseTime from main.js, which is loaded after this file — fine, since nothing
// here runs at load time.
/* global parseTime */

const Chords = (() => {
  // ---------- theory (mirrors guitar-chord-viewer's chord.ts) ----------
  const CONTEXTUAL_SUMMARY = ['R', '♭9', '9', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', 'Δ7'];
  const NOTES_SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const NOTES_FLAT  = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
  // Open strings in semitones, 1st string first — the row order the viewer uses.
  const OPEN_STRINGS = [4, 11, 7, 2, 9, 4];

  const AUG5 = [{ n: 5, sign: '♯', adjusted: 8 }];
  const ALT_TENSIONS = [
    { n: 9, sign: '♭', adjusted: 1 }, { n: 9, sign: '♯', adjusted: 3 },
    { n: 5, sign: '♭', adjusted: 6 }, { n: 5, sign: '♯', adjusted: 8 },
  ];

  const QUALITY_MAP = {
    '': [0, 4, 7], 'maj': [0, 4, 7], 'M': [0, 4, 7],
    'm': [0, 3, 7], 'min': [0, 3, 7], '-': [0, 3, 7],
    'dim': [0, 3, 6], '°': [0, 3, 6],
    'aug': { tones: [0, 4], tensions: AUG5 },
    'sus2': [0, 2, 7], 'sus4': [0, 5, 7], 'sus': [0, 5, 7],
    '6': [0, 4, 7, 9], 'm6': [0, 3, 7, 9], 'min6': [0, 3, 7, 9],
    '7': [0, 4, 7, 10],
    'M7': [0, 4, 7, 11], 'maj7': [0, 4, 7, 11], 'Δ7': [0, 4, 7, 11], 'Δ': [0, 4, 7, 11],
    'm7': [0, 3, 7, 10], 'min7': [0, 3, 7, 10], '-7': [0, 3, 7, 10],
    'mM7': [0, 3, 7, 11], 'mmaj7': [0, 3, 7, 11], 'mΔ7': [0, 3, 7, 11],
    'm7b5': [0, 3, 6, 10], 'ø': [0, 3, 6, 10], 'ø7': [0, 3, 6, 10],
    'dim7': [0, 3, 6, 9], '°7': [0, 3, 6, 9],
    'aug7': { tones: [0, 4, 10], tensions: AUG5 },
    '9': [0, 4, 7, 10, 2],
    'M9': [0, 4, 7, 11, 2], 'maj9': [0, 4, 7, 11, 2], 'Δ9': [0, 4, 7, 11, 2],
    'm9': [0, 3, 7, 10, 2],
    '11': [0, 4, 7, 10, 2, 5], 'm11': [0, 3, 7, 10, 2, 5],
    '13': [0, 4, 7, 10, 2, 5, 9],
    'M13': [0, 4, 7, 11, 2, 5, 9], 'maj13': [0, 4, 7, 11, 2, 5, 9], 'Δ13': [0, 4, 7, 11, 2, 5, 9],
    'm13': [0, 3, 7, 10, 2, 5, 9],
    'add9': [0, 4, 7, 2], 'add11': [0, 4, 7, 5], 'add13': [0, 4, 7, 9],
    'madd9': [0, 3, 7, 2], 'madd11': [0, 3, 7, 5], 'madd13': [0, 3, 7, 9],
    '6/9': [0, 4, 7, 9, 2], '69': [0, 4, 7, 9, 2],
    'm6/9': [0, 3, 7, 9, 2], 'm69': [0, 3, 7, 9, 2],
    '7sus4': [0, 5, 7, 10], '7sus': [0, 5, 7, 10],
    '9sus4': [0, 5, 7, 10, 2], '9sus': [0, 5, 7, 10, 2],
    '13sus4': [0, 5, 7, 10, 2, 9], '13sus': [0, 5, 7, 10, 2, 9],
    'alt': { tones: [0, 4, 10], tensions: ALT_TENSIONS },
    '7alt': { tones: [0, 4, 10], tensions: ALT_TENSIONS },
  };
  const QUALITY_KEYS = Object.keys(QUALITY_MAP).filter(k => k).sort((a, b) => b.length - a.length);

  const ROOT_MAP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const TENSION_NAT = { 2: 2, 4: 5, 5: 7, 6: 9, 7: 10, 9: 2, 11: 5, 13: 9 };
  const FLAT_NATURAL_MAJOR_ROOTS = new Set(['F']);
  const FLAT_NATURAL_MINOR_ROOTS = new Set(['D', 'G', 'C', 'F']);

  function normalizeAliases(s) {
    return s
      .replace(/∆/g, 'Δ').replace(/△/g, 'Δ')
      .replace(/major/gi, 'maj').replace(/Ma(?!j)/g, 'maj').replace(/MA(?![Jj])/g, 'maj')
      // Joe Pass notation: Cm+7 is minor(major 7th), so guard it before the
      // augmented rules rewrite '+7'.
      .replace(/m\+7/g, 'mM7')
      .replace(/7aug/g, 'aug7').replace(/7\+(?!\d)/g, 'aug7')
      .replace(/\+7(?!\d)/g, 'aug7').replace(/\+(?!\d)/g, 'aug');
  }

  function parseChord(input) {
    const s = normalizeAliases(String(input).trim().replace(/\s+/g, ''));
    if (!s) return null;
    const upper = s[0].toUpperCase();
    if (!(upper in ROOT_MAP)) return null;
    let root = ROOT_MAP[upper];
    let pos = 1;
    const sec = s[1];
    if (sec === '#' || sec === '♯') { root = (root + 1) % 12; pos = 2; }
    else if (sec === 'b' || sec === '♭') { root = (root + 11) % 12; pos = 2; }

    const rootLabel = s.slice(0, pos);
    let rest = s.slice(pos);
    let quality = '';
    for (const q of QUALITY_KEYS) {
      if (rest.startsWith(q)) { quality = q; rest = rest.slice(q.length); break; }
    }

    const raw = QUALITY_MAP[quality] ?? [0, 4, 7];
    const base = Array.isArray(raw) ? raw : raw.tones;
    const tensions = Array.isArray(raw) ? [] : raw.tensions.slice();
    const tones = new Set(base);

    const re = /([+#♯b♭])(\d+)/g;
    let m;
    while ((m = re.exec(rest)) !== null) {
      const n = parseInt(m[2], 10);
      const natural = TENSION_NAT[n];
      if (natural === undefined) continue;
      const isSharp = m[1] === '+' || m[1] === '#' || m[1] === '♯';
      tensions.push({
        n,
        sign: isSharp ? '♯' : '♭',
        adjusted: isSharp ? (natural + 1) % 12 : (natural + 11) % 12,
      });
    }
    for (const t of tensions) {
      if (t.n === 5) tones.delete(7);
      if (t.n === 7) { tones.delete(10); tones.delete(11); }
      tones.add(t.adjusted);
    }
    return { root, rootLabel, quality, tensions, tones: [...tones].sort((a, b) => a - b) };
  }

  // One accidental per chord, following the circle of fifths.
  function accidentalFor(chord) {
    const sign = chord.rootLabel[1];
    if (sign === 'b' || sign === '♭') return '♭';
    if (sign === '#' || sign === '♯') return '♯';
    const isMinor = chord.tones.includes(3) && !chord.tones.includes(4);
    const flatRoots = isMinor ? FLAT_NATURAL_MINOR_ROOTS : FLAT_NATURAL_MAJOR_ROOTS;
    return flatRoots.has(chord.rootLabel[0].toUpperCase()) ? '♭' : '♯';
  }

  function contextualName(semi, chord) {
    for (const t of chord.tensions) if (t.adjusted === semi) return `${t.sign}${t.n}`;
    return CONTEXTUAL_SUMMARY[semi];
  }

  // What goes inside a dot: the picked note read against the chord's root.
  function dotLabel(stringIdx, fret, chord, mode) {
    if (!chord) return '';
    const semi = (OPEN_STRINGS[stringIdx] + fret) % 12;
    if (mode === 'note') {
      return accidentalFor(chord) === '♭' ? NOTES_FLAT[semi] : NOTES_SHARP[semi];
    }
    return contextualName((semi - chord.root + 12) % 12, chord);
  }

  // ---------- notation ----------
  // A token is a markdown link (whose label may hold spaces) or a run of
  // non-space characters.
  const TOKEN = /\[[^\]]*\]\([^)]*\)|\S+/g;
  const MD_LINK = /^\[([^\]]*)\]\(([^)]*)\)$/;

  function parseMarkers(m) {
    if (!m) return null;
    const parts = String(m).split('.');
    if (parts.length !== 6) return null;
    const parsed = parts.map(p => {
      if (p === '') return null;
      const n = parseInt(p, 10);
      return !isNaN(n) && n >= 0 && n <= 22 ? n : null;
    });
    return parsed.some(f => f !== null) ? parsed : null;
  }

  // `@43.50` or `@43.50-45.85`, either side also accepted as `0:43.50`.
  function parseBarTime(token) {
    const body = token.slice(1);
    if (!body) return null;
    const dash = body.indexOf('-');
    const startText = dash === -1 ? body : body.slice(0, dash);
    const endText = dash === -1 ? '' : body.slice(dash + 1);
    const start = parseTime(startText);
    if (start === null || isNaN(start)) return null;
    const end = endText ? parseTime(endText) : null;
    return { start, end: end !== null && !isNaN(end) && end > start ? end : null };
  }

  function parseChordToken(token) {
    const link = token.match(MD_LINK);
    if (link) {
      let markers = null;
      let name = link[1].trim();
      try {
        const u = new URL(link[2], location.href);
        markers = parseMarkers(u.searchParams.get('m'));
        if (!name) name = u.searchParams.get('c') || '';
      } catch (e) { /* not a URL — keep the label as a bare chord name */ }
      return name ? { name, markers } : null;
    }
    const colon = token.indexOf(':');
    if (colon === -1) return { name: token, markers: null };
    return { name: token.slice(0, colon), markers: parseMarkers(token.slice(colon + 1)) };
  }

  function parseBar(barText) {
    const bar = { start: null, end: null, chords: [] };
    const tokens = barText.match(TOKEN) || [];
    for (const token of tokens) {
      if (token[0] === '@') {
        const t = parseBarTime(token);
        if (t) { bar.start = t.start; bar.end = t.end; }
        continue;
      }
      const chord = parseChordToken(token);
      if (chord) bar.chords.push(chord);
    }
    return bar.chords.length ? bar : null;
  }

  // A yt-loop link is a time range, not a chord: any link carrying `s` and `e`
  // counts, whichever host it points at. This is what a sheet looks like in a
  // notes file — a row of bars, then the link that plays them — so a line
  // holding one is read as timing for the bars above it and nothing else on
  // that line (the video title, a "10-12" bar count) is looked at.
  function parseRangeLine(line) {
    const tokens = line.match(TOKEN) || [];
    for (const token of tokens) {
      const link = token.match(MD_LINK);
      try {
        const u = new URL(link ? link[2] : token, location.href);
        const start = parseFloat(u.searchParams.get('s'));
        const end = parseFloat(u.searchParams.get('e'));
        if (!isNaN(start) && !isNaN(end) && end > start) return { start, end };
      } catch (e) { /* not a URL — keep looking */ }
    }
    return null;
  }

  // Lay a range over a run of bars. They share it evenly: a transcription is
  // written bar by bar at a steady tempo, so dividing is the only thing one
  // link across several bars can mean. The run holds no bar that already has a
  // time, so nothing written by hand is overwritten and nothing already timed
  // eats into the share of the bars this link is actually for.
  function spreadRange(bars, from, to, range) {
    const count = to - from;
    if (count <= 0) return;
    const each = (range.end - range.start) / count;
    for (let i = from; i < to; i++) {
      bars[i].start = range.start + (i - from) * each;
      bars[i].end = bars[i].start + each;
    }
  }

  // Hand a run of bars to the range lines that followed them, in order. Both
  // ways of writing it work out: one link per bar lands a range on each, and a
  // single link covering nine bars is divided nine ways.
  function distribute(bars, from, to, ranges) {
    const count = to - from;
    for (let r = 0; r < ranges.length; r++) {
      spreadRange(
        bars,
        from + Math.round((r * count) / ranges.length),
        from + Math.round(((r + 1) * count) / ranges.length),
        ranges[r],
      );
    }
  }

  // Which bars a run of range lines is timing: the ones written just above it
  // that have no time of their own. A bar carrying its own `@` ends the run —
  // it is already placed, and everything before it belongs to whatever timed
  // it. This is what lets a block be pasted into a sheet that is already timed:
  // the link divides its range among the bars it came with, not among those and
  // every bar above them.
  function untimedRunAbove(bars) {
    let from = bars.length;
    while (from > 0 && bars[from - 1].start === null) from--;
    return from;
  }

  // Text → bars. Bars split on | or a newline; empty ones are dropped, so a
  // leading or trailing | is free.
  function parseSheet(text) {
    const bars = [];
    let ranges = [];    // range lines seen since the last row of bars

    const flush = () => {
      const from = untimedRunAbove(bars);
      if (ranges.length && from < bars.length) distribute(bars, from, bars.length, ranges);
      ranges = [];
    };

    for (const line of String(text || '').split('\n')) {
      const range = parseRangeLine(line);
      if (range) { ranges.push(range); continue; }
      const found = line.split('|').map(s => s.trim()).filter(Boolean)
        .map(parseBar).filter(Boolean);
      if (!found.length) continue;
      // The ranges collected so far belong to the bars above them, not to these.
      flush();
      bars.push(...found);
    }
    flush();
    return bars;
  }

  // Fill in the bar ends nobody wrote down: a bar runs up to the next one, and
  // the last bar borrows the length of the one before it. Solos are transcribed
  // bar after bar, so this is right far more often than it is wrong — and a bar
  // that needs an exact end can always spell it out as `@start-end`.
  function resolveSpans(bars) {
    const spans = bars.map(b => ({ start: b.start, end: b.end }));
    for (let i = 0; i < spans.length; i++) {
      if (spans[i].start === null || spans[i].end !== null) continue;
      const next = spans[i + 1];
      if (next && next.start !== null && next.start > spans[i].start) {
        spans[i].end = next.start;
      } else {
        const prev = spans[i - 1];
        if (prev && prev.start !== null && prev.end !== null) {
          spans[i].end = spans[i].start + (prev.end - prev.start);
        }
      }
    }
    return spans;
  }

  // How a bar's four beats fall to its chords — chord-vamp's split, so the two
  // apps read a written bar the same way.
  function beatWeights(n) {
    if (n <= 1) return [4];
    if (n === 2) return [2, 2];
    if (n === 3) return [2, 1, 1];
    return Array(n).fill(4 / n);
  }

  // The same split as widths, in slots of one diagram. A bar is four slots wide
  // whatever it holds, so every bar on screen is the same size and the sheet
  // moves at one speed. Past four chords there is nothing left to divide — a
  // diagram can't be narrower than itself — so those bars run wide.
  function slotWeights(n) {
    if (n <= 4) return beatWeights(n);
    return Array(n).fill(1);
  }

  // Start time per chord in a bar, or nulls when the bar has no time on it.
  function chordTimes(bar, span) {
    if (!span || span.start === null) return bar.chords.map(() => null);
    if (span.end === null) return bar.chords.map((_, i) => (i === 0 ? span.start : null));
    const weights = beatWeights(bar.chords.length);
    const total = weights.reduce((a, b) => a + b, 0);
    const length = span.end - span.start;
    const times = [];
    let acc = 0;
    for (const w of weights) {
      times.push(span.start + (acc / total) * length);
      acc += w;
    }
    return times;
  }

  function markersToText(markers) {
    return markers.map(f => (f === null ? '' : String(f))).join('.');
  }

  // Bars → the shortest text that parses back to the same thing. This is what
  // gets stored and put in a share link, so a sheet pasted as markdown links
  // shrinks to a fraction of its size on the way out.
  // `sep` is '|' for a URL, where every character counts, and '\n' for the
  // editor, where one bar per line is what you can actually read and correct.
  function toCompact(bars, sep = '|') {
    return bars.map(bar => {
      const head = bar.start === null
        ? ''
        : `@${bar.start.toFixed(2)}${bar.end === null ? '' : `-${bar.end.toFixed(2)}`} `;
      const chords = bar.chords
        .map(c => (c.markers ? `${c.name}:${markersToText(c.markers)}` : c.name))
        .join(' ');
      return head + chords;
    }).join(sep);
  }

  function viewerUrl(chord) {
    const params = new URLSearchParams();
    params.set('c', chord.name);
    if (chord.markers) params.set('m', markersToText(chord.markers));
    return `https://cortyuming.github.io/guitar-chord-viewer/?${params.toString()}`;
  }

  // ---------- diagram ----------
  // The viewer draws all 22 frets; here the window is cropped to the span the
  // picked notes occupy, so what you read is the shape, not its address.
  // Every diagram is the same width, whatever the shape it holds. Boards that
  // grew to fit their span made the row jump about as it moved, which is what
  // the eye follows — so the window is a fixed five frets, and the rare shape
  // that needs more gets narrower frets rather than a wider board.
  // The board is narrower than the dots strictly need: frets carry no
  // information here beyond where the fingers go, so they give up their width
  // first and the labels inside the dots keep their size.
  const NS = 'http://www.w3.org/2000/svg';
  const BOARD_W = 110, CELL_H = 20, PAD_L = 20, PAD_T = 14, DOT_R = 8.8;
  // Open and muted strings live in the gutter left of the nut; the marks there
  // have to clear the left edge, so the dot's own radius sets the offset.
  const GUTTER_X = DOT_R + 1;
  const COLS = 5;

  function diagram(markers, chordName, mode) {
    const svg = document.createElementNS(NS, 'svg');
    const picked = markers ? markers.filter(f => f !== null) : [];
    if (!picked.length) {
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      return svg;
    }
    const chord = parseChord(chordName);
    const fretted = picked.filter(f => f > 0);
    const from = fretted.length ? Math.min(...fretted) : 1;
    const cols = Math.max(COLS, (fretted.length ? Math.max(...fretted) : from) - from + 1);
    const CELL_W = BOARD_W / cols;
    const w = PAD_L + BOARD_W + 4;
    const h = PAD_T + 6 * CELL_H + 2;
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${chordName} fingering`);

    const add = (tag, attrs, text) => {
      const el = document.createElementNS(NS, tag);
      for (const k in attrs) el.setAttribute(k, String(attrs[k]));
      if (text !== undefined) el.textContent = text;
      svg.appendChild(el);
      return el;
    };

    add('text', {
      x: PAD_L, y: 10, fill: '#999', 'font-size': 10,
      'font-family': 'ui-monospace, Menlo, monospace',
    }, String(from));

    for (let s = 0; s < 6; s++) {
      const y = PAD_T + s * CELL_H + CELL_H / 2;
      add('line', { x1: PAD_L, y1: y, x2: PAD_L + cols * CELL_W, y2: y, stroke: '#4d4d4d', 'stroke-width': 1 });
    }
    for (let c = 0; c <= cols; c++) {
      const x = PAD_L + c * CELL_W;
      add('line', {
        x1: x, y1: PAD_T + CELL_H / 2, x2: x, y2: PAD_T + 5 * CELL_H + CELL_H / 2,
        stroke: '#4d4d4d', 'stroke-width': c === 0 && from === 1 ? 2.5 : 1,
      });
    }

    markers.forEach((f, s) => {
      const y = PAD_T + s * CELL_H + CELL_H / 2;
      if (f === null) {
        add('text', {
          x: GUTTER_X, y: y + 3, fill: '#666', 'font-size': 9,
          'text-anchor': 'middle', 'font-family': 'sans-serif',
        }, '×');
        return;
      }
      const label = dotLabel(s, f, chord, mode);
      const isRoot = !!chord && (OPEN_STRINGS[s] + f - chord.root + 24) % 12 === 0;
      const open = f === 0;
      const cx = open ? GUTTER_X : PAD_L + (f - from) * CELL_W + CELL_W / 2;
      add('circle', {
        cx, cy: y, r: DOT_R,
        fill: open ? 'none' : isRoot ? '#ffa726' : '#4a7fff',
        stroke: open ? (isRoot ? '#ffa726' : '#4a7fff') : 'none', 'stroke-width': 1.5,
      });
      add('text', {
        x: cx, y: y + 3.9,
        fill: open ? (isRoot ? '#ffa726' : '#9bb6ff') : isRoot ? '#1a1a1a' : '#fff',
        'font-size': label.length > 2 ? 9 : 11, 'text-anchor': 'middle',
        'font-family': '-apple-system, BlinkMacSystemFont, sans-serif', 'font-weight': 600,
      }, label);
    });
    return svg;
  }

  return { parseSheet, resolveSpans, chordTimes, slotWeights, toCompact, viewerUrl, diagram };
})();
