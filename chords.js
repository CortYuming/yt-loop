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
  // Movable-do solfège, indexed by semitones above whatever is being called do.
  // The same two tables guitar-chord-viewer uses, so a shape read in one app is
  // spelled the same in the other. Which one applies is the accidental question
  // again: a flat key gets the flat syllables.
  const SOLFEGE_SHARP = ['do', 'di', 're', 'ri', 'mi', 'fa', 'fi', 'so', 'si', 'la', 'li', 'ti'];
  const SOLFEGE_FLAT  = ['do', 'ro', 're', 'mo', 'mi', 'fa', 'swo', 'so', 'lo', 'la', 'to', 'ti'];
  const NOTES_SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const NOTES_FLAT  = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
  // Open strings in semitones, 1st string first — the row order the viewer uses.
  const OPEN_STRINGS = [4, 11, 7, 2, 9, 4];

  // Degree hues, indexed by semitones above the chord root — guitar-chord-
  // viewer's palette in its dark values, this app having only the one theme.
  // The reasoning behind the twelve is written out in that app's App.css: an
  // altered degree is a lighter or darker cast of the natural one it alters,
  // and the sevenths and the 13 share the purple family. Kept in step with it
  // so a shape carried between the two apps keeps its colours.
  const DEGREE_HUE = [
    '#e57672', '#b07f45', '#e6a45c', '#6d8f45', '#9cc267', '#6ec6c1',
    '#98c9c4', '#6ea6de', '#c3b4ea', '#9b7ce6', '#d888cf', '#edbde6',
  ];
  // Labels inside a dot are white on every one of them. Picking ink or paper
  // per hue read better in the abstract and worse on the strip: the labels
  // flipped colour as the shape moved up the neck, which is motion that means
  // nothing, and the dot's own hue is where the degree is said anyway.
  const DOT_INK = '#ffffff';

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

  // What goes inside a dot: the picked note read against the chord's root, or —
  // in solfège — against the song's key. do is the key's and only the key's: a
  // chord's own root moving do from bar to bar is a different reading of the
  // same word and not the one a sheet is for. With no key there is nothing to
  // be relative to, so the dots go back to degrees rather than inventing one.
  function dotLabel(stringIdx, fret, chord, mode, key) {
    if (!chord) return '';
    const semi = (OPEN_STRINGS[stringIdx] + fret) % 12;
    if (mode === 'note') {
      return accidentalFor(chord) === '♭' ? NOTES_FLAT[semi] : NOTES_SHARP[semi];
    }
    if (mode === 'solfa' && key) {
      const table = key.accidental === '♭' ? SOLFEGE_FLAT : SOLFEGE_SHARP;
      return table[(semi - key.tonic + 12) % 12];
    }
    return contextualName((semi - chord.root + 12) % 12, chord);
  }

  // Which of the twelve hues a note wears. Colour and label have to be read off
  // the same thing or they contradict each other: in solfège the label counts
  // from the key, so the colour does too — do wears the R hue, re the 9, mi the
  // 3. Elsewhere both count from the chord's own root, as the viewer does.
  // Nothing to count from — an unparsed name in a mode that needs one — leaves
  // the note plain.
  function colourDegree(semi, chord, mode, key) {
    if (mode === 'solfa' && key) return (semi - key.tonic + 24) % 12;
    return chord ? (semi - chord.root + 24) % 12 : null;
  }

  // ---------- key ----------
  // A sheet can name the song's key on a line of its own — `key: Bb` — which is
  // what solfège is read from and, later, what the staff takes its signature
  // from. It rides in the sheet rather than beside it so a share link carries it
  // for free; in a link the sheet is one line of bars split by |, so the key is
  // read as a segment there too.
  // Stops at a |, so the one-line form a link carries — `key: Bb|@43.50 …` —
  // gives up its key and keeps its bars rather than reading as key all the way
  // to the end of the sheet.
  const KEY_SEGMENT = /^key\s*:\s*([^|]*)$/i;

  // A minor key is kept as the major it shares a signature with: `key: Am` is a
  // C do. That is the la-based reading — in a minor tune the tonic is la, not do
  // — and it is the right key signature either way.
  function parseKeyName(input) {
    const s = String(input || '').trim().replace(/\s+/g, '');
    const m = s.match(/^([A-Ga-g])([#♯b♭]?)(m|min|minor)?$/);
    if (!m) return null;
    const letter = m[1].toUpperCase();
    const sign = m[2] === '#' ? '♯' : m[2] === 'b' ? '♭' : m[2];
    const minor = !!m[3];
    const semi = (ROOT_MAP[letter] + (sign === '♯' ? 1 : sign === '♭' ? -1 : 0) + 12) % 12;
    const flatRoots = minor ? FLAT_NATURAL_MINOR_ROOTS : FLAT_NATURAL_MAJOR_ROOTS;
    return {
      label: letter + (sign === '♯' ? '#' : sign === '♭' ? 'b' : '') + (minor ? 'm' : ''),
      minor,
      tonic: minor ? (semi + 3) % 12 : semi,
      accidental: sign || (flatRoots.has(letter) ? '♭' : '♯'),
    };
  }

  function parseKey(text) {
    for (const line of String(text || '').split('\n')) {
      for (const seg of line.split('|')) {
        const m = seg.trim().match(KEY_SEGMENT);
        const key = m && parseKeyName(m[1]);
        if (key) return key;
      }
    }
    return null;
  }

  // Put a key on a sheet, or take it off with ''. Whatever was there goes first,
  // wherever it was written, so the sheet never ends up naming two keys.
  function withKey(text, label) {
    const body = String(text || '').split('\n')
      .filter(line => !KEY_SEGMENT.test(line.trim()))
      .map(line => line.split('|').filter(seg => !KEY_SEGMENT.test(seg.trim())).join('|'))
      .join('\n');
    if (!label) return body;
    return body ? `key: ${label}\n${body}` : `key: ${label}`;
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

  // A viewer link, as a markdown link or on its own. The label wins over `c=`
  // when there is one — someone who renamed it meant it — and `m=` is the
  // fingering either way.
  function parseViewerLink(text) {
    const link = text.match(MD_LINK);
    const href = link ? link[2] : (/^https?:\/\//i.test(text) ? text : null);
    if (href === null) return null;
    let name = link ? link[1].trim() : '';
    let markers = null;
    try {
      const u = new URL(href, location.href);
      markers = parseMarkers(u.searchParams.get('m'));
      if (!name) name = u.searchParams.get('c') || '';
    } catch (e) {
      // Not a URL after all — a markdown label is still a chord name.
      if (!link) return null;
    }
    return name ? { name, markers } : null;
  }

  function parseChordToken(token) {
    const link = parseViewerLink(token);
    if (link) return link;
    if (MD_LINK.test(token) || /^https?:\/\//i.test(token)) return null;
    const colon = token.indexOf(':');
    if (colon === -1) return { name: token, markers: null };
    return { name: token.slice(0, colon), markers: parseMarkers(token.slice(colon + 1)) };
  }

  // What the editing boxes accept. A chord copied out of Guitar Chord Viewer
  // arrives as `[Eb9](…?c=Eb9&m=.6.6.5..)` — the share button's own format — and
  // pasting that whole thing into either box should fill in both, since going
  // to the viewer to find a shape and bringing it back is the actual workflow.
  function readChord(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    return parseChordToken(s.replace(/\s+/g, ' '));
  }

  // Same, for the fret box: a link pasted there gives up its `m=`, and anything
  // else is read as the six frets it looks like.
  function readMarkers(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    const link = parseViewerLink(s);
    return link ? link.markers : parseMarkers(s);
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
      // `key: Bb` names the song, not a bar of it — parseBar would otherwise
      // read it as a chord called "key".
      const found = line.split('|').map(s => s.trim())
        .filter(s => s && !KEY_SEGMENT.test(s))
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
  function toCompact(bars, sep = '|', key = '') {
    const body = bars.map(bar => {
      const head = bar.start === null
        ? ''
        : `@${bar.start.toFixed(2)}${bar.end === null ? '' : `-${bar.end.toFixed(2)}`} `;
      const chords = bar.chords
        .map(c => (c.markers ? `${c.name}:${markersToText(c.markers)}` : c.name))
        .join(' ');
      return head + chords;
    }).join(sep);
    // First, so the sheet reads as what it is before it reads as where it goes.
    return key ? (body ? `key: ${key}${sep}${body}` : `key: ${key}`) : body;
  }

  // A chord as it is read rather than as it is typed. `b` and `#` are what a
  // keyboard has and ♭ and ♯ are what the music says, so the sheet shows the
  // second while everything written down — the editor, the share link, the
  // viewer's URL — keeps the first and stays typeable.
  // Only where they are accidentals: after the root letter, and in front of a
  // tension number. `Bbm7b5` is B♭m7♭5; the b of a name is left alone.
  function displayName(name) {
    return String(name || '')
      .replace(/^([A-Ga-g])b/, '$1♭')
      .replace(/^([A-Ga-g])#/, '$1♯')
      .replace(/b(\d)/g, '♭$1')
      .replace(/#(\d)/g, '♯$1');
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
  // The frets a guitar marks on its own face — the dots at the 3rd, 5th, 7th
  // and 9th, doubled at the 12th, and the same again an octave up. A player
  // finds a position by these rather than by counting up from the nut, so they
  // are what the numbers over a board name.
  const MARK_FRETS = [3, 5, 7, 9, 12, 15, 17, 19, 21];

  // Where each chord's window falls when the row is read as a row. A shape on
  // its own wants the tightest window round it, and that is what this drew
  // until now — but then a hand moving up two frets between two chords shows as
  // both shapes sitting in the same corner of their boards, and the movement,
  // which is the thing being read, disappears. So neighbours share a window for
  // as long as one window holds them: walking left to right, a chord joins the
  // run it fits in and starts a new one where it does not.
  // Two passes, because a run's left edge is only known once the run is closed
  // — a later chord reaching lower moves it, and the shapes drawn before it
  // would otherwise keep an edge the run no longer has.
  // Open-string-only shapes are left out of it: their board is the nut, wherever
  // the run happens to be, and they neither take a window nor break one.
  function fretWindows(bars, cols) {
    const span = cols || COLS;
    const out = (bars || []).map(bar => (bar.chords || []).map(() => null));
    const runs = [];
    let run = null;
    (bars || []).forEach((bar, b) => (bar.chords || []).forEach((chord, c) => {
      const fretted = (chord.markers || []).filter(f => f !== null && f > 0);
      if (!fretted.length) return;
      const lo = Math.min(...fretted), hi = Math.max(...fretted);
      if (!run || Math.max(run.hi, hi) - Math.min(run.lo, lo) + 1 > span) {
        run = { lo, hi, cells: [] };
        runs.push(run);
      } else {
        run.lo = Math.min(run.lo, lo);
        run.hi = Math.max(run.hi, hi);
      }
      run.cells.push([b, c]);
    }));
    runs.forEach(r => r.cells.forEach(([b, c]) => { out[b][c] = r.lo; }));
    return out;
  }

  // `windowFrom` is what fretWindows decided for this chord, and it is a
  // suggestion only: a shape that will not sit in that window keeps the tight
  // one it has always had rather than being drawn off the edge of its board.
  function diagram(markers, chordName, mode, key, windowFrom) {
    const svg = document.createElementNS(NS, 'svg');
    const picked = markers ? markers.filter(f => f !== null) : [];
    if (!picked.length) {
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      return svg;
    }
    const chord = parseChord(chordName);
    const fretted = picked.filter(f => f > 0);
    const tight = fretted.length ? Math.min(...fretted) : 1;
    const top = fretted.length ? Math.max(...fretted) : tight;
    const shared = typeof windowFrom === 'number' && fretted.length
      && windowFrom >= 1 && windowFrom <= tight && top - windowFrom + 1 <= COLS;
    const from = shared ? windowFrom : tight;
    const cols = Math.max(COLS, top - from + 1);
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

    // Where on the neck this is. The number used to sit over the window's left
    // edge, which is an address the neck itself does not mark — finding it means
    // counting frets. So the numbers go over the marked frets instead, every one
    // the window holds: they land where the eye already looks, and a row of them
    // reads as the neck's own scale. Read from a distance, so they keep a size
    // of their own rather than shrinking to a footnote.
    // Above the 21st there is nothing left to name, and the left edge answers.
    const number = (col, fret) => add('text', {
      x: PAD_L + col * CELL_W + CELL_W / 2, y: 12, fill: '#bbb', 'font-size': 14,
      'text-anchor': 'middle', 'font-family': 'ui-monospace, Menlo, monospace',
      'font-weight': 600,
    }, String(fret));
    let named = false;
    for (let c = 0; c < cols; c++) {
      if (!MARK_FRETS.includes(from + c)) continue;
      number(c, from + c);
      named = true;
    }
    if (!named) number(0, from);

    for (let s = 0; s < 6; s++) {
      const y = PAD_T + s * CELL_H + CELL_H / 2;
      add('line', { x1: PAD_L, y1: y, x2: PAD_L + cols * CELL_W, y2: y, stroke: '#4d4d4d', 'stroke-width': 1 });
    }
    for (let c = 0; c <= cols; c++) {
      const x = PAD_L + c * CELL_W;
      // The nut is the one line on the board that is a landmark rather than a
      // ruling, so it is drawn as one: thicker than the frets and lit brighter
      // than them, since at this size thickness alone in the same grey reads as
      // a smudge rather than as the end of the neck.
      const nut = c === 0 && from === 1;
      add('line', {
        x1: x, y1: PAD_T + CELL_H / 2, x2: x, y2: PAD_T + 5 * CELL_H + CELL_H / 2,
        stroke: nut ? '#9a9a9a' : '#4d4d4d', 'stroke-width': nut ? 4 : 1,
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
      const label = dotLabel(s, f, chord, mode, key);
      const degree = colourDegree((OPEN_STRINGS[s] + f) % 12, chord, mode, key);
      const hue = degree === null ? '#4a7fff' : DEGREE_HUE[degree];
      const open = f === 0;
      const cx = open ? GUTTER_X : PAD_L + (f - from) * CELL_W + CELL_W / 2;
      add('circle', {
        cx, cy: y, r: DOT_R,
        fill: open ? 'none' : hue,
        stroke: open ? hue : 'none', 'stroke-width': 1.5,
      });
      // The dot is 17.6 across, so how large the label can be set depends on how
      // much of it there is: `R` has the room to be read at a glance, `♭13` has
      // to come down or it spills over the edge of the circle it belongs to.
      const fs = label.length > 2 ? 10 : label.length > 1 ? 12 : 13;
      add('text', {
        x: cx, y: y + fs * 0.355,
        fill: DOT_INK,
        'font-size': fs, 'text-anchor': 'middle',
        'font-family': '-apple-system, BlinkMacSystemFont, sans-serif', 'font-weight': 600,
      }, label);
    });
    return svg;
  }

  // ---------- staff ----------
  // The same fingering again, as the notes it actually sounds. Guitar is
  // written an octave above where it sounds, so this is a treble clef read
  // 8vb — which is what puts an open 1st string in the top space instead of
  // three ledger lines above the staff.
  const OPEN_MIDI = [64, 59, 55, 50, 45, 40];   // sounding, 1st string first
  const WRITTEN_8VA = 12;
  const LETTER_STEP = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
  // Staff places are counted in letter-steps from C-1, which makes E4 — the
  // bottom line of the treble staff — 30, and every line above it two more.
  const BOTTOM_LINE = 30, TOP_LINE = 38;

  // One staff space, which every other size here is a multiple of — the staff
  // is 4 of them tall, a notehead a little over 1 of them wide, and a step
  // between two neighbouring places is half of one. So this single number is
  // how large the staff draws.
  const SP = 10;
  const HALF = SP / 2;
  const NOTE_RX = SP * 0.62, NOTE_RY = SP * 0.44;
  const STAFF_PAD = SP;
  // A band above the staff for the chord names. Printed music writes the chord
  // over the bar it sounds in, and the staff is the one place in the strip that
  // does not already say which chord it is drawing — the diagrams above carry
  // their own names, but by the time the eye is on the notes those are a row
  // away.
  const NAME_BAND = SP * 1.6;
  const NAME_SIZE = SP * 1.2;
  // Accidentals are the small print of a staff and were the first thing to go
  // unreadable, so they are sized against the staff rather than left at
  // whatever a note-sized glyph happens to be.
  const SIGN_SIZE = SP * 2.1;
  // Where a chord's notes sit inside its cell: at the beat it starts on, with
  // room in front for an accidental.
  const NOTE_INSET = 17;

  // A written pitch as a place on the staff and the sign in front of it. Which
  // of the two names it goes by is the key's business: in B♭ it is A♭, never G♯.
  function staffNote(midi, flat, signed) {
    const pc = ((midi % 12) + 12) % 12;
    const name = flat ? NOTES_FLAT[pc] : NOTES_SHARP[pc];
    const letter = LETTER_STEP[name[0]];
    const own = name.length > 1 ? name[1] : '';
    const bySignature = (signed && signed[letter]) || '';
    // What the signature has already said is not said again — a ♭ written on a
    // letter the signature already flattens reads as a change, not as agreement.
    // The other way round it has to be cancelled out loud: where the signature
    // alters a letter and this note does not want it, the natural is the only
    // thing separating E♮ from the E♭ the signature would otherwise give.
    const sign = own === bySignature ? '' : (own || '♮');
    return {
      pc,
      step: (Math.floor(midi / 12) - 1) * 7 + letter,
      sign,
    };
  }

  function writtenPitches(markers) {
    if (!markers) return [];
    const out = [];
    markers.forEach((f, s) => {
      if (f !== null) out.push(OPEN_MIDI[s] + f + WRITTEN_8VA);
    });
    return out.sort((a, b) => a - b);
  }

  // Without a key the chord spells itself, the same rule the diagram's note
  // names follow; with one, the key decides for the whole sheet.
  function spellsFlat(chordName, key) {
    if (key) return key.accidental === '♭';
    const chord = parseChord(chordName);
    return !!chord && accidentalFor(chord) === '♭';
  }

  // What one chord puts on the staff, ready to draw. The parse comes back with
  // it because the colours are read off the chord as well as the notes.
  function staffChord(name, markers, key) {
    const flat = spellsFlat(name, key);
    const signed = signedLetters(key);
    return {
      chord: parseChord(name),
      notes: writtenPitches(markers).map(m => staffNote(m, flat, signed)),
    };
  }

  // Which letters the key signature has already altered, and which way. Indexed
  // by letter-step (C=0 … B=6), the same numbering the staff places count in,
  // so a note can be asked about its own letter alone.
  function signedLetters(key) {
    const sig = signature(key);
    const out = {};
    for (const step of sig.steps) out[step % 7] = sig.sign;
    return out;
  }

  // The key signature, in the order and on the places every printed staff puts
  // it: sharps from F upwards, flats from B downwards.
  const SHARP_STEPS = [38, 35, 39, 36, 33, 37, 34];   // F5 C5 G5 D5 A4 E5 B4
  const FLAT_STEPS  = [34, 37, 33, 36, 32, 35, 31];   // B4 E5 A4 D5 G4 C5 F4
  const SHARP_COUNT = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: 7 };
  const FLAT_COUNT  = { 0: 0, 5: 1, 10: 2, 3: 3, 8: 4, 1: 5, 6: 6, 11: 7 };

  // Which way a key is written, and how many. A key kept as its relative major
  // is the same signature either way, which is the other reason to store it so.
  function signature(key) {
    if (!key) return { sign: '', steps: [] };
    const flat = key.accidental === '♭';
    const count = (flat ? FLAT_COUNT : SHARP_COUNT)[key.tonic];
    if (count !== undefined) {
      return { sign: flat ? '♭' : '♯', steps: (flat ? FLAT_STEPS : SHARP_STEPS).slice(0, count) };
    }
    // A key spelled the way the other side of the circle writes it — take the
    // signature that exists rather than none at all.
    const other = (flat ? SHARP_COUNT : FLAT_COUNT)[key.tonic];
    if (other === undefined) return { sign: '', steps: [] };
    return {
      sign: flat ? '♯' : '♭',
      steps: (flat ? SHARP_STEPS : FLAT_STEPS).slice(0, other),
    };
  }

  // How far the staff has to reach to hold a whole sheet. Every bar is drawn to
  // the same reach, so the five lines meet across the sheet rather than
  // stepping up and down with whatever each bar happens to hold. The signature
  // counts too: a sharp sits above the top line and would be cropped otherwise.
  function staffRange(bars, key) {
    let top = TOP_LINE, bottom = BOTTOM_LINE, any = false;
    for (const bar of bars) {
      for (const chord of bar.chords) {
        for (const n of staffChord(chord.name, chord.markers, key).notes) {
          top = Math.max(top, n.step);
          bottom = Math.min(bottom, n.step);
          any = true;
        }
      }
    }
    if (!any) return null;
    for (const step of signature(key).steps) {
      top = Math.max(top, step);
      bottom = Math.min(bottom, step);
    }
    return { top, bottom };
  }

  // A blank stretch of staff, its five lines drawn across the whole width, plus
  // the two things everything else on it needs: somewhere to put an element and
  // the height of a given place. Every stretch is measured from the same reach,
  // which is what makes them line up when they are butted together.
  function staffCanvas(width, range) {
    const svg = document.createElementNS(NS, 'svg');
    const yBottom = NAME_BAND + STAFF_PAD + (range.top - BOTTOM_LINE) * HALF;
    const h = yBottom + (BOTTOM_LINE - range.bottom) * HALF + STAFF_PAD;
    const y = step => yBottom - (step - BOTTOM_LINE) * HALF;

    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(h));
    svg.setAttribute('viewBox', `0 0 ${width} ${h}`);
    svg.setAttribute('aria-hidden', 'true');
    const add = (tag, attrs, text) => {
      const el = document.createElementNS(NS, tag);
      for (const k in attrs) el.setAttribute(k, String(attrs[k]));
      if (text !== undefined) el.textContent = text;
      svg.appendChild(el);
      return el;
    };
    for (let s = BOTTOM_LINE; s <= TOP_LINE; s += 2) {
      add('line', {
        x1: 0, y1: y(s), x2: width, y2: y(s), stroke: '#4d4d4d', 'stroke-width': 1,
      });
    }
    return { svg, add, y };
  }

  // ---------- the head of the staff ----------
  // Clef and key signature, in their own stretch at the far left of the sheet
  // where printed music puts them. Drawn as a stretch of its own rather than
  // inside the first bar: sharing a bar means sharing the room its first chord
  // needs, and the two collided.
  const CLEF_SIZE = SP * 4.4;
  const CLEF_W = SP * 3;
  const SIG_STEP = SP * 0.95;
  const HEAD_LEFT = SP * 0.4;
  // Centring a ♭ or ♯ glyph on its place leaves it reading high — the ink of
  // both sits above the middle of the box they are drawn in — so the signature
  // is dropped by a fraction of its own size to land on the line it names.
  const SIG_DROP = 0.02;

  function staffHeadWidth(key) {
    return HEAD_LEFT + CLEF_W + signature(key).steps.length * SIG_STEP + SP * 0.8;
  }

  function staffHead(range, key) {
    if (!range) {
      const empty = document.createElementNS(NS, 'svg');
      empty.setAttribute('width', '0');
      empty.setAttribute('height', '0');
      return empty;
    }
    const width = staffHeadWidth(key);
    const { svg, add, y } = staffCanvas(width, range);
    // The G of the G clef is the line its curl sits on, which is why the glyph
    // hangs below the staff as far as it does.
    add('text', {
      x: HEAD_LEFT, y: y(BOTTOM_LINE) + SP * 0.9, fill: '#9a9a9a', 'font-size': CLEF_SIZE,
      'font-family': '"Noto Music", "Apple Symbols", "Segoe UI Symbol", serif',
    }, '𝄞');
    const sig = signature(key);
    sig.steps.forEach((step, i) => {
      add('text', {
        x: HEAD_LEFT + CLEF_W + i * SIG_STEP, y: y(step) + SIGN_SIZE * SIG_DROP,
        fill: '#9a9a9a', 'font-size': SIGN_SIZE, 'dominant-baseline': 'central',
        'font-family': '-apple-system, BlinkMacSystemFont, sans-serif',
      }, sig.sign);
    });
    return svg;
  }

  // One bar's stretch of staff. Bars are drawn separately and butt against each
  // other, so the 2px rule between them reads as the bar line it already is.
  // `items` is [{ x, name, markers }], x measured from this bar's left edge.
  // Every altered note carries its own sign even though the signature says so
  // too: the row scrolls, and a signature that has slid off the left is no help
  // reading what is under the playhead now.
  function staffBar(items, width, range, key, mode) {
    if (!range || width <= 0) {
      const empty = document.createElementNS(NS, 'svg');
      empty.setAttribute('width', '0');
      empty.setAttribute('height', '0');
      return empty;
    }
    const { svg, add, y } = staffCanvas(width, range);

    // The names, over the beats they start on. A chord held across two beats is
    // written once and read as still sounding — repeating it says it was struck
    // again, which is a different bar. The run is only followed within the bar:
    // a new bar restates what it is playing, as printed music does.
    let held = null;
    for (const item of items) {
      if (item.name === held) continue;
      held = item.name;
      add('text', {
        x: item.x + NOTE_INSET - NOTE_RX, y: NAME_BAND,
        fill: '#ddd', 'font-size': NAME_SIZE, 'text-anchor': 'start',
        'font-family': '-apple-system, BlinkMacSystemFont, sans-serif', 'font-weight': 600,
      }, displayName(item.name));
    }

    for (const item of items) {
      const { chord, notes } = staffChord(item.name, item.markers, key);
      // Two notes a step apart cannot share a column — the heads would sit on
      // top of each other — so the upper one moves to the right of the stack,
      // which is what engraving does with a second.
      let prevStep = null, side = 0;
      const placed = notes.map(n => {
        side = prevStep !== null && n.step - prevStep === 1 ? 1 - side : 0;
        prevStep = n.step;
        return { n, x: item.x + NOTE_INSET + side * NOTE_RX * 2 };
      });

      const ledgers = new Set();
      const ledger = (s, x) => {
        const at = `${s}@${x}`;
        if (ledgers.has(at)) return;
        ledgers.add(at);
        // A ledger line is read against the note sitting on it, not against the
        // staff, so it is drawn heavier and lighter than the five lines are: at
        // this size, one grey thread the width of the note head simply vanished
        // under it. Reaching well past the head on both sides is also what says
        // it is a line the note is on rather than a mark the note carries.
        add('line', {
          x1: x - NOTE_RX - 6, y1: y(s), x2: x + NOTE_RX + 6, y2: y(s),
          stroke: '#8a8a8a', 'stroke-width': 1.4,
        });
      };

      let lastSign = null;
      for (const { n, x } of placed) {
        for (let s = TOP_LINE + 2; s <= n.step; s += 2) ledger(s, x);
        for (let s = BOTTOM_LINE - 2; s >= n.step; s -= 2) ledger(s, x);
        if (n.sign) {
          // Two signs a step or two apart would collide, so the second of them
          // hangs further out.
          const near = lastSign !== null && n.step - lastSign <= 2;
          // A ♭ marks its pitch with the bowl at the bottom of the glyph, not
          // with its middle, so centring it on the note puts it a touch low.
          const dy = n.sign === '♭' ? -SIGN_SIZE * 0.17 : 0;
          add('text', {
            x: x - NOTE_RX - 4 - (near ? SIGN_SIZE * 0.62 : 0), y: y(n.step) + dy,
            fill: '#9a9a9a', 'font-size': SIGN_SIZE, 'text-anchor': 'end',
            'dominant-baseline': 'central',
            'font-family': '-apple-system, BlinkMacSystemFont, sans-serif',
          }, n.sign);
          lastSign = near ? lastSign : n.step;
        }
        // The same hue the dot for this note wears in the diagram above it, so
        // the two readings of one chord are tied together by colour.
        const degree = colourDegree(n.pc, chord, mode, key);
        add('ellipse', {
          cx: x, cy: y(n.step), rx: NOTE_RX, ry: NOTE_RY,
          fill: degree === null ? '#dcdcdc' : DEGREE_HUE[degree],
        });
      }
    }
    return svg;
  }

  return {
    parseSheet, resolveSpans, chordTimes, slotWeights, toCompact, viewerUrl, diagram, fretWindows,
    readChord, readMarkers, markersToText, parseKey, parseKeyName, withKey, displayName,
    staffRange, staffBar, staffHead, staffHeadWidth,
  };
})();
