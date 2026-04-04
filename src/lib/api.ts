const importMeta = import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
};

const apiBaseUrl = importMeta.env?.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";

export interface ProcessingApiSettings {
  format: string;
  sensorType: "beep" | "silence" | "faaa";
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
  output_url: string;
  output_filename: string;
  output_mime_type: string;
  profane_count: number;
}

export interface ProcessingJobStatus {
  job_id: string;
  status: "queued" | "processing" | "completed" | "error";
  progress: number;
  error: string | null;
  result: ProcessingJobResult | null;
}

function toApiUrl(path: string) {
  if (!apiBaseUrl) {
    return path;
  }
  return `${apiBaseUrl}${path}`;
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

  const response = await fetch(toApiUrl("/api/process"), {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "Failed to start processing job");
  }

  return response.json() as Promise<{ job_id: string }>;
}

export async function fetchJobStatus(jobId: string) {
  const response = await fetch(toApiUrl(`/api/jobs/${jobId}`));
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "Failed to fetch job status");
  }

  return response.json() as Promise<ProcessingJobStatus>;
}