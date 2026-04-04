from __future__ import annotations

import csv
import mimetypes
import os
import shutil
import subprocess
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests
import whisper
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse


def resolve_binary(binary_name: str) -> str | None:
    discovered_path = shutil.which(binary_name)
    if discovered_path:
        return discovered_path

    local_app_data = Path(os.getenv("LOCALAPPDATA", ""))
    if local_app_data:
        winget_root = local_app_data / "Microsoft" / "WinGet" / "Packages"
        if winget_root.exists():
            pattern = f"Gyan.FFmpeg_*/*/bin/{binary_name}.exe"
            matches = sorted(winget_root.glob(pattern), reverse=True)
            if matches:
                return str(matches[0])

    return None


FFMPEG_BINARY = resolve_binary("ffmpeg")
FFPROBE_BINARY = resolve_binary("ffprobe")
if FFMPEG_BINARY:
    ffmpeg_dir = str(Path(FFMPEG_BINARY).parent)
    current_path = os.environ.get("PATH", "")
    if ffmpeg_dir not in current_path:
        os.environ["PATH"] = f"{ffmpeg_dir}{os.pathsep}{current_path}" if current_path else ffmpeg_dir

from pydub import AudioSegment
from pydub.generators import Sine

ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "backend_data"
JOBS_DIR = DATA_DIR / "jobs"
VBW_CACHE_PATH = DATA_DIR / "vbw_classify.csv"
VBW_SOURCE_URL = "https://raw.githubusercontent.com/hypernewbie/vbw/main/vbw_classify.csv"
WHISPER_MODEL_NAME = os.getenv("WHISPER_MODEL", "base")
VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv"}
ALLOWED_EXTENSIONS = VIDEO_EXTENSIONS | {".mp3", ".wav", ".flac", ".m4a", ".ogg", ".opus", ".aac", ".wma"}
FALLBACK_PROFANITY_MAP = {
    "damn": "English",
    "hell": "English",
    "shit": "English",
    "fuck": "English",
    "bitch": "English",
}
PUNCTUATION_TO_STRIP = " \t\r\n.,!?;:\"'`()[]{}<>-_"

DATA_DIR.mkdir(parents=True, exist_ok=True)
JOBS_DIR.mkdir(parents=True, exist_ok=True)

if FFMPEG_BINARY:
    AudioSegment.converter = FFMPEG_BINARY
if FFPROBE_BINARY:
    AudioSegment.ffprobe = FFPROBE_BINARY

