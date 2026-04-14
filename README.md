
# AI-Driven Audio Sanitization

<p align="center">
	<img src="https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExNnAzb3h3cnQ5eDM4Y2YwNWJkbmx1c3g3YjR1YWNhZjE4bXM5Mm5veSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/II7ZbN0k88lI4OZt9j/giphy.gif" alt="Audio sanitization preview" width="420" />
</p>

AI-Driven Audio Sanitization is a Vite + React frontend with a FastAPI backend for detecting profane words in audio or video, generating word-level timestamps with Whisper, and exporting sanitized media with censored audio.

It supports both local file uploads and remote media import through supported URLs.

## Quick start

```bash
npm install
python -m venv .venv
```

Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Run in two terminals:

```bash
npm run api
npm run dev
```

Frontend: `http://localhost:5173`  
Backend API: `http://127.0.0.1:8000`

## Features

- Upload local audio or video files for processing
- Import media from supported URLs with `yt-dlp`
- Transcribe speech with Whisper and word-level timestamps
- Match detected words against multilingual profanity CSV dictionaries
- Generate a word safety report and profanity analytics
- Preview both original and sanitized media in the app
- Export sanitized video or audio-only output
- Record audio directly from microphone in the `Voice record` tab
- Choose built-in censor behaviors such as `beep`, `silence`, or `faaa`
- Browse supported profanity dictionaries from the UI with lazy-loaded language modals
- Hover profanity entries in supported language tables to view dictionary meanings or translations
- Track per-job queue progress with estimated time remaining while processing
- Re-process completed jobs with the latest output settings directly from the queue
- Clear completed jobs from both the queue and backend storage

## Table of contents

