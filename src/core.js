(function (root, factory) {
  const api = factory();
  root.YtQuickSubCore = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const WORD_MAX_MS = 800;
  const MARKER_END_PAD_MS = 50;
  const DEFAULTS = Object.freeze({
    maxChars: 84,
    minChars: 16,
    maxDurMs: 7000,
    minDurMs: 1200,
    pauseBreakMs: 1500,
    tailMs: 400,
  });

  function readBalancedObject(source, openAt) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = openAt; index < source.length; index += 1) {
      const character = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) return source.slice(openAt, index + 1);
      }
    }
    return null;
  }

  function extractPlayerResponse(source) {
    const patterns = [
      /ytInitialPlayerResponse\s*=\s*/g,
      /window\[\s*["']ytInitialPlayerResponse["']\s*\]\s*=\s*/g,
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(source))) {
        const openAt = source.indexOf("{", match.index + match[0].length);
        if (openAt < 0) continue;
        const json = readBalancedObject(source, openAt);
        if (!json) continue;
        try {
          return JSON.parse(json);
        } catch {
          // Keep looking. The matched token may not lead directly to JSON.
        }
      }
    }
    return null;
  }

  function requiresSubtitlePoToken(baseUrl, origin = "https://www.youtube.com") {
    const url = new URL(baseUrl, origin);
    const experiments = url.searchParams.getAll("exp").flatMap((value) => value.split(","));
    return experiments.some((value) => value === "xpe" || value === "xpv");
  }

  function findSubtitlePoToken(resourceUrls, videoId, origin = "https://www.youtube.com") {
    for (const value of [...resourceUrls].reverse()) {
      let url;
      try {
        url = new URL(value, origin);
      } catch {
        continue;
      }
      if (url.pathname !== "/api/timedtext" || url.searchParams.get("v") !== videoId) continue;
      const poToken = url.searchParams.get("pot");
      if (!poToken) continue;
      return {
        pot: poToken,
        potc: url.searchParams.get("potc") || "1",
        client: url.searchParams.get("c") || "WEB",
      };
    }
    return null;
  }

  function buildCaptionUrl(baseUrl, poToken, origin = "https://www.youtube.com") {
    const url = new URL(baseUrl, origin);
    url.searchParams.set("fmt", "json3");
    // This similarly named option adds unwanted positioning data. yt-dlp also
    // removes it for json3; xospf is a separate signed experiment parameter.
    url.searchParams.delete("xosf");
    if (poToken) {
      url.searchParams.set("pot", poToken.pot);
      url.searchParams.set("potc", poToken.potc);
      url.searchParams.set("c", poToken.client);
    }
    return url.href;
  }

  function parseJson3(content) {
    const data = typeof content === "string" ? JSON.parse(content) : content;
    const prepared = [];

    for (const event of data.events || []) {
      if (event.aAppend || !event.segs?.length) continue;
      prepared.push([Number.parseInt(event.tStartMs || 0, 10), event.segs]);
    }

    const splitAll = prepared.some(([, segs]) =>
      segs.slice(1).some((seg) => {
        const text = seg.utf8 || "";
        return !text.startsWith(" ") && /\S\s+\S/.test(text);
      })
    );

    const tokens = [];
    for (const [eventStart, segs] of prepared) {
      segs.forEach((seg, index) => {
        const text = seg.utf8 || "";
        const segStart = eventStart + Number.parseInt(seg.tOffsetMs || 0, 10);
        if (splitAll || text.startsWith(" ") || index === 0 || tokens.length === 0) {
          const parts = splitAll ? text.trim().split(/\s+/) : text.split(" ");
          for (const part of parts) {
            if (part.trim()) tokens.push([segStart, part]);
          }
        } else if (text.trim()) {
          tokens[tokens.length - 1][1] += text;
        }
      });
    }

    return tokens.flatMap(([start, rawText], index) => {
      const text = rawText.trim();
      if (!text) return [];
      const nextStart = index + 1 < tokens.length ? tokens[index + 1][0] : start + WORD_MAX_MS;
      const isMarker = /^\[[^\]]+\]$/.test(text);
      const end = isMarker
        ? Math.max(start, nextStart - MARKER_END_PAD_MS)
        : Math.min(start + WORD_MAX_MS, nextStart);
      return [{ start, end, text, isMarker }];
    });
  }

  function parseManualJson3(content) {
    const data = typeof content === "string" ? JSON.parse(content) : content;
    const cues = [];
    for (const event of data.events || []) {
      if (event.aAppend || !event.segs?.length) continue;
      const start = Number.parseInt(event.tStartMs || 0, 10);
      const end = start + Number.parseInt(event.dDurationMs || 0, 10);
      const text = event.segs.map((seg) => seg.utf8 || "").join("").trim().replace(/\s+/g, " ");
      if (text) cues.push({ start, end: Math.max(start, end), text });
    }
    return cues;
  }

  function charsOf(words) {
    if (!words.length) return 0;
    return words.reduce((total, word) => total + word.text.length, 0) + words.length - 1;
  }

  function isSentenceEnd(word) {
    const text = word.text.replace(/['"’”\)\]\}]+$/u, "");
    return text.length > 1 && ".!?".includes(text.at(-1));
  }

  function lastSoftBreak(words, low, high, minLeftChars) {
    for (let index = high - 1; index > low; index -= 1) {
      if (",;:".includes(words[index].text.at(-1)) && charsOf(words.slice(low, index + 1)) >= minLeftChars) {
        return index;
      }
    }
    return null;
  }

  function groupWords(words, options = {}) {
    if (!words.length) return [];
    const settings = { ...DEFAULTS, ...options };
    const boundaries = [];
    let start = 0;

    for (let index = 0; index < words.length; index += 1) {
      const word = words[index];
      const chars = charsOf(words.slice(start, index + 1));
      const duration = word.end - words[start].start;
      const nextGap = index + 1 < words.length ? words[index + 1].start - word.start : 0;
      const isLast = index + 1 === words.length;
      const sentenceBreak = isSentenceEnd(word) && chars >= settings.minChars;
      const overflow =
        chars >= settings.maxChars ||
        duration >= settings.maxDurMs ||
        nextGap >= settings.pauseBreakMs;

      if (isLast || sentenceBreak) {
        boundaries.push(index);
        start = index + 1;
      } else if (overflow) {
        const softBreak = lastSoftBreak(words, start, index, settings.minChars);
        const boundary = softBreak === null ? index : softBreak;
        boundaries.push(boundary);
        start = boundary + 1;
      }
    }

    const cues = [];
    let low = 0;
    for (const endIndex of boundaries) {
      const chunk = words.slice(low, endIndex + 1);
      low = endIndex + 1;
      const text = chunk.map((word) => word.text).join(" ");
      if (!text) continue;

      const cueStart = chunk[0].start;
      const speechEnd = Math.max(...chunk.map((word) => word.end));
      let cueEnd;
      if (endIndex + 1 < words.length) {
        const nextStart = words[endIndex + 1].start;
        const gap = nextStart - speechEnd;
        const tail = gap > settings.tailMs + 100 ? settings.tailMs : Math.max(gap - 50, 0);
        cueEnd = Math.min(speechEnd + tail, Math.max(nextStart - 1, cueStart));
        if (cueEnd - cueStart < settings.minDurMs) {
          cueEnd = Math.min(cueStart + settings.minDurMs, Math.max(nextStart - 1, cueStart));
        }
      } else {
        cueEnd = speechEnd + settings.tailMs;
      }
      cues.push({ start: cueStart, end: Math.max(cueStart, cueEnd), text });
    }
    return cues;
  }

  function formatTimestamp(milliseconds) {
    let value = Math.max(0, Math.trunc(milliseconds));
    const hours = Math.trunc(value / 3600000);
    value %= 3600000;
    const minutes = Math.trunc(value / 60000);
    value %= 60000;
    const seconds = Math.trunc(value / 1000);
    const millis = value % 1000;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
  }

  function writeSrt(cues) {
    return cues
      .map((cue, index) => `${index + 1}\n${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}\n${cue.text}\n`)
      .join("\n");
  }

  function sanitizeTitle(title, maxBytes = 200) {
    let text = (title || "")
      .normalize("NFKC")
      .replace(/[\u00ad\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/gu, "")
      .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu, " ")
      .replace(/[\/\\:*?"<>|]/gu, " ")
      .replace(/\s+/gu, " ")
      .replace(/^[ .]+|[ .]+$/gu, "");

    const encoder = new TextEncoder();
    if (encoder.encode(text).length > maxBytes) {
      let shortened = "";
      for (const character of text) {
        if (encoder.encode(shortened + character).length > maxBytes) break;
        shortened += character;
      }
      text = shortened;
    }
    return text.replace(/[ .]+$/gu, "");
  }

  function defaultOutputName(title, videoId, languageCode) {
    const clean = sanitizeTitle(title);
    return `${clean ? `${clean} (${videoId})` : videoId}.${languageCode}.srt`;
  }

  return {
    DEFAULTS,
    buildCaptionUrl,
    extractPlayerResponse,
    findSubtitlePoToken,
    parseJson3,
    parseManualJson3,
    groupWords,
    writeSrt,
    sanitizeTitle,
    requiresSubtitlePoToken,
    defaultOutputName,
  };
});
