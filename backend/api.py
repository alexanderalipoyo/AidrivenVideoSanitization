from __future__ import annotations

import csv
import json
import mimetypes
import os
import shutil
import subprocess
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

import whisper
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

try:
    import yt_dlp
except ImportError:
    yt_dlp = None


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
SOUND_DIR = DATA_DIR / "censor_sounds"
PROFANITY_CSV_DIR = DATA_DIR / "profanity_csv"
VBW_CACHE_PATH = DATA_DIR / "vbw_classify.csv"
WHISPER_MODEL_NAME = os.getenv("WHISPER_MODEL", "base")
VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv"}
VIDEO_EXTENSIONS = VIDEO_EXTENSIONS | {".webm"}
ALLOWED_EXTENSIONS = VIDEO_EXTENSIONS | {".mp3", ".wav", ".flac", ".m4a", ".ogg", ".opus", ".aac", ".wma"}
SUPPORTED_AUDIO_OUTPUT_FORMATS = {"mp3", "wav", "flac", "ogg", "aac", "m4a"}
PUNCTUATION_TO_STRIP = " \t\r\n.,!?;:\"'`()[]{}<>-_"
CENSOR_SOUND_FILES = {
    "faaa": SOUND_DIR / "faaa.mp3",
}

DATA_DIR.mkdir(parents=True, exist_ok=True)
JOBS_DIR.mkdir(parents=True, exist_ok=True)
SOUND_DIR.mkdir(parents=True, exist_ok=True)

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
    audio_only: bool = False
    audio_format: str = "mp3"
    status: str = "queued"
    progress: float = 0.0
    error: str | None = None
    result: dict[str, Any] | None = None


class UrlProcessingRequest(BaseModel):
    url: str
    output_format: str = "mp4"
    censor_type: str = "beep"
    audio_only: bool = True
    audio_format: str = "mp3"
    playlist: bool = False


def build_safe_filename_stem(value: str, fallback: str, max_length: int = 80) -> str:
    cleaned = "".join(
        character if character.isalnum() or character in {" ", "-", "_", "."} else "_"
        for character in value.strip()
    ).strip(" ._")
    return cleaned[:max_length] or fallback


def build_safe_filename_token(value: str, fallback: str, max_length: int = 24) -> str:
    cleaned = "".join(
        character if character.isalnum() or character in {"-", "_"} else "_"
        for character in value.strip()
    ).strip("._-")
    return cleaned[:max_length] or fallback


JOBS: dict[str, JobState] = {}
JOBS_LOCK = threading.Lock()
MODEL_LOCK = threading.Lock()
PROFANITY_LOCK = threading.Lock()
WHISPER_MODEL: Any | None = None
PROFANITY_MAP: dict[str, str] | None = None
DICTIONARY_CACHE: dict[str, dict[str, str]] = {}
DICTIONARY_CACHE_LOCK = threading.Lock()
LANGUAGE_CODE_BY_CSV = {
    "arabic.csv": "ar",
    "bengali.csv": "bn",
    "chinese_mandarin.csv": "zh-CN",
    "english.csv": "en",
    "french.csv": "fr",
    "german.csv": "de",
    "hindi.csv": "hi",
    "japanese.csv": "ja",
    "portuguese.csv": "pt",
    "russian.csv": "ru",
    "spanish.csv": "es",
    "urdu.csv": "ur",
}


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


def delete_job_files(job_id: str) -> None:
    job_dir = JOBS_DIR / job_id
    if job_dir.exists():
        shutil.rmtree(job_dir, ignore_errors=True)


def delete_job(job_id: str) -> None:
    with JOBS_LOCK:
        job = JOBS.get(job_id)

    if job and job.status in {"queued", "processing"}:
        raise HTTPException(status_code=409, detail="Cannot delete a job that is still running")

    delete_job_files(job_id)

    with JOBS_LOCK:
        JOBS.pop(job_id, None)


def validate_processing_options(output_format: str, censor_type: str) -> None:
    if output_format not in {"mp4", "avi", "mov", "mkv"}:
        raise HTTPException(status_code=400, detail="Unsupported output format")

    if censor_type not in {"beep", "silence", *CENSOR_SOUND_FILES.keys()}:
        raise HTTPException(status_code=400, detail="Unsupported censor type")