app = FastAPI(title="AI-Driven Video Sanitization API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@dataclass
class JobState:
    job_id: str
    filename: str
    input_path: Path
    input_mime_type: str
    requested_format: str
    censor_type: str
    status: str = "queued"
    progress: float = 0.0
    error: str | None = None
    result: dict[str, Any] | None = None


JOBS: dict[str, JobState] = {}
JOBS_LOCK = threading.Lock()
MODEL_LOCK = threading.Lock()
PROFANITY_LOCK = threading.Lock()
WHISPER_MODEL: Any | None = None
PROFANITY_MAP: dict[str, str] | None = None


def get_job(job_id: str) -> JobState:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def update_job(job_id: str, **changes: Any) -> None:
    with JOBS_LOCK:
        job = JOBS[job_id]
        for key, value in changes.items():
            setattr(job, key, value)


def load_whisper_model() -> Any:
    global WHISPER_MODEL
    if WHISPER_MODEL is not None:
        return WHISPER_MODEL

    with MODEL_LOCK:
        if WHISPER_MODEL is None:
            WHISPER_MODEL = whisper.load_model(WHISPER_MODEL_NAME)

    return WHISPER_MODEL


def ensure_profanity_cache() -> Path:
    if VBW_CACHE_PATH.exists():
        return VBW_CACHE_PATH

    try:
        response = requests.get(VBW_SOURCE_URL, timeout=30)
        response.raise_for_status()
        VBW_CACHE_PATH.write_text(response.text, encoding="utf-8")
    except Exception:
        lines = ["word,language"]
        lines.extend(f"{word},{language}" for word, language in FALLBACK_PROFANITY_MAP.items())
        VBW_CACHE_PATH.write_text("\n".join(lines), encoding="utf-8")

    return VBW_CACHE_PATH


def load_profanity_map() -> dict[str, str]:
    global PROFANITY_MAP
    if PROFANITY_MAP is not None:
        return PROFANITY_MAP

    with PROFANITY_LOCK:
        if PROFANITY_MAP is not None:
            return PROFANITY_MAP

        profanity_map: dict[str, str] = {}
        cache_path = ensure_profanity_cache()
        with cache_path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.reader(handle)
            for row in reader:
                if not row:
                    continue
                word = str(row[0]).strip().lower()
                if not word or word == "word":
                    continue
                language = str(row[1]).strip() if len(row) > 1 and row[1] else ""
                profanity_map[word] = language

        if not profanity_map:
            profanity_map = dict(FALLBACK_PROFANITY_MAP)

        PROFANITY_MAP = profanity_map
        return PROFANITY_MAP


def aggregate_word_timestamps(result: dict[str, Any]) -> list[dict[str, Any]]:
    words: list[dict[str, Any]] = []
    for segment in result.get("segments", []):
        for word_info in segment.get("words", []):
            start = float(word_info.get("start", 0.0))
            end = float(word_info.get("end", start))
            words.append(
                {
                    "word": str(word_info.get("word", "")).strip(),
                    "start": start,
                    "end": end,
                    "duration": max(end - start, 0.0),
                }
            )
    return words


def build_transcription_payload(result: dict[str, Any]) -> dict[str, Any]:
    payload_segments: list[dict[str, Any]] = []
    for segment in result.get("segments", []):
        payload_words: list[dict[str, Any]] = []
        for word_info in segment.get("words", []):
            payload_words.append(
                {
                    "start": float(word_info.get("start", 0.0)),
                    "end": float(word_info.get("end", 0.0)),
                    "word": str(word_info.get("word", "")).strip(),
                }
            )
        payload_segments.append({"words": payload_words})
    return {"segments": payload_segments}


def classify_profanity(words: list[dict[str, Any]], profanity_map: dict[str, str]) -> list[dict[str, Any]]:
    classified: list[dict[str, Any]] = []
    for word_info in words:
        normalized_word = word_info["word"].strip(PUNCTUATION_TO_STRIP).lower()
        language = profanity_map.get(normalized_word, "")
        is_profane = normalized_word in profanity_map
        classified.append(
            {
                "word": word_info["word"],
                "start": word_info["start"],
                "end": word_info["end"],
                "is_profane": is_profane,
                "matched_profanity": normalized_word if is_profane else None,
                "matched_profanity_language": language,
                "not_safe_prob": 1.0 if is_profane else 0.0,
                "safe_prob": 0.0 if is_profane else 1.0,
            }
        )
    return classified


def profane_intervals(classified_words: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        [word for word in classified_words if word["is_profane"]],
        key=lambda word: word["start"],
    )


def render_beep(duration_ms: int) -> AudioSegment:
    return Sine(1000).to_audio_segment(duration=duration_ms).apply_gain(-10)


def sanitize_audio(input_path: Path, intervals: list[dict[str, Any]], censor_type: str, output_path: Path, output_format: str) -> None:
    source_audio = AudioSegment.from_file(str(input_path))
    sanitized_audio = AudioSegment.empty()
    previous_end_ms = 0

    for interval in intervals:
        start_ms = max(int(interval["start"] * 1000), previous_end_ms)
        end_ms = max(int(interval["end"] * 1000), start_ms)
        duration_ms = max(end_ms - start_ms, 0)

        sanitized_audio += source_audio[previous_end_ms:start_ms]
        if duration_ms > 0:
            replacement = render_beep(duration_ms) if censor_type == "beep" else AudioSegment.silent(duration=duration_ms)
            sanitized_audio += replacement
        previous_end_ms = end_ms

    sanitized_audio += source_audio[previous_end_ms:]
    sanitized_audio.export(str(output_path), format=output_format)


def mux_video_with_audio(video_path: Path, audio_path: Path, output_path: Path) -> None:
    suffix = output_path.suffix.lower()
    video_codec = "mpeg4" if suffix == ".avi" else "libx264"
    audio_codec = "libmp3lame" if suffix == ".avi" else "aac"
    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(video_path),
        "-i",
        str(audio_path),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        video_codec,
        "-c:a",
        audio_codec,
        "-shortest",
        str(output_path),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or "ffmpeg failed to mux video")


