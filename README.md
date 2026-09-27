# yt-quicksub for Firefox

This plugin lets you download the auto-generated or manual caption files in YouTube videos. Auto-generated subs are processed locally for timing corrections so they render like proper subtitles rather than TV-style captions that appear word by word.

Text is processed as-is. No corrections or editing is performed beyond timing correction, and no data is transmitted outward and all of it is processed locally.

The add-on does not render SRT files on YouTube videos. It's recommended to use other add-ons that does this for you if you want it displayed.

## What it does

- Adds an **Auto captions available · Download SRT** control below the title of
  a YouTube video.
- Adds a toolbar popup where you can select any available caption language.
- Reads YouTube's `json3` caption track, reconstructs its word stream, and
  groups the words into sentence-paced cues.
- Reuses the video-bound subtitle access token generated locally by YouTube's
  player. If the player has not requested captions yet, the extension briefly
  enables captions to obtain that token, then restores the previous setting.
- Downloads the result through a local Blob URL.
- Sends no analytics or caption data to the extension author or another
  service. Its only network requests go to YouTube for the current video's page
  and caption track when you open the popup or request a download. A narrowly scoped
  Firefox request observer captures only token-bearing YouTube caption request
  URLs and keeps the token in memory for the current tab. The availability badge
  uses caption data already present in the open page when possible.

Manual caption tracks are already line-paced, so the extension passes their
cues through without regrouping. Like the CLI, English is the default when it
is present, and a manual English track is preferred over an auto-generated one.

## Install for local testing

1. Open `about:debugging` in Firefox.
2. Select **This Firefox**.
3. Select **Load Temporary Add-on**.
4. Choose this repository's `manifest.json`.
5. Open or reload a YouTube video.

Temporary add-ons disappear when Firefox restarts. A normal install requires a
signed package from Mozilla Add-ons.

## Test

Use Node.js 24.18.0 (configured in `mise.toml`).

```sh
npm ci
npm test
npm run lint
```

The tests use Vitest. Lint checks run Biome and the pinned Mozilla web-ext
validator; runtime code has no dependencies. Run `rig check` for validation
or `rig check --fix` to apply setup repairs, formatting, and safe lint fixes.

## Package

```sh
npm run package
```