def validate_audio_output_format(audio_format: str) -> None:
    if audio_format not in SUPPORTED_AUDIO_OUTPUT_FORMATS:
        raise HTTPException(status_code=400, detail="Unsupported audio format")


def validate_remote_media_url(media_url: str) -> str:
    normalized_url = media_url.strip()
    parsed_url = urlparse(normalized_url)
    if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
        raise HTTPException(status_code=400, detail="A valid http or https URL is required")
    return normalized_url


def load_whisper_model() -> Any:
    global WHISPER_MODEL
    if WHISPER_MODEL is not None:
        return WHISPER_MODEL

    with MODEL_LOCK:
        if WHISPER_MODEL is None:
            WHISPER_MODEL = whisper.load_model(WHISPER_MODEL_NAME)

    return WHISPER_MODEL


def guess_media_mime_type(file_path: Path) -> str:
    guessed_type = mimetypes.guess_type(file_path.name)[0]
    if guessed_type:
        return guessed_type
    if file_path.suffix.lower() in VIDEO_EXTENSIONS:
        return "video/mp4"
    return "audio/mpeg"


def normalize_dictionary_term(term: str) -> str:
    normalized = " ".join(term.strip().split())
    if not normalized:
        raise HTTPException(status_code=400, detail="A word is required")
    if len(normalized) > 120:
        raise HTTPException(status_code=400, detail="Word is too long")
    return normalized


def resolve_dictionary_language(language: str) -> str:
    normalized_language = language.strip()
    if not normalized_language:
        raise HTTPException(status_code=400, detail="A language is required")

    normalized_key = normalized_language.casefold()
    if normalized_key in LANGUAGE_CODE_BY_CSV:
        return LANGUAGE_CODE_BY_CSV[normalized_key]

    for allowed_code in LANGUAGE_CODE_BY_CSV.values():
        if normalized_key == allowed_code.casefold():
            return allowed_code

    raise HTTPException(status_code=400, detail="Unsupported language")


def fetch_json(url: str) -> Any | None:
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
        },
    )
    try:
        with urlopen(request, timeout=8) as response:
            return json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError):
        return None


def fetch_google_dictionary_definition(term: str) -> dict[str, str] | None:
    encoded_term = quote(term)
    payload = fetch_json(
        "https://clients5.google.com/translate_a/t?"
        f"client=dict-chrome-ex&sl=en&tl=en&q={encoded_term}"
    )
    if not isinstance(payload, list) or not payload:
        return None

    first_value = payload[0] if payload else None
    if isinstance(first_value, list) and first_value:
        first_value = first_value[0]

    if not isinstance(first_value, str):
        return None

    definition = first_value.strip()
    if not definition or definition.casefold() == term.casefold():
        return None

    return {
        "word": term,
        "definition": definition,
        "part_of_speech": "",
        "source": "google",
    }


def fetch_google_translated_meaning(term: str, source_language: str) -> dict[str, str] | None:
    encoded_term = quote(term)
    payload = fetch_json(
        "https://clients5.google.com/translate_a/single?"
        f"client=dict-chrome-ex&sl={quote(source_language)}&tl=en&dt=t&q={encoded_term}"
    )
    if not isinstance(payload, list) or not payload:
        return None

    translation_rows = payload[0]
    if not isinstance(translation_rows, list) or not translation_rows:
        return None

    translated_parts: list[str] = []
    for row in translation_rows:
        if not isinstance(row, list) or not row:
            continue
        translated_text = row[0]
        if isinstance(translated_text, str) and translated_text.strip():
            translated_parts.append(translated_text.strip())

    translated_definition = " ".join(translated_parts).strip()
    if not translated_definition:
        return None

    return {
        "word": term,
        "definition": translated_definition,
        "part_of_speech": "Translation",
        "source": "google",
    }


def fetch_fallback_dictionary_definition(term: str) -> dict[str, str] | None:
    encoded_term = quote(term)
    payload = fetch_json(f"https://api.dictionaryapi.dev/api/v2/entries/en/{encoded_term}")
    if not isinstance(payload, list) or not payload:
        return None

    first_entry = payload[0]
    if not isinstance(first_entry, dict):
        return None

    meanings = first_entry.get("meanings")
    if not isinstance(meanings, list):
        return None

    for meaning in meanings:
        if not isinstance(meaning, dict):
            continue

        definitions = meaning.get("definitions")
        if not isinstance(definitions, list) or not definitions:
            continue

        first_definition = definitions[0]
        if not isinstance(first_definition, dict):
            continue

        definition = str(first_definition.get("definition") or "").strip()
        if not definition:
            continue

        return {
            "word": str(first_entry.get("word") or term).strip() or term,
            "definition": definition,
            "part_of_speech": str(meaning.get("partOfSpeech") or "").strip(),
            "source": "fallback",
        }

    return None


