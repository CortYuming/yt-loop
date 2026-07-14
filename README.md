# YT Loop

Loop any part of a YouTube video. Built for music practice — ear training, phrase drilling, riff learning.

## demo site

https://cortyuming.github.io/yt-loop/

## Features

- Paste a YouTube URL, play the video inline
- Switch playback speed (0.25x – 2.0x, YouTube's own steps)
- Set start / end times, loop the region
- **📍 pin** — snap the field to the current playback time
- Nudge start / end with arrow keys (±0.05s, Shift ±1s) while the field is focused
- **Live duration** display (end − start)
- **Loop toggle** — turn looping on/off without losing your start/end
- Save, edit, delete named loops per video (localStorage)
- **Share URL** — encodes video, start, end, and rate as query params
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

All data lives in your browser's `localStorage` under the key `yt-loop-data-v1`.
Nothing is synced across devices or browsers.

## Share URL format

```
?v=<videoId>&s=<startSec>&e=<endSec>&r=<rate>
```

Example: `?v=dQw4w9WgXcQ&s=12.50&e=24.80&r=0.75`
