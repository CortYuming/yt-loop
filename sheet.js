// ============================================================
// The sheet, as it is edited
// ============================================================
// Three files hold the chord sheet between them:
//
//   chords.js  the notation itself — a sheet read from text, and drawn back out
//              as an <svg>, with the theory behind both. Text in, data or an
//              element out, and nothing kept between calls.
//   sheet.js   this file: the edits a parsed sheet takes — a bar added, a bar
//              line moved, a note written, a triplet bracketed. The parse in,
//              the same parse changed, and nothing about the page it is on.
//   main.js    the page — the row, the panel, the boxes, the keyboard, and
//              where the video is.
//
// The parse is not copied in. The page holds it, replaces it whole on every
// re-parse, and hands the current one over through `cache()` — a copy kept
// here would be editing a sheet nobody can see. Every edit ends by going back
// out the way it came: written to the text box, and the row redrawn. Both are
// the page's own doing, handed over in init.
//
// Nothing here reaches for the document, which is what lets the checker run
// every edit in this file under node — see scripts/check.js.

const Sheet = (() => {
  'use strict';

  // What the page hands over at start-up:
  //   cache()             the parse being edited — its bars, spans and key
  //   writeSheet(source)  the edit, written back out to the text box and the
  //                       history; `source` says what kind of edit it was
  //   renderStrip(cached) the row, redrawn — see renderChordStrip
  //   openPanel(bar, i)   the board, opened on a stretch of a bar
  //   now()               where the video is
  //   settled(t)          that moment as the row reads it — see settledTime
  let page = null;

  function init(host) { page = host; }

  const cache = () => page.cache();

  // Two times this close are the same moment. A bar line heard and a bar line
  // typed agree to about this much, and it is what says whether the pair the
  // sheet keeps — this bar's start and the one before it's end — was written as
  // one line or as a gap left on purpose. main.js keeps a tolerance of its own
  // for the ranges in the history: a different question with the same answer.
  const RANGE_EPS = 0.005;

  function roundTo(n, digits) {
    const p = Math.pow(10, digits);
    return Math.round(n * p) / p;
  }

  // What a bar's phrase actually counts, over the whole of it rather
  // than one stretch at a time — three eighth triplets under three
  // chords are still one beat. Null where nothing is written: a bar
  // of plain chords carries no rhythm to be right or wrong about.
  function barBeats(bar) {
    let beats = 0;
    let any = false;
    for (const chord of (bar && bar.chords) || []) {
      if (!chord.notes || !chord.notes.length) continue;
      any = true;
      beats += Chords.noteBeats(chord.notes).length;
    }
    return any ? beats : null;
  }

  // What the bar's head has to say about its count, and only where it is not
  // four. A bar that adds up is the ordinary case and saying so on every bar
  // of a sheet is noise; a bar that does not is the one thing about it nothing
  // on screen used to say. Undoing a triplet leaves a bar half a beat long,
  // and beatFit then squeezes the phrase into the room the bar has — so the
  // sheet reads as usual and the count is the only place the truth shows.
  // `over` is a bar that cannot be played as written; short of four is a
  // phrase still being written. Null where there is nothing to say.
  function barBeatText(bar) {
    const beats = barBeats(bar);
    if (beats === null || Math.abs(beats - Chords.BEATS_PER_BAR) < 1e-9) return null;
    // Thirds of a beat do not come out even, so the count is
    // written to as many places as it needs and no more: 4.5 rather
    // than 4.50, 4.33 for a stray triplet.
    return { shown: String(Number(beats.toFixed(2))), over: beats > Chords.BEATS_PER_BAR };
  }

  // Whether a bar's first event is a tie — a note held over the bar
  // line into it.
  function barOpensOnTie(bar) {
    for (const chord of (bar && bar.chords) || []) {
      if (chord.notes && chord.notes.length) return !!chord.notes[0].tie;
    }
    return false;
  }

  // The three steps that follow an edit made on the row rather than in the
  // text box: the cached spans are worked out per parse, so a bar added or a
  // bar line moved leaves them describing the sheet as it was — recompute,
  // write the text back out, and redraw from the cache rather than from the
  // text just written. `source` reaches the page's writeSheet, which uses it
  // to decide what the edit was for the history it keeps.
  function commitChordEdit(source) {
    const held = cache();
    held.spans = Chords.resolveSpans(held.bars);
    page.writeSheet(source);
    page.renderStrip(true);
  }

  // A bar that isn't there yet. It starts where the last one ends,
  // which is what a transcription does — bar after bar — and at the
  // playhead when there is no last one to follow. The bar arrives
  // holding one empty chord, so it is a cell with a name box and a ♪
  // rather than an empty box nobody can write into: the sheet still
  // keeps nothing until something is actually typed or tapped.
  function addBar() {
    const bars = cache().bars;
    // The cache's own spans, not a fresh resolve: they are the resolve
    // of these same bars, kept in step by every edit that touches them.
    const spans = cache().spans;
    const last = spans[spans.length - 1];
    const after = last ? (last.end !== null ? last.end : last.start) : null;
    const start = roundTo(
      after === null ? page.settled(page.now()) : after, 2);
    bars.push({ start, end: null, chords: [{ name: '', markers: null }] });
    commitChordEdit();
    // Straight into the bar just made: the button was pressed to
    // write something, and the board is where writing happens.
    page.openPanel(cache().bars.length - 1, 0);
  }

  // A bar between two others, at the moment the video is at — which is what
  // someone pressing this is looking at. It arrives holding one empty chord,
  // the way a bar added at the end does, so there is something to write into.
  function insertBar(at, start) {
    const bars = cache().bars;
    const time = start === null || start === undefined ? null : roundTo(start, 2);
    // A new head is a new bar line, so the bar before it ends there. Left
    // alone, a bar written `@0.50-5.20` keeps an end that reaches past the bar
    // just made and swallows it: the row has no room in time for a bar inside
    // another, so it draws it with none — a stretch the playhead crosses in a
    // single frame and every drag settles at the far side of. Only where the
    // written end actually reaches past the new head; one that stops short of
    // it is a hole in the sheet and says so on purpose. setBarStart moves the
    // same bar line from the other side, for the same reason.
    const prev = bars[at - 1];
    if (time !== null && prev && prev.end !== null && prev.end > time
        && (prev.start === null || prev.start < time)) {
      prev.end = time;
    }
    bars.splice(at, 0, {
      start: time,
      end: null,
      chords: [{ name: '', markers: null }],
    });
    commitChordEdit();
    // Straight into the bar just made: it was asked for in order to
    // write in it.
    page.openPanel(at, 0);
  }

  // How far a bar's head can move: past the head of the bar before
  // it and it is out of order, past its own end and it has no length
  // left. Either side can be unknown — the first bar of a sheet has
  // nothing before it, a bar whose end nobody wrote and nothing to
  // work it out from has no end — and then that side is not a limit.
  function barTimeBounds(index) {
    const spans = cache().spans;
    const prev = spans[index - 1];
    const own = spans[index];
    return {
      after: prev && prev.start !== null ? prev.start : null,
      before: own && own.end !== null ? own.end : null,
    };
  }

  // The bar's own `@`, moved. A time caught by ear is caught slightly
  // late, which is a bar line in the wrong place; putting it right
  // meant opening the text box and finding that bar among thirty others
  // written the same way. The head knows which bar it is. Moving a head
  // moves a bar line: the bar before ends where this one starts, and a
  // sheet written by playing along is one unbroken chain of them. So
  // the pair moves together and nothing after them is touched — what
  // changes is the length of the two bars either side of the line.
  function setBarStart(index, t) {
    const bars = cache().bars;
    const bar = bars[index];
    if (!bar) return;
    const start = roundTo(t, 2);
    const was = bar.start;
    const prev = bars[index - 1];
    bar.start = start;
    // Only where the two were the same moment. A bar deliberately left
    // short of the next one — a hole in the sheet — says so on
    // purpose, and moving this head is no reason to close it.
    if (prev && prev.end !== null && was !== null && Math.abs(prev.end - was) <= RANGE_EPS) {
      prev.end = start;
    }
    commitChordEdit('bar-time');
  }

  return {
    init,
    roundTo, barBeats, barBeatText, barOpensOnTie,
    commitChordEdit, addBar, insertBar, barTimeBounds, setBarStart,
  };
})();
