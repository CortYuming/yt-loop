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
    return pitchLabel((OPEN_STRINGS[stringIdx] + fret) % 12, chord, mode, key);
  }

  // The same label for a pitch reached any other way — a note on the staff, say,
  // which knows what it sounds and not which string it was played on. With no
  // chord to count from there is only its name, which is what the board falls
  // back to as well.
  function pitchLabel(semi, chord, mode, key) {
    if (!chord) return NOTES_SHARP[semi];
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

  // ---------- single notes ----------
  // A chord can be followed by the notes actually played over it: `6/7:8` is
  // the 6th string at the 7th fret, an eighth long. What a note is worth is
  // written as the number printed music calls it by — 4 a quarter, 8 an eighth,
  // a trailing dot half again as long — and left off when it is the same as the
  // note before, which is what a run of eighths mostly is.
  // Where a note falls is never written: positions come from the durations
  // stacked up from the start of the chord's stretch. Typing both is typing the
  // same thing twice, and the two disagree the moment a duration is changed.
  const DUR_BY_TEXT = { 1: 4, 2: 2, 4: 1, 8: 0.5, 16: 0.25, 32: 0.125 };
  // A note, the name of the chord it starts if it starts one, and how long it is:
  // `1/5+2/6+3/9(Eb9):4`. The name belongs to the stop rather than to a stretch of
  // the bar, so a chord can begin wherever a note does.
  const NOTE_TOKEN = /^((?:[1-6]\/\d{1,2}(?:\+[1-6]\/\d{1,2})*)|r|_)(?:\(([^)]*)\))?(?::(\d{1,2}[.t]?))?$/;
  // Long enough to be the whole of a bar, short enough to still be a note.
  const DEFAULT_DUR = 0.5;

  // `t` is three in the time of two: `8t` is a triplet eighth, a third of a beat.
  // A dot and a t are the two ways a written value is bent, and a note carries at
  // most one of them — nobody writes `8.t`.
  const TRIPLET = 2 / 3;
  function parseDur(text) {
    const m = /^(\d{1,2})([.t]?)$/.exec(String(text || ''));
    if (!m) return null;
    const base = DUR_BY_TEXT[Number(m[1])];
    if (!base) return null;
    if (m[2] === '.') return base * 1.5;
    if (m[2] === 't') return base * TRIPLET;
    return base;
  }

  // A third of a beat has no exact double, so durations are compared as near
  // enough rather than equal from here on.
  const sameDur = (a, b) => Math.abs(a - b) < 1e-9;
  function durText(d) {
    for (const k of Object.keys(DUR_BY_TEXT)) {
      if (sameDur(DUR_BY_TEXT[k], d)) return k;
      if (sameDur(DUR_BY_TEXT[k] * 1.5, d)) return `${k}.`;
      if (sameDur(DUR_BY_TEXT[k] * TRIPLET, d)) return `${k}t`;
    }
    return null;
  }

  // The written value a duration is a triplet of, or 0 if it is not one.
  function tripletBase(d) {
    for (const k of Object.keys(DUR_BY_TEXT)) {
      if (sameDur(DUR_BY_TEXT[k] * TRIPLET, d)) return DUR_BY_TEXT[k];
    }
    return 0;
  }
  const isTripletDur = d => tripletBase(d) !== 0;

  // `r` is a rest and `_` holds the note before it on — which is also how a
  // note carries over a bar line, since the tie is simply the first thing in
  // the next bar and the pitch is not written again.
  function parseNoteToken(token, lastDur) {
    const m = NOTE_TOKEN.exec(String(token));
    if (!m) return null;
    const [, body, named, durText] = m;
    // `:0` is no length at all: the note sounds until the next one, the way a
    // chord does. It says out loud what a bare stop can only say when it is
    // alone in its stretch — see markFreeNotes — so a fingering keeps its
    // meaning with a phrase written after it.
    const free = durText === '0';
    const written = durText !== undefined && !free;
    const d = written ? parseDur(durText) : null;
    if (written && d === null) return null;
    const dur = d !== null ? d : (lastDur !== null ? lastDur : DEFAULT_DUR);
    if (body === 'r') return { d: dur, rest: true, stops: [] };
    if (body === '_') return { d: dur, tie: true, stops: [] };
    const stops = body.split('+').map(part => {
      const [str, fret] = part.split('/');
      return { string: Number(str), fret: Number(fret) };
    });
    // A fret past the end of the neck is a typo, not a note.
    if (stops.some(st => st.fret > 22)) return null;
    // Whether the duration was written matters later — see markFreeNotes.
    const ev = { d: dur, stops, noDur: !written && !free };
    if (free) ev.free = true;
    // A name on a rest or a tie has nothing to hold it, so only a struck note
    // carries one.
    const name = (named || '').trim();
    if (name) ev.name = name;
    return ev;
  }

  // The name in force at each note of a stretch. A name written on a note is a
  // chord change there — the harmony from that note on — so what follows is read
  // against it, and the stretch's own name rules only up to it.
  function rulingNames(item) {
    let ruling = (item && item.name) || '';
    return ((item && item.notes) || []).map(ev => {
      if (ev.name) ruling = ev.name;
      return ruling;
    });
  }

  // The notes of one chord's stretch as text, leaving out every duration that
  // repeats the one before it.
  function notesToText(notes) {
    let last = null;
    // A stop left bare reads back as having no length only where it is the whole
    // of the stretch — see markFreeNotes. Anywhere else a bare stop takes the
    // duration of the run around it, so there the lack of one is written out.
    const alone = (notes || []).length === 1;
    return (notes || []).map(ev => {
      const body = (ev.tie ? '_'
        : ev.rest ? 'r'
        : ev.stops.map(st => `${st.string}/${st.fret}`).join('+'))
        + (ev.name ? `(${ev.name})` : '');
      // A note with no duration of its own goes back the way it came, and leaves
      // the run's duration where it was for whatever follows.
      if (ev.free) return alone ? body : `${body}:0`;
      const d = ev.d === last ? '' : `:${durText(ev.d) || '4'}`;
      last = ev.d;
      return body + d;
    }).join(' ');
  }

  // A stop with more than one string in it is a shape — the same thing a chord
  // is, arrived at from the other side — so it is drawn the way a chord is, off
  // markers built from the strings it names. Strings it does not name are not
  // played and carry nothing.
  function stopsToMarkers(stops) {
    const markers = [null, null, null, null, null, null];
    for (const st of stops || []) {
      if (st.string >= 1 && st.string <= 6) markers[st.string - 1] = st.fret;
    }
    return markers;
  }

  // The shapes in a stretch, each with the beat it falls on: every event that
  // strikes more than one string at once.
  function stopShapes(notes, stretchName) {
    const ruling = rulingNames({ name: stretchName, notes });
    return noteBeats(notes).items
      .filter(it => it.ev.stops && it.ev.stops.length > 1)
      .map(it => ({
        markers: stopsToMarkers(it.ev.stops), beat: it.beat, index: it.index,
        // The name this shape is read against, and whether it is the shape that
        // names it — a diagram writes its name only where the name changes.
        name: ruling[it.index] || '', names: !!it.ev.name,
      }));
  }

  // Where each note of a stretch begins, in beats from the start of it, and how
  // far the lot of them reach.
  function noteBeats(notes) {
    let at = 0;
    const out = (notes || []).map((ev, index) => {
      const b = at;
      at += ev.free ? 0 : ev.d;
      return { ev, beat: b, index };
    });
    return { items: out, length: at };
  }

  // A stretch holding one struck note with no duration written on it is read the
  // way a chord is: sounding until the next one, with no note value of its own.
  // That is what a fingering written as a stop means — `Bb9 1/1+2/1+3/1+4/0` is
  // the chord, not a quarter of it — and it is drawn as a chord's notes are, as
  // heads with no stem. Write a duration on it and it is a note again.
  // Only when it is alone in the stretch: a stop in a run of eighths leaves its
  // duration off in order to inherit the run's, which is the other and much more
  // common reason one goes unwritten.
  function markFreeNotes(bar) {
    for (const chord of bar.chords) {
      const notes = chord.notes;
      if (notes && notes.length === 1 && notes[0].noDur && notes[0].stops.length) {
        notes[0].free = true;
      }
    }
  }

  function parseBar(barText) {
    const bar = { start: null, end: null, chords: [] };
    const tokens = barText.match(TOKEN) || [];
    // Durations carry across a chord change within a bar: a run of eighths
    // written over two chords is one run to whoever wrote it.
    let lastDur = null;
    for (const token of tokens) {
      if (token[0] === '@') {
        const t = parseBarTime(token);
        if (t) { bar.start = t.start; bar.end = t.end; }
        continue;
      }
      // Notes belong to the chord in front of them. A phrase written with no
      // chord over it gets a nameless one to hang from — the sheet is then a
      // line of music with nothing said about the harmony, which is a perfectly
      // ordinary thing to write down.
      const note = parseNoteToken(token, lastDur);
      if (note) {
        // A note with no length of its own is not what the run is measured by:
        // the eighths on either side of a chord are one run.
        if (!note.free) lastDur = note.d;
        let target = bar.chords[bar.chords.length - 1];
        if (!target) { target = { name: '', markers: null }; bar.chords.push(target); }
        (target.notes = target.notes || []).push(note);
        continue;
      }
      const chord = parseChordToken(token);
      if (chord) bar.chords.push(chord);
    }
    markFreeNotes(bar);
    // A bar of its own time and nothing else: one put between two others and not
    // written into yet. It keeps an empty stretch so there is somewhere to write.
    if (!bar.chords.length && bar.start !== null) bar.chords.push({ name: '', markers: null });
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
        .map(c => {
          const head = c.markers ? `${c.name}:${markersToText(c.markers)}` : c.name;
          if (!c.notes || !c.notes.length) return head;
          const played = notesToText(c.notes);
          return head ? `${head} ${played}` : played;
        })
        .join(' ');
      return (head + chords).trim();
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

  // Every drawing here is the same two things: a box of a given size, and a way
  // to put shapes in it. `parent` is for the odd group that holds a few of them
  // together — everything else lands in the box itself.
  function svgAdder(svg) {
    return (tag, attrs, text, parent) => {
      const el = document.createElementNS(NS, tag);
      for (const k in attrs) el.setAttribute(k, String(attrs[k]));
      if (text !== undefined) el.textContent = text;
      (parent || svg).appendChild(el);
      return el;
    };
  }

  function svgCanvas(w, h, attrs) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    for (const k in (attrs || {})) svg.setAttribute(k, String(attrs[k]));
    return { svg, add: svgAdder(svg) };
  }
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
      // Shapes written as notes are drawn in the same row as the chords and read
      // across it the same way, so they belong to the run whose window is being
      // settled — leaving them out let a diagram beside one of them jump.
      const fretted = [
        ...(chord.markers || []),
        ...stopShapes(chord.notes).flatMap(sh => sh.markers),
      ].filter(f => f !== null && f > 0);
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
    const picked = markers ? markers.filter(f => f !== null) : [];
    if (!picked.length) {
      const empty = document.createElementNS(NS, 'svg');
      empty.setAttribute('width', '0');
      empty.setAttribute('height', '0');
      return empty;
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
    const { svg, add } = svgCanvas(w, h,
      { role: 'img', 'aria-label': `${chordName} fingering` });

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
      // A string with no dot on it is a string not played, which is all the ×
      // ever said. Saying it twice matters less than saying it the same way
      // everywhere: a shape written as notes names the strings it strikes and
      // nothing else, so marking the rest would put a × on the four idle strings
      // of a double stop and call them muted, which is not what they are.
      if (f === null) return;
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
  // The middle line, which is what decides a stem's direction: a note above it
  // hangs its stem down, one below it sends it up.
  const MID_LINE = 34;
  // Beats to a bar. Notes are placed from this rather than from the cells above
  // them — a cell is as wide as its chord's share of the bar, while the notes
  // inside it move at the beat.
  const BEATS_PER_BAR = 4;

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
  // The band and the name in it are sized to the names in the diagram row above,
  // so the same chord is the same size wherever the eye lands on it — the staff's
  // own name was two thirds of that and read as a caption.
  const NAME_BAND = SP * 2.1;
  // A row of labelled dots over the staff, read the way the diagrams are: same
  // hues, same words, one per note struck. Stacked upwards where a chord is
  // struck, so the row is as tall as the thickest chord in the sheet.
  // The dot the diagrams draw, drawn here: same radius, same ink, and the same
  // rule for how large the word inside it is set — anything smaller reads as a
  // different kind of thing and has to be squinted at.
  const LABEL_R = DOT_R;
  const LABEL_GAP = SP * 0.22;
  const labelSize = label => (label.length > 2 ? 10 : label.length > 1 ? 12 : 13);
  // What has to fit between the dots and the highest note: a stem at full
  // stretch, and the 3 a triplet wears above its beam.
  const LABEL_CLEAR = SP * 4.4;
  const labelBandHeight = stack => (stack
    ? stack * LABEL_R * 2 + (stack - 1) * LABEL_GAP + SP * 0.5
    : 0);
  const NAME_SIZE = SP * 1.6;
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

  // One stopped string as a place on the staff. The same spelling rules as a
  // chord's own notes: the key decides, and without one the chord does.
  function stopNote(stop, chordName, key) {
    const midi = OPEN_MIDI[stop.string - 1] + stop.fret + WRITTEN_8VA;
    const note = staffNote(midi, spellsFlat(chordName, key), signedLetters(key));
    return { step: note.step, sign: note.sign, pc: note.pc, string: stop.string, fret: stop.fret };
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
  // How far the staff has to reach to hold anything the neck can play. What the
  // board reserves while notes are being tapped: measured from the sheet, the
  // staff grows the first time a note goes higher than any before it, and the
  // row growing slides the board out from under the hand writing on it.
  let neckReach = null;
  function neckRange(key) {
    const name = key ? key.name || '' : '';
    if (neckReach && neckReach.for === name) return neckReach;
    let top = TOP_LINE, bottom = BOTTOM_LINE;
    for (let string = 1; string <= 6; string++) {
      for (let fret = 0; fret <= BOARD_FRETS; fret++) {
        const { step } = stopNote({ string, fret }, '', key);
        top = Math.max(top, step);
        bottom = Math.min(bottom, step);
      }
    }
    neckReach = { for: name, top, bottom };
    return neckReach;
  }

  // `floor` draws the bare five lines whatever the sheet holds, for editing: a
  // staff appearing the moment the first note lands moves everything under it.
  // `'neck'` reserves the whole neck's reach, so tapping notes never moves it.
  function staffRange(bars, key, floor) {
    let top = TOP_LINE, bottom = BOTTOM_LINE, any = !!floor;
    if (floor === 'neck') {
      const neck = neckRange(key);
      top = neck.top;
      bottom = neck.bottom;
    }
    const reach = step => {
      top = Math.max(top, step);
      bottom = Math.min(bottom, step);
      any = true;
    };
    // How many dots the label row has to stack: the most notes struck at once
    // anywhere in the sheet. Measured over the whole sheet rather than per bar,
    // since every bar's staff is drawn to one height or they do not line up.
    let stack = 0;
    for (const bar of bars) {
      for (const chord of bar.chords) {
        for (const n of staffChord(chord.name, chord.markers, key).notes) reach(n.step);
        for (const ev of chord.notes || []) {
          for (const st of ev.stops) reach(stopNote(st, chord.name, key).step);
          if (!ev.rest && !ev.tie && ev.stops.length) {
            stack = Math.max(stack, ev.stops.length);
          }
        }
      }
    }
    if (!any) return null;
    for (const step of signature(key).steps) {
      top = Math.max(top, step);
      bottom = Math.min(bottom, step);
    }
    return { top, bottom, stack };
  }

  // A blank stretch of staff, its five lines drawn across the whole width, plus
  // the two things everything else on it needs: somewhere to put an element and
  // the height of a given place. Every stretch is measured from the same reach,
  // which is what makes them line up when they are butted together.
  function staffCanvas(width, range) {
    const band = labelBandHeight(range.stack || 0);
    // The gap under the dots is what keeps them off the music: a stem reaching up
    // from the highest note, and the mark a triplet wears above its beam, both
    // land inside it rather than in the row of dots.
    const above = band ? Math.max(STAFF_PAD, LABEL_CLEAR) : STAFF_PAD;
    const yBottom = NAME_BAND + band + above + (range.top - BOTTOM_LINE) * HALF;
    const h = yBottom + (BOTTOM_LINE - range.bottom) * HALF + STAFF_PAD;
    const y = step => yBottom - (step - BOTTOM_LINE) * HALF;
    // The nth dot of one chord, counted from the bottom of the row — one note
    // alone sits at the bottom, nearest the staff, wherever it is in the sheet.
    const labelY = n => NAME_BAND + band - SP * 0.25 - LABEL_R
      - n * (LABEL_R * 2 + LABEL_GAP);

    const { svg, add } = svgCanvas(width, h, { 'aria-hidden': 'true' });
    for (let s = BOTTOM_LINE; s <= TOP_LINE; s += 2) {
      add('line', {
        x1: 0, y1: y(s), x2: width, y2: y(s), stroke: '#4d4d4d', 'stroke-width': 1,
      });
    }
    return { svg, add, y, labelY, hasLabels: band > 0 };
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
  // ---------- note shapes ----------
  // Heads, stems, flags, beams and rests, drawn rather than set in a music font:
  // the code points for these are blank on most systems, and a blank where a
  // note should be reads as a fault in the sheet rather than a missing glyph.
  const STEM_LEN = SP * 3.4;
  // A beam is about a third of a staff space thick with a little more than that
  // between two of them: thicker and a pair of sixteenth beams closes into one
  // block, which is exactly the eighth it has to be told apart from.
  const BEAM_W = SP * 0.34;
  const BEAM_GAP = SP * 0.72;

  // How many beams or flags a duration carries. A dotted note carries what the
  // note it is a dot on carries.
  function beamCount(d) {
    const plain = tripletBase(d) || d / (isDottedDur(d) ? 1.5 : 1);
    if (plain >= 1) return 0;
    if (plain >= 0.5) return 1;
    if (plain >= 0.25) return 2;
    return 3;
  }
  function isDottedDur(d) {
    return d === 3 || d === 1.5 || d === 0.75 || d === 0.375;
  }

  // A rest at the middle of the staff, near enough to read at this size: the
  // quarter as its zigzag, the shorter ones as a slash with that many hooks,
  // the longer ones as the blocks they are.
  function drawRest(add, x, yMid, d, ink) {
    ink = ink || '#c8c8c8';
    if (d >= 2) {
      add('rect', {
        x: x - SP * 0.7, y: d >= 4 ? yMid - SP * 0.5 : yMid, width: SP * 1.4, height: SP * 0.5,
        fill: ink,
      });
      return;
    }
    if (d >= 1) {
      add('path', {
        d: `M${x - SP * 0.3} ${yMid - SP * 1.1} l ${SP * 0.5} ${SP * 0.7}`
          + ` l ${-SP * 0.5} ${SP * 0.5} l ${SP * 0.6} ${SP * 0.9}`,
        fill: 'none', stroke: ink, 'stroke-width': SP * 0.24,
      });
      return;
    }
    const hooks = beamCount(d);
    add('line', {
      x1: x + SP * 0.45, y1: yMid - SP * 0.9, x2: x - SP * 0.4, y2: yMid + SP * 0.9,
      stroke: ink, 'stroke-width': SP * 0.2,
    });
    for (let i = 0; i < hooks; i++) {
      const y = yMid - SP * 0.8 + i * SP * 0.7;
      add('circle', { cx: x - SP * 0.3, cy: y, r: SP * 0.24, fill: ink });
      add('path', {
        d: `M${x - SP * 0.3} ${y} q ${SP * 0.6} ${SP * 0.1} ${SP * 0.7} ${SP * 0.5}`,
        fill: 'none', stroke: ink, 'stroke-width': SP * 0.18,
      });
    }
  }

  // One bar's stretch of staff. Bars are drawn separately and butt against each
  // other, so the 2px rule between them reads as the bar line it already is.
  // `items` is [{ x, name, markers, notes }], x measured from this bar's left
  // edge. A chord with `notes` is drawn as the phrase played over it — heads at
  // the beats their durations put them on — and one without as the notes its
  // fingering sounds, all struck together on the beat it starts.
  // Every altered note carries its own sign even though the signature says so
  // too: the row scrolls, and a signature that has slid off the left is no help
  // reading what is under the playhead now.
  // The notes are clickable, which is how one is picked out for editing. The
  // whole column counts, not just the head: at this size a note head is a 12px
  // target and the fret number under it is another, while what the eye is
  // aiming at is the moment they share. The staff and the tab beneath it are
  // two views of the same moments, so they are covered the same way.
  function addNoteHits(add, hits, height) {
    for (const hit of hits) {
      const box = add('rect', {
        class: 'staff-hit' + (hit.on ? ' on' : '') + (hit.after ? ' after' : ''),
        x: hit.x - 13, y: 0,
        width: 26, height, rx: 4, fill: 'transparent',
      });
      box.dataset.chord = String(hit.chord);
      box.dataset.note = String(hit.note);
    }
  }

  // More written than the bar has room for: the spacing is squeezed until the
  // last note lands inside the bar rather than past its end, where the next bar
  // is already drawn. Measured per stretch — each starts at its own place in the
  // bar — and the tightest of them sets the pace for the whole bar, so the staff
  // and the tab under it stay note for note above one another.
  function beatFit(items, width, beat) {
    let scale = 1;
    for (const item of items) {
      if (!item.notes || !item.notes.length) continue;
      const { length } = noteBeats(item.notes);
      if (length <= 0) continue;
      const room = width - (item.x + NOTE_INSET) - NOTE_RX * 2;
      if (room <= 0) continue;
      scale = Math.min(scale, room / (length * beat));
    }
    // Never wider than the beat it was given: a bar with room to spare keeps the
    // even pace it shares with every other bar in the row.
    return Math.max(Math.min(scale, 1), 0.05);
  }

  // Somewhere to press in a stretch, under everything drawn in it: the width it
  // holds in the bar. Pressing an empty stretch is how the board is opened on
  // one — it has no note to press and no shape either, and the ♪ in the cell
  // above is a long way from the staff being read.
  function addSlots(add, items, width, height) {
    items.forEach((item, index) => {
      const next = items[index + 1];
      const to = next ? next.x : width;
      const box = add('rect', {
        class: 'staff-slot', x: item.x, y: 0,
        width: Math.max(0, to - item.x), height, fill: 'transparent',
      });
      box.dataset.slot = String(index);
    });
  }

  // Where writing starts in a stretch with nothing written in it. One is drawn
  // for every stretch and lit for the one the board is open on, so the mark can
  // be moved by turning a class on and off instead of drawing the row again.
  function addCarets(add, items, height) {
    items.forEach((item, index) => {
      const box = add('rect', {
        class: 'staff-caret' + (item.caret ? ' on' : ''),
        x: item.x + NOTE_INSET - 13, y: 0, width: 26, height, rx: 4,
        fill: 'none', 'pointer-events': 'none',
      });
      box.dataset.caret = String(index);
    });
  }

  function staffBar(items, width, range, key, mode, beatWidth) {
    if (!range || width <= 0) {
      const empty = document.createElementNS(NS, 'svg');
      empty.setAttribute('width', '0');
      empty.setAttribute('height', '0');
      return empty;
    }
    const { svg, add, y, labelY, hasLabels } = staffCanvas(width, range);
    const paced = beatWidth || width / BEATS_PER_BAR;
    const beat = paced * beatFit(items, width, paced);

    // The names, over the beats they start on. A chord held across two beats is
    // written once and read as still sounding — repeating it says it was struck
    // again, which is a different bar. The run is only followed within the bar:
    // a new bar restates what it is playing, as printed music does.
    let held = null;
    for (const item of items) {
      // A stretch names itself at its head; a note inside it that carries a name
      // names itself where it falls, which is what a chord changing mid-stretch
      // looks like on paper.
      const marks = [{ x: item.x, name: item.name || '', note: null }];
      for (const p of noteBeats(item.notes).items) {
        if (p.ev.name) marks.push({ x: item.x + p.beat * beat, name: p.ev.name, note: p.index });
      }
      for (const mark of marks) {
        if (mark.name === held) continue;
        held = mark.name;
        if (!mark.name) continue;
        // A name says which chord it is and where it is written, so the strip can
        // hand a press on it to the viewer — and say which note is carrying it,
        // for the box that writes it.
        add('text', {
          x: mark.x + NOTE_INSET - NOTE_RX, y: NAME_BAND, class: 'staff-name',
          'data-chord': item.chord === undefined ? '' : String(item.chord),
          'data-note': mark.note === null ? '' : String(mark.note),
          'data-name': mark.name,
          fill: '#ddd', 'font-size': NAME_SIZE, 'text-anchor': 'start',
          'font-family': '-apple-system, BlinkMacSystemFont, sans-serif', 'font-weight': 600,
        }, displayName(mark.name));
      }
    }

    // Ledger lines are shared: two notes on the same line at the same place get
    // one line between them, not two on top of each other.
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

    // The dots over the staff: what the diagrams say about a chord, said about
    // the notes played over it. One per note struck, stacked upward where more
    // than one is, in the hue and the wording the board uses — so a phrase can be
    // read as degrees, names or solfège without leaving the staff.
    // An octave of a note already in the chord says nothing the first one did
    // not, so it is not printed twice.
    const drawLabels = (notes, x, chord, named) => {
      if (!hasLabels) return;
      const seen = new Set();
      let i = 0;
      for (const n of notes) {
        if (seen.has(n.pc)) continue;
        seen.add(n.pc);
        const degree = colourDegree(n.pc, named ? chord : null, mode, key);
        const label = pitchLabel(n.pc, named ? chord : null, mode, key);
        const fs = labelSize(label);
        add('circle', {
          cx: x, cy: labelY(i), r: LABEL_R,
          fill: degree === null ? '#5f5f5f' : DEGREE_HUE[degree],
        });
        add('text', {
          x, y: labelY(i) + fs * 0.355, fill: DOT_INK, 'font-size': fs,
          'text-anchor': 'middle', 'font-weight': 600,
          'font-family': '-apple-system, BlinkMacSystemFont, sans-serif',
        }, label);
        i++;
      }
    };

    // Heads of one event, spread the way engraving spreads a second, with the
    // accidentals in front of them.
    const drawHeads = (notes, x, chord, hollow, signs) => {
      let prevStep = null, side = 0, lastSign = null;
      const placed = notes.map(n => {
        side = prevStep !== null && n.step - prevStep === 1 ? 1 - side : 0;
        prevStep = n.step;
        return { n, x: x + side * NOTE_RX * 2 };
      });
      for (const { n, x: nx } of placed) {
        for (let s = TOP_LINE + 2; s <= n.step; s += 2) ledger(s, nx);
        for (let s = BOTTOM_LINE - 2; s >= n.step; s -= 2) ledger(s, nx);
        if (n.sign && signs) {
          // Two signs a step or two apart would collide, so the second of them
          // hangs further out.
          const near = lastSign !== null && n.step - lastSign <= 2;
          // A flat marks its pitch with the bowl at the bottom of the glyph, not
          // with its middle, so centring it on the note puts it a touch low.
          const dy = n.sign === '♭' ? -SIGN_SIZE * 0.17 : 0;
          add('text', {
            x: nx - NOTE_RX - 4 - (near ? SIGN_SIZE * 0.62 : 0), y: y(n.step) + dy,
            fill: '#9a9a9a', 'font-size': SIGN_SIZE, 'text-anchor': 'end',
            'dominant-baseline': 'central',
            'font-family': '-apple-system, BlinkMacSystemFont, sans-serif',
          }, n.sign);
          lastSign = near ? lastSign : n.step;
        }
        // The same hue the dot for this note wears in the diagram above it, so
        // the two readings of one chord are tied together by colour.
        const degree = colourDegree(n.pc, chord, mode, key);
        const ink = degree === null ? '#dcdcdc' : DEGREE_HUE[degree];
        add('ellipse', {
          cx: nx, cy: y(n.step), rx: NOTE_RX, ry: NOTE_RY,
          fill: hollow ? 'none' : ink,
          stroke: hollow ? ink : 'none', 'stroke-width': 1.8,
        });
      }
      return placed;
    };

    // What a tie hangs on to: the last struck event.
    let carried = null;
    const ties = [];
    // Where each note can be clicked, and which note that is. Collected as they
    // are drawn and laid over the lot at the end, so a click lands on the note
    // whichever part of it was aimed at.
    const hits = [];

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const item = items[itemIndex];
      const chord = parseChord(item.name || 'C');
      const ruling = rulingNames(item);
      // Which chord a note is read against: the one in force where it falls.
      const chordAt = index => parseChord(ruling[index] || 'C');
      if (!item.notes || !item.notes.length) {
        const { notes } = staffChord(item.name, item.markers, key);
        if (notes.length) {
          drawHeads(notes, item.x + NOTE_INSET, chord, false, true);
          carried = { x: item.x + NOTE_INSET, stops: null, notes };
        }
        continue;
      }

      // Beamed groups: notes shorter than a beat, of the same duration, within
      // one beat of the bar. A group is never carried across a chord change —
      // the beam would then cross the cell edge the chord names sit on, and a
      // beam is read as one gesture, which two chords are not.
      const { items: placed } = noteBeats(item.notes);
      const from = beat > 0 ? item.x / beat : 0;
      const groups = [];
      for (const p of placed) {
        const last = groups[groups.length - 1];
        const sameBeat = last
          && Math.floor(from + last.items[last.items.length - 1].beat + 1e-6)
             === Math.floor(from + p.beat + 1e-6);
        if (!p.ev.rest && !p.ev.free && p.ev.d < 1
            && last && !last.rest && last.d === p.ev.d && sameBeat) {
          last.items.push(p);
        } else {
          groups.push({ d: p.ev.d, rest: !!p.ev.rest, items: [p] });
        }
      }

      for (const grp of groups) {
        // Which way the stems go is settled for the group, not per note: a beam
        // is one line and cannot have ends pointing opposite ways.
        let sum = 0, count = 0;
        const heads = [];
        for (const p of grp.items) {
          const stops = p.ev.tie ? (carried && carried.stops) || [] : p.ev.stops;
          const notes = stops.map(st => stopNote(st, ruling[p.index] || item.name, key))
            .sort((a, b) => a.step - b.step);
          for (const n of notes) { sum += n.step; count++; }
          heads.push({ p, notes, x: item.x + NOTE_INSET + p.beat * beat });
        }
        const up = count === 0 ? true : sum / count < MID_LINE;
        const tips = [];

        for (const h of heads) {
          hits.push({ x: h.x, chord: itemIndex, note: h.p.index, on: item.sel === h.p.index , after: item.after === (h.p.index) });
          if (h.p.ev.rest) { drawRest(add, h.x, y(MID_LINE), h.p.ev.d); continue; }
          // A tie with nothing in front of it — the first thing in a sheet, or
          // after the note it meant to hold was deleted — has nothing to say.
          if (!h.notes.length) continue;
          // A tie is the note before it still sounding, so it is not labelled
          // again: the row says what was struck, and nothing was.
          if (!h.p.ev.tie) {
            drawLabels(h.notes, h.x, chordAt(h.p.index), !!(ruling[h.p.index] || item.name));
          }
          // No duration written, so nothing to draw one with: heads alone, which
          // is how the chord this stands for has always been drawn.
          if (h.p.ev.free) {
            drawHeads(h.notes, h.x, chordAt(h.p.index), false, true);
            carried = { x: h.x, stops: h.p.ev.stops };
            continue;
          }
          const hollow = h.p.ev.d >= 2;
          // A tied note is not struck again, so it carries no accidental of its
          // own: the sign in front of the note it continues still stands.
          drawHeads(h.notes, h.x, chordAt(h.p.index), hollow, !h.p.ev.tie);
          if (h.p.ev.tie) {
            ties.push({
              from: carried ? carried.x : 0, to: h.x, step: h.notes[0].step, up,
            });
          }
          const hi = h.notes[h.notes.length - 1].step, lo = h.notes[0].step;
          if (h.p.ev.d < 4) {
            const sx = h.x + (up ? NOTE_RX : -NOTE_RX);
            const tip = up ? y(hi) - STEM_LEN : y(lo) + STEM_LEN;
            add('line', {
              x1: sx, y1: up ? y(lo) : y(hi), x2: sx, y2: tip,
              stroke: '#dcdcdc', 'stroke-width': 1.4,
            });
            if (beamCount(h.p.ev.d)) tips.push({ x: sx, tip });
          }
          if (isDottedDur(h.p.ev.d)) {
            // Every head in a chord takes a dot, the way printed music writes
            // one: a single dot beside the top note said that note was dotted
            // and left the rest of the chord looking as if it were not.
            const taken = new Set();
            for (const n of h.notes) {
              // A dot sits in a space, so a head on a line puts its dot in the
              // space above it.
              let cy = y(n.step) + (n.step % 2 === 0 ? -HALF : 0);
              // Two heads a second apart would otherwise both want that space.
              while (taken.has(cy)) cy -= HALF * 2;
              taken.add(cy);
              add('circle', { cx: h.x + NOTE_RX + 5, cy, r: 1.9, fill: '#dcdcdc' });
            }
          }
          carried = { x: h.x, stops: h.p.ev.tie ? (carried && carried.stops) || [] : h.p.ev.stops };
        }

        if (!tips.length) continue;
        // Beams sit at one height across the group, which is what makes them
        // read as one gesture; the stems stretch to meet them.
        const flat = up ? Math.min(...tips.map(t => t.tip)) : Math.max(...tips.map(t => t.tip));
        for (const t of tips) {
          add('line', {
            x1: t.x, y1: t.tip, x2: t.x, y2: flat, stroke: '#dcdcdc', 'stroke-width': 1.4,
          });
        }
        const beams = beamCount(grp.d);
        if (tips.length > 1) {
          for (let i = 0; i < beams; i++) {
            const off = (up ? 1 : -1) * i * BEAM_GAP;
            add('line', {
              x1: tips[0].x, y1: flat + off, x2: tips[tips.length - 1].x, y2: flat + off,
              stroke: '#dcdcdc', 'stroke-width': BEAM_W,
            });
          }
        } else {
          // A note alone in its beat gets flags instead of a beam, one per beam
          // it would have had.
          const dir = up ? 1 : -1;
          for (let i = 0; i < beams; i++) {
            const fy = flat + dir * i * BEAM_GAP;
            add('path', {
              d: `M${tips[0].x} ${fy} q ${SP * 0.9} ${dir * SP * 0.5} ${SP * 0.7} ${dir * SP * 1.5}`,
              fill: 'none', stroke: '#dcdcdc', 'stroke-width': BEAM_W * 0.75,
            });
          }
        }
        // Three in the time of two, said the way printed music says it: one 3
        // over the group, on the far side of the beam from the heads.
        if (isTripletDur(grp.d)) {
          add('text', {
            x: (tips[0].x + tips[tips.length - 1].x) / 2,
            y: flat + (up ? -4 : (beams ? beams * BEAM_GAP : 0) + 11),
            fill: '#dcdcdc', 'font-size': 9, 'text-anchor': 'middle', 'font-style': 'italic',
            'font-family': '-apple-system, BlinkMacSystemFont, sans-serif',
          }, '3');
        }
      }
    }

    addSlots(add, items, width, Number(svg.getAttribute('height')) || 0);
    addCarets(add, items, Number(svg.getAttribute('height')) || 0);
    addNoteHits(add, hits, Number(svg.getAttribute('height')) || 0);

    // Ties last, so an arc is never drawn under a head it has to clear. It
    // curves away from the stems, which is the side engraving puts it on.
    for (const t of ties) {
      const dir = t.up ? 1 : -1;
      const y0 = y(t.step) + dir * (NOTE_RY + 5);
      add('path', {
        d: `M${t.from + NOTE_RX} ${y0} Q ${(t.from + t.to) / 2} ${y0 + dir * 7} ${t.to - NOTE_RX} ${y0}`,
        fill: 'none', stroke: '#cfcfcf', 'stroke-width': 1.6,
      });
    }
    return svg;
  }

  // ---------- tab ----------
  // The same phrase again, as the frets to put fingers on. The staff says what
  // the music is; this says where it is on the neck, which is the half a
  // guitarist reads first and the reason a transcription is written on two rows
  // at all.
  const TAB_SP = SP * 0.95;
  const TAB_PAD = SP * 0.8;
  const TAB_NUM = 11.5;

  function tabHeight() {
    return TAB_PAD * 2 + 5 * TAB_SP;
  }

  function tabBar(items, width, key, mode, beatWidth) {
    const h = tabHeight();
    const { svg, add } = svgCanvas(Math.max(0, width), h, { 'aria-hidden': 'true' });
    if (width <= 0) return svg;
    const y = string => TAB_PAD + (string - 1) * TAB_SP;   // the 1st string on top
    for (let s = 1; s <= 6; s++) {
      add('line', { x1: 0, y1: y(s), x2: width, y2: y(s), stroke: '#4d4d4d', 'stroke-width': 1 });
    }
    const paced = beatWidth || width / BEATS_PER_BAR;
    const beat = paced * beatFit(items, width, paced);
    let carried = null;
    const hits = [];
    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const item = items[itemIndex];
      if (!item.notes || !item.notes.length) continue;
      const ruling = rulingNames(item);
      for (const p of noteBeats(item.notes).items) {
        const name = ruling[p.index] || 'C';
        const chord = parseChord(name);
        const x = item.x + NOTE_INSET + p.beat * beat;
        hits.push({ x, chord: itemIndex, note: p.index, on: item.sel === p.index , after: item.after === (p.index) });
        if (p.ev.rest) continue;
        const stops = p.ev.tie ? carried || [] : p.ev.stops;
        if (!stops.length) continue;
        for (const st of stops) {
          const note = stopNote(st, name, key);
          const degree = colourDegree(note.pc, chord, mode, key);
          const ink = degree === null ? '#dcdcdc' : DEGREE_HUE[degree];
          // A tied note is not struck again, so its number is not repeated: a
          // line carries the one before it on instead.
          if (p.ev.tie) {
            add('line', {
              x1: x - TAB_SP, y1: y(st.string), x2: x + TAB_SP, y2: y(st.string),
              stroke: ink, 'stroke-width': 1.6,
            });
            continue;
          }
          // The line is broken behind the number rather than run through it —
          // at this size a digit sitting on a line is unreadable.
          add('rect', { x: x - 8, y: y(st.string) - 6, width: 16, height: 12, fill: '#000' });
          add('text', {
            x, y: y(st.string), fill: ink, 'font-size': TAB_NUM, 'text-anchor': 'middle',
            'dominant-baseline': 'central', 'font-weight': 600,
            'font-family': '-apple-system, BlinkMacSystemFont, sans-serif',
          }, String(st.fret));
        }
        carried = stops;
      }
    }
    addSlots(add, items, width, h);
    addCarets(add, items, h);
    addNoteHits(add, hits, h);
    return svg;
  }

  // Does this sheet have any single notes in it at all? What decides whether the
  // strip carries a tab row — an empty one is height taken for nothing.
  function hasNotes(bars) {
    return (bars || []).some(bar => (bar.chords || []).some(c => c.notes && c.notes.length));
  }

  // ---------- glyphs for the buttons ----------
  // The same shapes again, on their own, for the duration buttons of the input
  // panel. Written out rather than set in a music font for the same reason the
  // staff is: those code points come out blank on most systems, and a button
  // showing a blank box is a button nobody can read.
  function noteGlyph(d, dotted, scale, triplet) {
    const k = scale || 1, w = 30 * k, h = 44 * k;
    const { svg, add } = svgCanvas(w, h, { 'aria-hidden': 'true' });
    const cx = 11 * k, cy = 32 * k, rx = 7 * k, ry = 5.2 * k;
    const hollow = d >= 2;
    add('ellipse', {
      cx, cy, rx, ry, transform: `rotate(-20 ${cx} ${cy})`,
      fill: hollow ? 'none' : 'currentColor', stroke: 'currentColor',
      'stroke-width': hollow ? 2 * k : 1 * k,
    });
    if (d < 4) {
      const sx = cx + rx * 0.92, top = 6 * k;
      add('line', { x1: sx, y1: cy - ry * 0.5, x2: sx, y2: top,
        stroke: 'currentColor', 'stroke-width': 1.8 * k });
      for (let i = 0; i < beamCount(d); i++) {
        const fy = top + i * 7 * k;
        add('path', { d: `M${sx} ${fy} q ${7 * k} ${3 * k} ${6 * k} ${10 * k}`,
          fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2 * k });
      }
    }
    if (dotted) add('circle', { cx: cx + rx + 5 * k, cy, r: 2.2 * k, fill: 'currentColor' });
    // The 3 that says three of these fill the time of two, over the stem the way
    // it sits over a beamed group on a staff.
    if (triplet || isTripletDur(d)) {
      add('text', {
        x: cx + 3 * k, y: 9 * k, fill: 'currentColor', 'font-size': 11 * k,
        'text-anchor': 'middle', 'font-style': 'italic',
        'font-family': '-apple-system, BlinkMacSystemFont, sans-serif',
      }, '3');
    }
    return svg;
  }

  // The mark a triplet wears on a staff, drawn on its own: three stems under the
  // beam their value carries, with the 3 over it. A value with no beam of its own
  // — a quarter and up — is bracketed instead, which is how it is printed.
  // What is drawn follows the value chosen, so the button says which triplet it
  // is about to write rather than saying three.
  function tripletGlyph(d, scale) {
    const k = scale || 1, w = 30 * k, h = 26 * k;
    const { svg, add } = svgCanvas(w, h, { 'aria-hidden': 'true' });
    const left = 5 * k, right = 25 * k, top = 10 * k, foot = 23 * k;
    const beams = beamCount(d);
    for (const x of [left, (left + right) / 2, right]) {
      add('line', { x1: x, y1: top, x2: x, y2: foot,
        stroke: 'currentColor', 'stroke-width': 1.5 * k });
    }
    if (beams) {
      for (let i = 0; i < beams; i++) {
        add('line', { x1: left, y1: top + i * 5.5 * k, x2: right, y2: top + i * 5.5 * k,
          stroke: 'currentColor', 'stroke-width': 2.2 * k });
      }
    } else {
      // A bracket: the line the 3 sits on, hooked down at both ends.
      add('path', {
        d: `M${left} ${top + 6 * k} V${top} H${right} V${top + 6 * k}`,
        fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4 * k,
      });
    }
    add('text', {
      x: (left + right) / 2, y: 8 * k, fill: 'currentColor', 'font-size': 11 * k,
      'text-anchor': 'middle', 'font-style': 'italic',
      'font-family': '-apple-system, BlinkMacSystemFont, sans-serif',
    }, '3');
    return svg;
  }

  // Three notes struck at once on one stem — what stacking writes, and what a
  // chord looks like on a staff. Drawn to the same box as noteGlyph so the row
  // of buttons keeps one baseline.
  function chordGlyph(scale) {
    const k = scale || 1, w = 30 * k, h = 44 * k;
    const { svg, add } = svgCanvas(w, h, { 'aria-hidden': 'true' });
    const cx = 10 * k, rx = 5.2 * k, ry = 3.4 * k;
    // Further apart than the thirds a staff would stack them in, and drawn
    // smaller: at this size touching heads read as one blob, not three notes.
    const heads = [35, 24.5, 14].map(v => v * k);
    for (const cy of heads) {
      add('ellipse', {
        cx, cy, rx, ry, transform: `rotate(-20 ${cx} ${cy})`,
        fill: 'currentColor', stroke: 'currentColor', 'stroke-width': 1 * k,
      });
    }
    // One stem for the lot of them: they are one event, not three in a row.
    const sx = cx + rx * 0.92;
    add('line', {
      x1: sx, y1: heads[0], x2: sx, y2: 7 * k,
      stroke: 'currentColor', 'stroke-width': 1.8 * k,
    });
    return svg;
  }

  // The same three notes with a plus beside them: the chord being tapped out is
  // finished, and the next tap begins another. Built on chordGlyph so the pair
  // read as one thing said twice — what stacking is, and what ends it.
  function chordAddGlyph(scale) {
    const k = scale || 1;
    const svg = chordGlyph(k);
    const w = Number(svg.getAttribute('width'));
    const add = svgAdder(svg);
    const x = w - 5 * k, y = 13 * k, r = 4 * k;
    add('line', { x1: x - r, y1: y, x2: x + r, y2: y,
      stroke: 'currentColor', 'stroke-width': 2 * k, 'stroke-linecap': 'round' });
    add('line', { x1: x, y1: y - r, x2: x, y2: y + r,
      stroke: 'currentColor', 'stroke-width': 2 * k, 'stroke-linecap': 'round' });
    return svg;
  }

  function restGlyph(d, scale) {
    const k = scale || 1, w = 26 * k, h = 44 * k;
    const { svg, add } = svgCanvas(w, h, { 'aria-hidden': 'true' });
    // drawRest works in staff spaces, so the glyph is drawn at the middle of a
    // box that size and scaled to the button.
    const g = add('g', { transform: `translate(${13 * k} ${22 * k}) scale(${1.15 * k})` });
    const addIn = (tag, attrs) => add(tag, attrs, undefined, g);
    drawRest(addIn, 0, 0, d, 'currentColor');
    return svg;
  }

  // ---------- the input board ----------
  // The whole neck, as the fretboard viewer draws it, for writing notes by
  // tapping them. Every cell carries which string and fret it is, so whoever
  // opened it only has to listen for a click.
  const BOARD_FRETS = 22;
  const BOARD_FW = 30, BOARD_FH = 26, BOARD_PAD_L = 26, BOARD_PAD_T = 16;
  const BOARD_MARKS = [3, 5, 7, 9, 12, 15, 17, 19, 21];

  function board(chordName, mode, key) {
    const chord = parseChord(chordName || 'C');
    const w = BOARD_PAD_L + (BOARD_FRETS + 1) * BOARD_FW + 8;
    const h = BOARD_PAD_T + 6 * BOARD_FH + 6;
    const { svg, add } = svgCanvas(w, h);
    const cx = f => BOARD_PAD_L + (f === 0 ? BOARD_FW * 0.5 : BOARD_FW * (f + 0.5));
    const cy = s => BOARD_PAD_T + (s - 1) * BOARD_FH + BOARD_FH / 2;

    for (const f of BOARD_MARKS) {
      add('text', {
        x: cx(f), y: BOARD_PAD_T - 4, fill: '#666', 'font-size': 10, 'text-anchor': 'middle',
        'font-family': '-apple-system, BlinkMacSystemFont, sans-serif',
      }, String(f));
    }
    // Strings thicken downwards, the way they do on the instrument.
    for (let s = 1; s <= 6; s++) {
      add('line', {
        x1: BOARD_PAD_L, y1: cy(s), x2: BOARD_PAD_L + (BOARD_FRETS + 1) * BOARD_FW, y2: cy(s),
        stroke: '#555', 'stroke-width': 0.7 + (s - 1) * 0.22,
      });
      add('text', {
        x: BOARD_PAD_L - 8, y: cy(s), fill: '#777', 'font-size': 10, 'text-anchor': 'end',
        'dominant-baseline': 'central',
        'font-family': '-apple-system, BlinkMacSystemFont, sans-serif',
      }, String(s));
    }
    for (let f = 0; f <= BOARD_FRETS + 1; f++) {
      const x = BOARD_PAD_L + f * BOARD_FW;
      add('line', {
        x1: x, y1: cy(1), x2: x, y2: cy(6),
        stroke: f === 1 ? '#bbb' : '#3d3d3d', 'stroke-width': f === 1 ? 3 : 1,
      });
    }
    for (let s = 1; s <= 6; s++) {
      for (let f = 0; f <= BOARD_FRETS; f++) {
        const semi = (OPEN_STRINGS[s - 1] + f) % 12;
        const degree = colourDegree(semi, chord, mode, key);
        const g = add('g', {
          class: 'board-cell', 'data-string': s, 'data-fret': f, tabindex: -1,
        });
        add('rect', {
          x: cx(f) - BOARD_FW / 2, y: cy(s) - BOARD_FH / 2,
          width: BOARD_FW, height: BOARD_FH, fill: 'transparent',
        }, undefined, g);
        add('circle', {
          class: 'board-dot', cx: cx(f), cy: cy(s), r: 10,
          fill: degree === null ? '#4a7fff' : DEGREE_HUE[degree],
        }, undefined, g);
        add('text', {
          class: 'board-label', x: cx(f), y: cy(s), 'font-size': 10, 'text-anchor': 'middle',
          'dominant-baseline': 'central', fill: '#cfcfcf', 'pointer-events': 'none',
          'font-family': '-apple-system, BlinkMacSystemFont, sans-serif',
        }, dotLabel(s - 1, f, chord, mode, key), g);
      }
    }
    return svg;
  }

  return {
    parseSheet, resolveSpans, chordTimes, slotWeights, toCompact, viewerUrl, diagram, fretWindows,
    readChord, readMarkers, markersToText, parseKey, parseKeyName, withKey, displayName,
    staffRange, staffBar, staffHead, staffHeadWidth,
    // single notes
    parseNoteToken, parseDur, durText, notesToText, noteBeats, isDottedDur,
    tabBar, tabHeight, hasNotes, board, noteGlyph, restGlyph, chordGlyph, chordAddGlyph, beatWeights,
    isTripletDur, tripletBase, tripletGlyph,
    BEATS_PER_BAR,
    stopsToMarkers, stopShapes, rulingNames,
  };
})();