def lookup_dictionary_definition(term: str, language: str) -> dict[str, str]:
    normalized_term = normalize_dictionary_term(term)
    language_code = resolve_dictionary_language(language)
    cache_key = f"{language_code}:{normalized_term.casefold()}"

    with DICTIONARY_CACHE_LOCK:
        cached = DICTIONARY_CACHE.get(cache_key)
    if cached is not None:
        return cached

    if language_code == "en":
        definition = fetch_google_dictionary_definition(normalized_term)
        if definition is None:
            definition = fetch_fallback_dictionary_definition(normalized_term)
    else:
        definition = fetch_google_translated_meaning(normalized_term, language_code)

    if definition is None and language_code != "en":
        definition = fetch_fallback_dictionary_definition(normalized_term)

    if definition is None:
        raise HTTPException(status_code=404, detail="Definition not found")

    with DICTIONARY_CACHE_LOCK:
        DICTIONARY_CACHE[cache_key] = definition

    return definition


def pick_downloaded_media_file(job_dir: Path) -> Path:
    candidates = [
        path
        for path in job_dir.iterdir()
        if path.is_file() and path.suffix.lower() in ALLOWED_EXTENSIONS
    ]
    if not candidates:
        raise RuntimeError("yt-dlp did not produce a supported media file")
    return max(candidates, key=lambda path: (path.stat().st_size, path.stat().st_mtime))


def extract_playlist_entries(media_url: str) -> tuple[str | None, list[dict[str, str]]]:
    if yt_dlp is None:
        raise RuntimeError("yt-dlp is not installed. Run pip install -r requirements.txt.")

    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True}) as downloader:
        metadata = downloader.extract_info(media_url, download=False)

    raw_entries = metadata.get("entries") or []
    playlist_title = str(metadata.get("title") or "").strip() or None
    entries: list[dict[str, str]] = []

    for index, entry in enumerate(raw_entries, start=1):
        if not entry:
            continue

        entry_url = str(
            entry.get("webpage_url")
            or entry.get("original_url")
            or ""
        ).strip()

        if not entry_url:
            raw_url = str(entry.get("url") or "").strip()
            if raw_url.startswith("http"):
                entry_url = raw_url
            elif raw_url and ("youtube.com" in media_url or "youtu.be" in media_url):
                entry_url = f"https://www.youtube.com/watch?v={raw_url}"

        if not entry_url:
            continue

        entry_title = str(entry.get("title") or f"Playlist item {index}").strip() or f"Playlist item {index}"
        entries.append({
            "url": entry_url,
            "title": entry_title,
        })

    return playlist_title, entries


def download_media_from_url(
    job_id: str,
    media_url: str,
    audio_only: bool,
) -> tuple[Path, str, str]:
    if yt_dlp is None:
        raise RuntimeError("yt-dlp is not installed. Run pip install -r requirements.txt.")

    job = get_job(job_id)
    job_dir = job.input_path.parent
    fallback_stem = build_safe_filename_stem(job.filename, "download", max_length=48)

    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True, "noplaylist": True}) as preview_downloader:
        preview_metadata = preview_downloader.extract_info(media_url, download=False)

    media_title = str(preview_metadata.get("title") or job.filename).strip() or job.filename
    media_id = build_safe_filename_token(str(preview_metadata.get("id") or job_id), job_id[:12])
    safe_stem = build_safe_filename_stem(media_title, fallback_stem, max_length=48)
    output_template = str(job_dir / f"{safe_stem}-{media_id}.%(ext)s")
    ydl_options: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "nopart": True,
        "outtmpl": output_template,
    }

    if audio_only:
        ydl_options.update(
            {
                "format": "bestaudio/best",
                "postprocessors": [
                    {
                        "key": "FFmpegExtractAudio",
                        "preferredcodec": "mp3",
                        "preferredquality": "192",
                    }
                ],
            }
        )
    else:
        ydl_options.update(
            {
                "format": "bestvideo+bestaudio/best",
                "merge_output_format": "mp4",
            }
        )

    with yt_dlp.YoutubeDL(ydl_options) as downloader:
        downloader.extract_info(media_url, download=True)

    downloaded_path = pick_downloaded_media_file(job_dir)
    return downloaded_path, guess_media_mime_type(downloaded_path), media_title