def build_output_file(job: JobState, classified_words: list[dict[str, Any]]) -> tuple[Path, str]:
    job_dir = job.input_path.parent
    source_suffix = job.input_path.suffix.lower()
    source_is_video = source_suffix in VIDEO_EXTENSIONS or job.input_mime_type.startswith("video/")
    sanitized_intervals = profane_intervals(classified_words)

    if source_is_video:
        output_suffix = f".{job.requested_format}"
        audio_track_path = job_dir / "sanitized_audio.wav"
        output_path = job_dir / f"sanitized_output{output_suffix}"
        sanitize_audio(job.input_path, sanitized_intervals, job.censor_type, audio_track_path, "wav")
        mux_video_with_audio(job.input_path, audio_track_path, output_path)
        return output_path, mimetypes.guess_type(output_path.name)[0] or "video/mp4"

    output_suffix = source_suffix if source_suffix not in VIDEO_EXTENSIONS else ".mp3"
    if output_suffix not in {".mp3", ".wav", ".flac", ".ogg", ".aac", ".m4a"}:
        output_suffix = ".mp3"

    output_format = output_suffix.lstrip(".")
    output_path = job_dir / f"sanitized_output{output_suffix}"
    sanitize_audio(job.input_path, sanitized_intervals, job.censor_type, output_path, output_format)
    return output_path, mimetypes.guess_type(output_path.name)[0] or "audio/mpeg"


def process_job(job_id: str) -> None:
    job = get_job(job_id)

    try:
        update_job(job_id, status="processing", progress=10.0, error=None)
        model = load_whisper_model()

        update_job(job_id, progress=35.0)
        transcription_result = model.transcribe(str(job.input_path), word_timestamps=True)

        update_job(job_id, progress=60.0)
        words = aggregate_word_timestamps(transcription_result)
        profanity_map = load_profanity_map()
        classified_words = classify_profanity(words, profanity_map)

        update_job(job_id, progress=82.0)
        output_path, output_mime_type = build_output_file(job, classified_words)

        result = {
            "transcription": build_transcription_payload(transcription_result),
            "safety_report": classified_words,
            "output_url": f"/api/jobs/{job_id}/download",
            "output_filename": output_path.name,
            "output_mime_type": output_mime_type,
            "profane_count": sum(1 for word in classified_words if word["is_profane"]),
        }

        update_job(job_id, status="completed", progress=100.0, result=result)
    except Exception as exc:
        update_job(job_id, status="error", error=str(exc), progress=100.0)


@app.get("/api/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok", "whisper_model": WHISPER_MODEL_NAME}


@app.post("/api/process")
async def start_processing(
    media: UploadFile = File(...),
    output_format: str = Form("mp4"),
    censor_type: str = Form("beep"),
) -> dict[str, str]:
    suffix = Path(media.filename or "upload").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported media format")

    if output_format not in {"mp4", "avi", "mov", "mkv"}:
        raise HTTPException(status_code=400, detail="Unsupported output format")

    if censor_type not in {"beep", "silence"}:
        raise HTTPException(status_code=400, detail="Unsupported censor type")

    job_id = uuid.uuid4().hex
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    safe_name = Path(media.filename or f"upload{suffix}").name
    input_path = job_dir / safe_name

    with input_path.open("wb") as destination:
        shutil.copyfileobj(media.file, destination)

    job = JobState(
        job_id=job_id,
        filename=safe_name,
        input_path=input_path,
        input_mime_type=media.content_type or mimetypes.guess_type(safe_name)[0] or "application/octet-stream",
        requested_format=output_format,
        censor_type=censor_type,
    )

    with JOBS_LOCK:
        JOBS[job_id] = job

    threading.Thread(target=process_job, args=(job_id,), daemon=True).start()
    return {"job_id": job_id}


@app.get("/api/jobs/{job_id}")
def read_job(job_id: str) -> dict[str, Any]:
    job = get_job(job_id)
    return {
        "job_id": job.job_id,
        "status": job.status,
        "progress": job.progress,
        "error": job.error,
        "result": job.result,
    }


@app.get("/api/jobs/{job_id}/download")
def download_output(job_id: str) -> FileResponse:
    job = get_job(job_id)
    if not job.result:
        raise HTTPException(status_code=404, detail="Job output not ready")

    output_path = job.input_path.parent / job.result["output_filename"]
    if not output_path.exists():
        raise HTTPException(status_code=404, detail="Output file missing")

    return FileResponse(
        path=output_path,
        media_type=job.result["output_mime_type"],
        filename=output_path.name,
    )