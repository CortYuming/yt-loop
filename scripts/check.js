#!/usr/bin/env node
// ============================================================
// Checking the sheet — what a phrase of text draws, and what editing it does
// ============================================================
// Notation bugs are hard to see and easy to write. A beam that stops one note
// early, a 3 over two notes, a bar half a beat too long: every one of them is a
// few pixels on a staff nobody is looking at closely, and every one of them was
// found by eye after it shipped. This runs the real code over a table of
// phrases instead.
//
//   node scripts/check.js            check every case
//   node scripts/check.js --update   accept what the code draws now
//
// Two kinds of case, because the bugs come in two kinds.
//
// A drawing case renders a bar and compares the SVG against the one in
// snapshots/. Nothing about beams or brackets is restated here — the file is
// whatever the code drew the day it was accepted, so any change to a beam, a
// bracket, a flag or a note's place shows up as a diff to read and approve.
// Restating the rules in the test would only check the restatement.
//
// An editing case presses a button or moves a note and compares the sheet text
// that comes back. Text is what the app saves, so it is what an edit means.
//
// chords.js is pure text-in-SVG-out, so it runs here as it is, over the little
// DOM shim below. main.js is a browser script that touches the document as it
// loads, so the functions worth checking are lifted out of it by name and run
// against a stub of the panel they read. That is a text lift and it can miss:
// it fails loudly rather than quietly skipping, and the names are listed in one
// place — LIFTED — so a rename is one line to fix.

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SNAPS = path.join(__dirname, 'snapshots');
const UPDATE = process.argv.includes('--update');

// ---------- the least DOM an SVG needs ----------
// Only what chords.js reaches for: a tag, attributes, children, text, and the
// dataset it hangs a note's address off.
const ESC = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
class El {
  constructor(tag) {
    this.tag = tag;
    this.attrs = {};
    this.kids = [];
    this.text = undefined;
    this.dataset = new Proxy({}, {
      set: (_, k, v) => {
        this.attrs[`data-${String(k).replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}`] = String(v);
        return true;
      },
      get: (_, k) => this.attrs[`data-${String(k)}`],
    });
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; }
  appendChild(c) { this.kids.push(c); return c; }
  set textContent(v) { this.text = v; }
  get textContent() { return this.text; }
  // One element per line, so a diff points at the shape that changed rather
  // than at one very long line.
  serialize(indent = '') {
    const attrs = Object.entries(this.attrs).map(([k, v]) => ` ${k}="${ESC(v)}"`).join('');
    const text = this.text === undefined ? '' : ESC(this.text);
    if (!this.kids.length) return `${indent}<${this.tag}${attrs}>${text}</${this.tag}>`;
    const kids = this.kids.map(k => k.serialize(`${indent}  `)).join('\n');
    return `${indent}<${this.tag}${attrs}>${text}\n${kids}\n${indent}</${this.tag}>`;
  }
}
global.document = { createElementNS: (ns, tag) => new El(tag), createElement: tag => new El(tag) };
// A page has a location, and chords.js reads one: parseViewerLink resolves a
// pasted link against it. Without this, `new URL(href, location.href)` throws,
// the catch swallows it, and a link pasted into a chord box comes back with its
// fingering missing — which looks exactly like a bug in the app and is not one.
// Anything the code reads off the page has to be here, or the run is measuring
// the harness.
global.location = { href: 'https://cortyuming.github.io/yt-loop/' };

// ---------- the two files under test ----------
// chords.js leans on parseTime from main.js and is loaded before it in the page,
// so nothing there runs at load time and the one function it wants can be handed
// in. Bar times are not what this checks, so a plain number will do.
const MAIN = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
// The functions lifted out of main.js. Editing a bar is these and nothing else,
// which is why they can be run without a page: they read the parsed sheet and
// the panel's two indexes, and write back into the same objects.
const LIFTED = [
  // writing
  'putNote', 'pressStop', 'stackStop', 'copyNote', 'deleteNote',
  'insertAfterNote', 'endNoteWriting',
  'addNoteRest', 'addNoteTie', 'markNote', 'heldStops',
  // lengths and marks
  'setNoteDur', 'toggleNoteDot', 'toggleNoteTriplet', 'noteCanTriplet',
  'tripletGroup', 'barNoteEvents',
  'toggleNoteBeam', 'noteCanBeam', 'noteJoinable', 'noteBeamOn',
  'toggleNoteGrace', 'noteCanGrace', 'noteGraceOn',
  // moving one thing along the sheet
  'sheetEvents', 'pinnedNote', 'writeBarsFromEvents', 'selectedEventIndex',
  'moveBlock', 'moveSelection', 'dropDanglingBeams', 'barHead', 'keepBarHeads',
  'selectedIsChord', 'canMoveSelection',
  // the triplet as one thing
  'tripletGroupPlaces', 'noteCopy', 'noteCanDot',
  // bars
  'roundTo', 'addBar', 'insertBar',
];
// Read to the brace that closes the declaration rather than to the next line
// holding one on its own: a function written on a single line — addNoteRest is
// one — would otherwise come back with everything after it up to the next such
// line, which is a silent wrong answer rather than an error.
function lift(name) {
  const at = MAIN.indexOf(`\nfunction ${name}(`);
  if (at < 0) throw new Error(`main.js に function ${name} が見つかりません（改名したら LIFTED を直す）`);
  const src = MAIN.slice(at + 1);
  let depth = 0, quote = null;
  for (let i = src.indexOf('{'); i < src.length; i++) {
    const c = src[i], next = src[i + 1];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && next === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && next === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(0, i + 1);
  }
  throw new Error(`function ${name} の終わりが読めません`);
}
// chords.js wants parseTime from main.js and is loaded ahead of it in the page,
// so it is handed in — the real one, lifted, rather than something near enough:
// a bar's `@` time is read by it, and a stub would put the bars somewhere else
// than the app does.
global.parseTime = new Function(`${liftOne('parseTime')}\nreturn parseTime;`)();
const Chords = new Function('parseTime',
  `${fs.readFileSync(path.join(ROOT, 'chords.js'), 'utf8')}\nreturn Chords;`)(global.parseTime);