def load_profanity_map_from_directory(directory_path: Path) -> dict[str, str]:
    profanity_map: dict[str, str] = {}

    if not directory_path.exists():
        return profanity_map

    for csv_path in sorted(directory_path.glob("*.csv")):
        language = csv_path.stem.replace("_", " ").strip()
        if not language:
            continue

        with csv_path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.reader(handle)
            for row in reader:
                if not row:
                    continue

                word = str(row[0]).strip().lower()
                if not word or word == "word":
                    continue

                profanity_map[word] = language

    return profanity_map


def load_profanity_map_from_file(file_path: Path, default_language: str) -> dict[str, str]:
    profanity_map: dict[str, str] = {}

    if not file_path.exists():
        return profanity_map

    with file_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle)
        saw_language_column = False
        for row in reader:
            if not row:
                continue

            word = str(row[0]).strip().lower()
            if not word or word == "word":
                continue

            language = default_language
            if len(row) > 1 and row[1]:
                saw_language_column = True
                language = str(row[1]).strip() or default_language

            profanity_map[word] = language

    if profanity_map and not saw_language_column:
        return {word: default_language for word in profanity_map}

    return profanity_map


def load_profanity_map() -> dict[str, str]:
    global PROFANITY_MAP
    if PROFANITY_MAP is not None:
        return PROFANITY_MAP

    with PROFANITY_LOCK:
        if PROFANITY_MAP is not None:
            return PROFANITY_MAP

        profanity_map = load_profanity_map_from_directory(PROFANITY_CSV_DIR)

        if not profanity_map:
            profanity_map = load_profanity_map_from_file(VBW_CACHE_PATH, default_language="VBW")

        PROFANITY_MAP = profanity_map
        return PROFANITY_MAP


def list_supported_languages() -> list[dict[str, Any]]:
    supported_languages: list[dict[str, Any]] = []

    if not PROFANITY_CSV_DIR.exists():
        return supported_languages

    for csv_path in sorted(PROFANITY_CSV_DIR.glob("*.csv")):
        language_name = csv_path.stem.replace("_", " ").strip()
        if not language_name:
            continue

        word_count = 0
        with csv_path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.reader(handle)
            for row in reader:
                if not row:
                    continue

                word = str(row[0]).strip()
                if not word or word.lower() == "word":
                    continue

                word_count += 1

        supported_languages.append(
            {
                "name": language_name,
                "file": csv_path.name,
                "word_count": word_count,
            }
        )

    return supported_languages


def get_supported_language_csv(csv_filename: str) -> tuple[str, Path]:
    csv_path = (PROFANITY_CSV_DIR / csv_filename).resolve()
    if csv_path.parent != PROFANITY_CSV_DIR.resolve() or csv_path.suffix.lower() != ".csv":
        raise HTTPException(status_code=404, detail="Language file not found")
    if not csv_path.exists():
        raise HTTPException(status_code=404, detail="Language file not found")

    language_name = csv_path.stem.replace("_", " ").strip()
    if not language_name:
        raise HTTPException(status_code=404, detail="Language file not found")

    return language_name, csv_path


def read_supported_language_entries(csv_filename: str) -> dict[str, Any]:
    return read_supported_language_entries_page(csv_filename, offset=0, limit=100, search=None)


def read_supported_language_entries_page(
    csv_filename: str,
    *,
    offset: int,
    limit: int,
    search: str | None,
) -> dict[str, Any]:
    language_name, csv_path = get_supported_language_csv(csv_filename)
    entries: list[str] = []
    normalized_search = search.strip().casefold() if search else ""

    if offset < 0:
        raise HTTPException(status_code=400, detail="Offset must be zero or greater")
    if limit <= 0 or limit > 500:
        raise HTTPException(status_code=400, detail="Limit must be between 1 and 500")

    matched_total = 0

    with csv_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle)
        for row in reader:
            if not row:
                continue

            word = str(row[0]).strip()
            if not word or word.lower() == "word":
                continue

            if normalized_search and normalized_search not in word.casefold():
                continue

            matched_total += 1

            if matched_total <= offset:
                continue

            if len(entries) >= limit:
                continue

            entries.append(word)

    return {
        "name": language_name,
        "file": csv_path.name,
        "entries": entries,
        "total": matched_total,
        "offset": offset,
        "limit": limit,
        "has_more": offset + len(entries) < matched_total,
    }


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


