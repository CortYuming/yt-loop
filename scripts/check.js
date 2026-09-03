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
  // Written as a property rather than through setAttribute in places, and the
  // two are the same attribute.
  set className(v) { this.attrs.class = String(v); }
  get className() { return this.attrs.class || ''; }
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
const MAIN = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
// The Start/End boxes are still main.js's own, so those functions are read out
// of it by hand — the one place left that does. Read to the brace that closes
// the declaration rather than to the next line holding one on its own: a
// function written on a single line would otherwise come back with everything
// after it up to the next such line, which is a silent wrong answer rather than
// an error.
function lift(name) {
  const at = MAIN.indexOf(`\nfunction ${name}(`);
  if (at < 0) throw new Error(`main.js に function ${name} が見つかりません（改名したら rangeModule の名前を直す）`);
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
const Chords = new Function(
  `${fs.readFileSync(path.join(ROOT, 'chords.js'), 'utf8')}\nreturn Chords;`)();
// The edits themselves, loaded the way the page loads them. Nothing in there
// reaches for a document or for the page's own state — what it works on is
// handed over per case, in open() below.
const Sheet = new Function('Chords',
  `${fs.readFileSync(path.join(ROOT, 'sheet.js'), 'utf8')}\nreturn Sheet;`)(Chords);

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

// A sheet, opened for editing. `at(bar, stretch, note)` is where the panel is
// pointing; everything else is the stubs those functions call into.
function open(sheet) {
  const bars = Chords.parseSheet(sheet);
  const state = {
    chordCache: { bars, spans: Chords.resolveSpans(bars) },
    writes: 0, carried: null, now: 0,
  };
  // The page's side of an edit, which is the whole of what sheet.js asks for:
  // the parse being worked on, and the ways an edit leaves. Nothing here draws,
  // so a write is counted instead.
  Sheet.init({
    cache: () => state.chordCache,
    // The case's sheet is the one on screen, always.
    videoId: () => state.chordCache.vid,
    writeSheet: () => { state.writes++; },
    renderStrip: () => {},
    renderPanel: () => {},
    markSelection: () => {},
    focusPanel: () => {},
    commit: () => { state.writes++; },
    // The moment the video is at. A bar added with nothing to follow starts here.
    now: () => state.now,
    settled: t => t,
  });
  // Where the panel points before a case says: the head of the first bar, which
  // is where a case that never calls at() writes.
  Sheet.openNotePanel(0, 0);
  const api = {
    // The board, as the panel's buttons set it before a tap.
    board: o => Sheet.setBoard(o),
    at(bar, stretch, note) {
      if (note === null || note === undefined) Sheet.openNotePanel(bar, stretch);
      else Sheet.selectNote(bar, stretch, note);
      // What the move button would say right now — read as the selection is
      // made, since after a step the selection has moved with it.
      state.carried = Sheet.selectedIsChord() ? 'Chord' : 'Note';
    },
    selected: () => ({ bar: Sheet.at.bar, stretch: Sheet.at.chord, note: Sheet.sel }),
    canTriplet: () => Sheet.noteCanTriplet(),
    triplet: () => Sheet.toggleNoteTriplet(),
    move: by => Sheet.moveSelection(by),
    canMove: by => Sheet.canMoveSelection(by),
    // What the move button says is about to travel — see selectedIsChord.
    carries: () => (Sheet.selectedIsChord() ? 'Chord' : 'Note'),
    // The rest of the panel, named as the buttons are.
    press: (string, fret) => Sheet.pressStop(string, fret),
    copy: () => Sheet.copyNote(),
    del: () => Sheet.deleteNote(),
    gap: () => Sheet.insertAfterNote(),
    done: () => Sheet.endNoteWriting(),
    addBar: at => { state.now = at === undefined ? state.now : at; Sheet.addBar(); },
    beats: at => Sheet.barBeats(state.chordCache.bars[at || 0]),
    // What the bar's head shows, as the text and the state it is shown in.
    beatLabel: at => {
      const count = Sheet.barBeatText(state.chordCache.bars[at || 0]);
      if (!count) return null;
      return `${count.shown}/${Chords.BEATS_PER_BAR} ${count.over ? '赤' : '灰'}`;
    },
    insertBar: (at, start) => Sheet.insertBar(at, start),
    // The bar's own time, moved from its head, and how far it may go.
    setBarStart: (at, t) => Sheet.setBarStart(at, t),
    bounds: at => Sheet.barTimeBounds(at),
    rest: () => Sheet.addNoteRest(),
    tie: () => Sheet.addNoteTie(),
    dur: d => Sheet.setNoteDur(d),
    dot: () => Sheet.toggleNoteDot(),
    beam: () => Sheet.toggleNoteBeam(),
    grace: () => Sheet.toggleNoteGrace(),
    dead: () => Sheet.toggleNoteDeadMode(),
    can: () => ({
      beam: Sheet.noteCanBeam(), grace: Sheet.noteCanGrace(),
      triplet: Sheet.noteCanTriplet(),
    }),
    on: what => ({
      beam: () => Sheet.noteBeamOn(), grace: () => Sheet.noteGraceOn(),
      dead: () => Sheet.noteDeadOn(),
    }[what]()),
    selection: () => ({ note: Sheet.sel, gap: Sheet.after }),
  };
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
function draw(sheet, mode) {
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
    // What the bar carried in: the harmony named before it, which a bass move on
    // its first beat holds. renderChordStrip hands the real thing over the same
    // way — a bar cannot see the bars around it.
    const held = Chords.rulingBefore(bars, i);
    const staff = Chords.staffBar(items, WIDTH, reach, key, mode, SLOT, [], false, held);
    const tab = Chords.tabBar(items, WIDTH, key, mode, SLOT, [], reach.stack, held);
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
  // The figure the explicit bracket is for: one 3 over two notes, the beat split
  // 1:2 — an eighth and a quarter, which is how a swung beat is written.
  'one-to-two-inside-a-triplet': '@0 D7 3/2{ 4/4:8 3/3+2/1:4 } r:4 r:4 r:4',
  // The same figure in the old spelling, where the bracket had to be worked out
  // from the values: two notes of different triplet values are read as two
  // brackets of one note each, which is the drawing the explicit bracket was
  // written to replace.
  'one-to-two-written-the-old-way': '@0 D7 4/4:8t 3/3+2/1:4t r:4 r:4 r:4',
  // Five in the time of four, which the old spelling had no way to write at all.
  // The number over the bracket is how many are written, so this one says 5.
  'five-in-the-time-of-four': '@0 Cm7 5/4{ 1/5:16 1/7 1/8 1/10 1/12 } r:4 r:4 r:4',
  // A grace note standing among the notes of a bracket: one bracket over the
  // lot, not one either side of it.
  'a-grace-note-inside-a-bracket': '@0 Cm7 3/2{ 1/5:4 1/7*:8 1/8:4 1/10:4 } r:4 r:4',
  // Two brackets side by side: each is drawn over the notes it holds, and the
  // one is not read as the other's.
  'two-brackets-side-by-side': '@0 Cm7 3/2{ 1/5:8 1/7 1/8 } 3/2{ 1/10 1/12 2/5 } 2/7:4 r:4',
  // A bracket holding a rest and a dot, neither of which the old spelling could
  // hold: the bracket says what the group is, so what is inside it is free.
  'a-rest-and-a-dot-inside-a-bracket': '@0 Cm7 3/2{ 1/5:8. r:16 1/8:8 } r:4 r:4 r:4',
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
  // A key spells its own seven and the chord spells the rest, which is what a
  // B♭7 in C is for: the staff called its root A♯ and the name under the tab
  // called it B♭, the same note answering to two letters in one column. The
  // A7♯5 after it goes back to sharps, and `/C#` is a bass move the parser
  // makes nothing of — there the key is all there is, and it says sharp.
  // Drawn with the names on rather than the degrees, since the two readings of
  // the note are what has to agree: the staff and the dot under it.
  'a-flat-chord-in-a-sharp-key': {
    mode: 'note',
    sheet: 'key: C\n@36.55-38.50 E7#9 2/8+3/7+4/6+5/7:8 '
      + '2/8+3/7+4/6- 6/6(Bb7) 4/6 2/6+3/6+4/5+6/5(A7#5) 2/6+3/6+4/5- 5/4(/C#) 4/4',
  },
  // Two bars of a transcription where the bass walks under held harmony: `/Bb`
  // under E7♯9, `/C#` under A7♯5♭9. A name like that is a bass move and not a
  // chord, so the parser makes nothing of it — and every label under it fell
  // back to a plain note name while the dot went on wearing the hue the key gave
  // it, which is the note saying it is two things at once.
  // Solfège is read from the key, so the key alone settles these.
  'solfege-under-a-bass-move': { mode: 'solfa', sheet: 'key: C\n@27.95 E7#9 6/0:8 2/8+3/7+4/6- 6/6(/Bb) 5/5 6/5(A7#5b9) 1/6+2/6+3/6+4/5- 5/4(/C#) 4/4\n@30.10-32.10 D9 5/5:8 1/5+2/5+3/5+4/4 6/4(/Ab):4 6/3(G7#5b9):8 1/4+2/4+3/4+4/3- 5/2(/B) 4/2' },
  // Degrees are read from the chord, so these are what says the bass move keeps
  // the harmony above it rather than breaking the count: the dots under `/Bb`
  // count from E7♯9 and not from nothing.
  'degrees-under-a-bass-move': { mode: 'number', sheet: 'key: C\n@27.95 E7#9 6/0:8 2/8+3/7+4/6- 6/6(/Bb) 5/5 6/5(A7#5b9) 1/6+2/6+3/6+4/5- 5/4(/C#) 4/4\n@30.10-32.10 D9 5/5:8 1/5+2/5+3/5+4/4 6/4(/Ab):4 6/3(G7#5b9):8 1/4+2/4+3/4+4/3- 5/2(/B) 4/2' },
  // The bass walking into the next bar, which is where the harmony has to reach
  // across a bar line to be found — see Chords.rulingBefore. Read against
  // nothing these came out ♭7 and 9, counted from C: numbers that look like an
  // answer, where the plain note names they used to show at least said the sheet
  // could not read the name.
  'degrees-across-a-bar-line': {
    mode: 'number',
    sheet: 'key: C\n@0 E7#9 6/0:8 2/8+3/7+4/6:8\n@2-4 /Bb 6/6:8 5/5:8',
  },
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
  // Muted strings inside triplets, which is how a comped bar of them is written:
  // the middle of the first two brackets keeps its top voice and knocks the
  // three under it, the third bracket is played through. Crosses and heads stand
  // in one column, and the beam and the bracket read across them as across any
  // other note.
  'muted-strings-in-triplets':
    '@0 Eb9 1/6+2/8+3/8:4 Bbm7 3/2{ 2/6+3/6+4/6:8 2/6+3/6x+4/6x 2/8+3/8+4/8 } '
    + 'Ebm9 3/2{ 1/6+2/8+3/8:8 1/6+2/8x+3/8x 1/8+2/10+3/10 } '
    + 'Ebm7 3/2{ 2/6+3/6+4/6:8 2/6+3/6+4/6 2/8+3/8+4/8 }',
  // A muted single note among plain ones, and a whole shape knocked — every
  // string of it crossed, which is the other thing the mark is for.
  'a-muted-note': '@0 C7 1/3+2/3+3/2+4/3:4 1/7x:8 1/8 2/8x+3/8x+4/7x 1/12',
  // The row of dots under the tab, at every depth it has to draw. A five-string
  // voicing sets how deep the row is for the whole bar; the four- and two-string
  // ones and the single note after them hang from that same top rather than
  // sitting on a floor, so what the row lines up along is the top voice. The
  // knocked strings in the third stop take no dot and the ones ringing over them
  // close up — a four-string shape with two crosses in it is two dots deep, not
  // four with holes.
  'a-voicing-under-the-tab':
    '@0 Cm9 1/3+2/4+3/3+4/1+5/3:4 1/3+2/4+3/3+4/1:8 1/3+2/4 '
    + 'F7 2/6+3/5x+4/6x+5/8:4 1/8:8 3/5+4/5',
};

// An editing case: open a sheet, do something, and say what the bar reads as
// after. `beats` is checked where the point of the edit is the length it buys.
const EDITED = [
  {
    name: '✕モード: タップした弦だけミュートになる',
    sheet: '@0 Cm7 2/6+3/6+4/6:8 2/8+3/8+4/8',
    run: ({ api, bars }) => {
      api.at(0, ...place(bars[0], 0));
      api.board({ dead: true });
      api.press(3, 6); api.press(4, 6);
    },
    text: 'Cm7 2/6+3/6x+4/6x:8 2/8+3/8+4/8',
  },
  {
    name: '✕モード: 同じ弦をもう一度タップすると鳴る音に戻る',
    sheet: '@0 Cm7 2/6+3/6x+4/6x:8 2/8+3/8+4/8',
    run: ({ api, bars }) => {
      api.at(0, ...place(bars[0], 0));
      api.board({ dead: true });
      api.press(3, 6);
    },
    text: 'Cm7 2/6+3/6+4/6x:8 2/8+3/8+4/8',
  },
  {
    name: '✕モード: コードにない弦はミュートの弦として足される',
    sheet: '@0 Cm7 2/6+3/6:8 2/8+3/8',
    run: ({ api, bars }) => {
      api.at(0, ...place(bars[0], 0));
      api.board({ dead: true });
      api.press(4, 6);
    },
    text: 'Cm7 2/6+3/6+4/6x:8 2/8+3/8',
  },
  {
    name: '✕モード: 何も選んでいなければミュートの音符が書かれる',
    sheet: '@0 Cm7 1/5:8',
    run: ({ api }) => { api.board({ dead: true }); api.press(1, 7); },
    text: 'Cm7 1/5:8 1/7x',
  },
  {
    name: '3連ボタン: 付点のあとの3音を3連にする',
    sheet: '@0 Bb7 2/11+3/7+4/6_:4. 4/8:8 2/4+3/5 2/6+3/7 3/6+4/7 3/6+4/7',
    run: ({ api, bars }) => { api.at(0, ...place(bars[0], 3)); api.triplet(); },
    text: 'Bb7 2/11+3/7+4/6_:4. 4/8:8 2/4+3/5 3/2{ 2/6+3/7 3/6+4/7 3/6+4/7 }',
    beats: 3.5,
  },
  {
    // The button counts down — three, two, none — so three presses is where it
    // started, and nothing was deleted on the way.
    name: '3連ボタン: 3回押すと元に戻る',
    sheet: '@0 Bb7 2/11+3/7+4/6_:4. 4/8:8 2/4+3/5 2/6+3/7 3/6+4/7 3/6+4/7',
    run: ({ api, bars }) => {
      api.at(0, ...place(bars[0], 3)); api.triplet();
      api.at(0, ...place(bars[0], 3)); api.triplet();
      api.at(0, ...place(bars[0], 3)); api.triplet();
    },
    text: 'Bb7 2/11+3/7+4/6_:4. 4/8:8 2/4+3/5 2/6+3/7 3/6+4/7 3/6+4/7',
    beats: 4,
  },
  {
    // Two notes under one 3 is a swung beat, so two at the end of a bar is a
    // bracket rather than nothing.
    name: '3連ボタン: 小節末に2音あれば括れる',
    sheet: '@0 Cm7 1/5:8 1/7 1/8 1/10',
    run: ({ api, bars }) => { api.at(0, ...place(bars[0], 2)); api.triplet(); },
    text: 'Cm7 1/5:8 1/7 3/2{ 1/8 1/10 }',
    beats: 5 / 3,
  },
  {
    // One is not a group, and that is the only place the button is down.
    name: '3連ボタン: 後ろに1音しかないと押せない',
    sheet: '@0 Cm7 1/5:8 1/7 1/8 1/10',
    run: ({ api, bars }) => { api.at(0, ...place(bars[0], 3)); },
    can: { triplet: false },
  },
  {
    // Up against a bracket already there, the run stops and brackets what is
    // free in front of it — the bar this was found in had a quarter and an
    // eighth left over ahead of one.
    name: '3連ボタン: 既存の括弧の手前2音で括れる',
    sheet: '@0 Ab7 6/4:4 3/5+4/4:8 G13 3/2{ 2/3:8 2/5 1/3 } 5/4:4',
    run: ({ api, bars }) => { api.at(0, ...place(bars[0], 0)); api.triplet(); },
    text: 'Ab7 3/2{ 6/4:4 3/5+4/4:8 } G13 3/2{ 2/3:8 2/5 1/3 } 5/4:4',
    beats: 3,
  },
  {
    // A grace note is not one of the three, and it is kept inside the bracket
    // all the same: left out, one bracket would be written as the two brackets
    // the notes either side of it had become.
    name: '3連ボタン: 装飾音符を挟んでも括弧は1つ',
    sheet: '@0 Cm7 1/5:8 1/7*:8 1/8 1/10 1/12',
    run: ({ api, bars }) => { api.at(0, ...place(bars[0], 0)); api.triplet(); },
    text: 'Cm7 3/2{ 1/5:8 1/7*:8 1/8 1/10 } 1/12',
    beats: 1.5,
  },
  {
    // Counting down drops the last note counted and the grace notes leaning on
    // it, and the selection stays on a note still under the bracket — it used to
    // follow the note that had just left it.
    name: '3連ボタン: 縮めると末尾の装飾音符も一緒に外れる',
    sheet: '@0 Cm7 3/2{ 1/5:8 1/7:8 1/8:8 1/10*:8 } 1/12:4',
    run: ({ api }) => { api.at(0, 0, 0); api.triplet(); },
    text: 'Cm7 3/2{ 1/5:8 1/7 } 1/8 1/10*:8 1/12:4',
    beats: 13 / 6,
    at: { bar: 0, stretch: 0 },
  },
  {
    // A tie is the note before it still sounding, and it has a value of its own,
    // so a bracket can hold one — the note it holds on ends earlier for it.
    name: '3連ボタン: タイを含めて括れる',
    sheet: '@0 Cm7 1/5:8 _:8 1/8:8 1/10:4 1/12:4',
    run: ({ api }) => { api.at(0, 0, 0); api.triplet(); },
    text: 'Cm7 3/2{ 1/5:8 _ 1/8 } 1/10:4 1/12',
    beats: 3,
  },
  {
    // A bracket steps over the bar line by trading places with what is there, so
    // two of them swap rather than ending up side by side. Which is what keeps a
    // bracket's name its own: names are settled a bar at a time, and two in one
    // bar would be read as one bracket if they ever met.
    name: '移動: 括弧どうしは小節線をまたいで入れ替わる',
    sheet: '@0 Cm7 1/5:4 1/7:4 3/2{ 1/8:8 1/10 1/12 }'
      + '|@2 F7 3/2{ 2/5:8 2/7 2/8 } 1/5:4 1/7:4',
    run: ({ api, bars }) => { api.at(0, ...place(bars[0], 4)); api.move(1); },
    text: 'Cm7 1/5:4 1/7 3/2{ 2/5:8 2/7 2/8 }',
    beats: 3,
    then: { bar: 1, text: 'F7 3/2{ 1/8:8 1/10 1/12 } 1/5:4 1/7', beats: 3 },
  },
  {
    // The note after a bracket starts a bracket of its own, so a bar can hold
    // two side by side and each is drawn over the notes it holds.
    name: '3連ボタン: 括弧の直後をもう一つ括れる',
    sheet: '@0 Cm7 3/2{ 1/5:8 1/7 1/8 } 1/10:8 1/12:8 2/5:8 2/7:4',
    run: ({ api }) => { api.at(0, 0, 3); api.triplet(); },
    text: 'Cm7 3/2{ 1/5:8 1/7 1/8 } 3/2{ 1/10 1/12 2/5 } 2/7:4',
    beats: 3,
  },
  {
    // Deleting from a bracket of two leaves a bracket of one. The note left
    // keeps the time it was sounding for, which is the quieter of the two ways
    // to be wrong here, and one press of the button takes the bracket off.
    name: '削除: 2音の括弧から1音消すと1音の括弧が残る',
    sheet: '@0 Cm7 3/2{ 1/5:8 1/7:8 } 1/8:4 1/10:4',
    run: ({ api }) => { api.at(0, 0, 1); api.del(); },
    text: 'Cm7 3/2{ 1/5:8 } 1/8:4 1/10',
    beats: 7 / 3,
  },
  {
    // And the button takes it off, rather than trying to count down from one.
    name: '3連ボタン: 1音の括弧は押すと外れる',
    sheet: '@0 Cm7 3/2{ 1/5:8 } 1/8:4 1/10:4 1/12:4',
    run: ({ api }) => { api.at(0, 0, 0); api.triplet(); },
    text: 'Cm7 1/5:8 1/8:4 1/10 1/12',
    beats: 3.5,
  },
  {
    // A stop written with no length takes no time from the bar, so it cannot be
    // one of the notes a bracket is over and the run stops at it.
    name: '3連ボタン: 長さなしの押弦で止まる',
    sheet: '@0 Cm7 1/5:8 F7 1/1+2/1+3/1+4/0 G7 1/8:8 1/10 1/12',
    run: ({ api, bars }) => { api.at(0, ...place(bars[0], 0)); },
    can: { triplet: false },
  },
  {
    name: '3連ボタン: 既存の3連に食い込むと押せない',
    sheet: '@0 Cm7 1/5:8 1/7:8t 1/8 1/10 1/12:8',
    run: ({ api, bars }) => { api.at(0, ...place(bars[0], 0)); },
    can: { triplet: false },
  },
  {
    // The bracket's whole point is that the time it takes is the ratio's, not
    // the values written inside it: an eighth and a quarter written under 3/2
    // are two thirds of each, which is the one beat a swung beat is.
    name: '連符: 1:2 に割った3連は1拍',
    sheet: '@0 D7 3/2{ 4/4:8 3/3+2/1:4 } r:4 r:4 r:4',
    run: () => {},
    beats: 4,
  },
  {
    // Five sixteenths in the time of four. Nothing has to know what a 5 means —
    // the ratio is written out and the beats fall out of it.
    name: '連符: 5連は分数のまま数えられる',
    sheet: '@0 Cm7 5/4{ 1/5:16 1/7 1/8 1/10 1/12 } r:4 r:4 r:4',
    run: () => {},
    beats: 4,
  },
  {
    // A bracket does not cross a bar line: a bar is parsed on its own, so one
    // left open ends with the bar and the next bar starts outside it.
    name: '連符: 閉じ忘れた括弧は小節で終わる',
    sheet: '@0 Cm7 3/2{ 1/8:8 1/10 1/12|@2 Cm7 1/8:4 1/10 1/12 1/5',
    run: () => {},
    beats: 1,
    then: [{ bar: 1, beats: 4 }],
  },
  {
    // The figure this piece of work is for: an eighth and a quarter in one 3
    // bracket, which is how a swung beat is written. It is reached the way it is
    // on paper — bracket three, then write what goes inside. The button brackets
    // the note and the two after it, the quarter is written on the second, and
    // the third is deleted, leaving the bracket over the two it holds.
    name: '3連ボタン: 1:2 に割った3連を作る',
    sheet: '@0 D7 4/4:8 3/3+2/1:8 r:8 r:4 r:4 r:4',
    run: ({ api, bars }) => {
      api.at(0, ...place(bars[0], 0)); api.triplet();
      api.at(0, ...place(bars[0], 1)); api.dur(1);
      api.at(0, ...place(bars[0], 2)); api.del();
    },
    text: 'D7 3/2{ 4/4:8 3/3+2/1:4 } r r r',
    beats: 4,
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
    text: 'Cm7 1/5:4 1/7*:8 3/2{ 1/8:8 1/10 1/12 }',
    beats: 2,
  },
  {
    // The quarter clears all three, rather than landing inside the triplet. Cm7
    // stays at the head of the bar — it is what the bar is read against, not a
    // mark on the note that happens to be written first. See keepBarHeads.
    name: '移動: 4分音符が3連をまるごと越える',
    sheet: '@0 Cm7 1/8:4 1/8:8t 1/10 1/12 1/8 1/10 1/12 1/8 1/10 1/12',
    run: ({ api, bars }) => { api.at(0, ...place(bars[0], 0)); api.move(1); },
    text: 'Cm7 3/2{ 1/8:8 1/10 1/12 } 1/8:4 3/2{ 1/8:8 1/10 1/12 } 3/2{ 1/8 1/10 1/12 }',
    beats: 4,
    carries: 'Note',
  },
  {
    name: '移動: 3連の中では1音ずつ入れ替わる',
    sheet: '@0 Cm7 1/8:4 1/8:8t 1/10 1/12 1/8 1/10 1/12 1/8 1/10 1/12',
    run: ({ api, bars }) => { api.at(0, ...place(bars[0], 1)); api.move(1); },
    text: 'Cm7 1/8:4 3/2{ 1/10:8 1/8 1/12 } 3/2{ 1/8 1/10 1/12 } 3/2{ 1/8 1/10 1/12 }',
    beats: 4,
  },
  {
    // Three notes go over together and the quarter comes back the other way, so
    // neither bar is left holding part of a triplet — and both still count four
    // beats. Each bar keeps the chord written at its own head.
    name: '移動: 3連は小節線をまたいで割れない',
    sheet: '@0 Cm7 1/8:4 1/8:8t 1/10 1/12 1/8 1/10 1/12 1/8 1/10 1/12|@2 F7 1/5:4 1/7 1/9 1/10',
    run: ({ api, bars }) => { api.at(0, ...place(bars[0], 9)); api.move(1); },
    text: 'Cm7 1/8:4 3/2{ 1/8:8 1/10 1/12 } 3/2{ 1/8 1/10 1/12 } 1/5:4',
    beats: 4,
    then: { bar: 1, text: 'F7 3/2{ 1/8:8 1/10 1/12 } 1/7:4 1/9 1/10', beats: 4 },
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
    text: 'Cm7 1/8:4 3/2{ 1/8:8 1/10 1/12 } 3/2{ 1/8 1/10 1/12 } 3/2{ 1/8 1/10 1/12 }',
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
    // Pressing what is already lit takes it off. The press that plainly means
    // "not this string" used to filter it out and put the same fret straight
    // back, which drew the same shape and read as a dead board.
    name: '板を叩く: 光っている弦を押すと外れる（スタックON）',
    sheet: '@0 Cm7 1/5+2/7:8 1/7',
    run: ({ api }) => { api.board({ stack: true }); api.at(0, 0, 0); api.press(2, 7); },
    text: 'Cm7 1/5:8 1/7', beats: 1,
  },
  {
    // The same press, with the board replacing rather than stacking: taking a
    // string off is about that string either way.
    name: '板を叩く: 光っている弦を押すと外れる（差し替えモード）',
    sheet: '@0 Cm7 1/5+2/7:8 1/7',
    run: ({ api }) => { api.at(0, 0, 0); api.press(2, 7); },
    text: 'Cm7 1/5:8 1/7', beats: 1,
  },
  {
    // The last string off leaves the beat where it was: a rest, not a hole the
    // notes after it slide into.
    name: '板を叩く: 最後の1本を外すと長さを保った休符になる',
    sheet: '@0 Cm7 1/5:8 1/7',
    run: ({ api }) => { api.at(0, 0, 0); api.press(1, 5); },
    text: 'Cm7 r:8 1/7', beats: 1,
  },
  {
    // On a rest a lit cell is the shape it remembers, so pressing it is that
    // note struck again rather than a string taken off something with none.
    name: '板を叩く: 休符の光っている弦を押すと音符に戻る',
    sheet: '@0 Cm7 1/5:8 1/7',
    run: ({ api }) => { api.at(0, 0, 0); api.press(1, 5); api.press(1, 5); },
    text: 'Cm7 1/5:8 1/7', beats: 1,
  },
  {
    // A stop written with no length of its own. Emptied it can no longer sound
    // until the next note — there is nothing to sound — so it takes the run's
    // duration and rests for it, which is what the R button does to one.
    name: '板を叩く: 長さなしの音を空にすると長さのある休符になる',
    sheet: '@0 Cm7 1/5:8 2/9:0',
    run: ({ api }) => { api.at(0, 0, 1); api.press(2, 9); },
    text: 'Cm7 1/5:8 r', beats: 1,
  },
  {
    // Taking a string off a note under a bracket is not a reason to fall out of
    // the triplet.
    name: '板を叩く: 3連の中で弦を外しても3連のまま',
    sheet: '@0 Cm7 1/5:8 1/7+2/9:8t 1/9 1/10 1/12:8',
    run: ({ api }) => { api.at(0, 0, 1); api.press(2, 9); },
    text: 'Cm7 1/5:8 3/2{ 1/7 1/9 1/10 } 1/12', beats: 2,
  },
  {
    name: '板を叩く: 3連の1音を差し替えても3連のまま',
    sheet: '@0 Cm7 1/5:8 1/7:8t 1/9 1/10 1/12:8',
    run: ({ api }) => { api.at(0, 0, 2); api.press(2, 9); },
    text: 'Cm7 1/5:8 3/2{ 1/7 2/9 1/10 } 1/12', beats: 2,
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
    text: 'Cm7 1/5:8 3/2{ 1/7 1/9 1/10 } 3/2{ 1/7 1/9 1/10 } 1/12', beats: 3,
  },
  {
    name: '削除: 選択した音を消す',
    sheet: '@0 Cm7 1/5:8 1/7 1/9',
    run: ({ api }) => { api.at(0, 0, 1); api.del(); },
    text: 'Cm7 1/5:8 1/9', beats: 1,
  },
  {
    // The bracket stays over what is left of it: two notes under a 3 is a swung
    // beat, not a mistake, so deleting one of three deletes one of three.
    name: '削除: 3連の1音だけ消えて括弧は残る',
    sheet: '@0 Cm7 1/5:8 1/7:8t 1/9 1/10 1/12:8',
    run: ({ api }) => { api.at(0, 0, 2); api.del(); },
    text: 'Cm7 1/5:8 3/2{ 1/7 1/10 } 1/12', beats: 5 / 3,
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
    text: 'Cm7 1/5:8 3/2{ 1/7 r 1/10 } 1/12', beats: 2,
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
    // The bracket says what the group is, so what it holds is free to change:
    // re-timing one note re-times that note, and the bracket keeps the rest.
    name: '長さ: 3連の1音だけ長さを変えられる',
    sheet: '@0 Cm7 1/5:8 1/7:8t 1/9 1/10 1/12:8',
    run: ({ api }) => { api.at(0, 0, 2); api.dur(1); },
    text: 'Cm7 1/5:8 3/2{ 1/7 1/9:4 1/10:8 } 1/12', beats: 7 / 3,
  },
  {
    // A dotted eighth under a 3 is ordinary printed music: the bracket is what
    // says the group is a triplet, so a dot inside it bends one note as usual.
    name: '付点: 3連の1音に付点をつけられる',
    sheet: '@0 Cm7 1/5:8 1/7:8t 1/9 1/10 1/12:8',
    run: ({ api }) => { api.at(0, 0, 2); api.dot(); },
    text: 'Cm7 1/5:8 3/2{ 1/7 1/9:8. 1/10:8 } 1/12', beats: 13 / 6,
  },
  {
    // The + opens its room where it was pressed, and a note written between two
    // under one bracket joins them — which is how a bracket grows.
    name: 'ギャップ: 3連の中で + を押すと括弧の中に開く',
    sheet: '@0 Cm7 1/5:8 1/7:8t 1/9 1/10 1/12:8',
    run: ({ api }) => { api.board({ dur: 0.5 }); api.at(0, 0, 2); api.gap(); api.press(2, 9); },
    text: 'Cm7 1/5:8 3/2{ 1/7 1/9 2/9 1/10 } 1/12', beats: 7 / 3,
  },
  {
    // The bracket already says the group is a triplet, so a note written into it
    // with the board's triplet mark on is not two thirds of two thirds.
    name: 'ギャップ: 板の3連マークが点いていても括弧の中では効かない',
    sheet: '@0 Cm7 1/5:8 1/7:8t 1/9 1/10 1/12:8',
    run: ({ api }) => {
      api.board({ dur: 0.5, triplet: true });
      api.at(0, 0, 2); api.gap(); api.press(2, 9);
    },
    text: 'Cm7 1/5:8 3/2{ 1/7 1/9 2/9 1/10 } 1/12', beats: 7 / 3,
  },
  {
    // Pressing it on a bracket of three lets the last note out: the bracket is
    // over two and the note let out keeps its value where it stands.
    name: '3連ボタン: もう一度押すと括弧が2音に縮む',
    sheet: '@0 Cm7 1/5:8 1/7:8t 1/9 1/10 1/12:8',
    run: ({ api }) => { api.at(0, 0, 2); api.triplet(); },
    text: 'Cm7 1/5:8 3/2{ 1/7 1/9 } 1/10 1/12', beats: 13 / 6,
  },
  {
    // The figure the whole change is for, made the short way: bracket the note
    // and the two after it, then press again to let the rest back out. Two
    // presses, nothing deleted, and the bar counts four again.
    name: '3連ボタン: 2回押して2音の3連にする',
    sheet: '@0 D7 4/4:8 3/3+2/1:4 r:4 r:4 r:4',
    run: ({ api, bars }) => {
      api.at(0, ...place(bars[0], 0)); api.triplet();
      api.at(0, ...place(bars[0], 0)); api.triplet();
    },
    text: 'D7 3/2{ 4/4:8 3/3+2/1:4 } r r r', beats: 4,
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
    // A head is a bar line: the bar before it ends there. A written end that
    // reaches past the new bar would swallow it — the row has no room in time
    // for a bar inside another — so it is drawn back to the new head.
    name: '小節を挟む: 前の小節の書かれた終わりが新しい頭まで詰まる',
    sheet: '@0-8 Cm7 1/5:8|@8-12 F7 1/9:8',
    run: ({ api }) => { api.insertBar(1, 4); },
    sheetText: '@0.00-4.00 Cm7 1/5:8\n@4.00\n@8.00-12.00 F7 1/9:8',
  },
  {
    // A bar left short of where the new one starts is a hole in the sheet, and
    // it says so on purpose — the same reason setBarStart leaves one alone.
    name: '小節を挟む: 空いている隙間は閉じない',
    sheet: '@0-3 Cm7 1/5:8|@8-12 F7 1/9:8',
    run: ({ api }) => { api.insertBar(1, 4); },
    sheetText: '@0.00-3.00 Cm7 1/5:8\n@4.00\n@8.00-12.00 F7 1/9:8',
  },
  {
    // Straight into the bar just made: it was asked for in order to write in it.
    name: '小節を挟む: 板がその小節を向く',
    sheet: '@0 Cm7 1/5:8|@4 F7 1/9:8',
    run: ({ api }) => { api.insertBar(1, 2); },
    at: { bar: 1, stretch: 0 },
  },
  {
    // A sheet written by playing along is one unbroken chain: the bar before ends
    // where this one starts. So the head is a bar line and both sides move.
    name: '小節の頭を動かす: 前の小節の終わりも動く',
    sheet: '@0-4 Cm7|@4-8 F7|@8-12 G7',
    run: ({ api }) => { api.setBarStart(1, 4.8); },
    sheetText: '@0.00-4.80 Cm7\n@4.80-8.00 F7\n@8.00-12.00 G7',
  },
  {
    // A bar left short of the next one is a hole in the sheet, and it says so on
    // purpose. Moving this head is no reason to close it.
    name: '小節の頭を動かす: 空いている隙間は閉じない',
    sheet: '@0-3 Cm7|@4-8 F7',
    run: ({ api }) => { api.setBarStart(1, 4.8); },
    sheetText: '@0.00-3.00 Cm7\n@4.80-8.00 F7',
  },
  {
    // Past the head before it and it is out of order; past its own end and it has
    // no length left.
    name: '小節の頭を動かす: 動かせる範囲は前の頭と自分の終わり',
    sheet: '@0-4 Cm7|@4-8 F7',
    run: () => {},
    bounds: { at: 1, after: 0, before: 8 },
  },
  {
    // Nothing before the first bar, so that side is not a limit.
    name: '小節の頭を動かす: 先頭の小節は前に限りがない',
    sheet: '@2-4 Cm7|@4-8 F7',
    run: () => {},
    bounds: { at: 0, after: null, before: 4 },
  },
];

// A phrase read in and written straight back out. Everything the app saves goes
// through that door — see sheetText — so a phrase that does not survive the trip
// is a phrase the app loses. Written out twice on purpose: the second pass
// catches a form that reads back as something other than what it was written as,
// which is the way a sheet quietly changes while nobody is editing it.
const WRITTEN = [
  {
    // A grace note inside a bracket stays inside it on the way out and on the
    // way back in: written outside, one bracket would come back as two.
    name: '読み書き: 装飾音符を挟んだ連符',
    sheet: '@0 Cm7 3/2{ 1/5:8 1/7*:8 1/8 1/10 } 1/12:8',
    text: '@0.00 Cm7 3/2{ 1/5:8 1/7*:8 1/8 1/10 } 1/12',
  },
  {
    // The figure the explicit bracket is for: one beat split 1:2, written as the
    // eighth and the quarter that are on the paper.
    name: '読み書き: 1:2 に割った3連',
    sheet: '@0 D7 3/2{ 4/4:8 3/3+2/1:4 } r:4 r:4 r:4',
    text: '@0.00 D7 3/2{ 4/4:8 3/3+2/1:4 } r r r',
  },
  {
    // `3/2` on its own is a note, so the brace has to be written against the
    // ratio. Written apart it is joined back rather than read as that note and a
    // chord named `{`.
    name: '読み書き: 3/2 { と空けて書いても連符になる',
    sheet: '@0 D7 3/2 { 4/4:8 3/3+2/1:4 } r:4',
    text: '@0.00 D7 3/2{ 4/4:8 3/3+2/1:4 } r',
  },
  {
    // A bracket is always one deep: a second one opened inside leaves the first
    // alone, and comes back written as the one bracket it was read as.
    name: '読み書き: 入れ子の連符は1つに畳まれる',
    sheet: '@0 Cm7 3/2{ 1/8:8 3/2{ 1/10 } 1/12 }',
    text: '@0.00 Cm7 3/2{ 1/8:8 1/10 1/12 }',
  },
  {
    // A bracket may run under a chord change, and comes back as one bracket
    // rather than one per stretch.
    name: '読み書き: コード変更をまたぐ連符',
    sheet: '@0 Eb9 3/2{ 1/6:8 Bbm7 1/9 1/10 }',
    text: '@0.00 Eb9 3/2{ 1/6:8 Bbm7 1/9:8 1/10 }',
  },
  {
    // Five in the time of four. The ratio is written out, so nothing has to know
    // what a 5 means.
    name: '読み書き: 5連',
    sheet: '@0 Cm7 5/4{ 1/5:16 1/7 1/8 1/10 1/12 }',
    text: '@0.00 Cm7 5/4{ 1/5:16 1/7 1/8 1/10 1/12 }',
  },
  {
    name: '読み書き: 付点・タイ・3連・押弦つきのコード名',
    sheet: '@5.07-7.60 Bb7:1.1.1.0.. 2/11+3/7+4/6_:4. 4/8:8 2/4+3/5 2/6+3/7:8t 3/6+4/7 3/6+4/7',
    text: '@5.07-7.60 Bb7:1.1.1.0.. 2/11+3/7+4/6_:4. 4/8:8 2/4+3/5 3/2{ 2/6+3/7 3/6+4/7 3/6+4/7 }',
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
  // The numeral under the staff. The degree and nothing else: the seventh and
  // the alterations are written in the chord's own name above it.
  { name: '度数: 主和音', got: () => Chords.romanNumeral('BbM7', Chords.parseKey('key: Bb')),
    want: 'I' },
  { name: '度数: 7th は書かない', got: () => Chords.romanNumeral('F7', Chords.parseKey('key: Bb')),
    want: 'V' },
  { name: '度数: 短3度は小文字', got: () => Chords.romanNumeral('Cm7', Chords.parseKey('key: Bb')),
    want: 'ii' },
  // ♭5 is part of the chord's name, not of its degree — the numeral says which
  // step of the key it is built on, and a half-diminished vii is built on vii.
  { name: '度数: m7b5 も小文字', got: () => Chords.romanNumeral('Am7b5', Chords.parseKey('key: Bb')),
    want: 'vii' },
  // Both thirds at once is a dominant wearing a ♯9, not a minor chord.
  { name: '度数: #9 は長調のまま', got: () => Chords.romanNumeral('E7#9', Chords.parseKey('key: C')),
    want: 'III' },
  { name: '度数: キー外の根音は調号側で綴る',
    got: () => Chords.romanNumeral('Db7', Chords.parseKey('key: Bb')), want: '♭III' },
  { name: '度数: シャープのキーでは♯側',
    got: () => Chords.romanNumeral('F#7', Chords.parseKey('key: C')), want: '♯IV' },
  // Everything else counts from the relative major, because that is where the
  // signature is. Numerals count from the tonic the sheet names: a tune in G
  // minor calls its own Gm i.
  { name: '度数: 短調は名乗った主音から数える',
    got: () => Chords.romanNumeral('Gm7', Chords.parseKey('key: Gm')), want: 'i' },
  { name: '度数: 短調の V', got: () => Chords.romanNumeral('D7', Chords.parseKey('key: Gm')),
    want: 'V' },
  { name: '度数: キーがなければ出さない', got: () => Chords.romanNumeral('Cm7', null), want: '' },
  { name: '度数: ベース移動には出さない',
    got: () => Chords.romanNumeral('/Bb', Chords.parseKey('key: C')), want: '' },
];

// Times, and the link a loop is shared as. A bar's `@` is where it starts and
// the end is worked out from what is around it — see resolveSpans — so a sheet
// written bar by bar with no end times still knows where every chord sounds.
// The share link is the one piece of the app that leaves the machine, so what it
// carries is checked to the character.
const share = (() => {
  const src = ['formatTime', 'buildShareUrl', 'buildShareLabel', 'buildShareMarkdown',
    'barRangeFor'].map(liftOne).join('\n');
  // The real bar numbering rather than a stub of it: which bars a range covers is
  // the part of the label that can be wrong, so it is run over a real sheet.
  return new Function('shim', 'Chords', `
    const NOTE_MAX = 30;
    const RANGE_EPS = 0.005;
    const location = shim.location;
    // Both read the browser's storage in the app; a case says them outright.
    function resolveVideoTitle() { return shim.title; }
    function getSheet() { return shim.sheet; }
    ${src}
    return { formatTime, buildShareUrl, buildShareLabel, buildShareMarkdown, barRangeFor,
      title(t) { shim.title = t; }, sheet(t) { shim.sheet = t; } };`)({
    location: { origin: 'https://cortyuming.github.io', pathname: '/yt-loop/' },
    title: '',
    sheet: '',
  }, Chords);
})();

// ---------- a bass move under held harmony ----------
// `/Bb` is where the bass went, not a chord — the way a lead sheet writes a bass
// walking under harmony that has not moved. It names nothing the parser can
// count from, so what the labels and the diagram dots under one read against is
// the chord still in force above it; see rulingWalk. The row's walk is what
// carries that, so these run it the way barShapes in main.js does — the pair is
// the name the sheet prints and the harmony it is read against.
function shapeRuling(sheet) {
  const out = [];
  const bars = Chords.parseSheet(sheet);
  bars.forEach((bar, barIndex) => {
    const walk = Chords.rulingWalk(Chords.rulingBefore(bars, barIndex));
    bar.chords.forEach(chord => {
      const ruling = walk(chord.name);
      if (chord.markers && chord.markers.some(f => f !== null)) {
        out.push([chord.name || '', ruling]);
      }
      for (const sh of Chords.stopShapes(chord.notes, chord.name, [], walk)) {
        out.push([sh.name, sh.ruling]);
      }
    });
  });
  return out;
}

const BASS = [
  { name: 'ベース移動: 和音でない名前を見分ける',
    got: () => ['/Bb', '/C#', '/ab', 'Bb', 'Bbm7', 'C/Bb', '/Bb9', '']
      .map(n => Chords.isBassOnly(n)),
    want: [true, true, true, false, false, false, false, false] },
  { name: 'ベース移動: 音符に書かれたベース名は上の和音を保つ',
    got: () => shapeRuling('key: C\n@0 E7#9 2/8+3/7+4/6:8 1/6+2/6+3/6+4/5(/Bb) '
      + '1/9+2/9+3/10+4/8(A7) 1/6+2/6+3/6+4/5(/C#)'),
    want: [['E7#9', 'E7#9'], ['/Bb', 'E7#9'], ['A7', 'A7'], ['/C#', 'A7']] },
  { name: 'ベース移動: コード欄に書かれてもストレッチをまたいで保つ',
    got: () => shapeRuling('key: C\n@0 E7#9 2/8+3/7+4/6:8 /Bb 1/6+2/6+3/6+4/5:8'),
    want: [['E7#9', 'E7#9'], ['/Bb', 'E7#9']] },
  // The walk has to see every name, not only the ones a shape carries: a chord
  // written on a note that struck one string leaves no diagram behind and still
  // moves the harmony on.
  { name: 'ベース移動: グリップの間の単音に書かれた和音を飛ばさない',
    got: () => shapeRuling('key: C\n@0 E7#9 2/8+3/7+4/6:8 5/5(A7) 1/6+2/6+3/6+4/5(/C#)'),
    want: [['E7#9', 'E7#9'], ['/C#', 'A7']] },
  // The first bar of a sheet opening on a bass move has nothing above it to hold.
  // The name is handed back as it was written rather than as no name at all: it
  // names no chord, so the labels under it are plain note names — which is what
  // it honestly is. Handed back as no name it would have been read against C,
  // and ♭5 would have printed as ♭7.
  { name: 'ベース移動: 保つものがなければ書かれたまま返す',
    got: () => shapeRuling('key: C\n@0 /Bb 1/6+2/6+3/6+4/5:8'),
    want: [['/Bb', '/Bb']] },
  // The reach that matters most: a bass walking into the next bar. Ties reach
  // back across a bar line for the strings they hold and this is the same kind
  // of reach — see Chords.carriedStops.
  { name: 'ベース移動: 小節線をまたいで和音を保つ',
    got: () => shapeRuling('key: C\n@0 E7#9 2/8+3/7+4/6:8\n'
      + '@2 /Bb 1/6+2/6+3/6+4/5:8'),
    want: [['E7#9', 'E7#9'], ['/Bb', 'E7#9']] },
  // Past a bar that names no chord at all, which is an absence rather than a
  // chord statement — a transcription writes its harmony every few bars.
  { name: 'ベース移動: 名前のない小節を越えて和音を保つ',
    got: () => shapeRuling('key: C\n@0 E7#9 2/8+3/7+4/6:8\n@2 1/6+2/6+3/6+4/5:8\n'
      + '@4 /C# 1/9+2/9+3/10+4/8:8'),
    want: [['E7#9', 'E7#9'], ['', ''], ['/C#', 'E7#9']] },
];

// ---------- a Start that outruns the End ----------
// Walking Start down the sheet used to be refused whenever it passed the End the
// range already held — the pair describes nothing, so the door kept it out. At
// the door, though, it is known which box was aimed at, so the other one is stale
// by construction and there is nothing left to guess: the End follows to the
// first bar line after the new Start. These run the real functions over stub
// boxes, because which box moved is the whole of the rule.
const rangeModule = (() => {
  const src = ['formatTime', 'formRange', 'refusesRange', 'rangeIsEmpty',
    'linkEndFor', 'nextBarEdge', 'endForStart', 'takesRange'].map(liftOne).join('\n');
  const make = new Function('shim', 'Chords', `
    const RANGE_EPS = 0.005;
    const startInput = shim.startInput;
    const endInput = shim.endInput;
    const player = shim.player;
    const currentVideoId = 'v';
    const chordCache = shim.chordCache;
    // The sheet never changes under a case, so the cache is always the fresh one.
    function refreshChordCache() { return chordCache; }
    function refreshUI() { shim.refreshed++; }
    function flashElements(els) {
      shim.flashed.push(...els.filter(Boolean).map(el => el.id));
    }
    ${src}
    return { formatTime, refusesRange, rangeIsEmpty, linkEndFor,
      nextBarEdge, endForStart, takesRange };`);
  return shim => make(shim, Chords);
})();

// One case's boxes and sheet, built fresh so no case inherits the End another
// one moved.
function rangeCase(opts) {
  const box = id => ({ id, value: '', dataset: {} });
  const bars = Chords.parseSheet(opts.sheet || '');
  const shim = {
    startInput: box('start'),
    endInput: box('end'),
    player: opts.duration === undefined ? null : { getDuration: () => opts.duration },
    chordCache: { vid: 'v', bars, spans: Chords.resolveSpans(bars) },
    flashed: [],
    refreshed: 0,
  };
  shim.startInput.value = opts.start || '';
  shim.endInput.value = opts.end || '';
  return { shim, api: rangeModule(shim) };
}

// Four bars of two seconds each, so every boundary is easy to name: heads at
// 10, 12, 14 and 16, and the last bar ends at 18 by borrowing the length of the
// one before it — see Chords.resolveSpans.
const FOUR_BARS = '@10 C7|@12 F7|@14 C7|@16 G7';

// What the End becomes for a Start dropped at `at`.
function endFor(at, opts) {
  const { api } = rangeCase(opts || { sheet: FOUR_BARS });
  return api.endForStart(at);
}

// Put `start` into Start against a range that already ends at `end`, and report
// what the pair became. `taken` is what the door answered.
function outrun(opts) {
  const { shim, api } = rangeCase(opts);
  const taken = api.takesRange(shim.startInput, opts.set);
  return { taken, end: shim.endInput.value, flashed: shim.flashed };
}

const RANGE = [
  { name: '追従: 新しい Start が入る小節の終わり（＝次の小節の頭）',
    got: () => endFor(12.5), want: 14 },
  { name: '追従: 小節の頭ぴったりならその小節を1つ鳴らす長さ',
    got: () => endFor(12), want: 14 },
  { name: '追従: 最後の小節なら借りた終わり',
    got: () => endFor(16.5), want: 18 },
  // Past every bar there is no bar line left to find, so the video's end is what
  // is left.
  { name: '追従: 小節を全部過ぎたら動画の終わり',
    got: () => endFor(20, { sheet: FOUR_BARS, duration: 30 }), want: 30 },
  { name: '追従: 譜面がなければ動画の終わり',
    got: () => endFor(20, { sheet: '', duration: 30 }), want: 30 },
  // A sheet whose bars carry no times has no boundaries to offer either.
  { name: '追従: 時刻のない譜面は動画の終わり',
    got: () => endFor(20, { sheet: 'C7|F7', duration: 30 }), want: 30 },
  { name: '追従: 動画の終わりも Start より前なら諦める',
    got: () => endFor(40, { sheet: FOUR_BARS, duration: 30 }), want: null },
  { name: '追従: 動画も譜面もなければ諦める',
    got: () => endFor(20, { sheet: '' }), want: null },

  // The door itself.
  { name: '門: End を追い越した Start は End を連れていく',
    got: () => outrun({ sheet: FOUR_BARS, start: '0:11.00', end: '0:12.00', set: '0:15.00' }),
    want: { taken: true, end: '0:16.00', flashed: ['end'] } },
  { name: '門: 順番どおりの値は何も動かさない',
    got: () => outrun({ sheet: FOUR_BARS, start: '0:11.00', end: '0:16.00', set: '0:13.00' }),
    want: { taken: true, end: '0:16.00', flashed: [] } },
  // Nothing to move the End to, so the value is refused the way it always was.
  { name: '門: 入れる先がなければ従来どおり断る',
    got: () => outrun({ sheet: '', start: '0:11.00', end: '0:12.00', set: '0:15.00' }),
    want: { taken: false, end: '0:12.00', flashed: [] } },
  // What lands in the box is text at two decimals, and everything downstream reads
  // it back through parseTime — so what has to clear the Start is the value that
  // survives that round trip, not the number endForStart picked. Two decimals lose
  // at most 0.005 and the margin endForStart insists on is more than 0.005, so it
  // clears by a hair. That is a coincidence between two constants that do not look
  // related: take formatTime to one decimal, or shrink RANGE_EPS, and a Start could
  // be left with an End equal to it — which reverses nothing, so no warning fires,
  // and the loop simply never runs. Here so that change fails out loud.
  { name: '追従: 丸めを通しても End は Start を必ず越える',
    got: () => {
      // Times whose third decimal is a 5 that rounds away, which is where two
      // decimals lose the most.
      const tight = [1.005, 2.005, 8.005, 16.005, 27.955, 1.045, 2.675, 300.005, 0.005];
      return tight.filter(at => {
        const edge = at + 0.005 + 1e-6;
        const { api } = rangeCase({ sheet: `@${at} C7|@${edge} F7` });
        const end = api.endForStart(at);
        if (end === null) return false;
        return !(Chords.parseTime(api.formatTime(end)) > at);
      });
    },
    want: [] },
  // Ends that land exactly on the other one. loopRange gives up on `s >= e`, so a
  // pair like that is a Loop toggle lit over nothing — and nothing is reversed
  // there, so the ⚠ never fired either. Both halves now agree it is no range.
  { name: '門: Start と同じ End は断る',
    got: () => {
      const { shim, api } = rangeCase(
        { sheet: FOUR_BARS, start: '0:13.00', end: '0:16.00' });
      return { taken: api.takesRange(shim.endInput, '0:13.00'),
        empty: (() => { shim.endInput.value = '0:13.00'; return api.rangeIsEmpty(); })() };
    },
    want: { taken: false, empty: true } },
  // The same value from the other side takes the End along rather than being
  // turned away, since a Start is what these doors are for.
  { name: '門: End と同じ Start は End を連れていく',
    got: () => outrun({ sheet: FOUR_BARS, start: '0:11.00', end: '0:13.00', set: '0:13.00' }),
    want: { taken: true, end: '0:14.00', flashed: ['end'] } },

  // A share link is the one way into the form that is not a door, so an End it
  // cannot make a range of is dropped on the way in — see linkEndFor. Left in, it
  // was the only remaining way to reach the ⚠ on Play.
  { name: 'リンク: End が Start より後ならそのまま',
    got: () => rangeCase({}).api.linkEndFor(10, 14), want: 14 },
  { name: 'リンク: End が Start と同じなら捨てる',
    got: () => rangeCase({}).api.linkEndFor(10, 10), want: undefined },
  { name: 'リンク: End が Start より前なら捨てる',
    got: () => rangeCase({}).api.linkEndFor(10, 4), want: undefined },
  { name: 'リンク: Start がなければ End はそのまま',
    got: () => rangeCase({}).api.linkEndFor(undefined, 14), want: 14 },
  { name: 'リンク: End がなければ何も返さない',
    got: () => rangeCase({}).api.linkEndFor(10, undefined), want: undefined },

  // The mirror image is left alone on purpose: someone placing an End is saying
  // where to stop, and moving their Start for them is a longer guess.
  { name: '門: Start より前の End は直さない',
    got: () => {
      const { shim, api } = rangeCase(
        { sheet: FOUR_BARS, start: '0:15.00', end: '0:16.00' });
      const taken = api.takesRange(shim.endInput, '0:11.00');
      return { taken, start: shim.startInput.value, flashed: shim.flashed };
    },
    want: { taken: false, start: '0:15.00', flashed: [] } },
];

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
  { name: '時刻を読む: 秒だけ', got: () => Chords.parseTime('43.50'), want: 43.5 },
  { name: '時刻を読む: 分と秒', got: () => Chords.parseTime('1:07.30'), want: 67.3 },
  { name: '時刻を読む: 時と分と秒', got: () => Chords.parseTime('1:02:03.5'), want: 3723.5 },
  { name: '時刻を読む: 時刻でないもの', got: () => Chords.parseTime('あとで'), want: null },
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
    got: () => { share.title(''); share.sheet(''); return share.buildShareLabel('abc123', LOOP); },
    want: '0:26.83 → 0:29.25 F7 の E♭' },
  // Which bars a loop covers. Bar 2 starts exactly where the loop ends, so it is
  // not in it: taking one bar's time for the start and the next but one's for the
  // end plays what lies between them.
  { name: '共有の小節: 区間の中で鳴る小節だけ数える',
    got: () => { share.sheet('@0-4 C7|@4-8 F7|@8-12 G7');
      return share.barRangeFor('abc123', { start: 0, end: 4 }); },
    want: 'bar 1' },
  { name: '共有の小節: 複数なら bars で範囲',
    got: () => { share.sheet('@0-4 C7|@4-8 F7|@8-12 G7');
      return share.barRangeFor('abc123', { start: 0, end: 9 }); },
    want: 'bars 1-3' },
  // Starting mid-bar is the ordinary case — a loop caught by ear — and the bar it
  // starts inside is one of the bars it plays.
  { name: '共有の小節: 小節の途中から始まってもその小節から',
    got: () => { share.sheet('@0-4 C7|@4-8 F7|@8-12 G7');
      return share.barRangeFor('abc123', { start: 2, end: 6 }); },
    want: 'bars 1-2' },
  { name: '共有の小節: 譜面の外なら出さない',
    got: () => { share.sheet('@0-4 C7');
      return share.barRangeFor('abc123', { start: 20, end: 24 }); },
    want: null },
  { name: '共有の小節: 譜面がなければ出さない',
    got: () => { share.sheet(''); return share.barRangeFor('abc123', LOOP); },
    want: null },
  { name: '共有の見出し: 小節の範囲も入る',
    got: () => {
      share.title('Autumn Leaves');
      share.sheet('@24-26 C7|@26-28 F7|@28-30 G7');
      return share.buildShareLabel('abc123', LOOP);
    },
    want: 'Autumn Leaves (0:26.83 → 0:29.25) bars 2-3 F7 の E♭' },
  // The count in a bar's head, and only where it is not four — see barBeatLabel.
  { name: '拍数: 4拍ぴったりなら出さない',
    got: () => open('@0 Cm7 1/5:4 1/7 1/9 1/10').api.beatLabel(), want: null },
  { name: '拍数: 3連12個も4拍として出さない',
    got: () => open('@0 Cm7 1/5:8t 1/7 1/9 1/10 1/12 1/5 1/7 1/9 1/10 1/12 1/5 1/7')
      .api.beatLabel(), want: null },
  { name: '拍数: 超えていたら赤',
    got: () => open('@0 Cm7 1/5:4 1/7 1/9 1/10 1/12:8').api.beatLabel(), want: '4.5/4 赤' },
  { name: '拍数: 足りなければ灰',
    got: () => open('@0 Cm7 1/5:4 1/7 1/9').api.beatLabel(), want: '3/4 灰' },
  { name: '拍数: 3連1つぶんの端数は2桁まで',
    got: () => open('@0 Cm7 1/5:4 1/7 1/9 1/10 1/12:8t').api.beatLabel(), want: '4.33/4 赤' },
  // A bar of plain chords carries no rhythm to be right or wrong about.
  { name: '拍数: 音符のない小節には出さない',
    got: () => open('@0 Cm7 F7 G7 C7').api.beatLabel(), want: null },
  { name: '拍数: 装飾音符は数に入らない',
    got: () => open('@0 Cm7 1/5:4 1/7 1/9 1/10 1/12*:8').api.beatLabel(), want: null },
  // Counted over the bar, not per stretch: three triplets under three chords are
  // still one beat.
  // A stop alone in its stretch with no length written is read as a fingering,
  // not a note — see markFreeNotes — so the lengths are written out here.
  { name: '拍数: 区間をまたいで数える',
    got: () => open('@0 Cm7 1/5:8t F7 1/7:8t G7 1/9:8t').api.beats(), want: 1 },
  { name: '共有の markdown',
    got: () => {
      share.title('Autumn Leaves');
      share.sheet('');
      return share.buildShareMarkdown('abc123', LOOP);
    },
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
for (const [name, entry] of Object.entries(DRAWN)) {
  // A case is the sheet on its own, or the sheet with the dot mode it is about
  // — 'number' being what the strip opens in and so what a bare case means.
  const sheet = typeof entry === 'string' ? entry : entry.sheet;
  const mode = typeof entry === 'string' ? 'number' : entry.mode;
  const file = path.join(SNAPS, `${name}.svg`);
  let drawn;
  try {
    drawn = `${draw(sheet, mode)}\n`;
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
  // How far a bar's head may move — the two limits, either of which can be
  // absent where there is nothing on that side to be limited by.
  if (c.bounds) {
    const got = sheet.api.bounds(c.bounds.at);
    for (const side of ['after', 'before']) {
      if (!(got[side] === null && c.bounds[side] === null) && !near(got[side], c.bounds[side])) {
        checks.push(`    小節${c.bounds.at + 1}の${side}  got ${got[side]}  want ${c.bounds[side]}`);
      }
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
answers('ベース移動', BASS);
answers('範囲の追従', RANGE);
answers('時間と共有', TIMES);

const drawnCount = Object.keys(DRAWN).length;
console.log(`\n描画 ${drawnCount} 件 / 編集 ${EDITED.length} 件`
  + ` / テキスト ${WRITTEN.length} 件 / 箱 ${READ.length} 件`
  + ` / ベース移動 ${BASS.length} 件 / 範囲の追従 ${RANGE.length} 件`
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
