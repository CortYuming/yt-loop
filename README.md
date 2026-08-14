# YT Loop

Loop any part of a YouTube video. Built for music practice — ear training, phrase drilling, riff learning.

## demo site

https://cortyuming.github.io/yt-loop/

## Features

- Paste a YouTube URL, play the video inline
- Switch playback speed — presets (0.25x – 2.0x, YouTube's own steps) plus a slider covering 0 – 2.0x in 0.01 steps
- **⤴️ Speed up** — a practice run from 0.25x to 1.00x: the rate gains 0.05x on every completed lap. The label doubles as the progress readout (`0.60x → 1.00x`). While it runs the speed controls and the 🔗 / 📝 buttons are locked; switch it off to return to your previous speed
- Set start / end times, loop the region
- **📍 pin** — snap the field to the current playback time
- **⏮** — jump to the loop start without changing play / pause state
- Nudge start / end by ±0.05s with `Shift + ←` / `→` while the field is focused (the bare arrows move the caret)
- **Live duration** display (end − start)
- **Loop toggle** — turn looping on/off without losing your start/end
- **History** — every range you play is remembered on its own, newest first, grouped by video. No save button: ▶ Play on an entry puts its range, speed and note back in the controls. 🗑 on an entry drops it; 🗑 on a video header clears that video's history. The video in the player has its ranges open and the rest are collapsed to their header — ▸ opens one without disturbing playback
- **🎼 Chords** — a chord sheet per video: the fingerings you picked in [Guitar Chord Viewer](https://cortyuming.github.io/guitar-chord-viewer/), drawn as diagrams of the five frets around the shape and laid out as one unbroken row that slides under a playhead fixed in the middle — what is playing stays in one place and what is coming arrives from the right. Every bar is four slots wide whatever it holds, its chords taking slots in proportion to their beats, so the sheet moves at one steady pace; a bar with more than four chords stacks them four to a line inside that same width. The slot narrows on a window too small for four, so a whole bar always fits across. Seconds the sheet says nothing about are drawn as blank of the same width those seconds would have taken, so the row keeps moving through a hole instead of parking under the playhead; where two phrases overlap it never runs backwards — a bar starting before the sheet has got there is crossed at once. An amber rule and the bar number mark where each bar starts. The time on a bar head is also how a range is marked out from the sheet: click it and **start📍 / end📍** appear, each putting that bar's moment in the box it names — one bar's time for the start, a later bar's for the end, instead of catching both by ear as they go past. Dots are labelled with degrees by default, note names on the **Interval / Note** switch; the root is set apart, open strings are hollow, muted ones get `×`. A chord name opens the full fretboard in the viewer. **Show** folds the strip away; 🎼 in a video's header loads that video and opens its editor. See the notation below
- **🔗 URL** — copies a link that encodes video, start, end, rate and note as query params. This is how you keep a loop for good: bookmark the link. Editing a value flashes the field and both copy buttons, so it's visible that the link tracks the form. Notes are capped at 30 characters, since percent-encoding costs 9 characters per Japanese character. On landing, a note already in this browser's history wins over the one in the link — the link's copy only fills in where there's no local entry, which is the case it exists for (another machine, or storage that got cleared)
- **📝 MD** — copies the same link as a Markdown link, labelled with the video title and time range
- Keyboard shortcuts (see below)

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / pause |
| `S` | Jump to loop start |
| `←` / `→` | Seek 0.05 seconds (move the caret when Start/End is focused) |
| `Shift + ←` / `→` | Seek 1 second (nudge the value by 0.05s when Start/End is focused) |

## Chord notation

```
@43.50 Bb9:1.1.1.0.. Eb9:.6.6.5.6.|@45.90 D7+9:.6.5.4.5. G7+9:13.11.10.9..
```

| Piece | Meaning |
|-------|---------|
| `\|` or a newline | Bar line. Leading and trailing ones are free |
| `Name:frets` | A chord and the fingering picked for it — six dot-separated frets, 1st string first, blank for a muted string. Exactly the `m=` string Guitar Chord Viewer puts in its own URL |
| `Name` | A chord with no fingering yet. It still gets its name and time, just no diagram |
| `@43.50` | Where the bar starts. Also accepted as `@0:43.50` |
| `@43.50-45.85` | Start and end, for a bar whose end can't be inferred |
| `[Bb9](https://.../guitar-chord-viewer/?c=Bb9&m=1.1.1.0..)` | A Markdown link pasted straight out of a notes file works as a chord. It is stored in the short form above |

A bar with no end runs to the start of the next one; the last bar borrows the
length of the one before it. **📍 Time** drops the current playback position in
at the caret, which is the fiddly part to type while something is playing.

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

## Deploy to GitHub Pages

1. Repo → **Settings** → **Pages**
2. Source: *Deploy from a branch*
3. Branch: `main` / `/ (root)` → **Save**

## Data

History and chord sheets live in your browser's `localStorage` under the key
`yt-loop-data-v3`. Nothing is synced across devices or browsers.

Each video keeps its **5 most recent ranges**, dropping the least recently
played — the range list is a short "back to what I was just on", not an archive.
Videos themselves are never dropped automatically: one can hold a chord sheet,
which is typed work rather than a by-product of pressing play. A video goes when
you clear it with the 🗑 in its header, and its chords go with it.

Earlier versions are migrated on first load and then left alone, so rolling back
still finds its data: `yt-loop-data-v2` (history, no sheets) is copied straight
over, and `yt-loop-data-v1` (loops saved by hand, back when saving was a button)
is converted to history.

Anything worth keeping belongs in a bookmark — 🔗 URL for a range, 🔗 URL under
**Chords** for a sheet.

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

A chord sheet travels in `k`, in the notation above:

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