def refresh_safety_report_languages(
    safety_report: list[dict[str, Any]],
    profanity_map: dict[str, str],
) -> list[dict[str, Any]]:
    refreshed_report: list[dict[str, Any]] = []

    for item in safety_report:
        refreshed_item = dict(item)
        if refreshed_item.get("is_profane"):
            matched_profanity = str(
                refreshed_item.get("matched_profanity")
                or refreshed_item.get("word", "")
            ).strip(PUNCTUATION_TO_STRIP).lower()
            refreshed_language = profanity_map.get(matched_profanity, "")
            if refreshed_language:
                refreshed_item["matched_profanity"] = matched_profanity
                refreshed_item["matched_profanity_language"] = refreshed_language

        refreshed_report.append(refreshed_item)

    return refreshed_report


def profane_intervals(classified_words: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        [word for word in classified_words if word["is_profane"]],
        key=lambda word: word["start"],
    )


def render_beep(duration_ms: int) -> AudioSegment:
    return Sine(1000).to_audio_segment(duration=duration_ms).apply_gain(-10)


def render_custom_censor_sound(sound_name: str, duration_ms: int) -> AudioSegment:
    sound_path = CENSOR_SOUND_FILES.get(sound_name)
    if sound_path is None:
        raise RuntimeError(f"Unsupported censor sound: {sound_name}")
    if not sound_path.exists():
        raise RuntimeError(
            f"Custom censor sound '{sound_name}' is missing at {sound_path}"
        )

    source_sound = AudioSegment.from_file(str(sound_path))
    if len(source_sound) == 0:
        raise RuntimeError(f"Custom censor sound '{sound_name}' is empty")

    repeated = AudioSegment.empty()
    while len(repeated) < duration_ms:
        repeated += source_sound
    return repeated[:duration_ms]


def resolve_audio_export_settings(audio_format: str) -> tuple[str, list[str] | None]:
    if audio_format == "aac":
        return "adts", None
    if audio_format == "m4a":
        return "mp4", ["-c:a", "aac"]
    return audio_format, None


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
            if censor_type == "beep":
                replacement = render_beep(duration_ms)
            elif censor_type == "silence":
                replacement = AudioSegment.silent(duration=duration_ms)
            else:
                replacement = render_custom_censor_sound(censor_type, duration_ms)
            sanitized_audio += replacement
        previous_end_ms = end_ms

    sanitized_audio += source_audio[previous_end_ms:]
    export_format, export_parameters = resolve_audio_export_settings(output_format)
    export_kwargs: dict[str, Any] = {"format": export_format}
    if export_parameters:
        export_kwargs["parameters"] = export_parameters
    sanitized_audio.export(str(output_path), **export_kwargs)


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


def build_output_file(job: JobState, classified_words: list[dict[str, Any]]) -> tuple[Path, str, Path | None, str | None]:
    job_dir = job.input_path.parent
    source_suffix = job.input_path.suffix.lower()
    source_is_video = source_suffix in VIDEO_EXTENSIONS or job.input_mime_type.startswith("video/")
    sanitized_intervals = profane_intervals(classified_words)

    if job.audio_only:
        output_suffix = f".{job.audio_format}"
        output_path = job_dir / f"sanitized_output{output_suffix}"
        sanitize_audio(job.input_path, sanitized_intervals, job.censor_type, output_path, job.audio_format)
        return output_path, mimetypes.guess_type(output_path.name)[0] or "audio/mpeg", None, None

    if source_is_video:
        output_suffix = f".{job.requested_format}"
        audio_track_path = job_dir / "sanitized_audio.wav"
        output_path = job_dir / f"sanitized_output{output_suffix}"
        sanitize_audio(job.input_path, sanitized_intervals, job.censor_type, audio_track_path, "wav")
        mux_video_with_audio(job.input_path, audio_track_path, output_path)

        preview_path: Path | None = None
        preview_mime_type: str | None = None
        if job.requested_format == "mp4":
            preview_path = output_path
            preview_mime_type = mimetypes.guess_type(output_path.name)[0] or "video/mp4"
        else:
            preview_path = job_dir / "sanitized_preview.mp4"
            mux_video_with_audio(job.input_path, audio_track_path, preview_path)
            preview_mime_type = "video/mp4"

        return (
            output_path,
            mimetypes.guess_type(output_path.name)[0] or "video/mp4",
            preview_path,
            preview_mime_type,
        )

    output_suffix = source_suffix if source_suffix not in VIDEO_EXTENSIONS else ".mp3"
    if output_suffix not in {".mp3", ".wav", ".flac", ".ogg", ".aac", ".m4a"}:
        output_suffix = ".mp3"

    output_format = output_suffix.lstrip(".")
    output_path = job_dir / f"sanitized_output{output_suffix}"
    sanitize_audio(job.input_path, sanitized_intervals, job.censor_type, output_path, output_format)
    return output_path, mimetypes.guess_type(output_path.name)[0] or "audio/mpeg", None, None