function liftOne(name) {
  const src = lift(name);
  // The scan above is not a JavaScript parser, so what it hands back is checked:
  // one declaration, of the name asked for, and something that parses.
  const declared = src.match(/(?:^|\n)function [A-Za-z0-9_]+\(/g) || [];
  if (declared.length !== 1 || !src.startsWith(`function ${name}(`)) {
    throw new Error(`function ${name} の取り出しがずれています（${declared.length} 個の宣言を拾いました）`);
  }
  try { new Function(`${src}\nreturn ${name};`); } catch (err) {
    throw new Error(`function ${name} の取り出しが壊れています: ${err.message}`);
  }
  return src;
}
const LIFTED_SRC = LIFTED.map(liftOne).join('\n');

// A sheet, opened for editing. `at(bar, stretch, note)` is where the panel is
// pointing; everything else is the stubs those functions call into.
function open(sheet) {
  const bars = Chords.parseSheet(sheet);
  const state = { Chords, chordCache: { bars }, writes: 0, carried: null, now: 0 };
  const api = new Function('state', `
    const Chords = state.Chords, chordCache = state.chordCache;
    let notePanelAt = { bar: 0, chord: 0 }, noteSel = null, noteAfter = null;
    // The board's own state — what a tap writes when nothing is selected. The
    // same five values the panel holds; see the top of main.js's note panel.
    let noteDur = 0.5, noteDotted = false, noteTriplet = false, noteStack = false;
    const NO_DUR = 0;
    const noteValue = () => noteDur * (noteDotted ? 1.5 : 1) * (noteTriplet ? 2 / 3 : 1);
    const restValue = () => noteValue() || 1;
    function editingNote() {
      if (noteSel === null) return null;
      const st = chordCache.bars[notePanelAt.bar].chords[notePanelAt.chord];
      return (st.notes || [])[noteSel] || null;
    }
    function noteEntries() {
      const st = chordCache.bars[notePanelAt.bar].chords[notePanelAt.chord];
      return st.notes || (st.notes = []);
    }
    function commitNotes() { state.writes++; }
    function markNoteSelection() {}
    function renderNotePanel() {}
    function renderChordStrip() {}
    function writeSheetFromCache() { state.writes++; }
    function openNotePanel(bar, chord) { notePanelAt = { bar, chord }; noteSel = null; }
    // The moment the video is at. A bar added with nothing to follow starts here.
    function currentPlaybackTime() { return state.now; }
    function settledTime(t) { return t; }
    ${LIFTED_SRC}
    return {
      // The board, as the panel's buttons set it before a tap.
      board(o) {
        if (o.dur !== undefined) noteDur = o.dur;
        if (o.dotted !== undefined) noteDotted = o.dotted;
        if (o.triplet !== undefined) noteTriplet = o.triplet;
        if (o.stack !== undefined) noteStack = o.stack;
      },
      at(bar, stretch, note) {
        notePanelAt = { bar, chord: stretch }; noteSel = note;
        // What the move button would say right now — read as the selection is
        // made, since after a step the selection has moved with it.
        state.carried = selectedIsChord() ? 'Chord' : 'Note';
      },
      selected() { return { bar: notePanelAt.bar, stretch: notePanelAt.chord, note: noteSel }; },
      canTriplet: () => noteCanTriplet(),
      triplet: () => toggleNoteTriplet(),
      move: by => moveSelection(by),
      canMove: by => canMoveSelection(by),
      // What the move button says is about to travel — see selectedIsChord.
      carries: () => (selectedIsChord() ? 'Chord' : 'Note'),
      // The rest of the panel, named as the buttons are.
      press: (string, fret) => pressStop(string, fret),
      copy: () => copyNote(),
      del: () => deleteNote(),
      gap: () => insertAfterNote(),
      done: () => endNoteWriting(),
      addBar: at => { state.now = at === undefined ? state.now : at; addBar(); },
      insertBar: (at, start) => insertBar(at, start),
      rest: () => addNoteRest(),
      tie: () => addNoteTie(),
      dur: d => setNoteDur(d),
      dot: () => toggleNoteDot(),
      beam: () => toggleNoteBeam(),
      grace: () => toggleNoteGrace(),
      can: () => ({
        beam: noteCanBeam(), grace: noteCanGrace(), triplet: noteCanTriplet(),
        dot: noteCanDot(),
      }),
      on: what => ({ beam: () => noteBeamOn(), grace: () => noteGraceOn() }[what]()),
      selection: () => ({ note: noteSel, gap: noteAfter }),
    };`)(state);
  return { api, bars, get carried() { return state.carried; } };
}

// ---------- reading a sheet back ----------
const notesOf = bar => (bar.chords || []).reduce((all, c) => all.concat(c.notes || []), []);
// The text the app saves, through the door it actually saves by: the filter and
// the toCompact call are writeSheetFromCache in main.js. Restating them here
// would check the restatement, so an edit is checked against what would land in
// the sheet box — including the rules only this path has, like an unnamed chord
// leaving no trace and an emptied bar keeping its time.
function sheetText(bars, key) {
  const kept = c => c.name || (c.notes && c.notes.length);
  const held = bars
    .map(bar => ({ start: bar.start, end: bar.end, chords: (bar.chords || []).filter(kept) }))
    .filter(bar => bar.chords.length || bar.start !== null);
  return Chords.toCompact(held, '\n', key ? key.label : '');
}
// One bar of that text, without the `@time` the case is not about.
const textOf = (bars, at) => (sheetText(bars).split('\n')[at] || '')
  .replace(/^@[\d.]+(-[\d.]+)? /, '');
const beatsOf = bar => Chords.noteBeats(notesOf(bar)).length;
// Where a note is in the bar, as the pair the panel holds. Cases are written
// against playing order — the row a reader counts along — rather than against
// the stretch a note happens to have been typed into.
function place(bar, n) {
  let k = 0;
  for (let s = 0; s < bar.chords.length; s++) {
    const notes = bar.chords[s].notes || [];
    for (let i = 0; i < notes.length; i++, k++) if (k === n) return [s, i];
  }
  throw new Error(`小節に ${n} 番目の音がありません`);
}

// ---------- drawing ----------
// A bar as the strip draws it: four slots of one beat, the stretches laid out by
// the widths barWeights hands them. See renderChordStrip in main.js — this is
// that call with the numbers pinned so a snapshot means something.
const SLOT = 190, SLOTS = 4, WIDTH = SLOT * SLOTS;
function draw(sheet) {
  const bars = Chords.parseSheet(sheet);
  // A `key:` line decides how everything after it is spelled and which letters
  // the signature has already altered, so a case can set one.
  const key = Chords.parseKey(sheet);
  const reach = Chords.staffRange(bars, key, 'neck');
  if (!reach) throw new Error('この譜面には五線譜に載るものがありません');
  return bars.map((bar, i) => {
    const weights = Chords.barWeights(bar, SLOT);
    let x = 0;
    const items = bar.chords.map((chord, j) => {
      const at = x;
      x += weights[j] * SLOT;
      return {
        x: at, chord: j, name: chord.name, markers: chord.markers, notes: chord.notes,
        sel: null, after: null, caret: false, gap: null,
      };
    });
    const mode = 'degrees';
    const staff = Chords.staffBar(items, WIDTH, reach, key, mode, SLOT, [], false);
    const tab = Chords.tabBar(items, WIDTH, key, mode, SLOT, [], reach.stack);
    return [`<!-- bar ${i + 1}: ${textOf(bars, i)} -->`,
      `<!-- ${beatsOf(bar).toFixed(4)} beats -->`,
      staff.serialize(), tab.serialize()].join('\n');
  }).join('\n');
}

// ---------- the cases ----------
// Every phrase here was a bug once. The name is the slug the snapshot is filed
// under, so it also reads as the list of what the notation is expected to hold.
const DRAWN = {
  // The bar the beams-run-on bug was found in: three eighth triplets under three
  // chords, the whole of it counted in one bar.
  'triplets-under-chord-changes':
    '@0 Eb9 1/6+2/6+3/6+4/5:4 Bbm7 1/9+2/9+3/10+4/8:8t 1/8- 1/9+2/9+3/10+4/8 '
    + 'Bbm9 1/13+2/13+3/13+4/11:8t- 1/12- 1/13+2/13+3/13+4/11 '
    + '1/9+2/9+3/10+4/8(Bbm7):8t- 1/8 1/9+2/9+3/10+4/8',
  // A triplet after a dotted quarter, which is where one is most often written
  // and the one place it cannot sit inside a single beat.
  'triplet-after-a-dot':
    '@0 Bb7 2/11+3/7+4/6_:4. 4/8:8 2/4+3/5 2/6+3/7:8t 3/6+4/7 3/6+4/7',
  // Six in a row are two triplets, not one bracket over the lot.
  'six-triplets-are-two': '@0 Cm7 1/8:4 1/8:8t 1/10 1/12 1/8 1/10 1/12',
  // A run of triplets begun off the beat: the beam follows the triplet, and the
  // bracket and the beam say the same three notes.
  'triplets-across-the-beat': '@0 Cm7 1/8:8 1/8:8t 1/10 1/12 1/8 1/10 1/12',
  // Quarter triplets and eighth triplets side by side are not one run.
  'two-triplet-values': '@0 Cm7 1/5:4t 1/7 1/8:8t 1/10 1/12 1/5 1/7',
  // A bar left longer than four beats — undoing a triplet does that, and the
  // notes past the end are still drawn where they sound.
  'bar-past-its-end':
    '@0 Eb9 1/6+2/6+3/6+4/5:4 Bbm7 1/9+2/9+3/10+4/8:8t 1/8- 1/9+2/9+3/10+4/8 '
    + 'Bbm9 1/13+2/13+3/13+4/11:8t- 1/12- 1/13+2/13+3/13+4/11 '
    + '1/9+2/9+3/10+4/8(Bbm7):8- 1/8 1/9+2/9+3/10+4/8',
  // Everything that is not a triplet, so a change to the triplets is caught
  // when it reaches music that has none: sixteenths, a dot, a rest, a tie held
  // over a bar line, and a beam asked for by hand.
  'the-plain-values':
    '@0 Dm7 1/5:16 1/7 1/8 1/10 1/5:8. 1/7:16 r:4 1/8:8- 1/10|'
    + '@2 G7 1/10_:4 1/5:8 1/7- 1/8 1/10',
  // A grace note takes no time from the bar and hangs off the note it leans on.
  'a-grace-note': '@0 C7 1/3+2/3+3/2+4/3:4 1/7*:8 1/8 1/10 1/12',
  // An accidental holds to the end of the bar, so a line the signature flattens
  // and a ♮ then cancels has to be flattened again out loud. In B♭, C7's E♮ and
  // then F7's E♭: without the second sign the reader plays E. The second E♮ of
  // the bar carries no sign of its own — it is already in force — and F7+'s E♭
  // an octave down carries none either, since nothing touched that line.
  'a-natural-then-a-flat': 'key: Bb\n@26.83-29.25 C7 2/5_:8 4/5- 2/5+3/3 4/5 '
    + 'F7 2/4+3/2:8 4/3 F7+ 2/2+3/2+4/1:4',
  // The same rule the other way: an A♭ written at the head of the bar makes the
  // A after it need a ♮.
  'a-flat-then-a-natural':
    '@0 Bb7 2/11+3/7+4/6_:4. 4/8:8 2/4+3/5 2/6+3/7:8t 3/6+4/7 3/6+4/7',
  // Four triplets in a row, which is what writing with the triplet button on
  // looks like the moment the fourth tap lands: three are a triplet and the
  // fourth is a 3 over one note, waiting for the two after it. Every button that
  // edits a triplet keeps it three — see tripletGroupPlaces in main.js — so this
  // is the one way a bar holds a triplet of one, and it is a phrase halfway
  // written rather than a phrase gone wrong.
  'four-triplets-in-a-row': '@0 Cm7 1/8:4 1/8:8t 1/10 1/12 1/5',
};

// An editing case: open a sheet, do something, and say what the bar reads as
// after. `beats` is checked where the point of the edit is the length it buys.
const EDITED = [
  {
    name: '3連ボタン: 付点のあとの3音を3連にする',
    sheet: '@0 Bb7 2/11+3/7+4/6_:4. 4/8:8 2/4+3/5 2/6+3/7 3/6+4/7 3/6+4/7',
    run: ({ api, bars }) => { api.at(0, ...place(bars[0], 3)); api.triplet(); },
    text: 'Bb7 2/11+3/7+4/6_:4. 4/8:8 2/4+3/5 2/6+3/7:8t 3/6+4/7 3/6+4/7',
    beats: 3.5,
  },
  {
    name: '3連ボタン: もう一度押すと元に戻る',
    sheet: '@0 Bb7 2/11+3/7+4/6_:4. 4/8:8 2/4+3/5 2/6+3/7 3/6+4/7 3/6+4/7',
    run: ({ api, bars }) => {
      api.at(0, ...place(bars[0], 3)); api.triplet();
      api.at(0, ...place(bars[0], 3)); api.triplet();
    },
    text: 'Bb7 2/11+3/7+4/6_:4. 4/8:8 2/4+3/5 2/6+3/7 3/6+4/7 3/6+4/7',
    beats: 4,
  },
  {
    name: '3連ボタン: 後ろに3音ないと押せない',
    sheet: '@0 Cm7 1/5:8 1/7 1/8 1/10',
    run: ({ api, bars }) => { api.at(0, ...place(bars[0], 2)); },
    can: { triplet: false },
  },
  {
    name: '3連ボタン: 既存の3連に食い込むと押せない',
    sheet: '@0 Cm7 1/5:8 1/7:8t 1/8 1/10 1/12:8',
    run: ({ api, bars }) => { api.at(0, ...place(bars[0], 0)); },
    can: { triplet: false },
  },
  {
    name: '3連ボタン: 装飾音符では押せない',
    sheet: '@0 Cm7 1/5:4 1/7*:8 1/8 1/10 1/12',
    run: ({ api, bars }) => { api.at(0, ...place(bars[0], 1)); },
    can: { triplet: false },
  },
  {
    // The grace note's own value is written out: it stands outside the run, so
    // the notes after it do not inherit it — see parseNoteToken.
    name: '3連ボタン: 装飾音符は3音の数に入らない',
    sheet: '@0 Cm7 1/5:4 1/7*:8 1/8:8 1/10 1/12',
    run: ({ api, bars }) => { api.at(0, ...place(bars[0], 2)); api.triplet(); },
    text: 'Cm7 1/5:4 1/7*:8 1/8:8t 1/10 1/12',
    beats: 2,
  },
  {
    // The quarter clears all three, rather than landing inside the triplet. Cm7
    // stays at the head of the bar — it is what the bar is read against, not a
    // mark on the note that happens to be written first. See keepBarHeads.
    name: '移動: 4分音符が3連をまるごと越える',
    sheet: '@0 Cm7 1/8:4 1/8:8t 1/10 1/12 1/8 1/10 1/12 1/8 1/10 1/12',
    run: ({ api, bars }) => { api.at(0, ...place(bars[0], 0)); api.move(1); },
    text: 'Cm7 1/8:8t 1/10 1/12 1/8:4 1/8:8t 1/10 1/12 1/8 1/10 1/12',
    beats: 4,
    carries: 'Note',
  },
  {
    name: '移動: 3連の中では1音ずつ入れ替わる',
    sheet: '@0 Cm7 1/8:4 1/8:8t 1/10 1/12 1/8 1/10 1/12 1/8 1/10 1/12',
    run: ({ api, bars }) => { api.at(0, ...place(bars[0], 1)); api.move(1); },
    text: 'Cm7 1/8:4 1/10:8t 1/8 1/12 1/8 1/10 1/12 1/8 1/10 1/12',
    beats: 4,
  },
  {
    // Three notes go over together and the quarter comes back the other way, so
    // neither bar is left holding part of a triplet — and both still count four
    // beats. Each bar keeps the chord written at its own head.
    name: '移動: 3連は小節線をまたいで割れない',
    sheet: '@0 Cm7 1/8:4 1/8:8t 1/10 1/12 1/8 1/10 1/12 1/8 1/10 1/12|@2 F7 1/5:4 1/7 1/9 1/10',
    run: ({ api, bars }) => { api.at(0, ...place(bars[0], 9)); api.move(1); },
    text: 'Cm7 1/8:4 1/8:8t 1/10 1/12 1/8 1/10 1/12 1/5:4',
    beats: 4,
    then: { bar: 1, text: 'F7 1/8:8t 1/10 1/12 1/7:4 1/9 1/10', beats: 4 },
  },
  {
    // A name written on a note is a chord starting there, so it goes where the
    // note goes — and the button says Chord to say so before it is pressed.
    name: '移動: 音符に書かれたコード名は一緒に動く',
    sheet: '@0 Cm7 1/5:8 1/7(F7) 1/9 1/10',
    run: ({ api, bars }) => { api.at(0, ...place(bars[0], 1)); api.move(1); },
    text: 'Cm7 1/5:8 1/9 F7 1/7:8 1/10',
    beats: 2,
    carries: 'Chord',
  },
  {
    // The same name stepped the other way lands at the head, and the bar now
    // opens on it. The name that was there keeps its own note rather than being
    // handed over — both are where their writer put them.
    name: '移動: 先頭に来たコード名は前の名前に上書きされない',
    sheet: '@0 Cm7 1/5:8 1/7(F7) 1/9 1/10',
    run: ({ api, bars }) => { api.at(0, ...place(bars[0], 1)); api.move(-1); },
    text: 'F7 1/7:8 Cm7 1/5:8 1/9 1/10',
    beats: 2,
  },
  {
    // A stretch's own name, one step earlier: the chord starts a note sooner and
    // takes its note with it. This is the move the Chord button is for.
    name: '移動: 小節の途中のコードは1音ぶん早く始まる',
    sheet: '@0 Cm7 1/5:8 1/7 F7 1/9 1/10',
    run: ({ api, bars }) => { api.at(0, 1, 0); api.move(-1); },
    text: 'Cm7 1/5:8 F7 1/9:8 1/7 1/10',
    beats: 2,
    carries: 'Chord',
  },
  {
    name: '移動: 押し戻すと元の譜面に戻る',
    sheet: '@0 Cm7 1/8:4 1/8:8t 1/10 1/12 1/8 1/10 1/12 1/8 1/10 1/12',
    run: ({ api, bars }) => {
      api.at(0, ...place(bars[0], 0)); api.move(1);
      api.at(0, ...place(bars[0], 3)); api.move(-1);
    },
    text: 'Cm7 1/8:4 1/8:8t 1/10 1/12 1/8 1/10 1/12 1/8 1/10 1/12',
    beats: 4,
  },
  // ---- the board: a tap writes, replaces, or piles on ----
  {
    name: '板を叩く: 末尾に書く',
    sheet: '@0 Cm7 1/5:8 1/7',
    run: ({ api }) => { api.board({ dur: 0.5 }); api.at(0, 0, null); api.press(2, 9); },
    text: 'Cm7 1/5:8 1/7 2/9', beats: 1.5,
  },
  {
    // A tap with a note selected corrects that note rather than writing another,
    // which is how one written on the wrong string is fixed.
    name: '板を叩く: 選択中の音を差し替える',
    sheet: '@0 Cm7 1/5:8 1/7 1/9',
    run: ({ api }) => { api.at(0, 0, 1); api.press(2, 9); },
    text: 'Cm7 1/5:8 2/9 1/9', beats: 1.5,
  },
  {
    name: '板を叩く: スタックONで選択中の音に積む',
    sheet: '@0 Cm7 1/5:8 1/7 1/9',
    run: ({ api }) => { api.board({ stack: true }); api.at(0, 0, 1); api.press(2, 9); },
    text: 'Cm7 1/5:8 1/7+2/9 1/9', beats: 1.5,
  },
  {
    // A string already in the shape moves to where it was tapped rather than
    // being struck twice at once, which is not a thing a hand can do.
    name: '板を叩く: 同じ弦を積むと移動する',
    sheet: '@0 Cm7 1/5+2/7:8 1/7',
    run: ({ api }) => { api.board({ stack: true }); api.at(0, 0, 0); api.press(2, 10); },
    text: 'Cm7 1/5+2/10:8 1/7', beats: 1,
  },
  {
    // No length at all: the stop sounds until the next one, the way a chord does.
    name: '板を叩く: 長さなしで書く',
    sheet: '@0 Cm7 1/5:8 1/7',
    run: ({ api }) => { api.board({ dur: 0 }); api.at(0, 0, null); api.press(2, 9); },
    text: 'Cm7 1/5:8 1/7 2/9:0', beats: 1,
  },
  {
    name: '板を叩く: 3連の1音を差し替えても3連のまま',
    sheet: '@0 Cm7 1/5:8 1/7:8t 1/9 1/10 1/12:8',
    run: ({ api }) => { api.at(0, 0, 2); api.press(2, 9); },
    text: 'Cm7 1/5:8 1/7:8t 2/9 1/10 1/12:8', beats: 2,
  },
  {
    name: 'ギャップ: + で開けた場所に書く',
    sheet: '@0 Cm7 1/5:8 1/7 1/9',
    run: ({ api }) => { api.at(0, 0, 0); api.gap(); api.press(2, 9); },
    text: 'Cm7 1/5:8 2/9 1/7 1/9', beats: 2,
  },

  // ---- copy and delete ----
  {
    // The name is not copied: a name repeated over the next shape reads as a
    // chord change to itself.
    name: 'コピー: 選択した音の直後に入る',
    sheet: '@0 Cm7 1/5:8 1/7 1/9',
    run: ({ api }) => { api.at(0, 0, 1); api.copy(); },
    text: 'Cm7 1/5:8 1/7 1/7 1/9', beats: 2,
  },
  {
    // The button says "this again", and with nothing selected there is no this.
    name: 'コピー: 未選択では何もしない',
    sheet: '@0 Cm7 1/5:8 1/7',
    run: ({ api }) => { api.at(0, 0, null); api.copy(); },
    text: 'Cm7 1/5:8 1/7', beats: 1,
  },
  {
    // The same figure struck again, written after the three. One more note inside
    // them would be a fourth in the time of two.
    name: 'コピー: 3連の1音をコピーすると3連まるごと増える',
    sheet: '@0 Cm7 1/5:8 1/7:8t 1/9 1/10 1/12:8',
    run: ({ api }) => { api.at(0, 0, 2); api.copy(); },
    text: 'Cm7 1/5:8 1/7:8t 1/9 1/10 1/7 1/9 1/10 1/12:8', beats: 3,
  },
  {
    name: '削除: 選択した音を消す',
    sheet: '@0 Cm7 1/5:8 1/7 1/9',
    run: ({ api }) => { api.at(0, 0, 1); api.del(); },
    text: 'Cm7 1/5:8 1/9', beats: 1,
  },
  {
    // Two of the three left behind are a triplet of two, so the whole of it goes.
    name: '削除: 3連の1音を消すと3連まるごと消える',
    sheet: '@0 Cm7 1/5:8 1/7:8t 1/9 1/10 1/12:8',
    run: ({ api }) => { api.at(0, 0, 2); api.del(); },
    text: 'Cm7 1/5:8 1/12', beats: 1,
  },

  // ---- rest and tie: marks on a note, not notes of their own ----
  {
    name: '休符: 選択した音を休符にする',
    sheet: '@0 Cm7 1/5:8 1/7 1/9',
    run: ({ api }) => { api.at(0, 0, 1); api.rest(); },
    text: 'Cm7 1/5:8 r 1/9', beats: 1.5,
  },
  {
    // The strings are kept on the event while the mark is on, so the note that
    // comes back is the note that was there.
    name: '休符: もう一度押すと元の音が戻る',
    sheet: '@0 Cm7 1/5:8 1/7 1/9',
    run: ({ api }) => { api.at(0, 0, 1); api.rest(); api.at(0, 0, 1); api.rest(); },
    text: 'Cm7 1/5:8 1/7 1/9', beats: 1.5,
  },
  {
    // A rest takes a length like a note, so it is one of the three and the
    // triplet holds.
    name: '休符: 3連の1音を休符にしても3連のまま',
    sheet: '@0 Cm7 1/5:8 1/7:8t 1/9 1/10 1/12:8',
    run: ({ api }) => { api.at(0, 0, 2); api.rest(); },
    text: 'Cm7 1/5:8 1/7:8t r 1/10 1/12:8', beats: 2,
  },
  {
    name: 'タイ: 選択した音をタイにする',
    sheet: '@0 Cm7 1/5:8 1/7 1/9',
    run: ({ api }) => { api.at(0, 0, 1); api.tie(); },
    text: 'Cm7 1/5:8 1/7_ 1/9', beats: 1.5,
  },
  {
    // Nothing is ringing at the head of a sheet, so a tie there would take the
    // note off the staff and put nothing in its place.
    name: 'タイ: 先頭では鳴っていないので書かれない',
    sheet: '@0 Cm7 1/5:8 1/7',
    run: ({ api }) => { api.at(0, 0, 0); api.tie(); },
    text: 'Cm7 1/5:8 1/7', beats: 1,
  },
  {
    // A chord tied over is three strings still ringing, and taking the tie off
    // strikes those three again rather than whatever sounded last.
    name: 'タイ: 外すと保持していた弦で戻る',
    sheet: '@0 Cm7 1/5+2/7:8 _ 1/9',
    run: ({ api }) => { api.at(0, 0, 1); api.tie(); },
    text: 'Cm7 1/5+2/7:8 1/5+2/7 1/9', beats: 1.5,
  },

  // ---- lengths ----
  {
    // The note after it can no longer inherit, so its length is written out.
    name: '長さ: 選択した音を4分にする',
    sheet: '@0 Cm7 1/5:8 1/7 1/9',
    run: ({ api }) => { api.at(0, 0, 1); api.dur(1); },
    text: 'Cm7 1/5:8 1/7:4 1/9:8', beats: 2,
  },
  {
    name: '付点: 選択した音に付点をつける',
    sheet: '@0 Cm7 1/5:8 1/7 1/9',
    run: ({ api }) => { api.at(0, 0, 1); api.dot(); },
    text: 'Cm7 1/5:8 1/7:8. 1/9:8', beats: 1.75,
  },
  {
    // Three notes of one value, so re-timing one re-times the three.
    name: '長さ: 3連の1音の長さを変えると3音そろって変わる',
    sheet: '@0 Cm7 1/5:8 1/7:8t 1/9 1/10 1/12:8',
    run: ({ api }) => { api.at(0, 0, 2); api.dur(1); },
    text: 'Cm7 1/5:8 1/7:4t 1/9 1/10 1/12:8', beats: 3,
  },
  {
    // There is no dotted triplet in this notation, and dotting one of three
    // leaves the other two a triplet of two.
    name: '付点: 3連の1音には付点をつけられない',
    sheet: '@0 Cm7 1/5:8 1/7:8t 1/9 1/10 1/12:8',
    run: ({ api }) => { api.at(0, 0, 2); api.dot(); },
    text: 'Cm7 1/5:8 1/7:8t 1/9 1/10 1/12:8', beats: 2,
    can: { dot: false },
  },
  {
    // The + opens its room after the triplet, not among its three.
    name: 'ギャップ: 3連の中で + を押すと3連の後ろに開く',
    sheet: '@0 Cm7 1/5:8 1/7:8t 1/9 1/10 1/12:8',
    run: ({ api }) => { api.board({ dur: 0.5 }); api.at(0, 0, 2); api.gap(); api.press(2, 9); },
    text: 'Cm7 1/5:8 1/7:8t 1/9 1/10 2/9:8 1/12', beats: 2.5,
  },

  // ---- beams and grace notes ----
  {
    name: 'ビーム: 手書きで次の音と繋ぐ',
    sheet: '@0 Cm7 1/5:8 1/7 1/9',
    run: ({ api }) => { api.at(0, 0, 0); api.beam(); },
    text: 'Cm7 1/5:8- 1/7 1/9', beats: 1.5,
  },
  {
    // Nothing on the other side of the join, so the button is down.
    name: 'ビーム: 小節の最後の音では押せない',
    sheet: '@0 Cm7 1/5:8 1/7',
    run: ({ api }) => { api.at(0, 0, 1); },
    can: { beam: false }, text: 'Cm7 1/5:8 1/7',
  },
  {
    name: '装飾音符: 選択した音を装飾音符にする',
    sheet: '@0 Cm7 1/5:8 1/7 1/9',
    run: ({ api }) => { api.at(0, 0, 1); api.grace(); },
    text: 'Cm7 1/5:8 1/7*:8 1/9', beats: 1,
  },
  {
    // It takes no time from the bar, so it is outside the beats a beam is read
    // off and the mark asking for one is dropped.
    name: '装飾音符: 手書きビームは落ちる',
    sheet: '@0 Cm7 1/5:8 1/7- 1/9',
    run: ({ api }) => { api.at(0, 0, 1); api.grace(); },
    text: 'Cm7 1/5:8 1/7*:8 1/9', beats: 1,
  },

  // ---- bars ----
  {
    // A bar after the last one starts where that one ends, which is what a
    // transcription does — bar after bar.
    name: '小節を足す: 前の小節の終わりから始まる',
    sheet: '@5.00-7.00 Cm7 1/5:8',
    run: ({ api }) => { api.addBar(); },
    sheetText: '@5.00-7.00 Cm7 1/5:8\n@7.00',
    then: { bar: 1, at: 7 },
  },
  {
    // No bar to follow, so it starts where the video is.
    name: '小節を足す: 前がなければ再生位置から始まる',
    sheet: 'Cm7 1/5:8',
    run: ({ api }) => { api.addBar(12.345); },
    then: { bar: 1, at: 12.35 },
  },
  {
    // The bar arrives holding one empty chord, so there is a cell to write into
    // — and an unnamed chord leaves no trace in the text, so the bar is its time
    // and nothing else until something is written.
    name: '小節を挟む: 時刻だけで残り、後ろの小節は動かない',
    sheet: '@0 Cm7 1/5:8|@4 F7 1/9:8',
    run: ({ api }) => { api.insertBar(1, 2); },
    sheetText: '@0.00 Cm7 1/5:8\n@2.00\n@4.00 F7 1/9:8',
  },
  {
    // Straight into the bar just made: it was asked for in order to write in it.
    name: '小節を挟む: 板がその小節を向く',
    sheet: '@0 Cm7 1/5:8|@4 F7 1/9:8',
    run: ({ api }) => { api.insertBar(1, 2); },
    at: { bar: 1, stretch: 0 },
  },
];

// A phrase read in and written straight back out. Everything the app saves goes
// through that door — see sheetText — so a phrase that does not survive the trip
// is a phrase the app loses. Written out twice on purpose: the second pass
// catches a form that reads back as something other than what it was written as,
// which is the way a sheet quietly changes while nobody is editing it.
const WRITTEN = [
  {
    name: '読み書き: 付点・タイ・3連・押弦つきのコード名',
    sheet: '@5.07-7.60 Bb7:1.1.1.0.. 2/11+3/7+4/6_:4. 4/8:8 2/4+3/5 2/6+3/7:8t 3/6+4/7 3/6+4/7',
    text: '@5.07-7.60 Bb7:1.1.1.0.. 2/11+3/7+4/6_:4. 4/8:8 2/4+3/5 2/6+3/7:8t 3/6+4/7 3/6+4/7',
  },
  {
    name: '読み書き: 休符・装飾音符・手書きビーム・16分',
    sheet: '@0 Dm7 r:4 1/7*:8 1/8- 1/10 1/12:16 1/5',
    text: '@0.00 Dm7 r:4 1/7*:8 1/8- 1/10 1/12:16 1/5',
  },
  {
    name: '読み書き: 音符に書かれたコード名',
    sheet: '@0 Eb9 1/6:8 1/8(Bbm7) 1/9 1/10',
    text: '@0.00 Eb9 1/6:8 1/8(Bbm7) 1/9 1/10',
  },
  {
    // A phrase with nothing said about the harmony is an ordinary thing to write
    // down, so the stretch is kept even with no name on it. The note opening the
    // next stretch writes its length out: a bare stop takes the length of the
    // run around it, and the run starts again here.
    name: '読み書き: 名前のない区間',
    sheet: '@0 1/5:8 1/7 Cm7 1/9 1/10',
    text: '@0.00 1/5:8 1/7 Cm7 1/9:8 1/10',
  },
  {
    // A fingering written as a stop, sounding until the next one — no length of
    // its own, and none written back.
    name: '読み書き: 長さのない押弦だけ',
    sheet: '@0 Bb9 1/1+2/1+3/1+4/0',
    text: '@0.00 Bb9 1/1+2/1+3/1+4/0',
  },
  {
    // A bar emptied of chords is still a bar of the tune, and its time is the
    // whole of what it says.
    name: '読み書き: 時刻だけの空の小節',
    sheet: '@0 Cm7 1/5:8|@2',
    text: '@0.00 Cm7 1/5:8\n@2.00',
  },
  {
    // A note held over the bar line is written as a tie at the head of the next
    // bar, naming the strings it holds — otherwise the arc is drawn as whatever
    // happened to sound last.
    name: '読み書き: 小節線をまたぐタイ',
    sheet: '@0 Cm7 1/5+2/7:4 1/5+2/7_:4|@2 F7 1/5+2/7_:4 1/9:4',
    text: '@0.00 Cm7 1/5+2/7:4 1/5+2/7_\n@2.00 F7 1/5+2/7_:4 1/9',
  },
  {
    name: '読み書き: キーの行',
    sheet: 'key: Bb\n@0 Bb9 1/5:8 1/7',
    text: 'key: Bb\n@0.00 Bb9 1/5:8 1/7',
    key: 'Bb',
  },
];

// What the two editing boxes accept. Going to Guitar Chord Viewer to find a
// shape and pasting it back is the actual workflow, so a link has to give up
// both halves of what it carries — the name and the frets.
const VIEWER = 'https://cortyuming.github.io/guitar-chord-viewer/?c=Eb9&m=.6.6.5.6.';
const READ = [
  { name: 'コード箱: 素の名前', got: () => Chords.readChord('Bbm7'),
    want: { name: 'Bbm7', markers: null } },
  { name: 'コード箱: 名前とフレット', got: () => Chords.readChord('Bb9:1.1.1.0..'),
    want: { name: 'Bb9', markers: [1, 1, 1, 0, null, null] } },
  { name: 'コード箱: viewer の URL', got: () => Chords.readChord(VIEWER),
    want: { name: 'Eb9', markers: [null, 6, 6, 5, 6, null] } },
  { name: 'コード箱: markdown リンク', got: () => Chords.readChord(`[Eb9](${VIEWER})`),
    want: { name: 'Eb9', markers: [null, 6, 6, 5, 6, null] } },
  { name: 'コード箱: 空欄は名前なし', got: () => Chords.readChord('   '), want: null },
  { name: 'フレット箱: 6つのフレット', got: () => Chords.readMarkers('1.1.1.0..'),
    want: [1, 1, 1, 0, null, null] },
  { name: 'フレット箱: リンクは m= を出す', got: () => Chords.readMarkers(`[Eb9](${VIEWER})`),
    want: [null, 6, 6, 5, 6, null] },
  { name: 'フレット箱: 書き戻すと同じ文字列',
    got: () => Chords.markersToText(Chords.readMarkers('1.1.1.0..')), want: '1.1.1.0..' },
  { name: 'キー: 行を読む', got: () => Chords.parseKey('key: Bb'),
    want: { label: 'Bb', minor: false, tonic: 10, accidental: '♭' } },
  // `tonic` is the major whose signature the key uses, not the letter typed: G
  // minor is written with B♭'s two flats, and 10 is B♭. That is what the degree
  // tables and the signature both read — see parseKeyName.
  { name: 'キー: 短調は relative major の tonic を持つ', got: () => Chords.parseKey('key: Gm'),
    want: { label: 'Gm', minor: true, tonic: 10, accidental: '♭' } },
  { name: '表示名: b と # は記号になる', got: () => Chords.displayName('Bbm7b5'),
    want: 'B♭m7♭5' },
];

// Times, and the link a loop is shared as. A bar's `@` is where it starts and
// the end is worked out from what is around it — see resolveSpans — so a sheet
// written bar by bar with no end times still knows where every chord sounds.
// The share link is the one piece of the app that leaves the machine, so what it
// carries is checked to the character.
const share = (() => {
  const src = ['formatTime', 'buildShareUrl', 'buildShareLabel', 'buildShareMarkdown']
    .map(liftOne).join('\n');
  return new Function('shim', `
    const NOTE_MAX = 30;
    const location = shim.location;
    // Reads the browser's storage in the app; a case says the title outright.
    function resolveVideoTitle() { return shim.title; }
    ${src}
    return { formatTime, buildShareUrl, buildShareLabel, buildShareMarkdown,
      title(t) { shim.title = t; } };`)({
    location: { origin: 'https://cortyuming.github.io', pathname: '/yt-loop/' },
    title: '',
  });
})();

const LOOP = { start: 26.83, end: 29.25, speed: 0.75, note: 'F7 の E♭' };
const TIMES = [
  // A bar with no end takes the next bar's start, and the last one — with
  // nothing after it — takes the length of the bar before it.
  { name: '小節の終わり: 次の小節の始まりを取る',
    got: () => Chords.resolveSpans(Chords.parseSheet('@10 C7|@14 F7|@18 C7')),
    want: [{ start: 10, end: 14 }, { start: 14, end: 18 }, { start: 18, end: 22 }] },
  // Nothing after it, so it takes the length of the bar before it.
  { name: '小節の終わり: 最後の小節は前の小節と同じ長さ',
    got: () => Chords.resolveSpans(Chords.parseSheet('@10-14 C7|@14 F7')),
    want: [{ start: 10, end: 14 }, { start: 14, end: 18 }] },
  // A sheet whose bars overlap says so rather than being quietly reordered.
  { name: '小節の終わり: 次が戻っていたら埋めない',
    got: () => Chords.resolveSpans(Chords.parseSheet('@10 C7|@8 F7')),
    want: [{ start: 10, end: null }, { start: 8, end: null }] },
  // Four beats to the bar, split the way chord-vamp splits them: 3 chords are
  // 2+1+1, so the second falls halfway and the third three quarters in.
  { name: 'コードの時刻: 3つなら 2+1+1 で割る',
    got: () => Chords.chordTimes(Chords.parseSheet('@0-4 C7 F7 G7')[0], { start: 0, end: 4 }),
    want: [0, 2, 3] },
  { name: 'コードの時刻: 2つなら半分ずつ',
    got: () => Chords.chordTimes(Chords.parseSheet('@0-4 C7 F7')[0], { start: 0, end: 4 }),
    want: [0, 2] },
  // No end to spread them over, so only the first one has a moment.
  { name: 'コードの時刻: 終わりが分からなければ先頭だけ',
    got: () => Chords.chordTimes(Chords.parseSheet('@0 C7 F7')[0], { start: 0, end: null }),
    want: [0, null] },
  { name: '時刻を読む: 秒だけ', got: () => parseTime('43.50'), want: 43.5 },
  { name: '時刻を読む: 分と秒', got: () => parseTime('1:07.30'), want: 67.3 },
  { name: '時刻を読む: 時と分と秒', got: () => parseTime('1:02:03.5'), want: 3723.5 },
  { name: '時刻を読む: 時刻でないもの', got: () => parseTime('あとで'), want: null },
  { name: '時刻を書く: 1分未満', got: () => share.formatTime(9.5), want: '0:09.50' },
  { name: '時刻を書く: 1時間以上', got: () => share.formatTime(3723.5), want: '1:02:03.50' },
  { name: '時刻を書く: 負の値は0', got: () => share.formatTime(-5), want: '0:00.00' },
  { name: '共有URL: 区間と速度とメモ',
    got: () => share.buildShareUrl('abc123', LOOP),
    want: 'https://cortyuming.github.io/yt-loop/?v=abc123&s=26.83&e=29.25&r=0.75'
      + '&n=F7+%E3%81%AE+E%E2%99%AD' },
  // Speed 1 is the speed it plays at anyway, so it is not carried.
  { name: '共有URL: 等速はパラメータに出ない',
    got: () => share.buildShareUrl('abc123', { start: 1, end: 2, speed: 1 }),
    want: 'https://cortyuming.github.io/yt-loop/?v=abc123&s=1.00&e=2.00' },
  { name: '共有URL: 動画がなければ作らない',
    got: () => share.buildShareUrl('', LOOP), want: null },
  { name: '共有の見出し: 題名と区間とメモ',
    got: () => { share.title('Autumn Leaves'); return share.buildShareLabel('abc123', LOOP); },
    want: 'Autumn Leaves (0:26.83 → 0:29.25) F7 の E♭' },
  { name: '共有の見出し: 題名がなければ区間だけ',
    got: () => { share.title(''); return share.buildShareLabel('abc123', LOOP); },
    want: '0:26.83 → 0:29.25 F7 の E♭' },
  { name: '共有の markdown',
    got: () => { share.title('Autumn Leaves'); return share.buildShareMarkdown('abc123', LOOP); },
    want: '[Autumn Leaves (0:26.83 → 0:29.25) F7 の E♭]'
      + '(https://cortyuming.github.io/yt-loop/?v=abc123&s=26.83&e=29.25&r=0.75'
      + '&n=F7+%E3%81%AE+E%E2%99%AD)' },
];

// ---------- running them ----------
let failed = 0, updated = 0;
let known = 0;
const say = (ok, name, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `\n${detail}` : ''}`);
};
// A case whose expected value is what the code does wrong today. Written down
// rather than left out: the phrase is the bug, and the day it is fixed this case
// fails and is turned into the real answer. Counted apart from the passes so the
// number is in front of whoever reads the run.
const noted = (name, why) => { known++; console.log(`! ${name}\n    既知の壊れ方: ${why}`); };
const near = (a, b) => Math.abs(a - b) < 1e-9;
// Which line of two blocks of text first disagrees, and what each says there.
function firstDiff(got, want) {
  const a = got.split('\n'), b = want.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      return `    行 ${i + 1}\n    got  ${a[i] === undefined ? '(なし)' : a[i].trim()}`
        + `\n    want ${b[i] === undefined ? '(なし)' : b[i].trim()}`;
    }
  }
  return '    行の中身は同じで長さだけ違います';
}

console.log('譜面の描画');
for (const [name, sheet] of Object.entries(DRAWN)) {
  const file = path.join(SNAPS, `${name}.svg`);
  let drawn;
  try {
    drawn = `${draw(sheet)}\n`;
  } catch (err) {
    say(false, name, `    例外 ${err.message}`);
    continue;
  }
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, drawn);
    updated++;
    console.log(`+ ${name}  （新しい snapshot を書きました）`);
    continue;
  }
  const held = fs.readFileSync(file, 'utf8');
  if (held === drawn) { say(true, name); continue; }
  if (UPDATE) {
    fs.writeFileSync(file, drawn);
    updated++;
    console.log(`~ ${name}  （snapshot を更新しました）`);
    continue;
  }
  say(false, name, `${firstDiff(drawn, held)}\n    差分を見る: node scripts/check.js --update して git diff`);
}

console.log('\n譜面の編集');
for (const c of EDITED) {
  let sheet;
  try {
    sheet = open(c.sheet);
    c.run(sheet);
  } catch (err) {
    say(false, c.name, `    例外 ${err.message}`);
    continue;
  }
  const checks = [];
  if (c.carries !== undefined && c.carries !== sheet.carried) {
    checks.push(`    ボタン表示  got ${sheet.carried}  want ${c.carries}`);
  }
  // `can` names the buttons whose state the case is about: { triplet: false }
  // reads as "the triplet button is down here".
  if (c.can) {
    const can = sheet.api.can();
    for (const [what, want] of Object.entries(c.can)) {
      if (can[what] !== want) {
        checks.push(`    ${what} ボタン  got ${can[what] ? '押せる' : '押せない'}`
          + `  want ${want ? '押せる' : '押せない'}`);
      }
    }
  }
  // The whole sheet, where the case is about what survives being written out
  // rather than about one bar.
  if (c.sheetText !== undefined) {
    const got = sheetText(sheet.bars);
    if (got !== c.sheetText) {
      checks.push(`    譜面  got  ${got.replace(/\n/g, ' ⏎ ')}`
        + `\n          want ${c.sheetText.replace(/\n/g, ' ⏎ ')}`);
    }
  }
  // Where the board is pointing after the edit.
  if (c.at) {
    const got = sheet.api.selected();
    if (got.bar !== c.at.bar || got.stretch !== c.at.stretch) {
      checks.push(`    板の位置  got 小節${got.bar + 1}/区間${got.stretch + 1}`
        + `  want 小節${c.at.bar + 1}/区間${c.at.stretch + 1}`);
    }
  }
  const want = [{ bar: 0, text: c.text, beats: c.beats }].concat(c.then || []);
  for (const w of want) {
    if (w.text !== undefined) {
      const got = textOf(sheet.bars, w.bar);
      if (got !== w.text) checks.push(`    小節${w.bar + 1}  got  ${got}\n              want ${w.text}`);
    }
    if (w.beats !== undefined) {
      const got = beatsOf(sheet.bars[w.bar]);
      if (!near(got, w.beats)) checks.push(`    小節${w.bar + 1}の拍  got ${got}  want ${w.beats}`);
    }
    // When a bar starts, which is what an added or inserted one is about.
    if (w.at !== undefined) {
      const got = sheet.bars[w.bar] && sheet.bars[w.bar].start;
      if (!near(got, w.at)) checks.push(`    小節${w.bar + 1}の時刻  got ${got}  want ${w.at}`);
    }
  }
  if (!checks.length && c.broken) { noted(c.name, c.broken); continue; }
  say(!checks.length, c.name, checks.join('\n'));
}

console.log('\n譜面テキスト');
for (const c of WRITTEN) {
  const key = Chords.parseKey(c.sheet.split('\n')[0]);
  if (c.key !== undefined && (!key || key.label !== c.key)) {
    say(false, c.name, `    キー  got ${key ? key.label : '(なし)'}  want ${c.key}`);
    continue;
  }
  const once = sheetText(Chords.parseSheet(c.sheet), key);
  const twice = sheetText(Chords.parseSheet(once), key);
  const flat = t => t.replace(/\n/g, ' ⏎ ');
  if (once !== c.text) {
    say(false, c.name, `    got  ${flat(once)}\n    want ${flat(c.text)}`);
  } else if (twice !== once) {
    say(false, c.name, `    書き出すたびに変わる\n    1回目 ${flat(once)}\n    2回目 ${flat(twice)}`);
  } else say(true, c.name);
}

// A list of "call this, expect that" — the pure halves of the app, where a case
// is one value and reads as the rule it is checking.
const answers = (title, list) => {
  console.log(`\n${title}`);
  for (const c of list) {
    let got;
    try { got = c.got(); } catch (err) { say(false, c.name, `    例外 ${err.message}`); continue; }
    const ok = JSON.stringify(got) === JSON.stringify(c.want);
    say(ok, c.name, ok ? '' : `    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(c.want)}`);
  }
};
answers('箱に貼る', READ);
answers('時間と共有', TIMES);

const drawnCount = Object.keys(DRAWN).length;
console.log(`\n描画 ${drawnCount} 件 / 編集 ${EDITED.length} 件`
  + ` / テキスト ${WRITTEN.length} 件 / 箱 ${READ.length} 件`
  + ` / 時間と共有 ${TIMES.length} 件`
  + `${known ? ` / 既知の壊れ方 ${known} 件` : ''}`
  + `${updated ? ` / snapshot ${updated} 件を書きました` : ''}`);
if (failed) {
  console.log(`\n失敗 ${failed} 件`);
  console.log('描画が変わったのが意図した変更なら、node scripts/check.js --update で snapshot を更新して'
    + '差分をコミットに含めてください。');
  process.exit(1);
}
console.log('すべて通りました');
