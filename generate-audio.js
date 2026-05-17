#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Vlaams Sprint — Lexicon audio generator
 *
 * Reads VOCAB_DATA from index.html, calls Azure Cognitive Services
 * Text-to-Speech, and writes per-entry MP3s into ./lexicon-audio/
 * along with a manifest.js that index.html loads at boot.
 *
 * Usage:
 *   AZURE_TTS_KEY=xxx AZURE_TTS_REGION=westeurope node generate-audio.js
 *
 * Flags:
 *   --voice nl-BE-DenaNeural   override the voice (default Arnaud)
 *   --force                    regenerate every file even if it exists
 *   --rate -10%                prosody rate (default -10%)
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const vm = require("vm");

const ROOT = __dirname;
const INDEX_HTML = path.join(ROOT, "index.html");
const OUT_DIR = path.join(ROOT, "lexicon-audio");
const MANIFEST_FILE = path.join(OUT_DIR, "manifest.js");

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  return args[i + 1] !== undefined && !args[i + 1].startsWith("--")
    ? args[i + 1]
    : true;
}

const VOICE = flag("--voice", "nl-BE-ArnaudNeural");
const RATE = flag("--rate", "-10%");
const FORCE = !!flag("--force", false);

const AZURE_KEY = process.env.AZURE_TTS_KEY;
const AZURE_REGION = process.env.AZURE_TTS_REGION || "westeurope";

if (!AZURE_KEY) {
  console.error("Missing AZURE_TTS_KEY environment variable.");
  console.error("See LEXICON_AUDIO_README.md for setup steps.");
  process.exit(1);
}

// ----------------------------------------------------------------
// VOCAB extractor — pulls the VOCAB_DATA literal out of index.html
// ----------------------------------------------------------------
function extractVocabData() {
  const html = fs.readFileSync(INDEX_HTML, "utf8");
  const startMarker = "const VOCAB_DATA = ";
  const start = html.indexOf(startMarker);
  if (start === -1) throw new Error("Could not find VOCAB_DATA in index.html");

  // Brace-balance scan to find the end of the object literal
  let i = start + startMarker.length;
  while (html[i] !== "{") i++;
  let depth = 0;
  let end = -1;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) { end = j + 1; break; }
    }
  }
  if (end === -1) throw new Error("Could not locate end of VOCAB_DATA literal");

  const literal = html.slice(i, end);
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`out = ${literal};`, sandbox);
  return sandbox.out;
}

// ----------------------------------------------------------------
// Stable filename hashing (must mirror the browser-side function)
// ----------------------------------------------------------------
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
function slugify(s) {
  return s.toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}
function audioKey(flemish) {
  return `${slugify(flemish)}-${fnv1a(flemish)}`;
}

// ----------------------------------------------------------------
// Azure TTS REST call
// ----------------------------------------------------------------
function ssmlEscape(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildSSML(text, voice, rate) {
  const lang = voice.startsWith("nl-BE") ? "nl-BE" : "nl-NL";
  return `<speak version='1.0' xml:lang='${lang}'>` +
    `<voice name='${voice}'>` +
    `<prosody rate='${rate}'>${ssmlEscape(text)}</prosody>` +
    `</voice></speak>`;
}

function azureSynthesise(text) {
  const ssml = buildSSML(text, VOICE, RATE);
  const opts = {
    method: "POST",
    hostname: `${AZURE_REGION}.tts.speech.microsoft.com`,
    path: "/cognitiveservices/v1",
    headers: {
      "Ocp-Apim-Subscription-Key": AZURE_KEY,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "vlaams-sprint-generator/1.0",
      "Content-Length": Buffer.byteLength(ssml)
    }
  };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          return reject(new Error(
            `Azure TTS ${res.statusCode}: ${Buffer.concat(chunks).toString("utf8")}`
          ));
        }
        resolve(Buffer.concat(chunks));
      });
    });
    req.on("error", reject);
    req.write(ssml);
    req.end();
  });
}

// ----------------------------------------------------------------
// Main
// ----------------------------------------------------------------
async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const VOCAB = extractVocabData();
  const entries = [];
  for (const [week, list] of Object.entries(VOCAB)) {
    for (const item of list) {
      entries.push({ week, fl: item.fl });
    }
  }

  // Dedupe (vocab can repeat across weeks)
  const seen = new Map();
  for (const e of entries) {
    if (!seen.has(e.fl)) seen.set(e.fl, e);
  }
  const unique = [...seen.values()];

  console.log(`Vlaams Sprint audio generator`);
  console.log(`  voice  : ${VOICE}`);
  console.log(`  region : ${AZURE_REGION}`);
  console.log(`  rate   : ${RATE}`);
  console.log(`  entries: ${unique.length} unique (from ${entries.length} total)`);
  console.log(`  out    : ${path.relative(ROOT, OUT_DIR)}/`);
  console.log("");

  const manifest = {};
  let generated = 0, skipped = 0, failed = 0;

  for (const e of unique) {
    const key = audioKey(e.fl);
    const file = `${key}.mp3`;
    const dest = path.join(OUT_DIR, file);
    manifest[e.fl] = file;

    if (!FORCE && fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      skipped++;
      continue;
    }

    try {
      process.stdout.write(`  ${e.fl.padEnd(28)} → ${file} ... `);
      const buf = await azureSynthesise(e.fl);
      fs.writeFileSync(dest, buf);
      console.log(`ok (${buf.length} bytes)`);
      generated++;
      // Light pacing to stay polite on the free tier
      await new Promise(r => setTimeout(r, 120));
    } catch (err) {
      console.log(`FAIL`);
      console.error(`    ${err.message}`);
      failed++;
    }
  }

  // Write manifest as a JS file (loadable from file:// without fetch)
  const banner = `// Generated by generate-audio.js — do not edit by hand.\n` +
    `// Voice: ${VOICE} · ${unique.length} entries\n`;
  const body = `window.VLAAMS_AUDIO_MANIFEST = ${JSON.stringify(manifest, null, 2)};\n`;
  fs.writeFileSync(MANIFEST_FILE, banner + body);

  console.log("");
  console.log(`Done. generated=${generated} skipped=${skipped} failed=${failed}`);
  console.log(`Manifest: ${path.relative(ROOT, MANIFEST_FILE)}`);
}

main().catch(err => { console.error(err); process.exit(1); });
