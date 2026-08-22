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
  'barNoteEvents', 'tripletGroup', 'noteCanTriplet', 'toggleNoteTriplet',
  'sheetEvents', 'pinnedNote', 'writeBarsFromEvents', 'selectedEventIndex',
  'moveBlock', 'moveSelection', 'dropDanglingBeams', 'barHead', 'keepBarHeads',
  'selectedIsChord',
];
function lift(name) {
  const at = MAIN.indexOf(`\nfunction ${name}(`);
  if (at < 0) throw new Error(`main.js に function ${name} が見つかりません（改名したら LIFTED を直す）`);
  const rest = MAIN.slice(at + 1);
  const end = rest.indexOf('\n}\n');
  if (end < 0) throw new Error(`function ${name} の終わりが読めません`);
  return rest.slice(0, end + 3);
}
const LIFTED_SRC = LIFTED.map(lift).join('\n');

// A sheet, opened for editing. `at(bar, stretch, note)` is where the panel is
// pointing; everything else is the stubs those functions call into.
function open(sheet) {
  const bars = Chords.parseSheet(sheet);
  const state = { Chords, chordCache: { bars }, writes: 0, carried: null };
  const api = new Function('state', `
    const Chords = state.Chords, chordCache = state.chordCache;
    let notePanelAt = { bar: 0, chord: 0 }, noteSel = null, noteAfter = null;
    let noteTriplet = false, noteDotted = false;
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
    ${LIFTED_SRC}
    return {
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
      // What the move button says is about to travel — see selectedIsChord.
      carries: () => (selectedIsChord() ? 'Chord' : 'Note'),
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
    can: false,
  },
  {
    name: '3連ボタン: 既存の3連に食い込むと押せない',
    sheet: '@0 Cm7 1/5:8 1/7:8t 1/8 1/10 1/12:8',
    run: ({ api, bars }) => { api.at(0, ...place(bars[0], 0)); },
    can: false,
  },
  {
    name: '3連ボタン: 装飾音符では押せない',
    sheet: '@0 Cm7 1/5:4 1/7*:8 1/8 1/10 1/12',
    run: ({ api, bars }) => { api.at(0, ...place(bars[0], 1)); },
    can: false,
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
];

// ---------- running them ----------
let failed = 0, updated = 0;
const say = (ok, name, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `\n${detail}` : ''}`);
};
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
  if (c.can !== undefined) {
    const can = sheet.api.canTriplet();
    if (can !== c.can) checks.push(`    押せるか  got ${can}  want ${c.can}`);
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
  say(!checks.length, c.name, checks.join('\n'));
}

const drawnCount = Object.keys(DRAWN).length;
console.log(`\n描画 ${drawnCount} 件 / 編集 ${EDITED.length} 件`
  + `${updated ? ` / snapshot ${updated} 件を書きました` : ''}`);
if (failed) {
  console.log(`\n失敗 ${failed} 件`);
  console.log('描画が変わったのが意図した変更なら、node scripts/check.js --update で snapshot を更新して'
    + '差分をコミットに含めてください。');
  process.exit(1);
}
console.log('すべて通りました');
