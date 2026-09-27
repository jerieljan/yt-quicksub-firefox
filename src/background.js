(() => {
  // Tokens stay in memory and are scoped to the tab and video that generated
  // them. Nothing is persisted; tokens are reused only for caption requests to YouTube.
  const tokensByTab = new Map();
  const MAX_TOKEN_AGE_MS = 30 * 60 * 1000;

  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (details.tabId < 0) return;
      let url;
      try {
        url = new URL(details.url);
      } catch {
        return;
      }
      const videoId = url.searchParams.get("v");
      const poToken = url.searchParams.get("pot");
      if (!videoId || !poToken) return;

      let tabTokens = tokensByTab.get(details.tabId);
      if (!tabTokens) {
        tabTokens = new Map();
        tokensByTab.set(details.tabId, tabTokens);
      }
      tabTokens.set(videoId, {
        pot: poToken,
        potc: url.searchParams.get("potc") || "1",
        client: url.searchParams.get("c") || "WEB",
        capturedAt: Date.now(),
      });
    },
    { urls: ["https://www.youtube.com/api/timedtext*"] },
  );

  browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== "get-caption-po-token" || sender.tab?.id == null) return undefined;
    const token = tokensByTab.get(sender.tab.id)?.get(message.videoId);
    if (!token || Date.now() - token.capturedAt > MAX_TOKEN_AGE_MS) return { token: null };
    return {
      token: {
        pot: token.pot,
        potc: token.potc,
        client: token.client,
      },
    };
  });

  browser.tabs.onRemoved.addListener((tabId) => tokensByTab.delete(tabId));
})();
