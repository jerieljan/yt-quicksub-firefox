(() => {
  "use strict";

  const core = globalThis.YtQuickSubCore;
  const CONTROL_ID = "yt-quicksub-control";
  let cachedVideo = null;
  let cachedInfo = null;
  let refreshSequence = 0;

  function currentVideoId() {
    if (!/^\/(watch|shorts\/)/.test(location.pathname)) return null;
    if (location.pathname.startsWith("/shorts/")) return location.pathname.split("/")[2] || null;
    return new URL(location.href).searchParams.get("v");
  }

  function responseFromDocument(videoId) {
    for (const script of document.scripts) {
      if (!script.textContent?.includes("ytInitialPlayerResponse")) continue;
      const response = core.extractPlayerResponse(script.textContent);
      if (response?.videoDetails?.videoId === videoId) return response;
    }
    return null;
  }

  async function loadPlayerResponse(videoId, allowFetch) {
    const inPage = responseFromDocument(videoId);
    if (inPage) return inPage;

    if (!allowFetch) return null;

    const watchUrl = new URL("/watch", location.origin);
    watchUrl.searchParams.set("v", videoId);
    watchUrl.searchParams.set("hl", "en");
    const response = await fetch(watchUrl, { credentials: "include" });
    if (!response.ok) throw new Error(`YouTube returned HTTP ${response.status}.`);
    const html = await response.text();
    const playerResponse = core.extractPlayerResponse(html);
    if (!playerResponse) throw new Error("YouTube did not include caption information in the page.");
    return playerResponse;
  }

  function trackName(track) {
    if (track.name?.simpleText) return track.name.simpleText;
    return (track.name?.runs || []).map((run) => run.text || "").join("") || track.languageCode;
  }

  function normalizePlayerResponse(response, videoId) {
    const status = response.playabilityStatus?.status;
    if (status && status !== "OK") {
      throw new Error(response.playabilityStatus?.reason || "This video is not available.");
    }
    const captionRenderer = response.captions?.playerCaptionsTracklistRenderer;
    const rawTracks = captionRenderer?.captionTracks || [];
    const tracks = rawTracks.map((track, index) => ({
      id: `${index}:${track.languageCode}:${track.kind || "manual"}`,
      languageCode: track.languageCode,
      name: trackName(track),
      isAsr: track.kind === "asr",
      baseUrl: track.baseUrl,
    }));
    return {
      videoId,
      title: response.videoDetails?.title || document.title.replace(/\s+-\s+YouTube$/, ""),
      tracks,
    };
  }

  async function inspectVideo({ fresh = false, allowFetch = true } = {}) {
    const videoId = currentVideoId();
    if (!videoId) throw new Error("Open a YouTube video first.");
    if (!fresh && cachedVideo === videoId && cachedInfo) return cachedInfo;
    const response = await loadPlayerResponse(videoId, allowFetch);
    if (!response) throw new Error("Caption availability has not been checked yet.");
    const info = normalizePlayerResponse(response, videoId);
    cachedVideo = videoId;
    cachedInfo = info;
    return info;
  }

  function publicInfo(info) {
    return {
      videoId: info.videoId,
      title: info.title,
      tracks: info.tracks.map(({ id, languageCode, name, isAsr }) => ({ id, languageCode, name, isAsr })),
    };
  }

  function chooseDefaultTrack(tracks) {
    const english = tracks.filter((track) => track.languageCode === "en" || track.languageCode === "en-orig");
    return english.find((track) => !track.isAsr) || english.find((track) => track.isAsr) || tracks.find((track) => track.isAsr) || tracks[0];
  }

  function captionResourceUrls() {
    return performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => url.includes("/api/timedtext?"));
  }

  async function playerPoToken(videoId) {
    const visibleToken = core.findSubtitlePoToken(captionResourceUrls(), videoId, location.origin);
    if (visibleToken) return visibleToken;
    try {
      const response = await browser.runtime.sendMessage({
        type: "get-caption-po-token",
        videoId,
      });
      return response?.token || null;
    } catch {
      return null;
    }
  }

  async function waitForPlayerPoToken(videoId, timeoutMs = 5000) {
    const started = performance.now();
    while (performance.now() - started < timeoutMs) {
      const token = await playerPoToken(videoId);
      if (token) return token;
      await new Promise((resolve) => setTimeout(resolve, 125));
    }
    return null;
  }

  async function obtainPlayerPoToken(videoId) {
    const existing = await playerPoToken(videoId);
    if (existing) return existing;

    // YouTube's player generates its subtitle token locally when captions are
    // enabled. Briefly enabling captions lets us reuse that video-bound token.
    const captionsButton = document.querySelector("#movie_player .ytp-subtitles-button");
    if (!captionsButton || captionsButton.disabled) {
      throw new Error("Turn on captions in YouTube once, then try the download again.");
    }
    const wasEnabled = captionsButton.getAttribute("aria-pressed") === "true";
    if (wasEnabled) {
      captionsButton.click();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    captionsButton.click();
    const token = await waitForPlayerPoToken(videoId);
    if (!wasEnabled && captionsButton.getAttribute("aria-pressed") === "true") captionsButton.click();
    if (!token) {
      throw new Error("YouTube did not expose its caption access token. Turn on captions once, then try again.");
    }
    return token;
  }

  async function fetchJson3(track, videoId) {
    const needsToken = core.requiresSubtitlePoToken(track.baseUrl, location.origin);
    const poToken = needsToken ? await obtainPlayerPoToken(videoId) : await playerPoToken(videoId);
    const url = core.buildCaptionUrl(track.baseUrl, poToken, location.origin);
    let response;
    try {
      response = await fetch(url, { credentials: "include" });
    } catch (error) {
      throw new Error(`The caption request failed: ${error.message}`);
    }
    if (!response.ok) throw new Error(`YouTube returned HTTP ${response.status} for the caption track.`);
    const text = await response.text();
    try {
      JSON.parse(text);
    } catch {
      throw new Error("YouTube returned an invalid or empty caption track. Try again in a few minutes.");
    }
    return text;
  }

  function saveText(text, filename) {
    const blobUrl = URL.createObjectURL(new Blob([text], { type: "application/x-subrip;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  }

  async function downloadTrack(trackId) {
    const info = await inspectVideo({ fresh: true });
    const track = trackId ? info.tracks.find((candidate) => candidate.id === trackId) : chooseDefaultTrack(info.tracks);
    if (!track) throw new Error("This video has no caption tracks.");

    const content = await fetchJson3(track, info.videoId);
    const cues = track.isAsr
      ? core.groupWords(core.parseJson3(content))
      : core.parseManualJson3(content);
    if (!cues.length) throw new Error("The caption track did not produce any subtitle cues.");

    const filename = core.defaultOutputName(info.title, info.videoId, track.languageCode);
    saveText(core.writeSrt(cues), filename);
    return { filename, cueCount: cues.length, track: { name: track.name, isAsr: track.isAsr } };
  }

  function buttonElement() {
    return document.querySelector(`#${CONTROL_ID} button`);
  }

  function buttonContents() {
    const icon = document.createElement("span");
    icon.className = "yt-quicksub-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = `
      <svg class="yt-quicksub-icon-download" viewBox="0 0 24 24" focusable="false">
        <path d="M11 4h2v8.17l2.59-2.58L17 11l-5 5-5-5 1.41-1.41L11 12.17V4Zm-4 14h10v2H7v-2Z"/>
      </svg>
      <svg class="yt-quicksub-icon-success" viewBox="0 0 24 24" focusable="false">
        <path d="m9.55 17.3-4.6-4.6 1.4-1.4 3.2 3.2 8.1-8.1 1.4 1.4-9.5 9.5Z"/>
      </svg>
      <svg class="yt-quicksub-icon-error" viewBox="0 0 24 24" focusable="false">
        <path d="M11 7h2v6h-2V7Zm0 8h2v2h-2v-2Zm1-13a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z"/>
      </svg>`;
    const label = document.createElement("span");
    label.className = "yt-quicksub-label";
    return [icon, label];
  }

  function setButtonState(state = "ready", description = "Download SRT", label = "Download SRT") {
    const button = buttonElement();
    if (!button) return;
    button.querySelector(".yt-quicksub-label").textContent = label;
    button.title = description;
    button.setAttribute("aria-label", description);
    button.setAttribute("aria-busy", String(state === "busy"));
    button.dataset.state = state;
    button.disabled = state === "busy" || state === "unavailable";
  }

  async function updatePageControl(sequence) {
    try {
      const info = await inspectVideo({ fresh: true, allowFetch: false });
      if (sequence !== refreshSequence || info.videoId !== currentVideoId()) return;
      if (!info.tracks.length) {
        document.getElementById(CONTROL_ID)?.remove();
      } else {
        const control = document.getElementById(CONTROL_ID);
        if (control) control.hidden = false;
        setButtonState("ready");
      }
    } catch {
      if (sequence === refreshSequence) document.getElementById(CONTROL_ID)?.remove();
    }
  }

  function mountPageControl() {
    const videoId = currentVideoId();
    if (!videoId) {
      document.getElementById(CONTROL_ID)?.remove();
      return false;
    }
    const existing = document.getElementById(CONTROL_ID);
    if (existing?.dataset.videoId === videoId) return true;
    existing?.remove();

    const actionButtons = document.querySelector(
      "ytd-watch-metadata #actions-inner #menu #top-level-buttons-computed, " +
      "ytd-watch-metadata #actions #menu #top-level-buttons-computed, " +
      "#above-the-fold #actions-inner #top-level-buttons-computed"
    );
    if (!actionButtons) return false;
    const wrapper = document.createElement("div");
    wrapper.id = CONTROL_ID;
    wrapper.dataset.videoId = videoId;
    wrapper.hidden = true;
    const button = document.createElement("button");
    button.type = "button";
    button.append(...buttonContents());
    button.dataset.state = "busy";
    button.disabled = true;
    button.addEventListener("click", async () => {
      setButtonState("busy", "Building SRT…", "Building…");
      try {
        const result = await downloadTrack();
        setButtonState("success", `Downloaded ${result.cueCount} cues. Download SRT again`, "Downloaded");
      } catch (error) {
        setButtonState("error", `${error.message} Select to try again.`, "Try again");
      }
    });
    wrapper.append(button);
    // YouTube places its three-dot menu immediately after this container, so
    // appending here puts yt-quicksub after Download and before that menu.
    actionButtons.append(wrapper);
    return true;
  }

  function scheduleRefresh() {
    refreshSequence += 1;
    const sequence = refreshSequence;
    cachedVideo = null;
    cachedInfo = null;
    document.getElementById(CONTROL_ID)?.remove();
    for (const delay of [0, 400, 1000, 2200, 4000]) {
      setTimeout(() => {
        if (sequence !== refreshSequence) return;
        if (mountPageControl()) updatePageControl(sequence);
      }, delay);
    }
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === "inspect") {
      return inspectVideo({ fresh: true })
        .then((info) => ({ ok: true, info: publicInfo(info) }))
        .catch((error) => ({ ok: false, error: error.message }));
    }
    if (message?.type === "download") {
      return downloadTrack(message.trackId)
        .then((result) => ({ ok: true, result }))
        .catch((error) => ({ ok: false, error: error.message }));
    }
    return undefined;
  });

  document.addEventListener("yt-navigate-finish", scheduleRefresh);
  window.addEventListener("popstate", scheduleRefresh);
  scheduleRefresh();
})();
