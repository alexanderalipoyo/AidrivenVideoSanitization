
# AI-Driven Video Sanitization

AI-Driven Video Sanitization is a Vite + React frontend with a FastAPI backend for detecting profane words in audio or video, generating word-level timestamps with OpenAI Whisper, and producing a sanitized output file with censored audio.

## What it does

- Upload local audio or video files for processing
- Transcribe media with Whisper using word timestamps
- Match profane words against the local multilingual profanity CSV library
- Generate a word safety report and profanity analytics dashboard
- Preview uncensored and censored media in the UI
- Download the sanitized output in the selected output format
- Browse supported profanity languages directly from the app

## Tech stack

- Frontend: Vite, React, TypeScript, Tailwind CSS, Radix UI
- Backend: FastAPI, Uvicorn
- Speech recognition: OpenAI Whisper
- Media processing: FFmpeg, pydub, MoviePy

## Project structure

```text
src/                         Frontend application
backend/api.py               FastAPI backend and processing pipeline
backend_data/profanity_csv/  Multilingual profanity dictionaries
backend_data/censor_sounds/  Custom censor sounds
backend_data/jobs/           Generated processing outputs
requirements.txt             Python dependencies
package.json                 Frontend scripts and JS dependencies
```

## Prerequisites

Before running the app, make sure these are available:

- Node.js and npm
- Python 3.11 or a compatible local Python environment
- FFmpeg available on `PATH`
- Optional: ImageMagick for MoviePy-related text rendering workflows

## Installation

### 1. Install frontend dependencies

```bash
npm install
```

### 2. Create and activate a Python environment

Windows PowerShell:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
```

### 3. Install backend dependencies

```bash
pip install -r requirements.txt
```

Installed Python packages include:

- `openai-whisper`
- `pydub`
- `torch`
- `torchaudio`
- `pandas`
- `fuzzywuzzy`
- `python-Levenshtein`
- `moviepy`
- `matplotlib`
- `seaborn`
- `fastapi`
- `uvicorn`
- `python-multipart`

## Running the app

You need two terminals.

### Terminal 1: Start the backend API

```bash
npm run api
```

This starts the FastAPI server at `http://127.0.0.1:8000`.

Note: the `api` script uses `.venv\Scripts\python.exe`. If `.venv` does not exist yet, create it first.

### Terminal 2: Start the frontend

```bash
npm run dev
```

Vite serves the frontend and proxies `/api/*` requests to the backend automatically.

## Supported media formats

Input media:

- Video: `mp4`, `avi`, `mov`, `mkv`
- Audio: `mp3`, `wav`, `flac`, `m4a`, `ogg`, `opus`, `aac`, `wma`

Output video formats:

- `mp4`
- `avi`
- `mov`
- `mkv`

## Censor types

Built-in censor types:

- `beep`
- `silence`
- `faaa`

For the `faaa` censor type to work, place this file in the project:

```text
backend_data/censor_sounds/faaa.mp3
```

## Profanity dictionaries

The backend reads profanity dictionaries from:

```text
backend_data/profanity_csv/
```

Each CSV file is treated as one supported language. The filename becomes the language label shown in the UI.

If the folder is missing or empty, the backend falls back to `backend_data/vbw_classify.csv`.

## End-to-end workflow

1. Start the backend with `npm run api`.
2. Start the frontend with `npm run dev`.
3. Upload a local audio or video file.
4. Choose an output format and censor type.
5. Start processing.
6. Review the generated safety report, previews, timestamps, and analytics.
7. Download the sanitized output.

## API overview

Main backend endpoints:

- `GET /api/health` - health check
- `POST /api/process` - upload and start a processing job
- `GET /api/jobs/{job_id}` - poll processing status and result metadata
- `GET /api/jobs/{job_id}/download` - download sanitized output
- `GET /api/jobs/{job_id}/preview` - preview sanitized media when applicable
- `GET /api/supported-languages` - list supported languages from CSV files
- `GET /api/supported-languages/{csv_filename}` - read entries from a specific CSV
- `GET /api/censor-sounds/{sound_name}` - serve custom censor audio assets

## Notes

- Whisper model loading can take time on first run.
- GPU acceleration depends on your installed PyTorch build and local CUDA support.
- Existing processed jobs are stored under `backend_data/jobs/`.
- Unsupported files are rejected in the upload UI and shown as a notification.

## Suggested check

```bash
npm run build
```

Use that to validate the frontend bundle after changes.
  