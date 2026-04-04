const importMeta = import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
};

const apiBaseUrl = importMeta.env?.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";

export interface ProcessingApiSettings {
  format: string;
  sensorType: "beep" | "silence" | "faaa";
  audioOnly?: boolean;
  audioFormat?: string;
}

export interface UrlProcessingApiSettings extends ProcessingApiSettings {
  url: string;
  audioOnly: boolean;
  playlist: boolean;
}

export interface UrlProcessingStartJob {
  job_id: string;
  filename: string;
  source_url: string;
}

export interface UrlProcessingStartResponse {
  jobs: UrlProcessingStartJob[];
  total: number;
  playlist_title: string;
}

export interface ProcessingJobResult {
  transcription: {
    segments: Array<{
      words: Array<{
        start: number;
        end: number;
        word: string;
      }>;
    }>;
  };
  safety_report: Array<{
    word: string;
    start: number;
    end: number;
    is_profane: boolean;
    matched_profanity: string | null;
    matched_profanity_language: string;
    not_safe_prob: number;
    safe_prob: number;
  }>;
  source_url: string;
  source_filename: string;
  source_mime_type: string;
  output_url: string;
  output_filename: string;
  output_mime_type: string;
  preview_url: string;
  preview_mime_type: string;
  profane_count: number;
}

export interface ProcessingJobStatus {
  job_id: string;
  status: "queued" | "processing" | "completed" | "error";
  progress: number;
  error: string | null;
  result: ProcessingJobResult | null;
}

export interface SupportedLanguage {
  name: string;
  file: string;
  word_count: number;
}

export interface SupportedLanguagesResponse {
  languages: SupportedLanguage[];
  total: number;
}

export interface SupportedLanguageEntriesResponse {
  name: string;
  file: string;
  entries: string[];
  total: number;
}

function toApiUrl(path: string) {
  if (!apiBaseUrl) {
    return path;
  }
  return `${apiBaseUrl}${path}`;
}

async function readErrorDetail(response: Response, fallbackMessage: string) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    try {
      const payload = await response.json() as { detail?: string };
      if (payload.detail) {
        return payload.detail;
      }
    } catch {
      // Fall through to plain-text handling.
    }
  }

  const detail = await response.text();
  return detail || fallbackMessage;
}

export function resolveApiAssetUrl(path: string) {
  return toApiUrl(path);
}

export function resolveCensorSoundUrl(soundName: string) {
  return toApiUrl(`/api/censor-sounds/${soundName}`);
}

export async function startProcessingJob(file: File, settings: ProcessingApiSettings) {
  const formData = new FormData();
  formData.append("media", file);
  formData.append("output_format", settings.format);
  formData.append("censor_type", settings.sensorType);
  formData.append("audio_only", String(Boolean(settings.audioOnly)));
  formData.append("audio_format", settings.audioFormat ?? "mp3");

  const response = await fetch(toApiUrl("/api/process"), {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response, "Failed to start processing job");
    throw new Error(detail || "Failed to start processing job");
  }

  return response.json() as Promise<{ job_id: string }>;
}

export async function startProcessingUrlJob(settings: UrlProcessingApiSettings) {
  const response = await fetch(toApiUrl("/api/process-url"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: settings.url,
      output_format: settings.format,
      censor_type: settings.sensorType,
      audio_only: settings.audioOnly,
      audio_format: settings.audioFormat ?? "mp3",
      playlist: settings.playlist,
    }),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response, "Failed to start URL processing job");
    throw new Error(detail || "Failed to start URL processing job");
  }

  return response.json() as Promise<UrlProcessingStartResponse>;
}

export async function fetchJobStatus(jobId: string) {
  const response = await fetch(toApiUrl(`/api/jobs/${jobId}`));
  if (!response.ok) {
    const detail = await readErrorDetail(response, "Failed to fetch job status");
    throw new Error(detail || "Failed to fetch job status");
  }

  return response.json() as Promise<ProcessingJobStatus>;
}

export async function deleteJob(jobId: string) {
  const response = await fetch(toApiUrl(`/api/jobs/${jobId}`), {
    method: "DELETE",
  });

  if (!response.ok && response.status !== 404) {
    const detail = await readErrorDetail(response, "Failed to delete job");
    throw new Error(detail || "Failed to delete job");
  }
}

export async function fetchSupportedLanguages() {
  const response = await fetch(toApiUrl("/api/supported-languages"));
  if (!response.ok) {
    const detail = await readErrorDetail(response, "Failed to fetch supported languages");
    throw new Error(detail || "Failed to fetch supported languages");
  }

  return response.json() as Promise<SupportedLanguagesResponse>;
}

export async function fetchSupportedLanguageEntries(csvFilename: string) {
  const response = await fetch(toApiUrl(`/api/supported-languages/${encodeURIComponent(csvFilename)}`));
  if (!response.ok) {
    const detail = await readErrorDetail(response, "Failed to fetch supported language entries");
    throw new Error(detail || "Failed to fetch supported language entries");
  }

  return response.json() as Promise<SupportedLanguageEntriesResponse>;
}