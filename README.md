# YT Loop

YouTube動画の任意区間をリピート再生するWebアプリ。音楽の耳コピ・フレーズ練習用。

## 機能

- YouTube URL入力 → 動画表示
- 再生速度切替（0.25x〜2.0x、YouTubeと同じ刻み）
- 開始・終了時間指定でループ再生
- 「現在時刻をキャプチャ」ボタンで開始/終了を即設定
- ループ回数指定（無限 or N回）
- ラベル付きで区間を保存・編集・削除（localStorage）
- 共有URL生成（動画ID・区間・速度をクエリで渡せる）
- キーボードショートカット

## キーボードショートカット

| キー | 動作 |
|-----|------|
| `Space` | 再生 / 停止 |
| `S` | 現在時刻を開始にキャプチャ |
| `E` | 現在時刻を終了にキャプチャ |
| `←` / `→` | 0.5秒シーク |
| `Shift + ←` / `→` | 5秒シーク |

## ローカル実行

```bash
# 素のファイルを開くだけでも動作する
open index.html

# 簡易サーバーで開きたい場合
python3 -m http.server 8000
# → http://localhost:8000
```

## デプロイ（GitHub Pages）

1. リポジトリ Settings → Pages
2. Source: Deploy from a branch
3. Branch: `main` / `/ (root)` を選択して保存

## データ

すべてブラウザの `localStorage` に保存されます（キー: `yt-loop-data-v1`）。
別ブラウザ・別端末とは同期しません。

## 共有URL形式

```
?v=<videoId>&s=<startSec>&e=<endSec>&r=<rate>
```

例: `?v=dQw4w9WgXcQ&s=12.50&e=24.80&r=0.75`