- [Quick start](#quick-start)
- [Features](#features)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Requirements](#requirements)
- [Setup](#setup)
- [Running locally](#running-locally)
- [Supported workflows](#supported-workflows)
- [Media formats](#media-formats)
- [Output settings](#output-settings)
- [Censor types](#censor-types)
- [Profanity dictionaries](#profanity-dictionaries)
- [Processing flow](#processing-flow)
- [API overview](#api-overview)
- [Troubleshooting](#troubleshooting)
- [Validation](#validation)

## Tech stack

- Frontend: Vite, React, TypeScript, Tailwind CSS, Radix UI
- Backend: FastAPI, Uvicorn
- Speech recognition: Whisper
- Media processing: FFmpeg, pydub
- Remote downloads: yt-dlp

## Project structure

```text
src/                         Frontend application
backend/api.py               FastAPI backend and processing pipeline
backend_data/profanity_csv/  Multilingual profanity dictionaries
backend_data/censor_sounds/  Custom censor sound assets
backend_data/jobs/           Per-job working directories and generated outputs
requirements.txt             Python dependencies
package.json                 Frontend scripts and JS dependencies
```

## Requirements

Install these before running the app:

- Node.js and npm
- Python 3.11 or a compatible Python version
- FFmpeg available on `PATH`

Optional:

- A GPU-enabled PyTorch setup if you want faster Whisper inference

## Setup

### 1. Install frontend dependencies

```bash
npm install
```

### 2. Create a Python virtual environment

Windows PowerShell:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
```

### 3. Install backend dependencies

```bash
pip install -r requirements.txt
```

Key Python packages used by this project include:

- `openai-whisper`
- `pydub`
- `torch`
- `torchaudio`
- `fastapi`
- `uvicorn`
- `python-multipart`
- `yt-dlp`
- `@ffmpeg/ffmpeg`, `@ffmpeg/core`, `@ffmpeg/util` (browser-side voice recording transcoding)

## Running locally

Use two terminals.

### Terminal 1: start the backend

```bash
npm run api
```

This starts the FastAPI server at `http://127.0.0.1:8000`.

The `api` script uses `.venv\Scripts\python.exe`, so `.venv` must exist first.

### Terminal 2: start the frontend

```bash
npm run dev
```

The Vite dev server proxies `/api/*` requests to `http://127.0.0.1:8000`.

## Supported workflows

### Upload local media

Use the `Upload Media Files` tab to queue local audio or video files, configure output settings, and run sanitization.

### Import media via URL

Use the `Upload via Url` tab to queue supported remote media links. The app uses `yt-dlp` to download the source before processing it.

Typical supported sources include:

- YouTube
- Facebook
- Vimeo
- SoundCloud
- TikTok
- X (Twitter)
- Bandcamp
- Other sites supported by `yt-dlp`

### Voice recording workflow

Use the `Voice record` tab to capture audio directly from your microphone.

The recorder supports:

- Browser microphone permission flow
- Live waveform while recording
- Pause/resume and stop controls
- Post-recording preview with draggable trim handles
- Save to queue with client-side transcoding to the selected audio format

### Browse supported languages

Open any language card from the `Supported Languages` page to load its profanity CSV in a modal.

The modal now:

- Loads entries lazily in pages when the card is opened
- Supports server-side search within the selected CSV
- Loads more entries as you scroll
- Shows a hover tooltip with a meaning or translated explanation for each listed word

## Media formats

### Accepted input formats

- Video: `mp4`, `mov`, `avi`, `mkv`, `webm`
- Audio: `mp3`, `wav`, `flac`, `m4a`, `ogg`, `opus`, `aac`, `wma`

### Video output formats

- `mp4`
- `avi`
- `mov`
- `mkv`

### Audio-only output formats

- `mp3`
- `wav`
- `flac`
- `ogg`
- `aac`
- `m4a`

## Output settings

The UI currently supports:

- Video output format
- Censor type
- Audio-only export toggle
- Audio format selection when audio-only is enabled

In the `Voice record` tab, output settings are audio-focused:

- Video format is hidden
- Audio format is always selectable
- Saved queue file extension and MIME now match the selected audio format via client-side transcoding

For some URL sources such as YouTube and TikTok, the app keeps video downloads enabled so previews remain available.

## Censor types

Built-in censor types:

- `beep`
- `silence`
- `faaa`
- `mac-quack`
- `bruh`

For custom sound options, the backend expects these files:

```text
backend_data/censor_sounds/faaa.mp3
backend_data/censor_sounds/mac-quack.mp3
backend_data/censor_sounds/bruh.mp3
```

## Profanity dictionaries

The backend loads profanity dictionaries from:

```text
backend_data/profanity_csv/
```

Each CSV file is treated as a supported language, and the filename becomes the language label shown in the app.

If the profanity CSV directory is missing or empty, the backend falls back to:

```text
backend_data/vbw_classify.csv
```

## Processing flow

1. Start the backend with `npm run api`.
2. Start the frontend with `npm run dev`.
3. Add a local file or supported URL.
4. Choose output settings.
5. Start processing or wait for queued URL jobs to run.
6. Watch queue progress, including estimated time remaining for active jobs.
7. Review the safety report, analytics, and original/sanitized previews.
8. Download the sanitized result or re-process a completed item with updated settings.
9. Clear completed items when you want to reclaim disk space in `backend_data/jobs/`.

## API overview

Main backend endpoints:

- `GET /api/health` - health check
- `GET /api/supported-languages` - list supported profanity CSV files
- `GET /api/supported-languages/{csv_filename}` - read entries from one profanity CSV, with optional `offset`, `limit`, and `search` query parameters for lazy loading
- `GET /api/google-dictionary` - fetch a meaning or translated explanation for a profanity entry using the requested language
- `GET /api/censor-sounds/{sound_name}` - serve custom censor sounds
- `POST /api/process` - upload local media and start a processing job
- `POST /api/process-url` - start a URL-based processing job
- `GET /api/jobs/{job_id}` - poll processing status and result metadata
- `GET /api/jobs/{job_id}/download` - download the sanitized output
- `GET /api/jobs/{job_id}/original` - fetch the original uploaded or downloaded source media
- `GET /api/jobs/{job_id}/preview` - fetch a sanitized preview asset
- `DELETE /api/jobs/{job_id}` - delete a completed job and its job directory

## Troubleshooting

### `npm run api` fails immediately

Check these first:

- `.venv` exists and dependencies were installed with `pip install -r requirements.txt`
- FFmpeg is installed and accessible on `PATH`
- The Python interpreter at `.venv\Scripts\python.exe` is valid

### URL import fails with an invalid URL error

Use a full URL starting with `http://` or `https://`.

Example:

```text
https://www.youtube.com/watch?v=...
```

### Voice record save fails with FFmpeg load/fetch errors

Try these checks:

- Ensure frontend dependencies are installed: `npm install`
- Restart the Vite dev server after dependency or config changes
- If dependency optimizer cache is stale, delete `node_modules/.vite` and run `npm run dev` again

### YouTube says "Sign in to confirm you're not a bot"

Some YouTube requests require authenticated cookies. Configure one of these before starting the backend:

- `YTDLP_COOKIES_FILE` pointing to an exported `cookies.txt` file
- `YTDLP_COOKIES_BROWSER` with a browser name such as `chrome`, `edge`, `firefox`, or `brave`
- Optional: `YTDLP_COOKIES_PROFILE` for non-default browser profiles

Windows PowerShell example:

```powershell
$env:YTDLP_COOKIES_BROWSER = "chrome"
$env:YTDLP_COOKIES_PROFILE = "Default"
npm run api
```

Or with an exported cookies file:

```powershell
$env:YTDLP_COOKIES_FILE = "C:\path\to\cookies.txt"
npm run api
```

### First run is slow

Whisper model loading can take time the first time the backend starts processing.

### Completed jobs are taking disk space

Use `Clear Completed` in the queue. Completed job directories are deleted from `backend_data/jobs/` when cleared.

### Supported language modal feels empty at first

Entries are now loaded lazily. Open a language card and scroll in the modal to fetch more rows.

## Validation

To validate the frontend bundle:

```bash
npm run build
```
  