def run_processing_pipeline(job_id: str) -> None:
    job = get_job(job_id)
    model = load_whisper_model()

    update_job(job_id, progress=35.0)
    transcription_result = model.transcribe(str(job.input_path), word_timestamps=True)

    update_job(job_id, progress=60.0)
    words = aggregate_word_timestamps(transcription_result)
    profanity_map = load_profanity_map()
    classified_words = classify_profanity(words, profanity_map)

    update_job(job_id, progress=82.0)
    output_path, output_mime_type, preview_path, preview_mime_type = build_output_file(job, classified_words)
    preview_filename = preview_path.name if preview_path else output_path.name
    preview_url = (
        f"/api/jobs/{job_id}/preview"
        if preview_path and preview_path != output_path
        else f"/api/jobs/{job_id}/download"
    )

    result = {
        "transcription": build_transcription_payload(transcription_result),
        "safety_report": classified_words,
        "source_url": f"/api/jobs/{job_id}/original",
        "source_filename": job.input_path.name,
        "source_mime_type": job.input_mime_type,
        "output_url": f"/api/jobs/{job_id}/download",
        "output_filename": output_path.name,
        "output_mime_type": output_mime_type,
        "preview_url": preview_url,
        "preview_filename": preview_filename,
        "preview_mime_type": preview_mime_type or output_mime_type,
        "profane_count": sum(1 for word in classified_words if word["is_profane"]),
    }

    update_job(job_id, status="completed", progress=100.0, result=result)


def process_job(job_id: str) -> None:
    try:
        update_job(job_id, status="processing", progress=10.0, error=None)
        run_processing_pipeline(job_id)
    except Exception as exc:
        update_job(job_id, status="error", error=str(exc), progress=100.0)


def process_url_job(job_id: str, media_url: str, audio_only: bool) -> None:
    try:
        update_job(job_id, status="processing", progress=8.0, error=None)
        input_path, input_mime_type, media_title = download_media_from_url(job_id, media_url, audio_only)
        update_job(
            job_id,
            filename=input_path.name,
            input_path=input_path,
            input_mime_type=input_mime_type,
            progress=20.0,
            result={"source_title": media_title},
        )
        run_processing_pipeline(job_id)
    except Exception as exc:
        update_job(job_id, status="error", error=str(exc), progress=100.0)


@app.get("/api/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok", "whisper_model": WHISPER_MODEL_NAME}


@app.get("/api/supported-languages")
def get_supported_languages() -> dict[str, Any]:
    languages = list_supported_languages()
    return {
        "languages": languages,
        "total": len(languages),
    }


@app.get("/api/supported-languages/{csv_filename}")
def get_supported_language_entries(
    csv_filename: str,
    offset: int = 0,
    limit: int = 100,
    search: str | None = None,
) -> dict[str, Any]:
    return read_supported_language_entries_page(
        csv_filename,
        offset=offset,
        limit=limit,
        search=search,
    )


@app.get("/api/google-dictionary")
def get_google_dictionary_definition(word: str, language: str = "en") -> dict[str, str]:
    return lookup_dictionary_definition(word, language)


@app.get("/api/censor-sounds/{sound_name}")
def get_censor_sound(sound_name: str) -> FileResponse:
    sound_path = CENSOR_SOUND_FILES.get(sound_name)
    if sound_path is None or not sound_path.exists():
        raise HTTPException(status_code=404, detail="Censor sound not found")

    return FileResponse(
        path=sound_path,
        media_type=mimetypes.guess_type(sound_path.name)[0] or "audio/mpeg",
        filename=sound_path.name,
    )


