import { test } from "vitest";
import assert from "node:assert/strict";
import {
  parseJson3,
  parseManualJson3,
  groupWords,
  writeSrt,
  sanitizeTitle,
  extractPlayerResponse,
  requiresSubtitlePoToken,
  findSubtitlePoToken,
  buildCaptionUrl,
} from "../src/core.js";

function makeWords(text, startMs = 0, wordMs = 350) {
  return text.split(/\s+/).map((token, index) => ({
    start: startMs + index * wordMs,
    end: startMs + (index + 1) * wordMs,
    text: token,
    isMarker: false,
  }));
}

test("reconstructs fragments and ignores rolling-window append events", () => {
  const words = parseJson3({
    events: [
      { tStartMs: 1000, segs: [{ utf8: "Hel" }, { utf8: "lo" }, { utf8: " world", tOffsetMs: 500 }] },
      { aAppend: 1, tStartMs: 1800, segs: [{ utf8: "\n" }] },
    ],
  });
  assert.deepEqual(
    words.map((word) => word.text),
    ["Hello", "world"],
  );
  assert.deepEqual(
    words.map((word) => word.start),
    [1000, 1500],
  );
});

test("splits tracks that do not use leading spaces", () => {
  const words = parseJson3({
    events: [{ tStartMs: 1000, segs: [{ utf8: "Something" }, { utf8: "is going on" }, { utf8: "here." }] }],
  });
  assert.deepEqual(
    words.map((word) => word.text),
    ["Something", "is", "going", "on", "here."],
  );
});

test("manual events pass through as cues", () => {
  const cues = parseManualJson3({
    events: [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: " Hello" }, { utf8: "\nworld" }] }],
  });
  assert.deepEqual(cues, [{ start: 1000, end: 3000, text: "Hello world" }]);
});

test("groups on sentences and keeps cues from overlapping", () => {
  const words = makeWords("We're no strangers to love. You know the rules and so do I.");
  const cues = groupWords(words);
  assert.equal(cues[0].text, "We're no strangers to love.");
  assert.equal(cues[1].text, "You know the rules and so do I.");
  assert.ok(cues[0].end < cues[1].start);
});

test("prefers a comma when a cue overflows", () => {
  const words = makeWords("aaaa bbbb cccc dddd, eeee ffff gggg hhhh iiii jjjj kkkk llll");
  const cues = groupWords(words, { maxChars: 40, minChars: 10 });
  assert.equal(cues[0].text, "aaaa bbbb cccc dddd,");
});

test("writes valid SRT timestamps", () => {
  const output = writeSrt([{ start: 1000, end: 2345, text: "Hello." }]);
  assert.equal(output, "1\n00:00:01,000 --> 00:00:02,345\nHello.\n");
});

test("sanitizes and byte-limits filenames", () => {
  const value = sanitizeTitle("  ＡＣ／ＤＣ: \u200bIntro  ");
  assert.equal(value, "AC DC Intro");
  assert.ok(Buffer.byteLength(sanitizeTitle("😀".repeat(100))) <= 200);
});

test("extracts YouTube's player response without being confused by braces in strings", () => {
  const html =
    '<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"abc","title":"A } title"},"captions":{}};</script>';
  const response = extractPlayerResponse(html);
  assert.equal(response.videoDetails.videoId, "abc");
  assert.equal(response.videoDetails.title, "A } title");
});

test("detects subtitle URLs that require a Proof-of-Origin token", () => {
  assert.equal(requiresSubtitlePoToken("/api/timedtext?v=abc&exp=xpe"), true);
  assert.equal(requiresSubtitlePoToken("/api/timedtext?v=abc&exp=other"), false);
});

test("reuses the player-generated subtitle token for the selected track", () => {
  const token = findSubtitlePoToken(
    [
      "https://www.youtube.com/api/timedtext?v=other&pot=wrong",
      "https://www.youtube.com/api/timedtext?v=abc&lang=en&pot=proof123&potc=1&c=WEB",
    ],
    "abc",
  );
  assert.deepEqual(token, { pot: "proof123", potc: "1", client: "WEB" });

  const result = new URL(
    buildCaptionUrl("https://www.youtube.com/api/timedtext?v=abc&lang=es&exp=xpe&xosf=1&xospf=1", token),
  );
  assert.equal(result.searchParams.get("lang"), "es");
  assert.equal(result.searchParams.get("fmt"), "json3");
  assert.equal(result.searchParams.get("pot"), "proof123");
  assert.equal(result.searchParams.get("potc"), "1");
  assert.equal(result.searchParams.get("c"), "WEB");
  assert.equal(result.searchParams.has("xosf"), false);
  assert.equal(result.searchParams.get("xospf"), "1");
});
