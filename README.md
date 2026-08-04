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
- Nudge start / end with arrow keys (±0.05s, Shift ±1s) while the field is focused
- **Live duration** display (end − start)
- **Loop toggle** — turn looping on/off without losing your start/end
- **History** — every range you play is remembered on its own, newest first, grouped by video. No save button: ▶ Play on an entry puts its range, speed and note back in the controls. 🗑 on an entry drops it; 🗑 on a video header clears that video's history
- **🔗 URL** — copies a link that encodes video, start, end, and rate as query params. This is how you keep a loop for good: bookmark the link. Editing a value flashes the field and both copy buttons, so it's visible that the link tracks the form
- **📝 MD** — copies the same link as a Markdown link, labelled with the video title and time range
- Keyboard shortcuts (see below)

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / pause |
| `S` | Jump to loop start |
| `E` | Jump to loop end |
| `←` / `→` | Seek 0.05 seconds (or nudge the value when Start/End is focused) |
| `Shift + ←` / `→` | Seek 1 second (or nudge by 1s when Start/End is focused) |

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

History lives in your browser's `localStorage` under the key `yt-loop-data-v2`.
Nothing is synced across devices or browsers.

It is capped at **5 videos × 5 ranges each**, dropping the least recently played
first — it's a short "back to what I was just on" list, not an archive. Anything
worth keeping belongs in a bookmark (🔗 URL).

Loops saved by hand in an earlier version (`yt-loop-data-v1`) are converted to
history on first load, uncapped, so they can still be turned into bookmarks. The
caps take effect from the next range you play. The `v1` key itself is left
untouched.

## Share URL format

```
?v=<videoId>&s=<startSec>&e=<endSec>&r=<rate>
```

Example: `?v=dQw4w9WgXcQ&s=12.50&e=24.80&r=0.75`

The **📝 MD** button wraps this link in Markdown:

```
[<video title> (<start> → <end>)](<share url>)
```

Example: `[My Song (0:12.50 → 0:24.80)](https://.../?v=dQw4w9WgXcQ&s=12.50&e=24.80&r=0.75)`
