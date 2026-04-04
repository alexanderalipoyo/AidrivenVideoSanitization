import { useState } from "react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "./components/ui/tabs";
import { Card } from "./components/ui/card";
import { FileUploadZone } from "./components/FileUploadZone";
import { FormatSelector } from "./components/FormatSelector";
import { PresetCards } from "./components/PresetCards";
import { ProcessingQueue } from "./components/ProcessingQueue";
import { DownloadSection } from "./components/DownloadSection";
import {
  AudioWaveform,
  Link,
  Languages,
  Settings,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { SupportedLanguagesPage } from "./components/SupportedLanguagesPage";
import { deleteJob, fetchJobStatus, resolveApiAssetUrl, startProcessingJob, startProcessingUrlJob } from "./lib/api";

export interface AudioFile {
  id: string;
  name: string;
  size: number;
  type: string;
  status: "pending" | "processing" | "completed" | "error";
  progress: number;
  file?: File;
  url?: string;
  previewUrl?: string;
  outputUrl?: string;
  outputMimeType?: string;
  outputPreviewUrl?: string;
  outputPreviewMimeType?: string;
  outputFilename?: string;
  requestedFormat?: string;
  errorMessage?: string;
  serverJobId?: string;
  transcription?: {
    segments: Array<{
      words: Array<{
        start: number;
        end: number;
        word: string;
      }>;
    }>;
  };
  safetyReport?: Array<{
    word: string;
    start: number;
    end: number;
    is_profane: boolean;
    matched_profanity: string | null;
    matched_profanity_language: string;
  }>;
  expanded?: boolean;
}

export interface ConversionSettings {
  format: string;
  sensorType: "beep" | "silence" | "faaa";
  audioOnly: boolean;
  audioFormat: string;
  normalize: boolean;
  compress: boolean;
  compressionLevel: "low" | "medium" | "high" | "extreme";
  metadata: Record<string, string>;
  preset?: string;
}

function shouldForceVideoDownload(mediaUrl: string) {
  try {
    const hostname = new URL(mediaUrl).hostname.toLowerCase();
    return hostname.includes("youtube.com")
      || hostname.includes("youtu.be")
      || hostname.includes("tiktok.com");
  } catch {
    return false;
  }
}

export default function App() {
  const [files, setFiles] = useState<AudioFile[]>([]);
  const [activePage, setActivePage] = useState<"workspace" | "supported-languages">("workspace");
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<"upload-media" | "upload-url">("upload-media");
  const [settings, setSettings] = useState<ConversionSettings>({
    format: "mp4",
    sensorType: "beep",
    audioOnly: false,
    audioFormat: "mp3",
    normalize: false,
    compress: false,
    compressionLevel: "medium",
    metadata: {},
  });

  const handleFilesAdded = (newFiles: File[]) => {
    const audioFiles: AudioFile[] = newFiles.map(
      (file, idx) => ({
        id: `${Date.now()}-${idx}`,
        name: file.name,
        size: file.size,
        type: file.type,
        status: "pending",
        progress: 0,
        file,
        previewUrl: URL.createObjectURL(file),
      }),
    );
    setFiles((prev) => [...prev, ...audioFiles]);
  };

  const handleUrlAdded = async (options: {
    url: string;
  }) => {
    try {
      const forceVideoDownload = shouldForceVideoDownload(options.url);
      const urlAudioOnly = forceVideoDownload ? false : settings.audioOnly;

      const queued = await startProcessingUrlJob({
        url: options.url,
        audioOnly: urlAudioOnly,
        audioFormat: settings.audioFormat,
        playlist: false,
        format: settings.format,
        sensorType: settings.sensorType,
      });

      const queuedFiles: AudioFile[] = queued.jobs.map((job, index) => ({
        id: `${Date.now()}-url-${index}-${job.job_id}`,
        name: job.filename || "Remote media",
        size: 0,
        type: urlAudioOnly ? "audio/unknown" : "video/unknown",
        status: "processing",
        progress: 12,
        url: job.source_url || options.url,
        requestedFormat: settings.format,
        serverJobId: job.job_id,
      }));

      setFiles((prev) => [...prev, ...queuedFiles]);

      queuedFiles.forEach((queuedFile) => {
        if (!queuedFile.serverJobId) {
          return;
        }

        void pollJobUntilComplete(queuedFile.id, queuedFile.serverJobId).catch((error) => {
          updateFile(queuedFile.id, {
            status: "error",
            progress: 100,
            errorMessage: error instanceof Error ? error.message : "URL processing failed",
          });
        });
      });
    } catch (error) {
      throw error instanceof Error ? error : new Error("URL processing failed");
    }
  };

  const updateFile = (id: string, changes: Partial<AudioFile>) => {
    setFiles((prev) =>
      prev.map((file) =>
        file.id === id ? { ...file, ...changes } : file,
      ),
    );
  };

  const pollJobUntilComplete = async (fileId: string, jobId: string) => {
    while (true) {
      const job = await fetchJobStatus(jobId);
      if (job.status === "completed" && job.result) {
        updateFile(fileId, {
          status: "completed",
          progress: 100,
          transcription: job.result.transcription,
          safetyReport: job.result.safety_report,
          previewUrl: resolveApiAssetUrl(job.result.source_url),
          type: job.result.source_mime_type,
          outputPreviewUrl: resolveApiAssetUrl(job.result.preview_url),
          outputPreviewMimeType: job.result.preview_mime_type,
          outputUrl: resolveApiAssetUrl(job.result.output_url),
          outputMimeType: job.result.output_mime_type,
          outputFilename: job.result.output_filename,
          expanded: true,
          errorMessage: undefined,
        });
        return;
      }

      if (job.status === "error") {
        throw new Error(job.error || "Processing failed");
      }

      updateFile(fileId, {
        status: "processing",
        progress: Math.max(5, Math.min(job.progress, 99)),
      });

      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
  };

  const handleStartProcessing = async () => {
    const pendingFiles = files.filter((file) => file.status === "pending");
    const processingSettings = { ...settings };

    for (const file of pendingFiles) {
      if (!file.file) {
        updateFile(file.id, {
          status: "error",
          progress: 100,
          errorMessage: "Only uploaded local files can be processed right now.",
        });
        continue;
      }

      try {
        updateFile(file.id, {
          status: "processing",
          progress: 5,
          requestedFormat: processingSettings.format,
          errorMessage: undefined,
        });

        const job = await startProcessingJob(file.file, {
          format: processingSettings.format,
          sensorType: processingSettings.sensorType,
          audioOnly: processingSettings.audioOnly,
          audioFormat: processingSettings.audioFormat,
        });

        updateFile(file.id, { serverJobId: job.job_id });
        await pollJobUntilComplete(file.id, job.job_id);
      } catch (error) {
        updateFile(file.id, {
          status: "error",
          progress: 100,
          errorMessage:
            error instanceof Error
              ? error.message
              : "Processing failed",
        });
      }
    }
  };

  const handleRemoveFile = (id: string) => {
    setFiles((prev) => {
      const fileToRemove = prev.find((file) => file.id === id);
      if (fileToRemove?.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(fileToRemove.previewUrl);
      }
      return prev.filter((file) => file.id !== id);
    });
  };

  const handleClearCompleted = async () => {
    const completedFiles = files.filter((file) => file.status === "completed");
    const completedServerJobs = completedFiles.filter((file) => file.serverJobId);

    const deletionResults = await Promise.allSettled(
      completedServerJobs.map((file) => deleteJob(file.serverJobId as string)),
    );

    const failedJobIds = new Set(
      deletionResults.flatMap((result, index) =>
        result.status === "rejected"
          ? [completedServerJobs[index].serverJobId as string]
          : [],
      ),
    );

    setFiles((prev) => {
      prev
        .filter(
          (file) => file.status === "completed"
            && !failedJobIds.has(file.serverJobId || "")
            && file.previewUrl?.startsWith("blob:"),
        )
        .forEach((file) => {
          if (file.previewUrl) {
            URL.revokeObjectURL(file.previewUrl);
          }
        });
      return prev.filter(
        (file) => file.status !== "completed" || failedJobIds.has(file.serverJobId || ""),
      );
    });
  };

  const handleToggleExpanded = (id: string) => {
    setFiles((prev) =>
      prev.map((file) =>
        file.id === id
          ? { ...file, expanded: !file.expanded }
          : file,
      ),
    );
  };

  const handleDownloadFile = (id: string) => {
    const file = files.find((entry) => entry.id === id);
    if (!file?.outputUrl) {
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = file.outputUrl;
    anchor.download = file.outputFilename || `${file.name}.sanitized`;
    anchor.target = "_blank";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  const handlePresetSelect = (preset: string) => {
    const presetSettings: Record<
      string,
      Partial<ConversionSettings>
    > = {
      podcast: {
        format: "mp4",
        normalize: true,
      },
      audiobook: {
        format: "mov",
        normalize: true,
      },
      streaming: { format: "mp4" },
      archival: { format: "mkv" },
      "high-quality": { format: "mp4" },
      compressed: {
        format: "avi",
        compress: true,
      },
    };

    if (presetSettings[preset]) {
      setSettings({
        ...settings,
        ...presetSettings[preset],
        preset,
      });
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="border-b border-slate-800 bg-slate-950/50 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 p-2">
                <AudioWaveform className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-slate-100">AI-Driven Video Sanitization</h1>
                <p className="text-sm text-slate-400">
                  Combining OpenAI Whisper with VBW Blacklisting
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setActivePage("workspace")}
                className={activePage === "workspace"
                  ? "border border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-800"
                  : "text-slate-300 hover:bg-slate-800/70 hover:text-slate-100"
                }
              >
                <Settings className="h-4 w-4" />
                Workspace
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setActivePage("supported-languages")}
                className={activePage === "supported-languages"
                  ? "border border-cyan-500/40 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/15"
                  : "text-slate-300 hover:bg-slate-800/70 hover:text-slate-100"
                }
              >
                <Languages className="h-4 w-4" />
                Supported language
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto flex-1 px-6 py-8">
        {activePage === "workspace" ? (
          <div className="space-y-6">
            <Tabs
              value={activeWorkspaceTab}
              onValueChange={(value) => setActiveWorkspaceTab(value as "upload-media" | "upload-url")}
              className="space-y-6"
            >
              <TabsList className="w-fit border border-slate-800 bg-slate-900/50">
                <TabsTrigger
                  value="upload-media"
                  className="text-slate-300 hover:text-slate-100 data-[state=active]:bg-violet-600 data-[state=active]:text-white"
                >
                  <Settings className="mr-2 w-4 h-4" />
                  Upload Media Files
                </TabsTrigger>
                <TabsTrigger
                  value="upload-url"
                  className="text-slate-300 hover:text-slate-100 data-[state=active]:bg-violet-600 data-[state=active]:text-white"
                >
                  <Link className="mr-2 w-4 h-4" />
                  Upload via Url
                </TabsTrigger>
              </TabsList>

              <TabsContent value="upload-media" className="space-y-6">
                <div className="grid gap-6 lg:grid-cols-3">
                  <div className="space-y-6 lg:col-span-2">
                    <FileUploadZone
                      onFilesAdded={handleFilesAdded}
                    />
                  </div>

                  <div className="space-y-6">
                    <FormatSelector
                      settings={settings}
                      onSettingsChange={setSettings}
                      showAudioOnly
                    />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="upload-url">
                <DownloadSection
                  settings={settings}
                  onSettingsChange={setSettings}
                  onUrlAdded={handleUrlAdded}
                />
              </TabsContent>
            </Tabs>

            {files.length > 0 && (
              <ProcessingQueue
                files={files}
                onStartProcessing={handleStartProcessing}
                onRemoveFile={handleRemoveFile}
                onClearCompleted={handleClearCompleted}
                onToggleExpanded={handleToggleExpanded}
                onDownloadFile={handleDownloadFile}
              />
            )}
          </div>
        ) : (
          <SupportedLanguagesPage />
        )}
      </div>

      <footer className="border-t border-slate-800/80 bg-slate-950/40">
        <div className="container mx-auto px-6 py-4 text-center text-sm text-slate-500">
          © 2026 MITS 001 (Machine Learning) - {" "}
          <a
            href="https://github.com/alexanderalipoyo"
            target="_blank"
            rel="noreferrer"
            className="text-slate-300 underline decoration-slate-600 underline-offset-4 transition-colors hover:text-cyan-300"
          >
            Alex Ali
          </a>
        </div>
      </footer>
    </div>
  );
}