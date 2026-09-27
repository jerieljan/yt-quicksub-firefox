# yt-quicksub for Firefox

A standalone Firefox extension that downloads the current YouTube video's
captions as a readable SRT file. Auto-generated tracks use the same parsing,
cue grouping, and timing rules as the `yt-quicksub` Python CLI in the sibling
repository.

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

```sh
npm ci
npm test
npm run lint
```

The tests use Node's built-in test runner. Release validation uses the pinned
Mozilla web-ext development dependency; runtime code has no dependencies.

## Package

```sh
npm run package
```

This runs tests and Mozilla validation (warnings fail the build), then creates
`dist/yt-quicksub-firefox-0.1.5.xpi` and a SHA-256 checksum. It also refreshes
`yt-quicksub-firefox.xpi` for compatibility with the original package command.
Only explicitly listed runtime files and the license enter the package.
Mozilla must sign an XPI before regular Firefox releases can install it permanently.

Desktop requires Firefox 140 or later; Android requires 142 or later. Android
behavior still needs device testing before publication. See
[AMO submission notes](docs/AMO-SUBMISSION.md) for listing copy, privacy details,
reviewer instructions, and the manual release checklist.

## Important maintenance note

The official YouTube Data API only lets a user download captions for videos
they can edit. This extension instead reads the caption-track URL already sent
to the YouTube watch page and reuses the subtitle Proof-of-Origin token created
by YouTube's own player. That makes public-video use possible without an API key,
token provider, or server, but it is an undocumented YouTube interface. YouTube
can change the watch-page response, token parameters, or `json3` endpoint, so
the fetch adapter in `src/content.js` may need maintenance even though the
conversion code in `src/core.js` is stable.
