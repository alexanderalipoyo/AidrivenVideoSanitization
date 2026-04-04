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
import { BatchProcessor } from "./components/BatchProcessor";
import { WordTimestamps } from "./components/WordTimestamps";
import { WordSafetyReport } from "./components/WordSafetyReport";
import { VideoPreview } from "./components/VideoPreview";
import { ProfanityGraphs } from "./components/ProfanityGraphs";
import {
  AudioWaveform,
  Settings,
  Sparkles,
} from "lucide-react";
import { fetchJobStatus, resolveApiAssetUrl, startProcessingJob } from "./lib/api";

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
  outputFilename?: string;
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
  normalize: boolean;
  compress: boolean;
  compressionLevel: "low" | "medium" | "high" | "extreme";
  metadata: Record<string, string>;
  preset?: string;
}

export default function App() {
  const [files, setFiles] = useState<AudioFile[]>([]);
  const [settings, setSettings] = useState<ConversionSettings>({
    format: "mp4",
    sensorType: "beep",
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

  const handleUrlAdded = (url: string, filename: string) => {
    const audioFile: AudioFile = {
      id: `${Date.now()}-url`,
      name: filename,
      size: 0,
      type: "audio/unknown",
      status: "error",
      progress: 100,
      url,
      errorMessage: "URL downloads are not wired to the processing API yet.",
    };
    setFiles((prev) => [...prev, audioFile]);
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
          errorMessage: undefined,
        });

        const job = await startProcessingJob(file.file, {
          format: settings.format,
          sensorType: settings.sensorType,
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

  const handleClearCompleted = () => {
    setFiles((prev) => {
      prev
        .filter((file) => file.status === "completed" && file.previewUrl?.startsWith("blob:"))
        .forEach((file) => {
          if (file.previewUrl) {
            URL.revokeObjectURL(file.previewUrl);
          }
        });
      return prev.filter((file) => file.status !== "completed");
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
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-950/50 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl">
              <AudioWaveform className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-slate-100">AI-Driven Video Sanitization</h1>
              <p className="text-slate-400 text-sm">
                Combining OpenAI Whisper with VBW Blacklisting
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-6 py-8">
        <Tabs defaultValue="convert" className="space-y-6">
          <TabsList className="bg-slate-900/50 border border-slate-800 hidden">
            <TabsTrigger
              value="convert"
              className="data-[state=active]:bg-violet-600"
            >
              <Settings className="w-4 h-4 mr-2" />
              Convert Files
            </TabsTrigger>
            <TabsTrigger
              value="download"
              className="data-[state=active]:bg-violet-600"
            >
              <AudioWaveform className="w-4 h-4 mr-2" />
              Download Audio
            </TabsTrigger>
            <TabsTrigger
              value="batch"
              className="data-[state=active]:bg-violet-600"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Batch Process
            </TabsTrigger>
          </TabsList>

          {/* Convert Tab */}
          <TabsContent value="convert" className="space-y-6">
            <div className="grid lg:grid-cols-3 gap-6">
              {/* Left Column - Upload & Presets */}
              <div className="lg:col-span-2 space-y-6">
                <FileUploadZone
                  onFilesAdded={handleFilesAdded}
                />
                {/* Quick Presets hidden */}
              </div>

              {/* Right Column - Settings */}
              <div className="space-y-6">
                <FormatSelector
                  settings={settings}
                  onSettingsChange={setSettings}
                />
              </div>
            </div>

            {/* Processing Queue */}
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
          </TabsContent>

          {/* Download Tab */}
          <TabsContent value="download">
            <DownloadSection
              settings={settings}
              onSettingsChange={setSettings}
              onUrlAdded={handleUrlAdded}
            />
          </TabsContent>

          {/* Batch Tab */}
          <TabsContent value="batch">
            <BatchProcessor
              settings={settings}
              onSettingsChange={setSettings}
              onFilesAdded={handleFilesAdded}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}