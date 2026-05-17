# Lexicon Audio — Pre-generated Belgian Dutch MP3s

This project ships with a robotic OS-default voice as a fallback, but you can
upgrade the Lexicon tab to studio-grade Belgian Dutch by pre-generating MP3s
with Azure Neural Text-to-Speech.

The free Azure tier covers 500,000 characters per month. The full Vlaams
Sprint vocab list is roughly 1,000 characters, so generation is essentially
free and only runs when you add new vocab.

## What you get

- Real Belgian Dutch voice (`nl-BE-ArnaudNeural` by default; switch to
  `nl-BE-DenaNeural` for a female voice)
- Works offline once generated
- No API key shipped to the browser — generation is a local Node.js step
- Web Speech API stays as a graceful fallback for any entries you haven't
  generated yet

## One-time Azure setup (about 5 minutes)

### Prerequisite: Node.js

The generator script needs Node.js (any version 18+). Check with:

```bash
node --version
```

If it's missing, install it:

- **macOS** with Homebrew: `brew install node`
- **macOS** without Homebrew: download the LTS installer from https://nodejs.org
- **Windows**: download the LTS installer from https://nodejs.org

No npm packages required — the script uses only Node built-ins.

### Azure resource

1. Go to https://portal.azure.com and sign in (free Microsoft account is fine,
   no credit card required for the F0 free tier).
2. Click **Create a resource** → search for **Speech** → **Speech** by Microsoft → **Create**.
3. Fill in:
   - **Subscription**: your default (the free one)
   - **Resource group**: create a new one called `vlaams-sprint`
   - **Region**: `West Europe` (closest to Belgian Dutch; pick something
     near you if you prefer)
   - **Name**: anything, e.g. `vlaams-tts`
   - **Pricing tier**: **Free F0** (500k characters/month)
4. Click **Review + Create**, then **Create**. Wait about 30 seconds.
5. Open the resource. In the left nav, click **Keys and Endpoint**.
6. Copy **KEY 1** and the **Location/Region** (e.g. `westeurope`).

## Generate the audio

From the project root:

```bash
export AZURE_TTS_KEY="paste-key-1-here"
export AZURE_TTS_REGION="westeurope"
node generate-audio.js
```

You'll see something like:

```
Vlaams Sprint audio generator
  voice  : nl-BE-ArnaudNeural
  region : westeurope
  rate   : -10%
  entries: 56 unique (from 56 total)
  out    : lexicon-audio/

  Dag                          → dag-1a2b3c4d.mp3 ... ok (8423 bytes)
  Salut                        → salut-5e6f7g8h.mp3 ... ok (9011 bytes)
  ...

Done. generated=56 skipped=0 failed=0
Manifest: lexicon-audio/manifest.js
```

Reload `index.html` in the browser. The Lexicon banner now reads:

> 🎙 Studio audio: 56 entries via Azure Neural TTS (Belgian Dutch).

## Flags

| Flag | Default | Effect |
|---|---|---|
| `--voice nl-BE-DenaNeural` | `nl-BE-ArnaudNeural` | Switch to the female Belgian voice |
| `--rate -10%` | `-10%` | Prosody rate (use `0%` for natural, `-15%` slower for learning) |
| `--force` | off | Regenerate every file even if it already exists |

Examples:

```bash
# Use the female voice
node generate-audio.js --voice nl-BE-DenaNeural

# Slower playback for difficult phrases
node generate-audio.js --rate -20%

# Re-record everything after changing prosody
node generate-audio.js --force
```

## How the runtime fallback works

1. Browser loads `lexicon-audio/manifest.js` if present (silent if missing).
2. Clicking ▶ on a vocab card calls `speak(text)`, which:
   - First tries to play `lexicon-audio/<key>.mp3` via an `<audio>` element
   - Falls back to the Web Speech API voice picker if the MP3 is missing or
     fails to load
3. Per-text status is cached, so a missing MP3 is only probed once per
   session.

## Adding new vocab

1. Edit `VOCAB_DATA` in `index.html`.
2. Re-run `node generate-audio.js`. Existing files are skipped; only new
   entries hit the Azure API.
3. Refresh the browser.

## File layout

```
.
├── index.html
├── generate-audio.js
├── LEXICON_AUDIO_README.md   (this file)
└── lexicon-audio/
    ├── manifest.js           generated; loaded by index.html
    ├── dag-1a2b3c4d.mp3
    ├── salut-5e6f7g8h.mp3
    └── ...                   one MP3 per unique Flemish entry
```

Filenames use a slug + FNV-1a hash so the same text always resolves to the
same file across runs and across the Node generator and the browser.

## Costs and limits

- F0 (Free) tier: 500,000 characters/month for neural voices, no expiry as
  long as you generate at least once every 90 days
- Each Vlaams Sprint vocab entry is roughly 15-30 characters → full
  regeneration costs about 1,500 characters, leaving ~498,500 free
- If you exhaust F0, upgrade to S0 (Standard): about $16 per 1 million
  characters of neural TTS

## Troubleshooting

**"Azure TTS 401: ..."** — wrong key or wrong region. Re-check Keys and
Endpoint in the portal.

**"Azure TTS 403: ..."** — you may have a Standard (paid) subscription
locked down by policy, or the Speech resource is in a region that doesn't
host neural voices. `westeurope`, `northeurope`, and `eastus` are reliable.

**"Audio is silent in browser"** — open DevTools → Network. If the
`.mp3` requests show `200`, the MP3 is loading; check your system volume.
If they show `404`, the manifest may be stale. Re-run `node
generate-audio.js` and hard-reload (Cmd+Shift+R).

**"Banner still says 'Voice: ...' instead of 'Studio audio: ...'"** —
`lexicon-audio/manifest.js` did not load. Check it exists and that you're
serving from the project root, not a subdirectory.