@app.post("/api/process")
async def start_processing(
    media: UploadFile = File(...),
    output_format: str = Form("mp4"),
    censor_type: str = Form("beep"),
    audio_only: bool = Form(False),
    audio_format: str = Form("mp3"),
) -> dict[str, str]:
    suffix = Path(media.filename or "upload").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported media format")

    validate_processing_options(output_format, censor_type)
    validate_audio_output_format(audio_format)

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
        audio_only=audio_only,
        audio_format=audio_format,
    )

    with JOBS_LOCK:
        JOBS[job_id] = job

    threading.Thread(target=process_job, args=(job_id,), daemon=True).start()
    return {"job_id": job_id}


@app.post("/api/process-url")
def start_url_processing(request: UrlProcessingRequest) -> dict[str, Any]:
    media_url = validate_remote_media_url(request.url)
    validate_processing_options(request.output_format, request.censor_type)
    validate_audio_output_format(request.audio_format)

    source_host = urlparse(media_url).netloc.replace("www.", "") or "remote-media"
    jobs_to_queue: list[dict[str, str]] = []
    playlist_title: str | None = None

    if request.playlist:
        playlist_title, playlist_entries = extract_playlist_entries(media_url)
        if not playlist_entries:
            raise HTTPException(status_code=400, detail="No playable entries were found in the playlist")
        jobs_to_queue = playlist_entries
    else:
        jobs_to_queue = [{"url": media_url, "title": source_host}]

    queued_jobs: list[dict[str, str]] = []

    for index, queued_item in enumerate(jobs_to_queue, start=1):
        job_id = uuid.uuid4().hex
        job_dir = JOBS_DIR / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        display_name = queued_item["title"]
        safe_stem = build_safe_filename_stem(display_name, f"{source_host}-{index}", max_length=48)
        placeholder_name = f"{safe_stem}.url"

        job = JobState(
            job_id=job_id,
            filename=display_name,
            input_path=job_dir / placeholder_name,
            input_mime_type="application/octet-stream",
            requested_format=request.output_format,
            censor_type=request.censor_type,
            audio_only=request.audio_only,
            audio_format=request.audio_format,
            result={"source_title": display_name},
        )

        with JOBS_LOCK:
            JOBS[job_id] = job

        threading.Thread(
            target=process_url_job,
            args=(job_id, queued_item["url"], request.audio_only),
            daemon=True,
        ).start()

        queued_jobs.append(
            {
                "job_id": job_id,
                "filename": display_name,
                "source_url": queued_item["url"],
            }
        )

    return {
        "jobs": queued_jobs,
        "total": len(queued_jobs),
        "playlist_title": playlist_title or "",
    }


@app.get("/api/jobs/{job_id}")
def read_job(job_id: str) -> dict[str, Any]:
    job = get_job(job_id)
    if job.result and job.result.get("safety_report"):
        refreshed_report = refresh_safety_report_languages(
            job.result["safety_report"],
            load_profanity_map(),
        )
        update_job(
            job_id,
            result={
                **job.result,
                "safety_report": refreshed_report,
            },
        )
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


@app.get("/api/jobs/{job_id}/original")
def download_original_input(job_id: str) -> FileResponse:
    job = get_job(job_id)
    if not job.input_path.exists():
        raise HTTPException(status_code=404, detail="Original media missing")

    return FileResponse(
        path=job.input_path,
        media_type=job.input_mime_type,
        filename=job.input_path.name,
    )


@app.get("/api/jobs/{job_id}/preview")
def preview_output(job_id: str) -> FileResponse:
    job = get_job(job_id)
    if not job.result:
        raise HTTPException(status_code=404, detail="Job output not ready")

    preview_filename = job.result.get("preview_filename") or job.result["output_filename"]
    preview_path = job.input_path.parent / preview_filename
    if not preview_path.exists():
        raise HTTPException(status_code=404, detail="Preview file missing")

    return FileResponse(
        path=preview_path,
        media_type=job.result.get("preview_mime_type") or job.result["output_mime_type"],
        filename=preview_path.name,
    )


@app.delete("/api/jobs/{job_id}", status_code=204)
def remove_job(job_id: str) -> None:
    delete_job(job_id)