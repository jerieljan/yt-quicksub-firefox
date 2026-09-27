# Mozilla Add-ons submission

## Package and identity

Run `npm ci`, then `npm run release` with Node.js 20 or later. Upload
`dist/yt-quicksub-firefox-0.1.5.xpi` to the Mozilla Add-ons developer hub.
The adjacent `.sha256` file identifies the unsigned upload. Mozilla's signed
package will have a different checksum. Do not distribute the unsigned file as
an installable release for normal Firefox.

Keep the extension ID, `@yt-quicksub.jerieljan`, for updates. This is
an identifier, not a contact email address. Version 0.1.5 must be higher than any
version already submitted under this ID; if needed, update both package.json
and manifest.json and rebuild.

The manifest requires Firefox desktop 140 or later and Android 142 or later.
The Android minimum fixes the data declaration warning; it does not prove that
all mobile features work. Complete Android testing before offering Android
support in the listing. The inline page button uses desktop YouTube selectors;
on mobile, use the extension popup and enable YouTube captions manually if asked.

## Listing copy

Name: yt-quicksub

Summary: Download YouTube captions as readable SRT subtitles, processed locally in Firefox.

Description:

Download available captions from the YouTube video you are watching. Choose a
caption language from the toolbar popup, or use the Download SRT button beside
the video actions on the desktop watch page.

Auto-generated captions are grouped into readable subtitle cues with adjusted
timing. Manual caption tracks keep their existing cue structure. English is
selected by default when available. The resulting SRT file works with subtitle
editors and video players that support SRT.

Caption processing happens in Firefox. No extension account, API key, analytics,
or external processing service is required. The extension contacts YouTube to
retrieve the current video's page and captions. Videos must have available
caption tracks. YouTube changes can affect availability.

This is an independent project and is not affiliated with YouTube or Google.

License: MIT.

Before submitting, supply your actual support contact or project URL in AMO.
Use genuine screenshots showing the page button, language selection, and a
successful download. Avoid showing account details or private video content.

## Privacy statement

yt-quicksub processes video titles and caption text locally in Firefox to create
subtitle files. It sends no analytics, advertising data, or crash reports to the
author. It has no author-operated server.

Opening the popup or requesting a download may retrieve the current video's
YouTube watch page and caption track. These requests may include your existing
YouTube session credentials. The extension reuses YouTube's video-specific
caption access token for requests to YouTube. Observed tokens remain in memory,
are rejected after 30 minutes, and are removed when the tab closes or the
background context ends. Downloaded subtitle files remain wherever you save them.

The existing manifest declaration, `required: ["none"]`, is retained. The
network behavior above should be disclosed to the reviewer so Mozilla can
assess that declaration against its data classification rules. Passing the
automated validator does not establish privacy-policy compliance. Reassess the
declaration before adding any remote service or telemetry.

## Reviewer notes

All runtime JavaScript is readable and included directly in the XPI. There is
no transpilation, minification, remote code, runtime dependency, or server.
The packaging script copies an explicit file list and uses web-ext to validate
and zip it. A separate generated-code source archive is not needed for this
release; provide the repository source if a reviewer requests it.

Permissions:

- Access to www.youtube.com and m.youtube.com lets content scripts inspect the
  current video and retrieve its caption tracks.
- webRequest observes only www.youtube.com/api/timedtext requests to capture the
  current tab's video-bound caption access token. It does not block or modify
  requests. Tokens are not sent to the author.

To test, open a public YouTube watch page with English automatic captions.
Allow the extension access to YouTube, reload the page, and choose Download SRT
or open the toolbar popup. Select a track and download it. If prompted, turn on
YouTube captions once and retry. No extension-specific account is required.
The extension uses YouTube's undocumented page and caption interfaces, so
caption availability and token behavior can change independently of this release.

## Manual checks before publication

These are pending checks, not claims of successful testing:

- Load the packaged XPI through about:debugging on desktop. Check the minimum
  supported Firefox and current stable Firefox where available.
- Download automatic and manual captions, and a non-English track. Open each
  SRT and check readable text, ordering, and timing against the video.
- Check a video without captions, a non-video page, and unavailable videos.
- Navigate between videos without reloading; confirm titles and tracks update.
- Check that a download restores the previous caption setting, and that errors
  allow retry. Check popup keyboard navigation and readable status messages.
- On Android 142 or later, check popup selection, manual caption enablement,
  and saving/opening the SRT on both supported YouTube hostnames.
- Take listing screenshots after these checks, then upload the XPI. Resolve
  AMO findings and test the signed download before announcing the release.

References:

- https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
- https://extensionworkshop.com/documentation/publish/package-your-extension/
- https://extensionworkshop.com/documentation/publish/source-code-submission/
- https://extensionworkshop.com/documentation/publish/submitting-an-add-on/
