/**
 * Builds the training video from what film.mjs recorded: one segment per script part (slide or recording), each
 * with its voice placed at the beat's start and Arabic subtitles burned in, then joined per chapter and in full.
 *
 * Needs ffmpeg/ffprobe with libass, and the "Noto Sans Arabic" font (fonts-noto-core). Reads OUT_DIR/
 * {timeline.json, live-test.json, audio/}; writes OUT_DIR/{training-full.mp4, full.srt, chapters/*.mp4}.
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHAPTERS } from "./script.ar.mjs";

const OUT = path.resolve(process.env.OUT_DIR ?? "training-out");
const WORK = path.resolve(process.env.WORK_DIR ?? path.join(OUT, "work"));
const AUDIO_DIR = path.join(OUT, "audio");
const AUDIO = JSON.parse(fs.readFileSync(path.join(AUDIO_DIR, "index.json"), "utf8"));
const timeline = JSON.parse(fs.readFileSync(path.join(OUT, "timeline.json"), "utf8"));
const live = JSON.parse(fs.readFileSync(path.join(OUT, "live-test.json"), "utf8"));
const GAP = 0.45, LEAD = 0.6, TAIL = 0.5, FADE = 0.35;
const PHONE = { x: 230, y: 60, h: 960 };
const SUB_STYLE = "FontName=Noto Sans Arabic,FontSize=15,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H70101820,BackColour=&H70101820,BorderStyle=3,Outline=5,Shadow=0,MarginV=16";
const VENC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30", "-g", "60"];
const AENC = ["-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"];
fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(path.join(OUT, "chapters"), { recursive: true });

/** One ffmpeg call, with a hard time limit so a stuck call fails its part instead of the whole job. */
function ff(args, label = "ffmpeg") {
  const t0 = Date.now();
  try {
    execFileSync("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "warning", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"], timeout: 15 * 60_000, killSignal: "SIGKILL" });
  } catch (e) {
    console.log(`::group::${label} failed after ${((Date.now() - t0) / 1000).toFixed(0)} s — command`);
    console.log(["ffmpeg", ...args].join(" "));
    console.log("::endgroup::");
    throw e;
  }
  console.log(`    ${label}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
const probe = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
const srtTime = (s) => { const ms = Math.max(0, Math.round(s * 1000)); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
const toSrt = (cues) => cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n");

// ------------------------------------------------------------------ slides
const browser = await chromium.launch();
const cardPage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await cardPage.goto(`file://${fileURLToPath(new URL("./cards.html", import.meta.url))}`);
await cardPage.waitForFunction(() => typeof window.render === "function");
const steps = CHAPTERS.filter((c) => !["00", "08"].includes(c.id)).length;
async function slide(name, data) {
  const file = path.join(WORK, `${name}.png`);
  await cardPage.evaluate((d) => window.render(d), data);
  await cardPage.waitForTimeout(150);
  await cardPage.screenshot({ path: file });
  return file;
}

// ------------------------------------------------------------------ segment builders
/** Voice + subtitles for a list of beats at given offsets (seconds from the segment start). */
function voice(placed, dur) {
  const inputs = [], filters = [], labels = [], cues = [];
  placed.forEach(({ id, at }, i) => {
    inputs.push("-i", path.join(AUDIO_DIR, `${id}.mp3`));
    const ms = Math.max(0, Math.round(at * 1000));
    filters.push(`[${i + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms}|${ms}[a${i}]`);
    labels.push(`[a${i}]`);
    for (const c of AUDIO[id].cues) cues.push({ start: at + c.start, end: Math.min(at + c.end, dur - 0.05), text: c.text });
  });
  filters.push(labels.length
    ? `${labels.join("")}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,apad,atrim=0:${dur.toFixed(3)}[aout]`
    : `anullsrc=r=48000:cl=stereo,atrim=0:${dur.toFixed(3)}[aout]`);
  return { inputs, filters, cues };
}

/**
 * Two passes: the picture (with burned subtitles) alone, then the voice mixed in with the picture copied. Captured
 * frames can change size mid-recording, which makes ffmpeg rebuild its filter graph; in one graph with the voice
 * inputs that rebuild left the mixer waiting for audio that had already ended (the first two runs hung there).
 */
function encode(name, videoInputs, videoFilter, placed, dur, subMarginL = 0) {
  const file = path.join(WORK, `${name}.mp4`);
  const picture = path.join(WORK, `${name}.video.mp4`);
  const v = voice(placed, dur);
  const srt = path.join(WORK, `${name}.srt`);
  fs.writeFileSync(srt, toSrt(v.cues));
  const style = subMarginL ? `${SUB_STYLE},MarginL=${subMarginL},MarginR=60` : SUB_STYLE;
  const vf = `${videoFilter},fade=t=in:st=0:d=${FADE},fade=t=out:st=${Math.max(0, dur - FADE).toFixed(3)}:d=${FADE},subtitles=${srt}:force_style='${style}'[vout]`;
  ff([...videoInputs, "-filter_complex", vf, "-map", "[vout]", "-t", dur.toFixed(3), "-an", ...VENC, picture], `${name} picture`);
  ff(["-i", picture, ...v.inputs, "-filter_complex", v.filters.join(";"), "-map", "0:v", "-map", "[aout]", "-c:v", "copy", ...AENC, "-t", dur.toFixed(3), "-movflags", "+faststart", file], `${name} sound`);
  fs.rmSync(picture, { force: true });
  return { file, cues: v.cues, dur: probe(file) };
}

async function cardSegment(chapter, part, idx) {
  let data;
  if (part.card.dynamic === "results") data = { mode: "results", kicker: part.card.kicker, checks: live.checks };
  else data = { mode: "card", ...part.card, step: Number(chapter.id), steps: ["00", "08"].includes(chapter.id) ? 0 : steps };
  const png = await slide(`card-${part.key}`, data);
  let t = LEAD;
  const placed = part.beats.map((b) => { const at = t; t += AUDIO[b.id].duration + GAP; return { id: b.id, at }; });
  const dur = t + TAIL;
  return encode(`seg-${String(idx).padStart(2, "0")}-${part.key}`, ["-loop", "1", "-framerate", "30", "-t", dur.toFixed(3), "-i", png], "[0:v]fps=30,setsar=1", placed, dur);
}

async function recSegment(chapter, part, idx) {
  const rec = timeline.recordings.find((r) => r.key === part.key);
  if (!rec || !rec.frames.length || !rec.beats.length) throw new Error(`recording ${part.key} missing or empty`);
  const segStart = Math.max(rec.startAt + 200, rec.beats[0].start - 400);
  const segEnd = Math.min(rec.endAt, rec.beats.at(-1).end + 350);
  // Kept time = [segStart, segEnd] minus the cuts.
  const kept = [];
  let s = segStart;
  for (const c of [...rec.cuts].sort((a, b) => a.start - b.start)) {
    if (c.end <= s || c.start >= segEnd) continue;
    if (c.start > s) kept.push([s, c.start]);
    s = Math.max(s, c.end);
  }
  if (s < segEnd) kept.push([s, segEnd]);
  const overlap = (a, b) => kept.reduce((n, [k0, k1]) => n + Math.max(0, Math.min(b, k1) - Math.max(a, k0)), 0);
  const map = (t) => overlap(segStart, t) / 1000;
  const dur = overlap(segStart, segEnd) / 1000;
  /** Video time (ms) → recording time, skipping the cuts. */
  const unmap = (ms) => { for (const [a, b] of kept) { if (ms < b - a) return a + ms; ms -= b - a; } return segEnd; };
  // A constant 30 fps numbered sequence of links to the captured frames: for each video frame, the newest capture.
  const seq = path.join(WORK, `seq-${part.key}`);
  fs.rmSync(seq, { recursive: true, force: true });
  fs.mkdirSync(seq, { recursive: true });
  const frames = rec.frames;
  const count = Math.ceil(dur * 30);
  let j = 0;
  for (let k = 0; k < count; k++) {
    const t = unmap((k * 1000) / 30);
    while (j + 1 < frames.length && frames[j + 1].t <= t) j++;
    fs.symlinkSync(path.join(rec.dir, frames[j].file), path.join(seq, `${String(k).padStart(6, "0")}.jpg`));
  }
  const input = ["-framerate", "30", "-i", path.join(seq, "%06d.jpg")];
  const placed = rec.beats.map((b) => ({ id: b.id, at: map(b.start) }));
  const name = `seg-${String(idx).padStart(2, "0")}-${part.key}`;
  if (rec.kind === "phone") {
    const bg = await slide(`panel-${part.key}`, { mode: "panel", ...(part.panel ?? {}) });
    const vf = `[0:v]scale=-2:${PHONE.h}:flags=lanczos,setsar=1[ph];[1:v]fps=30,setsar=1[bg];[bg][ph]overlay=x=${PHONE.x}:y=${PHONE.y}:shortest=1`;
    return encode(name, [...input, "-loop", "1", "-framerate", "30", "-i", bg], vf, placed, dur, 760);
  }
  const vf = `[0:v]scale=1920:1080:flags=lanczos:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0E2233,setsar=1`;
  return encode(name, input, vf, placed, dur);
}

// ------------------------------------------------------------------ build
const chapterFiles = [];
const fullCues = [];
let offset = 0, idx = 0;
const failed = [];
for (const chapter of CHAPTERS) {
  const segs = [];
  for (const part of chapter.parts) {
    try {
      const seg = part.type === "card" ? await cardSegment(chapter, part, idx++) : await recSegment(chapter, part, idx++);
      console.log(`  ${path.basename(seg.file)} ${seg.dur.toFixed(1)} s`);
      segs.push(seg);
    } catch (e) {
      failed.push(`${part.key}: ${e.message}`);
      console.log(`✗ ${part.key}: ${e.message}`);
    }
  }
  if (!segs.length) continue;
  const list = path.join(WORK, `chapter-${chapter.id}.txt`);
  fs.writeFileSync(list, segs.map((s) => `file '${s.file}'`).join("\n"));
  const out = path.join(OUT, "chapters", `${chapter.id}-${chapter.slug}.mp4`);
  ff(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out]);
  chapterFiles.push(out);
  for (const s of segs) {
    for (const c of s.cues) fullCues.push({ start: c.start + offset, end: c.end + offset, text: c.text });
    offset += s.dur;
  }
}
await browser.close();

const all = path.join(WORK, "all.txt");
fs.writeFileSync(all, chapterFiles.map((f) => `file '${f}'`).join("\n"));
ff(["-f", "concat", "-safe", "0", "-i", all, "-c", "copy", "-movflags", "+faststart", path.join(OUT, "training-full.mp4")]);
fs.writeFileSync(path.join(OUT, "full.srt"), toSrt(fullCues));
const total = probe(path.join(OUT, "training-full.mp4"));
fs.writeFileSync(path.join(OUT, "video.json"), JSON.stringify({ seconds: Math.round(total), chapters: chapterFiles.map((f) => ({ file: path.basename(f), seconds: Math.round(probe(f)) })), failed }, null, 2));
console.log(`\ntraining-full.mp4: ${(total / 60).toFixed(1)} min, ${chapterFiles.length} chapters${failed.length ? `, FAILED parts: ${failed.join("; ")}` : ""}`);
if (failed.length) process.exitCode = 1;
