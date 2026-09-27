(() => {
  const status = document.getElementById("status");
  const form = document.getElementById("download-form");
  const select = document.getElementById("track");
  const download = document.getElementById("download");
  let activeTabId;

  function setStatus(message) {
    status.textContent = message;
  }

  function chooseDefaultIndex(tracks) {
    const englishManual = tracks.findIndex((track) => track.languageCode === "en" && !track.isAsr);
    if (englishManual >= 0) return englishManual;
    const englishAsr = tracks.findIndex((track) => ["en", "en-orig"].includes(track.languageCode) && track.isAsr);
    if (englishAsr >= 0) return englishAsr;
    const anyAsr = tracks.findIndex((track) => track.isAsr);
    return anyAsr >= 0 ? anyAsr : 0;
  }

  async function initialize() {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      activeTabId = tab?.id;
      if (!activeTabId || !/^https:\/\/(www|m)\.youtube\.com\//.test(tab.url || "")) {
        throw new Error("Open a YouTube video, then use this button again.");
      }
      const response = await browser.tabs.sendMessage(activeTabId, { type: "inspect" });
      if (!response?.ok) throw new Error(response?.error || "The YouTube page did not respond.");
      const { info } = response;
      if (!info.tracks.length) throw new Error("This video has no caption tracks.");

      select.replaceChildren(
        ...info.tracks.map((track) => {
          const option = document.createElement("option");
          option.value = track.id;
          option.textContent = `${track.name} (${track.languageCode}) — ${track.isAsr ? "auto-generated" : "manual"}`;
          return option;
        }),
      );
      select.selectedIndex = chooseDefaultIndex(info.tracks);
      setStatus(`${info.tracks.length} caption track${info.tracks.length === 1 ? "" : "s"} found for “${info.title}”.`);
      form.hidden = false;
    } catch (error) {
      setStatus(error.message);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    download.disabled = true;
    download.textContent = "Building SRT…";
    setStatus("Fetching captions and adjusting timings…");
    try {
      const response = await browser.tabs.sendMessage(activeTabId, {
        type: "download",
        trackId: select.value,
      });
      if (!response?.ok) throw new Error(response?.error || "The download failed.");
      setStatus(`Downloaded ${response.result.cueCount} cues as ${response.result.filename}`);
      download.textContent = "Downloaded ✓";
    } catch (error) {
      setStatus(error.message);
      download.disabled = false;
      download.textContent = "Try again";
    }
  });

  initialize();
})();
