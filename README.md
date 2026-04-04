
# AI-Driven Video Sanitization

This project is a Vite + React frontend for an AI-driven video sanitization workflow based on OpenAI Whisper word timestamps and VBW blacklist matching.

## Frontend setup

Run `npm i` to install the web app dependencies.

Run `npm run dev` to start the development server.

## Backend API

Run `npm run api` in a separate terminal to start the FastAPI processing backend on `http://127.0.0.1:8000`.

The frontend dev server proxies `/api/*` requests to that backend automatically.

## Python processing dependencies

The source notebook also depends on a Python media-processing stack. Install it with:

```bash
pip install -r requirements.txt
```

Included Python packages:

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

## System requirements

- FFmpeg must be installed and available on `PATH`
- ImageMagick may be required for MoviePy text rendering workflows
- GPU acceleration for Whisper depends on the installed PyTorch build and local CUDA support

## End-to-end workflow

1. Start the API with `npm run api`.
2. Start the frontend with `npm run dev`.
3. Upload a local audio or video file in the browser.
4. Start processing to generate a real Whisper transcription, profanity report, and sanitized output file.
  