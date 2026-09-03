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
  //   videoId()           which video that parse is of — see noteStretch
  //   writeSheet(source)  the edit, written back out to the text box and the
  //                       history; `source` says what kind of edit it was
  //   commit()            a ♪ edit, filed for ↺ and then written out the same
  //                       way — see commitNotes
  //   renderStrip(cached) the row, redrawn — see renderChordStrip
  //   renderPanel()       the panel, drawn again where no redraw is due
  //   markSelection()     the marks in the row that say where the caret is
  //   focusPanel()        the board, given the keyboard
  //   now()               where the video is
  //   settled(t)          that moment as the row reads it — see settledTime
  let page = null;

  // The page, and a sheet nothing has been written on yet. The checker opens
  // a case the same way, so one case never starts on the board another left.
  function init(host) {
    page = host;
    clearCaret();
    // An eighth, written plain, one note at a time, with every string ringing.
    setBoard({ dur: 0.5, dotted: false, triplet: false, stack: false, dead: false });
  }

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
    openNotePanel(cache().bars.length - 1, 0);
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
    openNotePanel(at, 0);
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

  // ============================================================
  // Single notes (♪)
  // ============================================================
  // The notes played over a chord, written by tapping them on a board of the
  // whole neck. Where a note falls is never typed: it lands after the one before
  // it and the durations stack up, so re-timing one slides everything after it
  // along — which is the whole reason the position is not a number you have to
  // keep.

  // ---------- what is being written, and what a tap writes ----------
  // Which stretch is being written into, held as a position rather than as the
  // object: the sheet can be re-parsed under the panel — someone types in the
  // textarea — and a held object would then be editing a copy nobody can see.
  let notePanelAt = null;
  // The note being edited, or null while writing at the end.
  // Clicking a note in the strip is what puts one here.
  let noteSel = null;
  // Armed by the + between ← and →: the next thing written goes in
  // just after this note rather than at the end of the stretch.
  // Which is how a note is put between two others, and how the next
  // chord is begun without letting go of stacking — what is written
  // lands on a place of its own rather than piling onto the last.
  let noteAfter = null;

  // The board's own state: what a tap writes when nothing is selected. The
  // values it starts at are in init, so there is one place they are written.
  let noteDur;
  let noteDotted;
  // Three in the time of two. It sits with the dot rather than with
  // the durations: both of them bend whatever value is chosen
  // rather than being one.
  let noteTriplet;
  // While on, a tap piles onto the last note instead of following
  // it, which is how a double stop gets written.
  let noteStack;
  // While on, a fret tapped says that string of the note is muted
  // rather than where the note is: the ✕ button, and the way a chord
  // ringing on top of muted courses is written — tap the strings the
  // hand kills. Tapping one it already mutes lets it ring again.
  let noteDeadMode;

  // 0 is not a duration but the lack of one: a stop with no length sounds until
  // the next thing does, which is what a chord is. It is how a fingering is
  // tapped out, so it sits with the durations rather than off on its own.
  const NO_DUR = 0;
  const noteValue = () => noteDur * (noteDotted ? 1.5 : 1) * (noteTriplet ? 2 / 3 : 1);
  // A rest and a tie have to last something, so they fall back to a
  // quarter when the board is set to write chords.
  const restValue = () => noteValue() || 1;

  // The caret, kept inside a stretch that has lost notes under it:
  // the sheet can be re-parsed or typed over in the text box while
  // the panel is open on it.
  function clampCaret(count) {
    if (noteSel !== null && noteSel >= count) noteSel = count ? count - 1 : null;
  }

  // The board, set outright. Its buttons work in toggles and in
  // "this note or the next one" — see setNoteDur — so the state
  // left when nothing is selected is written through here: by init,
  // by the row saying what a shape of two or more strings is
  // already doing, and by a case setting the board before a tap.
  function setBoard(o) {
    if (o.dur !== undefined) noteDur = o.dur;
    if (o.dotted !== undefined) noteDotted = o.dotted;
    if (o.triplet !== undefined) noteTriplet = o.triplet;
    if (o.stack !== undefined) noteStack = o.stack;
    if (o.dead !== undefined) noteDeadMode = o.dead;
  }

  // Nothing is being written on any more — the panel is closing.
  // True when a gap was open, which the row is drawn with and so
  // has to be drawn again without.
  function clearCaret() {
    const wasOpen = noteAfter !== null;
    notePanelAt = null;
    noteSel = null;
    noteAfter = null;
    return wasOpen;
  }

  function noteStretch() {
    if (!notePanelAt || cache().vid !== page.videoId()) return null;
    const bar = cache().bars[notePanelAt.bar];
    const chord = bar && bar.chords[notePanelAt.chord];
    return chord || null;
  }

  // How many beats this chord holds — its share of the bar, the same split the
  // cells above are laid out by. What the panel measures a phrase against.
  function noteStretchBeats() {
    const bar = notePanelAt && cache().bars[notePanelAt.bar];
    if (!bar) return Chords.BEATS_PER_BAR;
    // The bar's own four beats, split the way a written bar is read
    // — not the room the strip happens to draw this stretch at. The
    // width bends to fit a phrase in (see Chords.barWeights); the
    // beat it falls on does not, and a panel reporting 1.196 beats
    // of room was measuring the drawing rather than the music.
    const weights = Chords.beatWeights(bar.chords.length);
    return weights[notePanelAt.chord] || weights[weights.length - 1];
  }

  function noteEntries() {
    const chord = noteStretch();
    if (!chord) return [];
    if (!chord.notes) chord.notes = [];
    return chord.notes;
  }

  function editingNote() {
    const notes = noteEntries();
    return noteSel !== null ? notes[noteSel] || null : null;
  }

  // `Bb9:1.1.1.0..` → `Bb9 1/1+2/1+3/1+4/0:0`: the same six frets,
  // written as the stop they sound as and with no length of its
  // own, at the head of the stretch where the chord was. Done when
  // the shape is tapped rather than when the sheet is read, so a
  // sheet nobody has edited is left exactly as it was written.
  function chordMarkersToStop(chord) {
    const stops = [];
    (chord.markers || []).forEach((fret, i) => {
      if (fret !== null) stops.push({ string: i + 1, fret });
    });
    // A name with no frets under it is already written the one way.
    if (!stops.length) return;
    chord.notes = chord.notes || [];
    chord.notes.unshift({ d: 1, stops, free: true });
    chord.markers = null;
  }

  // MIGRATION (temporary): the same turn for a whole sheet at once. Every
  // chord still written as a name and six frets becomes the stop it sounds
  // as, so a sheet worked on before the two notations were folded together
  // comes back written the one way. Hung off the box's own tidy-up, so
  // opening 🎼 and leaving the field is the whole of the migration for a
  // sheet. Delete this, its call in normalizeChordInput, and the `Name:frets`
  // arm of toCompact once no sheet in use is written the old way any more.
  function stopsFromOldChords(bars) {
    for (const bar of bars) {
      for (const chord of bar.chords) {
        if (chord.markers) chordMarkersToStop(chord);
      }
    }
  }

  function openNotePanel(barIndex, chordIndex) {
    notePanelAt = { bar: barIndex, chord: chordIndex };
    noteSel = null;
    noteAfter = null;
    // Through the strip rather than the panel alone: what is being
    // written into is marked in the strip, and a panel drawn
    // without it says the caret is nowhere.
    page.renderStrip(true);
    page.markSelection();
    page.focusPanel();
  }

  // Back to writing at the end of the stretch: nothing selected,
  // and no room being held open anywhere.
  function endNoteWriting() {
    const wasOpen = noteAfter !== null;
    noteSel = null;
    noteAfter = null;
    // A redraw draws the panel itself; without one the panel still
    // has to hear that nothing is selected any more.
    if (wasOpen) page.renderStrip(true);
    else page.renderPanel();
    page.markSelection();
  }

  // A place to write, just after what is selected — or after the last
  // note, when writing was already at the end. Nothing goes into the
  // sheet yet: the next tap, rest or tie goes in there, and is then what
  // is being edited, so stacking piles the rest of a chord onto it.
  function insertAfterNote() {
    const notes = noteEntries();
    if (!notes.length) return;
    const at = noteSel !== null ? noteSel : notes.length - 1;
    // Room right where the + was pressed, inside a bracket as
    // readily as outside one: a bracket holds whatever is written in
    // it — see putNote for what the note written into the gap joins.
    noteAfter = at;
    noteSel = null;
    page.renderStrip(true);
    page.markSelection();
  }

  // Where what is written goes: into the gap the + opened, which is then
  // what is being edited, or at the end of the stretch when no gap is open.
  function putNote(ev) {
    const notes = noteEntries();
    if (noteAfter === null) { notes.push(ev); return; }
    const at = Math.min(noteAfter + 1, notes.length);
    // Written between two notes of one bracket, it joins them — which
    // is how a bracket grows. At either edge of one it stays outside,
    // where inside and out is not something the gap can say.
    const before = notes[at - 1], after = notes[at];
    if (before && after && before.trip && before.trip === after.trip) {
      ev.trip = before.trip;
      // The bracket already says the group is a triplet. A value written
      // with the board's triplet mark on would say it a second time, and
      // the note would be two thirds of two thirds of what it looks like.
      ev.d = Chords.tripletBase(ev.d) || ev.d;
    }
    notes.splice(at, 0, ev);
    noteSel = at;
    noteAfter = null;
  }

  // A tap on the board. With a note selected it replaces that note — which is
  // how one written on the wrong string is corrected — and otherwise it
  // writes a new one after the last, or into the gap the + opened. A stop
  // already lit is a stop taken off: pressing what is on is how you unwrite
  // it, stacking or replacing alike. It used to filter that string out and
  // put the same fret straight back, so the one press that plainly meant "not
  // this one" was the one press that did nothing. Emptied of every string the
  // note keeps its place and its length and becomes a rest — what was being
  // corrected is the fingering, not the beat — written the way the R button
  // writes one. A rest and a tie are turned away, because on them a lit cell
  // means something else: a rest keeps the shape it was made from so that
  // pressing it again brings the note back, and a tie's lit cells are the
  // strings it is holding on from before it. On either, a press is that note
  // struck again, which is what the stack and replace branches in pressStop
  // do. False where nothing was taken off, so the caller knows to go on.
  function unlightStop(ev, string, fret) {
    if (ev.tie || ev.rest) return false;
    const stops = ev.stops || [];
    const lit = stops.findIndex(st => st.string === string && st.fret === fret);
    if (lit < 0) return false;
    stops.splice(lit, 1);
    ev.stops = stops;
    if (!stops.length) {
      delete ev.free;
      delete ev.grace;
      ev.rest = true;
    }
    return true;
  }

  // A new note holding one stop, at the length the board is set to. No
  // length at all is the state a fingering is written in — held until
  // the next note, the way a chord is — and that is what `free` says.
  function newStopEvent(stop) {
    return noteDur === NO_DUR
      ? { d: 1, stops: [stop], free: true }
      : { d: noteValue(), stops: [stop] };
  }

  function pressStop(string, fret) {
    const notes = noteEntries();
    // What a tap writes: a stop, muted while the ✕ button is on.
    const stop = () => (noteDeadMode ? { string, fret, dead: true } : { string, fret });
    if (noteAfter !== null) {
      putNote(newStopEvent(stop()));
      page.commit();
      return;
    }
    const ev = editingNote();
    if (ev) {
      // ✕ on: the tap is about this string of the note rather than
      // about where the note is, so it lands on the shape instead
      // of replacing it. A string it already mutes rings again.
      if (noteDeadMode && !ev.tie) {
        const was = (ev.stops || []).find(st => st.string === string && st.fret === fret);
        if (was && was.dead) delete was.dead;
        else {
          ev.stops = stackStop(ev.stops, string, fret);
          const now = ev.stops.find(st => st.string === string && st.fret === fret);
          if (now) now.dead = true;
          delete ev.rest;
        }
        page.commit();
        return;
      }
      // A stop already lit is a stop taken off — see unlightStop. A
      // rest and a tie fall through it to the branches below, where
      // a press is that note struck again.
      if (unlightStop(ev, string, fret)) {
        page.commit();
        return;
      }
      if (noteStack && !ev.tie) {
        ev.stops = stackStop(ev.stops, string, fret);
        delete ev.rest;
      } else {
        // It keeps its place under a bracket: tapping the right string to
        // correct a wrong one is not a reason to fall out of the triplet.
        const put = { d: ev.d, stops: [stop()], free: ev.free };
        if (ev.trip) put.trip = ev.trip;
        notes[noteSel] = put;
      }
      page.commit();
      return;
    }
    const last = notes[notes.length - 1];
    if (noteStack && last && !last.rest && !last.tie) {
      last.stops = stackStop(last.stops, string, fret);
    } else notes.push(newStopEvent(stop()));
    page.commit();
  }

  // A name for a new bracket that no bracket in the bar is using. The
  // sheet is written out and read back on every edit, and that is where
  // the names are really settled — this one only has to last until then.
  function freeTripId() {
    const taken = new Set(barNoteEvents().map(p => p.ev.trip && p.ev.trip.id));
    let n = 1;
    while (taken.has(`g${n}`)) n++;
    return `g${n}`;
  }

  // One more string in a shape. A string already in it moves to
  // where it was just tapped rather than being struck twice at
  // once, which is not a thing a hand can do — and which would draw
  // one fret in the diagram while the tab printed two.
  function stackStop(stops, string, fret) {
    const kept = (stops || []).filter(st => st.string !== string);
    kept.push({ string, fret });
    // Written 1st string first, the way every other stop in a sheet
    // is written, whatever order it was tapped in.
    return kept.sort((a, b) => a.string - b.string);
  }

  // The same chord again, written just after it. The name is not copied:
  // a name repeated over the next shape reads as a chord change to
  // itself, and what this writes is the same chord struck again, which
  // the ruling name already says. The same note again: what it sounds
  // and how long for, and nothing about the chord — see copyNote.
  function noteCopy(src) {
    const copy = { d: src.d, stops: (src.stops || []).map(st => ({ ...st })) };
    if (src.free) copy.free = true;
    if (src.rest) copy.rest = true;
    if (src.tie) copy.tie = true;
    return copy;
  }

  function copyNote() {
    // Only ever the selected note. Falling back to the last note of the stretch
    // put the copy somewhere nobody had pointed at — the button says "this
    // again", and with nothing selected there is no this. The button is down
    // then, so there is nothing to press and no silent second meaning to it.
    if (noteSel === null) return;
    const notes = noteEntries();
    const at = noteSel;
    const src = notes[at];
    if (!src) return;
    // A note in a triplet is copied as the triplet — three more, written
    // after the three, which is the same figure struck again. One more
    // inside the three has nothing the sheet could say about it.
    const group = tripletGroupPlaces(notePanelAt.chord, at);
    if (group.length) {
      const last = group[group.length - 1];
      const into = cache().bars[notePanelAt.bar].chords[last.cell].notes;
      // A bracket of their own: the same figure struck again, rather than
      // six notes crowded under the one bracket the three came from.
      const from = group[0].ev.trip;
      const trip = { id: freeTripId(), num: from.num, den: from.den };
      into.splice(last.index + 1, 0, ...group.map(p => {
        const copy = noteCopy(p.ev);
        copy.trip = trip;
        return copy;
      }));
      notePanelAt = { bar: notePanelAt.bar, chord: last.cell };
      noteSel = last.index + 1;
      noteAfter = null;
      page.commit();
      return;
    }
    notes.splice(at + 1, 0, noteCopy(src));
    // The copy is what is being written now — the reason to copy
    // one is usually to move a string of it — so it is what the
    // board is holding when it lands.
    noteSel = at + 1;
    noteAfter = null;
    page.commit();
  }

  // Rest and tie do the same double duty as the board: they turn the
  // selected note into one, or write one at the end. Both are marks on a
  // note rather than notes of their own, so pressing one again takes it off
  // and the note comes back — it used to write the same mark over itself,
  // which is a button that goes down and never comes up. The strings are
  // kept on the event while the mark is on, so the note that comes back is
  // the note that was there; a mark written before this browser last read
  // the sheet has none to keep, and then what comes back is the note it was
  // holding on, which is the one the row was already drawing in that place.
  function addNoteRest() { markNote('rest'); }

  function addNoteTie() { markNote('tie'); }

  function markNote(mark) {
    const other = mark === 'rest' ? 'tie' : 'rest';
    const ev = editingNote();
    if (!ev) {
      putNote({ d: restValue(), [mark]: true, stops: [] });
      page.commit();
      return;
    }
    // A tie is a note held on, so there has to be one: written
    // where nothing is ringing — the first note of a sheet — it
    // would take the note off the staff and put nothing in its
    // place, which is a note deleted by a button that says it ties.
    // The button is down in that case, so this is the second door.
    if (mark === 'tie' && !ev.tie && !heldStops(noteSel).length) return;
    if (ev[mark]) {
      const stops = (ev.stops && ev.stops.length) ? ev.stops : heldStops(noteSel);
      // Nothing to be a note with — a tie written as the first thing in a
      // stretch, holding a note in the bar before it — so the mark stays
      // where it is rather than leaving an event that sounds nothing at all.
      if (!stops.length) return;
      delete ev[mark];
      ev.stops = stops;
    } else {
      delete ev[other];
      // A rest and a tie both take a length, and neither is struck
      // ahead of the note after it: the two states a note can be
      // written in that they cannot.
      delete ev.free;
      delete ev.grace;
      ev[mark] = true;
      ev.stops = ev.stops || [];
    }
    page.commit();
  }

  // What a rest or a tie at `at` is sounding: the last thing struck
  // before it, counted over the whole bar and then over the bars before
  // it, since a tie at the head of a bar holds a note struck in the one
  // before. A tie is that note still ringing, so striking it again is
  // the same strings — which is what taking the tie off writes.
  function heldStops(at) {
    const all = barNoteEvents();
    const pos = all.findIndex(p => p.cell === notePanelAt.chord && p.index === at);
    for (let i = pos - 1; i >= 0; i--) {
      const ev = all[i].ev;
      if (ev.tie) continue;
      // Nothing rings over a rest, so nothing is being held after one.
      if (ev.rest) return [];
      if (ev.stops && ev.stops.length) return ev.stops.map(st => ({ ...st }));
    }
    const over = Chords.carriedStops(cache().bars, notePanelAt.bar);
    return over.map(st => ({ ...st }));
  }

  // The duration buttons set what comes next, or re-time what is selected.
  function setNoteDur(d) {
    const ev = editingNote();
    // Writing a duration on a note that had none is what turns a
    // chord back into a note, and taking it away again is what
    // turns a note into a chord — see markFreeNotes.
    if (ev) {
      if (d === NO_DUR) { ev.free = true; delete ev.grace; }
      else {
        // A note under a bracket takes the new value on its own. The
        // bracket says what the group is, so what it holds is free to be an
        // eighth and a quarter — which is how a swung beat is written.
        ev.d = Chords.isDottedDur(ev.d) ? d * 1.5 : d;
        delete ev.free;
      }
      page.commit();
      return;
    }
    noteDur = d;
    page.renderPanel();
  }

  // A dot bends one note, and under a bracket it bends it the same
  // way: a dotted eighth inside a 3 is ordinary printed music once
  // the bracket is what says the group is a triplet, rather than
  // the values inside it. So there is nothing left for the button
  // to be down for, and it no longer has a rule of its own.
  function toggleNoteDot() {
    const ev = editingNote();
    if (ev) {
      ev.d = Chords.isDottedDur(ev.d) ? ev.d / 1.5 : ev.d * 1.5;
      delete ev.free;
      page.commit();
      return;
    }
    noteDotted = !noteDotted;
    if (noteDotted) noteTriplet = false;
    page.renderPanel();
  }

  // Three of these in the time of two. Three notes make a triplet, not one — a
  // lone third of a beat is nothing anyone plays — so this works on the
  // selected note and the two after it — across a chord change, since three
  // notes under three different chords are still a triplet — the way it is done
  // on paper: mark three, and they now fill the time two of them used to. The
  // rest of the bar moves up by the one note's worth of time that buys, which
  // is the point of writing it. Pressing it again on any of the three undoes
  // that group and nothing else. A note already dotted gives the dot up: one
  // note is bent one way, and a dotted triplet is not something written here.
  function toggleNoteTriplet() {
    const ev = editingNote();
    if (!ev) {
      noteTriplet = !noteTriplet;
      if (noteTriplet) noteDotted = false;
      page.renderPanel();
      return;
    }
    if (!noteCanTriplet()) return;
    if (ev.trip) {
      // Pressing it again on a bracket lets the last note out of it, and
      // pressing it on a bracket of two takes the bracket off. So the button
      // counts down — three, two, none — and two notes under one 3, which is
      // how a swung beat is written, is two presses rather than a bracket and a
      // deletion. Nothing is deleted on the way: the note let out keeps its
      // value and its place, and the bar goes back to the length it had.
      const group = tripletGroupPlaces(notePanelAt.chord, noteSel);
      if (group.filter(p => !p.ev.grace).length > 2) {
        // The last note counted, and the grace notes leaning on it, which go
        // with it rather than being left at the end of the bracket alone.
        let last = group.length - 1;
        while (last > 0 && group[last].ev.grace) last--;
        for (let i = group.length - 1; i >= last; i--) delete group[i].ev.trip;
        const out = group[last];
        // The next press goes on counting down the same bracket, so the
        // selection follows it in when the note it was on is the one let out.
        const kept = last > 0 ? group[last - 1] : null;
        if (kept && out.cell === notePanelAt.chord && out.index === noteSel) {
          notePanelAt = { bar: notePanelAt.bar, chord: kept.cell };
          noteSel = kept.index;
        }
      } else {
        for (const p of group) delete p.ev.trip;
      }
    } else {
      // A name of its own, so the bracket is not read as part of one beside it.
      const trip = { id: freeTripId(), num: 3, den: 2 };
      for (const note of tripletGroup()) note.trip = trip;
    }
    page.commit();
  }

  // Two notes under one 3 is a swung beat, which is ordinary printed music, so
  // two is enough to bracket. Three is what the button reaches for; two is what
  // it settles for at the end of a bar, or up against a bracket already there.
  // One is not a group, and that is the only place the button is down. A grace
  // note and a lengthless stop take no time from the bar, so neither is one of
  // the notes counted, and neither can be the note the bracket starts on.
  // Taking a bracket off is always allowed — whatever the staff brackets can be
  // unbracketed. With no note selected the button is the value the next one is
  // written with, and there is nothing yet for it to be wrong about.
  function noteCanTriplet() {
    const ev = editingNote();
    if (!ev) return true;
    if (ev.free || ev.grace) return false;
    if (ev.trip) return true;
    return tripletGroup().filter(n => !n.grace).length >= 2;
  }

  // Beaming a run by hand: this note and the next are drawn as one gesture,
  // whatever the beat under them says. Which is what beaming is for once a
  // phrase stops agreeing with the beat — four sixteenths straddling two
  // beats are one run to play, and the row breaks them into two. One join is
  // all this writes, and it is all it needs to: the mark sits on the link
  // between two notes, so joining 1–2 and then 2–3 makes a run of three. A
  // button per length would be several ways of saying the same thing.
  // Pressing it again parts them, and the beats take over there again.
  function toggleNoteBeam() {
    if (!noteCanBeam()) return;
    const ev = editingNote();
    if (ev.beam) delete ev.beam;
    else ev.beam = true;
    page.commit();
  }

  // Whether there is a note on the other side of the join. A
  // stretch's last note looks over the cell edge to the next stretch
  // of the same bar, since that is a join staffBar now draws — but
  // not over the bar line, which is drawn as a staff of its own, and
  // not past an empty stretch, which has a chord of its own to say.
  function noteJoinable() {
    if (noteSel === null) return false;
    if (noteSel + 1 < noteEntries().length) return true;
    const bar = notePanelAt && cache().bars[notePanelAt.bar];
    const next = bar && bar.chords[notePanelAt.chord + 1];
    return !!(next && next.notes && next.notes.length);
  }

  // Beams say a note is shorter than a beat, so only such a note can
  // carry one: a quarter has no beam to share, and a fingering
  // written with no length has no stem to hang one from. The button
  // is down on those rather than doing nothing when pressed.
  function noteCanBeam() {
    const ev = editingNote();
    return !!(ev && !ev.free && !ev.rest && !ev.tie && !ev.grace && ev.d < 1
      && noteJoinable());
  }

  // A grace note — the small one with the stroke through its stem, struck
  // just before the note it leans on and taking no time of its own from
  // the bar. Which is why it is a mark on a note rather than a length: the
  // run around it is measured as if it were not there, and it is drawn
  // ahead of the note it belongs to rather than on a beat of its own.
  function toggleNoteGrace() {
    if (!noteCanGrace()) return;
    const ev = editingNote();
    if (ev.grace) { delete ev.grace; page.commit(); return; }
    ev.grace = true;
    // It takes no time from the bar, so it is outside the beats a beam is read
    // off, and a length longer than an eighth has no flag to be drawn small.
    delete ev.beam;
    delete ev.free;
    if (ev.d >= 1) ev.d = 0.5;
    page.commit();
  }

  // The ✕ button is a mode rather than a mark on this note: which strings are
  // muted is picked on the neck, a tap at a time, because that is the question
  // — a chord is muted a course at a time and its top voice often rings.
  function toggleNoteDeadMode() {
    noteDeadMode = !noteDeadMode;
    page.renderPanel();
  }

  function noteDeadOn() {
    return noteDeadMode;
  }

  // Only a struck note can be one: a rest is silence and has nothing to lean
  // on the next note with, a tie is the note before it still sounding, and a
  // fingering written with no length has no stem to draw the stroke across.
  function noteCanGrace() {
    const ev = editingNote();
    return !!(ev && !ev.rest && !ev.tie && !ev.free && ev.stops && ev.stops.length);
  }

  function noteGraceOn() {
    const ev = editingNote();
    return !!(ev && ev.grace);
  }

  // Whether the note being edited is joined to the next by hand —
  // what lights the button, and what pressing it takes back.
  function noteBeamOn() {
    const ev = editingNote();
    return !!(ev && ev.beam);
  }

  // The three notes a triplet is made of. Going in, that is the selected
  // note and the two after it — and if the phrase ends before that, whatever
  // there is, so the last note of a bar can still be marked. Coming out, it
  // is the three of the run the selected note belongs to, counted from where
  // that run starts: a run of six is two triplets, and undoing one of them
  // leaves the other alone. The triplet a note is in, as the places its
  // notes sit in — the stretch and the index inside it, since a triplet can
  // cross a cell edge and every edit that works on the group has to reach
  // into both. Empty when the note is not in one. A triplet is one thing:
  // three notes fill the time of two, so there is nothing the sheet can say
  // about four of them or two. Every button that adds, removes or re-times a
  // note works on the group for that reason — copyNote, deleteNote,
  // insertAfterNote, setNoteDur — and toggleNoteDot is down on one, since a
  // dot bends a single note and there is no note here to bend on its own.
  function tripletGroupPlaces(cell, index) {
    const all = barNoteEvents();
    const at = all.findIndex(p => p.cell === cell && p.index === index);
    if (at < 0 || !all[at].trip) return [];
    const key = all[at].trip;
    const out = [];
    for (let i = at; i >= 0 && all[i].trip === key; i--) out.unshift(all[i]);
    for (let i = at + 1; i < all.length && all[i].trip === key; i++) out.push(all[i]);
    return out;
  }

  function tripletGroup() {
    const all = barNoteEvents();
    const at = all.findIndex(p => p.cell === notePanelAt.chord && p.index === noteSel);
    if (at < 0) return [];
    // Going in: the selected note and what follows it, up to three notes.
    // The run stops at a note already under a bracket and at a stop
    // written with no length: neither can be one of the notes a bracket is
    // over, and reaching past one would bracket a note that is somebody
    // else's or no note at all. A grace note takes no time from the bar,
    // so it is not one of the three — but it stands among them and is kept
    // inside the bracket. Left out, the bracket would be written as the
    // two brackets its notes are no longer next to each other in.
    if (!all[at].ev.trip) {
      const out = [];
      let counted = 0;
      for (let i = at; i < all.length && counted < 3; i++) {
        const ev = all[i].ev;
        if (ev.trip || ev.free) break;
        out.push(ev);
        if (!ev.grace) counted++;
      }
      // One leaning on the note after the bracket leans outside it.
      while (out.length && out[out.length - 1].grace) out.pop();
      return out;
    }
    // Coming out: the notes the staff brackets with the selected one. A
    // run of six is two triplets, so undoing one leaves the other alone.
    return tripletGroupPlaces(notePanelAt.chord, noteSel).map(p => p.ev);
  }

  // Every note in the bar, in playing order, with the stretch each one
  // came from. A triplet is three notes and the harmony under them has
  // nothing to do with it: a bar of quarter triplets is three chords,
  // each a stretch of its own. Counted over the bar rather than inside
  // one stretch's own notes, which is why marking one used to shorten
  // a single note and leave it a triplet of nothing.
  function barNoteEvents() {
    const bar = notePanelAt && cache().bars[notePanelAt.bar];
    if (!bar) return [];
    const out = [];
    // Which triplet each note belongs to, read over the bar the way
    // the staff reads it — see Chords.tripletGroups — so the three
    // the button undoes are the three the bracket is drawn over.
    const all = [];
    bar.chords.forEach((chord, cell) => {
      (chord.notes || []).forEach((ev, index) => {
        all.push({ ev, cell, index });
      });
    });
    const keys = Chords.tripletGroups(all.map(p => p.ev));
    all.forEach((p, i) => out.push({ ...p, trip: keys[i] }));
    return out;
  }

  function deleteNote() {
    const notes = noteEntries();
    const at = noteSel !== null ? noteSel : notes.length - 1;
    if (at < 0 || at >= notes.length) return;
    // One note, whether or not it is under a bracket. The bracket is written
    // over a range and says nothing about how many notes fill it, so the two
    // left behind are a bracket over two — which is what a swung beat is.
    notes.splice(at, 1);
    noteAfter = null;
    if (noteSel !== null) noteSel = notes.length ? Math.min(at, notes.length - 1) : null;
    page.commit();
  }

  // Walking the selection. Off either end lands back on writing at the
  // end, which is the state the panel opens in. Every stretch in the
  // sheet in playing order, as the pair of indexes the panel holds. What
  // ← → walk along once they reach the end of the one they are in: a
  // phrase is written across bars, and a caret that stops at the bar
  // line leaves the next bar reachable only by going back to the mouse.
  function noteStretchList() {
    const out = [];
    (cache().bars || []).forEach((bar, bi) => {
      bar.chords.forEach((chord, ci) => out.push({ bar: bi, chord: ci }));
    });
    return out;
  }

  // Along to the next stretch, or back to the one before, landing at
  // whichever end of it the caret arrived from: going right, its
  // first note — or its own writing place, if nothing is written in
  // it yet — and going left, the place after its last note.
  function moveNoteStretch(by) {
    if (!notePanelAt) return false;
    const list = noteStretchList();
    const from = list.findIndex(s => s.bar === notePanelAt.bar && s.chord === notePanelAt.chord);
    const to = from < 0 ? null : list[from + (by > 0 ? 1 : -1)];
    if (!to) return false;
    notePanelAt = { bar: to.bar, chord: to.chord };
    const notes = noteEntries();
    noteSel = by > 0 && notes.length ? 0 : null;
    return true;
  }

  // ============================================================
  // Moving one thing along the sheet (Shift + arrows)
  // ============================================================
  // What stands on the staff is one thing at a time: a stop, a note, a rest, a
  // tie — or a chord written as a name with nothing under it yet. A chord name is
  // not a thing of its own; it is written on the moment it starts, so it travels
  // with whatever it is written on. That is the whole of the move: the thing
  // picked and the one beside it trade places, and nothing else on the sheet is
  // touched. A chord does not carry the phrase written after it — those notes did
  // not move, the chord did, and the phrase is read against whatever is over it.
  //
  // The nesting the sheet is parsed into — bar, stretch, note — is not that row.
  // A stretch holds a name and the notes after it, and a chord can also be a name
  // written on a note inside another stretch. So the row is built first, moved in,
  // and the touched bars are written back out of it. Only the bars either end of
  // the step are rebuilt: every other bar keeps the objects, and the text, it
  // already had.
  function sheetEvents() {
    const out = [];
    (cache().bars || []).forEach((bar, bi) => {
      // Which triplet each note is in, read over the bar — see barNoteEvents.
      // Held as one list per bar and handed out as the notes are walked.
      const keys = Chords.tripletGroups(
        (bar.chords || []).reduce((all, st) => all.concat(st.notes || []), []));
      let at = 0;
      (bar.chords || []).forEach((st, si) => {
        const notes = st.notes || [];
        if (!notes.length) {
          out.push({ bar: bi, stretch: si, note: null, name: st.name || '',
            markers: st.markers || null, ev: null, trip: null });
          return;
        }
        notes.forEach((ev, k) => {
          // A name written on a stretch's first note rules from the
          // stretch's head — see Chords.rulingNames — so it is that head's
          // name, and the stretch's own has nothing left to say. Which is
          // also what the staff draws: see the marks in Chords.staffBar.
          const name = k === 0 ? (notes[0].name || st.name || '') : (ev.name || '');
          out.push({ bar: bi, stretch: si, note: k, name,
            markers: k === 0 ? (st.markers || null) : null, ev, trip: keys[at] });
          at++;
        });
      });
    });
    return out;
  }

  // Where a note's length comes from when none is written on it: the
  // note before it. Three notes have a new note before them after a
  // step — the two that traded places, and whatever followed them —
  // so those three have theirs written out. Left alone, a stop that
  // inherited a quarter would come back as an eighth, or as no
  // length at all, and the move would have changed the music.
  function pinnedNote(item) {
    const ev = Object.assign({}, item.ev);
    delete ev.name;                                   // the event carries it now
    if (item.pin && ev.noDur && !ev.free) delete ev.noDur;
    return ev;
  }

  // The row back into bars. A thing carrying a name opens a stretch of its
  // own; one without a name joins the stretch in front of it, which is what a
  // phrase under a chord is. Returns where each thing in the row ended up, so
  // the panel can follow the one that moved: the rebuild copies every note,
  // and the object the row is holding is no longer the object in the sheet.
  function writeBarsFromEvents(list, touched) {
    const held = new Map();
    list.forEach((item, i) => {
      if (!touched.has(item.bar)) return;
      if (!held.has(item.bar)) held.set(item.bar, []);
      held.get(item.bar).push({ item, i });
    });
    const homes = new Map();
    for (const bi of touched) {
      const bar = cache().bars[bi];
      if (!bar) continue;
      const chords = [];
      let open = null;
      for (const { item, i } of held.get(bi) || []) {
        if (item.name || item.markers || !open) {
          open = { name: item.name, markers: item.markers, notes: [] };
          chords.push(open);
        }
        if (item.ev) open.notes.push(pinnedNote(item));
        homes.set(i, {
          bar: bi, stretch: chords.length - 1,
          note: item.ev ? open.notes.length - 1 : null,
        });
      }
      // A bar every thing moved out of is still a bar of the tune: it keeps its
      // time and an empty stretch to write into, the same as one just inserted.
      bar.chords = chords.length ? chords : [{ name: '', markers: null }];
    }
    return homes;
  }

  // Which thing in the row the panel is pointing at. With a note selected it
  // is that note; with nothing selected it is the chord at the head of the
  // stretch being written into, since that is what the panel is open on.
  function selectedEventIndex(list) {
    if (!notePanelAt) return -1;
    const at = notePanelAt;
    const want = noteSel === null ? 0 : noteSel;
    let head = -1;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.bar !== at.bar || e.stretch !== at.chord) continue;
      if (head < 0) head = i;
      if (e.note === null || e.note === want) return i;
    }
    return head;
  }

  // Whether the thing the panel is pointing at is a chord — a name is written
  // on it — which is the whole difference between the buttons saying Chord and
  // Note. A name at the head of a bar is not one of those: it stays where it
  // is, so what travels from there is the note by itself. See keepBarHeads.
  function selectedIsChord() {
    const list = sheetEvents();
    const i = selectedEventIndex(list);
    if (i < 0 || !list[i].name) return false;
    return list[i] !== barHead(list, list[i].bar);
  }

  // The first thing in a bar, which is where its chord is written.
  function barHead(list, bar) {
    return list.find(e => e.bar === bar);
  }

  // A bar opens on a chord, and everything written in it is read against
  // that name — see Chords.rulingNames, and the parseChord call in
  // staffBar that falls back to C without one. So the name at a bar's head
  // belongs to the opening rather than to the thing that happens to be
  // written there: step that thing along and the name stays, and whatever
  // lands at the head takes it up. Otherwise moving the first note of a
  // bar carried its chord away with it, and the notes it left behind were
  // read as C. Unless what arrives brings a name of its own, which is a
  // chord starting there and is the new opening — then both names are
  // where their writer put them and there is nothing to hand over.
  function keepBarHeads(list, heads) {
    for (const [bar, was] of heads) {
      const now = barHead(list, bar);
      if (!now || now === was || now.name) continue;
      now.name = was.name;
      now.markers = was.markers;
      was.name = '';
      was.markers = null;
    }
  }

  function canMoveSelection(by) {
    const list = sheetEvents();
    const i = selectedEventIndex(list);
    if (i < 0) return false;
    return by > 0 ? i + 1 < list.length : i > 0;
  }

  // What one step carries, which is not always one thing. Three
  // triplets are one division of the beat: a note stepping past them
  // steps past all three, or the beat they fill comes apart and the
  // sheet says a triplet of two. So the run the thing belongs to
  // moves with it — see Chords.tripletGroups for what makes one.
  function moveBlock(list, at) {
    const item = list[at];
    if (!item || !item.trip) return { from: at, to: at };
    let from = at, to = at;
    while (from > 0 && list[from - 1].bar === item.bar
      && list[from - 1].trip === item.trip) from--;
    while (to + 1 < list.length && list[to + 1].bar === item.bar
      && list[to + 1].trip === item.trip) to++;
    return { from, to };
  }

  // One step. The thing picked and its neighbour trade places, each
  // keeping the bar of the place it lands in — which is how a step
  // at a bar's edge crosses the bar line without the move having to
  // know anything about bar lines. A step inside one's own triplet
  // is still a step of one: the three are being reordered, and all
  // three are still there. A step out of it moves the triplet.
  function moveSelection(by) {
    const list = sheetEvents();
    const from = selectedEventIndex(list);
    if (from < 0) return;
    const sel = list[from];
    const next = from + (by > 0 ? 1 : -1);            // the neighbour stepped towards
    if (next < 0 || next >= list.length) return;
    const inside = !!sel.trip && list[next].bar === sel.bar
      && list[next].trip === sel.trip;
    const mine = inside ? { from, to: from } : moveBlock(list, from);
    const other = inside ? { from: next, to: next }
      : moveBlock(list, by > 0 ? mine.to + 1 : mine.from - 1);
    if (other.from < 0 || other.to >= list.length) return;
    const lo = Math.min(mine.from, other.from);
    const hi = Math.max(mine.to, other.to);
    // The two swap bars as well as places — a run is only ever within one
    // bar, so each has just the one to give. Which is how a step at a
    // bar's edge crosses the bar line, and how it crosses without leaving
    // a triplet with a bar line through the middle of it: the whole run
    // goes over, and the thing it traded with comes back the other way.
    const a = list.slice(mine.from, mine.to + 1);
    const b = list.slice(other.from, other.to + 1);
    const barA = a[0].bar, barB = b[0].bar;
    // What each bar the step touches opens on, read before anything moves.
    const heads = [...new Set([barA, barB])].map(bar => [bar, barHead(list, bar)]);
    list.splice(lo, hi - lo + 1, ...(by > 0 ? b.concat(a) : a.concat(b)));
    for (const e of a) e.bar = barB;
    for (const e of b) e.bar = barA;
    keepBarHeads(list, heads);
    // Everything that has a new thing in front of it now writes its
    // length out — see pinnedNote — which is everything moved, plus
    // whatever follows the lot.
    for (let i = lo; i <= hi + 1; i++) {
      if (list[i] && list[i].ev) list[i].pin = true;
    }
    const touched = new Set([barA, barB]);
    const homes = writeBarsFromEvents(list, touched);
    dropDanglingBeams(touched);
    // The panel follows what was moved rather than the place it
    // left, so pressing again carries the same thing further along.
    const home = homes.get(list.indexOf(sel));
    if (home) {
      notePanelAt = { bar: home.bar, chord: home.stretch };
      noteSel = home.note;
    }
    noteAfter = null;
    page.commit();
    page.markSelection();
  }

  // A beam on the last thing in a bar has nothing to join. Cleared
  // rather than kept, so a step never leaves a mark that draws as a
  // beam off the bar's edge.
  function dropDanglingBeams(touched) {
    for (const bi of touched) {
      const bar = cache().bars[bi];
      if (!bar) continue;
      const notes = [];
      for (const st of bar.chords) for (const ev of st.notes || []) notes.push(ev);
      const last = notes[notes.length - 1];
      if (last && last.beam) delete last.beam;
    }
  }

  // A stretch holds a place per note, plus the place after the last one where
  // writing goes — which is what null is, and what an empty stretch has instead
  // of notes. Stepping off either end of that walks into the next stretch.
  function stepNote(by) {
    if (!notePanelAt) return;
    if (noteAfter !== null) { noteAfter = null; page.renderStrip(true); }
    const notes = noteEntries();
    const at = noteSel === null ? notes.length : noteSel;
    const next = at + by;
    if (next >= 0 && next < notes.length) noteSel = next;
    else if (next === notes.length) noteSel = null;
    else if (!moveNoteStretch(by)) return;
    page.renderPanel();
    page.markSelection();
  }

  // How many strings a note in the sheet strikes at once. A rest strikes
  // none, and a tie's strings are the ones before it still ringing
  // rather than anything struck here, so neither counts as a shape.
  function stopCountAt(barIndex, chordIndex, index) {
    const bar = cache().bars[barIndex];
    const stretch = bar && bar.chords[chordIndex];
    const ev = stretch && (stretch.notes || [])[index];
    if (!ev || ev.rest || ev.tie) return 0;
    return (ev.stops || []).length;
  }

  // Clicking a note in the strip selects it — see the staff's own
  // click handler.
  function selectNote(barIndex, chordIndex, index) {
    if (noteAfter !== null) { noteAfter = null; page.renderStrip(true); }
    notePanelAt = { bar: barIndex, chord: chordIndex };
    // Pressing the selected note again keeps it selected. It used to
    // unselect it, and nothing on screen said much about the
    // difference — while the Chord box and ⧉ Copy both quietly change
    // what they act on when nothing is selected, so a press meant to
    // make sure of a note renamed the whole stretch instead. Esc and
    // ▷▷| are how writing goes back to the end of the stretch.
    noteSel = index;
    page.renderPanel();
    page.markSelection();
  }

  return {
    init,
    // bars
    roundTo, barBeats, barBeatText, barOpensOnTie,
    commitChordEdit, addBar, insertBar, barTimeBounds, setBarStart,
    // ♪ — where the caret is, and what the board is set to. The page reads
    // these while it draws; every way of changing one is a call above.
    get at() { return notePanelAt; },
    get sel() { return noteSel; },
    get after() { return noteAfter; },
    get dur() { return noteDur; },
    get dotted() { return noteDotted; },
    get triplet() { return noteTriplet; },
    get stack() { return noteStack; },
    get dead() { return noteDeadMode; },
    setBoard,
    clearCaret, clampCaret,
    // The ♪ edits the page and the checker reach for. Everything
    // else in this section is one of these calling another.
    noteStretch, noteStretchBeats, noteEntries, editingNote,
    stopsFromOldChords, openNotePanel, endNoteWriting, insertAfterNote,
    pressStop, copyNote, addNoteRest, addNoteTie, heldStops, setNoteDur,
    toggleNoteDot, toggleNoteTriplet, noteCanTriplet, toggleNoteBeam,
    noteCanBeam, toggleNoteGrace, toggleNoteDeadMode, noteDeadOn,
    noteCanGrace, noteGraceOn, noteBeamOn, deleteNote, selectedIsChord,
    canMoveSelection, moveSelection, stepNote, stopCountAt, selectNote,
    NO_DUR, restValue,
  };
})();
