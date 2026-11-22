"""Voice for the training video: one mp3 per beat with edge-tts, plus subtitle cues and the exact length.

    python tts.py <script.json> <audio-dir>

Writes <audio-dir>/<beat>.mp3 and <audio-dir>/index.json:
    {"<beat>": {"duration": seconds, "cues": [{"start": s, "end": s, "text": "..."}]}}
Runs before the browser in CI, so a voice outage fails the job in seconds.
"""
import asyncio
import json
import os
import re
import subprocess
import sys

import edge_tts

MAX_CHARS = 48


def phrases(text):
    """Short subtitle lines: split at punctuation, then at spaces when a piece is still long."""
    out = []
    for piece in re.split(r"(?<=[،,.؟?!:])\s+", text.strip()):
        words, line = piece.split(), ""
        for w in words:
            if line and len(line) + 1 + len(w) > MAX_CHARS:
                out.append(line)
                line = w
            else:
                line = f"{line} {w}".strip()
        if line:
            out.append(line)
    return out


def duration(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                       capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


def cues_for(text, words, total):
    lines = phrases(text)
    counts = [len(l.split()) for l in lines]
    word_level = words and all(len(w["text"].split()) <= 2 for w in words)
    if word_level and len(words) == sum(counts):
        cues, k = [], 0
        for line, n in zip(lines, counts):
            first, last = words[k], words[k + n - 1]
            cues.append({"start": first["t"], "end": last["t"] + last["d"], "text": line})
            k += n
    else:
        # Proportional by length over the spoken span.
        start = words[0]["t"] if words else 0.0
        end = (words[-1]["t"] + words[-1]["d"]) if words else total
        if end <= start:
            start, end = 0.0, total
        size = sum(len(l) for l in lines) or 1
        cues, t = [], start
        for line in lines:
            d = (end - start) * len(line) / size
            cues.append({"start": t, "end": t + d, "text": line})
            t += d
    # Let each line stay until the next one starts (no flicker between lines).
    for a, b in zip(cues, cues[1:]):
        a["end"] = max(a["end"], b["start"])
    cues[-1]["end"] = min(max(cues[-1]["end"], cues[-1]["start"] + 0.8), total + 0.3)
    return [{"start": round(c["start"], 3), "end": round(c["end"], 3), "text": c["text"]} for c in cues]


async def speak(beat, voice, rate, out, sem):
    path = os.path.join(out, f"{beat['id']}.mp3")
    async with sem:
        for attempt in range(5):
            try:
                try:
                    comm = edge_tts.Communicate(beat["text"], voice, rate=rate, boundary="WordBoundary")
                except TypeError:  # older edge-tts without the boundary option
                    comm = edge_tts.Communicate(beat["text"], voice, rate=rate)
                audio, words = bytearray(), []
                async for chunk in comm.stream():
                    if chunk["type"] == "audio":
                        audio += chunk["data"]
                    elif chunk["type"] in ("WordBoundary", "SentenceBoundary"):
                        words.append({"t": chunk["offset"] / 1e7, "d": chunk["duration"] / 1e7, "text": chunk["text"]})
                if not audio:
                    raise RuntimeError("no audio")
                with open(path, "wb") as f:
                    f.write(audio)
                total = duration(path)
                return beat["id"], {"duration": round(total, 3), "cues": cues_for(beat["text"], words, total)}
            except Exception as e:  # noqa: BLE001 — retry any network hiccup
                print(f"retry {beat['id']} ({attempt + 1}): {e}", flush=True)
                await asyncio.sleep(2 * (attempt + 1))
    raise RuntimeError(f"edge-tts failed for {beat['id']}")


async def main():
    script, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    data = json.load(open(script, encoding="utf-8"))
    sem = asyncio.Semaphore(6)
    results = await asyncio.gather(*(speak(b, data["voice"], data["rate"], out, sem) for b in data["beats"]))
    index = dict(results)
    json.dump(index, open(os.path.join(out, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    total = sum(v["duration"] for v in index.values())
    print(f"{len(index)} beats, {total / 60:.1f} min of voice → {out}")


asyncio.run(main())
