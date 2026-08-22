# YT Loop

Loop any part of a YouTube video. Built for music practice — ear training, phrase drilling, riff learning.

## demo site

https://cortyuming.github.io/yt-loop/

## Features

- Paste a YouTube URL, play the video inline
- Switch playback speed — presets (0.25x – 2.0x, YouTube's own steps) plus a slider covering 0 – 2.0x in 0.01 steps
- **⤴️ Speed up** — a practice run from whatever speed is set when you switch it on up to 1.00x: the rate gains 0.05x on every completed lap. Switching it on never changes the tempo, so slow the part down until it is playable and let it climb from there. The label doubles as the progress readout (`0.60x → 1.00x`). While it runs the speed controls and the 🔗 / 📝 buttons are locked; switch it off to return to the speed you started from
- Set start / end times, loop the region
- **📍 pin** — snap the field to the current playback time
- **⏮** — jump to the loop start without changing play / pause state
- Nudge start / end by ±0.05s with `Shift + ←` / `→` while the field is focused (the bare arrows move the caret)
- **Live duration** display (end − start)
- **Loop toggle** — turn looping on/off without losing your start/end
- **History** — every range you play is remembered on its own, newest first, grouped by video. No save button: ▶ Play on an entry puts its range, speed and note back in the controls. 🗑 on an entry drops it; 🗑 on a video header clears that video's history. The video in the player has its ranges open and the rest are collapsed to their header — ▸ opens one without disturbing playback
- **🎼 Sheet** — a sheet per video: the fingerings you picked in [Guitar Chord Viewer](https://cortyuming.github.io/guitar-chord-viewer/), drawn as diagrams of the five frets around the shape and laid out as one unbroken row that slides under a playhead fixed in the middle — what is playing stays in one place and what is coming arrives from the right. Every bar is four slots wide whatever it holds, its chords taking slots in proportion to their beats, so the sheet moves at one steady pace; a bar with more than four chords stacks them four to a line inside that same width. The slot narrows on a window too small for four, so a whole bar always fits across. Seconds the sheet says nothing about are drawn as blank of the same width those seconds would have taken, so the row keeps moving through a hole instead of parking under the playhead; where two phrases overlap it never runs backwards — a bar starting before the sheet has got there is crossed at once. An amber rule and the bar number mark where each bar starts. The time on a bar head is also how a range is marked out from the sheet: click it and **start📍 / end📍** appear, each putting that bar's moment in the box it names — one bar's time for the start, a later bar's for the end, instead of catching both by ear as they go past. Dots are labelled with degrees by default, note names on the **Interval / Note** switch; the root is set apart, open strings are hollow, muted ones get `×`. A chord name opens the full fretboard in the viewer. **Show** folds the strip away; 🎼 in a video's header loads that video and opens its editor. See the notation below
- **♪ Single notes** — the line actually played over a chord, not just the chord: a solo, a riff, the head of the tune. Written on the staff with the durations it is played in — stems, beams, flags, rests, dots and ties — and again below it as tab, so the same phrase says what the music is and where it is on the neck. A tab row appears only in a sheet that has notes in it. Where a note falls is never written down: a note follows the one before it and the durations stack up from the start of the chord's stretch, so re-timing one slides the rest along instead of leaving a row of positions to correct by hand. Notes struck together — a double stop, the three-note chords a chord-melody ends on — are one event with more than one string in it. A tie holds a note on without striking it again, which is also how a note carries over a bar line: the tie is simply the first thing in the next bar, and the pitch is not written twice. In 🎼 Edit mode every chord cell has a ♪ that opens the whole neck under the strip: pick a duration, tap a fret, and it is written. **A fingering is written on that same board** — click a diagram in the strip and it opens with that shape held and stacking on, so each tap adds a string to it and a string already in it moves to where it was just tapped. A chord still written as a name and six frets becomes the stop it sounds as the moment it is tapped. **None** is the duration a chord is written in: no length of its own, sounding until the next thing does. A **grace note** — drawn small with a stroke through its stem — is written with the button beside the rest and the tie: it is struck just before the note it leans on and takes no time from the bar, so the run around it is measured as if it were not there. **⧉ Copy** in the Fix row writes whatever is selected again just after it — a chord, a note, a rest — for the bar that holds one voicing while the tune moves. The panel's buttons stand in three rows by what they do: **Length**, **Write**, **Fix**. **↺ Undo** in the Fix row takes back one tap at a time (the Versions list files a run of them as one entry, which is what makes it readable), and the **Int / Note / Sol** switch at the end of that row labels the board's dots — the same choice as the pill above the strip. Clicking a note in the strip — head, fret number, or the column between them — selects it, and the same buttons then re-time it, dot it, move it to another string, or turn it into a rest or a tie. The dots on the board are labelled by the same **Interval / Note / Solfege** switch the diagrams use. Keys while the panel is open: **← →** to walk the selection, **1**–**5** for the durations, **0** no length, **.** dot, **R** rest, **T** tie, **G** grace note, **S** stack, **Backspace** delete, **Esc** out
- **🔗 URL** — copies a link that encodes video, start, end, rate and note as query params. This is how you keep a loop for good: bookmark the link. Editing a value flashes the field and both copy buttons, so it's visible that the link tracks the form. Notes are capped at 30 characters, since percent-encoding costs 9 characters per Japanese character. On landing, a note already in this browser's history wins over the one in the link — the link's copy only fills in where there's no local entry, which is the case it exists for (another machine, or storage that got cleared)
- **📝 MD** — copies the same link as a Markdown link, labelled with the video title and time range
- Keyboard shortcuts (see below)

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / pause |
| `S` | Jump to loop start |
| `E` | Open / close the sheet editor (the strip's 🎼 Edit) |
| `←` / `→` | Seek 0.05 seconds (move the caret when Start/End is focused) |
| `Shift + ←` / `→` | Seek 1 second (nudge the value by 0.05s when Start/End is focused) |
| While ♪ is open | The panel takes the keyboard: `← →` walk the note selection, `1`–`5` set the duration, `0` gives it no length, `.` dots it, `R` rest, `T` tie, `G` grace note, `S` stack, `Backspace` delete, `Esc` back to writing at the end and then closed. Seeking with `← →` comes back as soon as it is closed |

## Sheet notation

```
@43.50 Bb9:1.1.1.0.. Eb9:.6.6.5.6.|@45.90 D7+9:.6.5.4.5. G7+9:13.11.10.9..
```

| Piece | Meaning |
|-------|---------|
| `\|` or a newline | Bar line. Leading and trailing ones are free |
| `Name:frets` | A chord and the fingering picked for it — six dot-separated frets, 1st string first, blank for a muted string. Exactly the `m=` string Guitar Chord Viewer puts in its own URL. Read as it always was, and still what a pasted link becomes; tapping the diagram writes it back as the stop below |
| `Name` | A chord with no fingering yet. It still gets its name and time, just no diagram |
| `@43.50` | Where the bar starts. Also accepted as `@0:43.50` |
| `@43.50-45.85` | Start and end, for a bar whose end can't be inferred |
| `[Bb9](https://.../guitar-chord-viewer/?c=Bb9&m=1.1.1.0..)` | A Markdown link pasted straight out of a notes file works as a chord. It is stored in the short form above |
| `6/7:8` | A note played over the chord in front of it: 6th string, 7th fret, an eighth long. The duration is the number printed music calls the note by — `1` whole, `2` half, `4` quarter, `8` eighth, `16` sixteenth, `32` — and a trailing dot is half again as long (`4.`). Leave `:` off and the note is as long as the one before it, which a run of eighths mostly is |
| `2/10+3/9` | Two strings struck together — a double stop. Any number of them, joined by `+` |
| `1/1+2/1+3/1+4/0` | A fingering, written as the strings it strikes. Alone in its stretch it has no length of its own: it sounds until the next thing does, which is what a chord is |
| `…:0` | No length, said out loud — for a fingering with a phrase written after it, where a bare stop would take the duration of the run instead |
| `6/8:8-` | A trailing `-` beams the note to the one after it, across the beat if that is where the run falls. Beams are worked out from the beats otherwise — a run inside one beat is beamed, a run across two is not — so the mark is only written where the music groups against the beat |
| `3/5*` | A grace note — struck just before the note it leans on, and taking no time from the bar, so the run around it is measured as if it were not there. Drawn small, with a stroke through its stem. A length can be written after the mark (`3/5*:16`) |
| `r:4` | A rest, as long as it says |
| `_:8` | Holds the note before it on for that much longer, without striking it again. Written at the head of a bar, this is a note carried over the bar line — the pitch is not written twice |
| `1/3+2/3+3/2_` | The same for a chord: a tie with its strings written out holds those, so a chord carried over a bar line is drawn as the notes still ringing rather than as whatever happened to sound last |

A bar with no end runs to the start of the next one; the last bar borrows the
length of the one before it. **📍 Time** drops the current playback position in
at the caret, which is the fiddly part to type while something is playing.

Notes belong to the chord written in front of them, and where each one falls
comes from the durations before it rather than from a position of its own. A bar
is four beats, so a chord's stretch is its share of them — one of two chords in
a bar holds two beats — and a phrase written longer than that overruns the bar,
which the panel says out loud and the staff draws past the bar line. A phrase
with no chord over it is written on its own; the sheet then says what is played
and nothing about the harmony, which is a perfectly ordinary thing to write
down.

Within a bar the four beats split the way chord-vamp splits them — 2 chords into
2+2, 3 into 2+1+1 — so a bar written in either app reads the same.

## Run locally

```bash
# Open the file directly
open index.html

# Or serve it (needed on some browsers for iframe API):
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Checks

```bash
node scripts/check.js            # run every case
node scripts/check.js --update   # accept what the code draws now
```

Runs the real `chords.js` and the sheet-editing half of `main.js` over a table
of phrases — no dependencies, no test runner. Two kinds of case:

- **drawing** — renders a bar and diffs the SVG against `scripts/snapshots/`.
  Change a beam, a bracket, a flag or a note's place and the diff says so.
  If the change was the point, `--update` accepts it and the new snapshot goes
  in the commit, where it reads as what the change did to the page.
- **editing** — presses a button or moves a note, and checks the sheet text that
  comes back. Text is what the app saves, so it is what an edit means.

A case can also carry `broken:` — the expected value is what the code does
wrong today, and the run prints it as `!` with the reason instead of a pass.
Writing the phrase down is the point: the day it is fixed, that case fails and
the expected value is turned into the right answer.

Every phrase in there was a bug once. Add the phrase before the fix, and the
next one like it is caught before it ships.

## Deploy to GitHub Pages

1. Repo → **Settings** → **Pages**
2. Source: *Deploy from a branch*
3. Branch: `main` / `/ (root)` → **Save**

## Data

History and sheets live in your browser's `localStorage` under the key
`yt-loop-data-v3`. Nothing is synced across devices or browsers.

Each video keeps its **5 most recent ranges**, dropping the least recently
played — the range list is a short "back to what I was just on", not an archive.
Videos themselves are never dropped automatically: one can hold a sheet,
which is typed work rather than a by-product of pressing play. A video goes when
you clear it with the 🗑 in its header, and its chords go with it.

Earlier versions are migrated on first load and then left alone, so rolling back
still finds its data: `yt-loop-data-v2` (history, no sheets) is copied straight
over, and `yt-loop-data-v1` (loops saved by hand, back when saving was a button)
is converted to history.

Anything worth keeping belongs in a bookmark — 🔗 URL for a range, 🔗 URL under
**Sheet** for the sheet itself.

## Share URL format

```
?v=<videoId>&s=<startSec>&e=<endSec>&r=<rate>&n=<note>
```

Example: `?v=dQw4w9WgXcQ&s=12.50&e=24.80&r=0.75`

The **📝 MD** button wraps this link in Markdown:

```
[<video title> (<start> → <end>)](<share url>)
```

Example: `[My Song (0:12.50 → 0:24.80)](https://.../?v=dQw4w9WgXcQ&s=12.50&e=24.80&r=0.75)`

A sheet travels in `k`, in the notation above:

```
?v=<videoId>&k=<sheet>
```

Nothing in the app builds that link — a second 🔗 / 📝 pair beside the range's
own was two identical-looking buttons meaning different things. The sheet is
text in the editor, kept in the short notation, so moving one is a matter of
copying it. Links carrying `k` are still read: a sheet arriving in one fills in
only where this browser has none, the same rule the note follows.

GitHub Pages answers a URL of 8,000 characters and refuses one of 9,000, which
works out to roughly 90 bars of four chords — a whole tune, with room to spare.
