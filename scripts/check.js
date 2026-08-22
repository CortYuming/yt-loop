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

// ---------- the two files under test ----------
// chords.js leans on parseTime from main.js and is loaded before it in the page,
// so nothing there runs at load time and the one function it wants can be handed
// in. Bar times are not what this checks, so a plain number will do.
global.parseTime = s => Number(s) || 0;
const Chords = new Function('parseTime',
  `${fs.readFileSync(path.join(ROOT, 'chords.js'), 'utf8')}\nreturn Chords;`)(global.parseTime);

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
const LIFTED_SRC = LIFTED.map(name => {
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
}).join('\n');

// A sheet, opened for editing. `at(bar, stretch, note)` is where the panel is
// pointing; everything else is the stubs those functions call into.
function open(sheet) {
  const bars = Chords.parseSheet(sheet);
  const state = { Chords, chordCache: { bars }, writes: 0, carried: null };
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
      rest: () => addNoteRest(),
      tie: () => addNoteTie(),
      dur: d => setNoteDur(d),
      dot: () => toggleNoteDot(),
      beam: () => toggleNoteBeam(),
      grace: () => toggleNoteGrace(),
      can: () => ({
        beam: noteCanBeam(), grace: noteCanGrace(), triplet: noteCanTriplet(),
      }),
      on: what => ({ beam: () => noteBeamOn(), grace: () => noteGraceOn() }[what]()),
      selection: () => ({ note: noteSel, gap: noteAfter }),
    };`)(state);
  return { api, bars, get carried() { return state.carried; } };
}

// ---------- reading a sheet back ----------
const notesOf = bar => (bar.chords || []).reduce((all, c) => all.concat(c.notes || []), []);
// The text the app would save. Written per bar, since that is the unit an edit
// touches and the unit a case is about.
const textOf = bar => (bar.chords || [])
  .map(c => `${c.name ? `${c.name} ` : ''}${Chords.notesToText(c.notes)}`.trim())
  .filter(Boolean).join(' ');
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
  const reach = Chords.staffRange(bars, null, 'neck');
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
    const staff = Chords.staffBar(items, WIDTH, reach, null, mode, SLOT, [], false);
    const tab = Chords.tabBar(items, WIDTH, null, mode, SLOT, [], reach.stack);
    return [`<!-- bar ${i + 1}: ${textOf(bar)} -->`,
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
  // Four triplets in a row, which is what writing with the triplet button on
  // gets you when the fourth tap lands. Three are a triplet and the fourth is a
  // 3 over one note. Nothing here can tell it was meant as part of the three
  // before it, because the sheet does not say which notes are one triplet — it
  // only says each is a third of a beat. Recorded so the day the groups are
  // written down, this snapshot is what changes.
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
    name: 'コピー: 3連の1音をコピーすると4音になる',
    sheet: '@0 Cm7 1/5:8 1/7:8t 1/9 1/10 1/12:8',
    run: ({ api }) => { api.at(0, 0, 2); api.copy(); },
    text: 'Cm7 1/5:8 1/7:8t 1/9 1/9 1/10 1/12:8', beats: 0.5 + 4 / 3 + 0.5,
    broken: '3連が4音の run になり、括弧が3音＋1音に割れる。小節も3分の1拍伸びる',
  },
  {
    name: '削除: 選択した音を消す',
    sheet: '@0 Cm7 1/5:8 1/7 1/9',
    run: ({ api }) => { api.at(0, 0, 1); api.del(); },
    text: 'Cm7 1/5:8 1/9', beats: 1,
  },
  {
    name: '削除: 3連の1音を消すと2音になる',
    sheet: '@0 Cm7 1/5:8 1/7:8t 1/9 1/10 1/12:8',
    run: ({ api }) => { api.at(0, 0, 2); api.del(); },
    text: 'Cm7 1/5:8 1/7:8t 1/10 1/12:8', beats: 0.5 + 2 / 3 + 0.5,
    broken: '2音に3の括弧が付く。小節も3分の1拍縮む',
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
    name: '長さ: 3連の1音だけ長さを変えられる',
    sheet: '@0 Cm7 1/5:8 1/7:8t 1/9 1/10 1/12:8',
    run: ({ api }) => { api.at(0, 0, 2); api.dur(1); },
    text: 'Cm7 1/5:8 1/7:8t 1/9:4t 1/10:8t 1/12:8', beats: 0.5 + 1 / 3 + 2 / 3 + 1 / 3 + 0.5,
    broken: '8分3連の中に4分3連が入り、長さが違うので3つの run に割れる（1音の括弧が3つ）',
  },
  {
    name: '付点: 3連の1音に付点がつけられる',
    sheet: '@0 Cm7 1/5:8 1/7:8t 1/9 1/10 1/12:8',
    run: ({ api }) => { api.at(0, 0, 2); api.dot(); },
    text: 'Cm7 1/5:8 1/7:8t 1/9:8. 1/10:8t 1/12:8',
    beats: 0.5 + 1 / 3 + 0.75 + 1 / 3 + 0.5,
    broken: '真ん中の3連が外れ、残った2音が1音ずつの括弧になる',
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
  const want = [{ bar: 0, text: c.text, beats: c.beats }].concat(c.then || []);
  for (const w of want) {
    if (w.text !== undefined) {
      const got = textOf(sheet.bars[w.bar]);
      if (got !== w.text) checks.push(`    小節${w.bar + 1}  got  ${got}\n              want ${w.text}`);
    }
    if (w.beats !== undefined) {
      const got = beatsOf(sheet.bars[w.bar]);
      if (!near(got, w.beats)) checks.push(`    小節${w.bar + 1}の拍  got ${got}  want ${w.beats}`);
    }
  }
  if (!checks.length && c.broken) { noted(c.name, c.broken); continue; }
  say(!checks.length, c.name, checks.join('\n'));
}

const drawnCount = Object.keys(DRAWN).length;
console.log(`\n描画 ${drawnCount} 件 / 編集 ${EDITED.length} 件`
  + `${known ? ` / 既知の壊れ方 ${known} 件` : ''}`
  + `${updated ? ` / snapshot ${updated} 件を書きました` : ''}`);
if (failed) {
  console.log(`\n失敗 ${failed} 件`);
  console.log('描画が変わったのが意図した変更なら、node scripts/check.js --update で snapshot を更新して'
    + '差分をコミットに含めてください。');
  process.exit(1);
}
console.log('すべて通りました');
