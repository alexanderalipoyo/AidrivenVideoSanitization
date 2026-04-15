import { useEffect, useMemo, useRef, useState } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import { Mic, MicOff, Pause, Play, Settings, Square, Upload, X } from "lucide-react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { toast } from "sonner";

interface VoiceRecorderPanelProps {
  onRecordingReady: (file: File) => void;
  audioFormat?: string;
  pauseSignal?: number;
  onRecordingStateChange?: (state: { isRecording: boolean; isPaused: boolean }) => void;
}

const NEVER_ALLOW_KEY = "voice-record-mic-choice";

type PermissionChoice = "undecided" | "allow-session" | "never";
type AudioInputOption = {
  optionId: string;
  deviceId: string;
  label: string;
};

export function VoiceRecorderPanel({
  onRecordingReady,
  audioFormat = "mp3",
  pauseSignal,
  onRecordingStateChange,
}: VoiceRecorderPanelProps) {
  const MIN_TRIM_GAP_SECONDS = 0.1;

  const [permissionChoice, setPermissionChoice] = useState<PermissionChoice>(() => {
    if (typeof window === "undefined") {
      return "undecided";
    }
    return localStorage.getItem(NEVER_ALLOW_KEY) === "never" ? "never" : "undecided";
  });
  const [isCheckingDevices, setIsCheckingDevices] = useState(true);
  const [noMicrophoneFound, setNoMicrophoneFound] = useState(false);
  const [audioInputOptions, setAudioInputOptions] = useState<AudioInputOption[]>([]);
  const [selectedAudioInputOptionId, setSelectedAudioInputOptionId] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [recordedFile, setRecordedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewDurationSec, setPreviewDurationSec] = useState(0);
  const [trimStartSec, setTrimStartSec] = useState(0);
  const [trimEndSec, setTrimEndSec] = useState(0);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [previewSamples, setPreviewSamples] = useState<number[]>([]);
  const [isSavingPreview, setIsSavingPreview] = useState(false);
  const [isClosePreviewDialogOpen, setIsClosePreviewDialogOpen] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const waveformHistoryRef = useRef<number[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewTimelineRef = useRef<HTMLDivElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewDragRef = useRef<"start" | "end" | null>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const ffmpegIsLoadedRef = useRef(false);
  const ffmpegLoadPromiseRef = useRef<Promise<void> | null>(null);
  const accumulatedDurationMsRef = useRef(0);
  const activeSegmentStartMsRef = useRef<number | null>(null);
  const lastPauseSignalRef = useRef<number | undefined>(pauseSignal);

  const recordingMimeType = useMemo(() => {
    if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
      return "audio/webm";
    }

    if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
      return "audio/webm;codecs=opus";
    }
    if (MediaRecorder.isTypeSupported("audio/webm")) {
      return "audio/webm";
    }
    if (MediaRecorder.isTypeSupported("audio/mp4")) {
      return "audio/mp4";
    }
    return "";
  }, []);

  const audioFormatMap: Record<string, { extension: string; mimeType: string }> = {
    mp3: { extension: "mp3", mimeType: "audio/mpeg" },
    wav: { extension: "wav", mimeType: "audio/wav" },
    flac: { extension: "flac", mimeType: "audio/flac" },
    ogg: { extension: "ogg", mimeType: "audio/ogg" },
    aac: { extension: "aac", mimeType: "audio/aac" },
    m4a: { extension: "m4a", mimeType: "audio/mp4" },
  };

  const selectedAudioFormat = audioFormatMap[audioFormat] || audioFormatMap.mp3;

  const selectedAudioInput = useMemo(() => {
    if (!audioInputOptions.length) {
      return null;
    }

    return audioInputOptions.find((option) => option.optionId === selectedAudioInputOptionId)
      ?? audioInputOptions[0];
  }, [audioInputOptions, selectedAudioInputOptionId]);

  const ffmpegArgsByFormat: Record<string, string[]> = {
    mp3: ["-c:a", "libmp3lame", "-b:a", "192k"],
    wav: ["-c:a", "pcm_s16le"],
    flac: ["-c:a", "flac"],
    ogg: ["-c:a", "libvorbis", "-q:a", "5"],
    aac: ["-c:a", "aac", "-b:a", "192k"],
    m4a: ["-c:a", "aac", "-b:a", "192k"],
  };

  const extensionFromMimeType = (mimeType: string) => {
    if (mimeType.includes("webm")) {
      return "webm";
    }
    if (mimeType.includes("ogg")) {
      return "ogg";
    }
    if (mimeType.includes("mp4")) {
      return "m4a";
    }
    if (mimeType.includes("mpeg")) {
      return "mp3";
    }
    if (mimeType.includes("wav")) {
      return "wav";
    }
    return "webm";
  };

  const ensureFfmpegLoaded = async () => {
    if (ffmpegRef.current && ffmpegIsLoadedRef.current) {
      return ffmpegRef.current;
    }

    if (ffmpegLoadPromiseRef.current) {
      await ffmpegLoadPromiseRef.current;
      return ffmpegRef.current as FFmpeg;
    }

    const ffmpeg = ffmpegRef.current ?? new FFmpeg();
    ffmpegRef.current = ffmpeg;

    ffmpegLoadPromiseRef.current = (async () => {
      const basePath = import.meta.env.BASE_URL || "/";
      const normalizedBase = basePath.endsWith("/") ? basePath : `${basePath}/`;
      const coreURL = new URL(`${normalizedBase}node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js`, window.location.origin).toString();
      const wasmURL = new URL(`${normalizedBase}node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm`, window.location.origin).toString();

      await ffmpeg.load({
        coreURL,
        wasmURL,
      });
      ffmpegIsLoadedRef.current = true;
    })();

    await ffmpegLoadPromiseRef.current;
    return ffmpeg;
  };

  const transcodeToSelectedAudioFormat = async (inputFile: File) => {
    const ffmpeg = await ensureFfmpegLoaded();
    const sourceExt = extensionFromMimeType(inputFile.type) || "webm";
    const inputName = `input-${Date.now()}.${sourceExt}`;
    const outputName = `output-${Date.now()}.${selectedAudioFormat.extension}`;
    const codecArgs = ffmpegArgsByFormat[selectedAudioFormat.extension] || ffmpegArgsByFormat.mp3;

    await ffmpeg.writeFile(inputName, await fetchFile(inputFile));

    try {
      await ffmpeg.exec([
        "-i",
        inputName,
        ...codecArgs,
        outputName,
      ]);

      const outputData = await ffmpeg.readFile(outputName) as Uint8Array;
      const outputBytes = new Uint8Array(outputData);
      const outputBlob = new Blob([outputBytes], { type: selectedAudioFormat.mimeType });

      return new File(
        [outputBlob],
        `voice-recording-${formatRecordingFilenameDate()}.${selectedAudioFormat.extension}`,
        { type: selectedAudioFormat.mimeType },
      );
    } finally {
      try {
        await ffmpeg.deleteFile(inputName);
      } catch {
        // noop
      }
      try {
        await ffmpeg.deleteFile(outputName);
      } catch {
        // noop
      }
    }
  };

  const formatRecordingFilenameDate = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    // Keep filename filesystem-safe across OSes (Windows disallows ':').
    return `${year}-${month}-${day}-${hours}-${minutes}-${seconds}`;
  };

  const formatRecordingTime = (durationMs: number) => {
    const totalSeconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (totalSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  };

  const clearWaveformLoop = () => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  };

  const clampTime = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  const formatPreviewTime = (seconds: number) => {
    const safeSeconds = Math.max(0, seconds);
    const minutes = Math.floor(safeSeconds / 60)
      .toString()
      .padStart(2, "0");
    const secs = (safeSeconds % 60).toFixed(1).padStart(4, "0");
    return `${minutes}:${secs}`;
  };

  const timeToPercent = (timeSec: number) => {
    if (previewDurationSec <= 0) {
      return 0;
    }
    return (timeSec / previewDurationSec) * 100;
  };

  const buildPreviewSamples = async (file: File) => {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      return;
    }

    try {
      const ctx = new AudioCtx();
      const arrayBuffer = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));

      const channelData = decoded.numberOfChannels > 0
        ? decoded.getChannelData(0)
        : new Float32Array(0);

      const bucketCount = 320;
      const blockSize = Math.max(1, Math.floor(channelData.length / bucketCount));
      const samples = new Array(bucketCount).fill(0).map((_, i) => {
        const start = i * blockSize;
        const end = Math.min(channelData.length, start + blockSize);
        let sumSquares = 0;

        for (let s = start; s < end; s += 1) {
          const v = channelData[s];
          sumSquares += v * v;
        }

        const rms = Math.sqrt(sumSquares / Math.max(1, end - start));
        return clampTime(rms * 2.8, 0.02, 1);
      });

      setPreviewSamples(samples);
      void ctx.close();
    } catch {
      setPreviewSamples([]);
    }
  };

  const encodeWav = (audioBuffer: AudioBuffer) => {
    const numberOfChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const numSamples = audioBuffer.length;
    const bytesPerSample = 2;
    const blockAlign = numberOfChannels * bytesPerSample;
    const buffer = new ArrayBuffer(44 + numSamples * blockAlign);
    const view = new DataView(buffer);

    const writeString = (offset: number, value: string) => {
      for (let i = 0; i < value.length; i += 1) {
        view.setUint8(offset + i, value.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + numSamples * blockAlign, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, numSamples * blockAlign, true);

    let offset = 44;
    for (let i = 0; i < numSamples; i += 1) {
      for (let ch = 0; ch < numberOfChannels; ch += 1) {
        const sample = clampTime(audioBuffer.getChannelData(ch)[i], -1, 1);
        const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        view.setInt16(offset, int16, true);
        offset += 2;
      }
    }

    return new Blob([buffer], { type: "audio/wav" });
  };

  const clearRecordingTimer = () => {
    if (timerIntervalRef.current !== null) {
      window.clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  const teardownAudioVisualization = () => {
    clearWaveformLoop();
    analyserRef.current = null;

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
  };

  const drawWaveform = () => {
    const analyser = analyserRef.current;
    const canvas = waveformCanvasRef.current;

    if (!analyser || !canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;

    const nextWidth = Math.floor(width * dpr);
    const nextHeight = Math.floor(height * dpr);
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const timeDomainData = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(timeDomainData);

    const centerY = height / 2;
    const pointCount = Math.max(140, Math.floor(width / 3));

    context.clearRect(0, 0, width, height);

    const backgroundGradient = context.createLinearGradient(0, 0, 0, height);
    backgroundGradient.addColorStop(0, "rgba(7, 13, 28, 0.95)");
    backgroundGradient.addColorStop(0.5, "rgba(4, 11, 25, 0.95)");
    backgroundGradient.addColorStop(1, "rgba(2, 8, 20, 0.98)");
    context.fillStyle = backgroundGradient;
    context.fillRect(0, 0, width, height);

    context.strokeStyle = "rgba(34, 211, 238, 0.26)";
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(0, centerY);
    context.lineTo(width, centerY);
    context.stroke();

    if (waveformHistoryRef.current.length !== pointCount) {
      waveformHistoryRef.current = new Array(pointCount).fill(0);
    }

    // Compute current signal energy and append to history for left-scrolling progress.
    let sumSquares = 0;
    for (let i = 0; i < timeDomainData.length; i += 1) {
      const centered = (timeDomainData[i] - 128) / 128;
      sumSquares += centered * centered;
    }
    const rms = Math.sqrt(sumSquares / timeDomainData.length);
    const amplitude = Math.min(1, rms * 3.4);

    const history = waveformHistoryRef.current;
    history.push(amplitude);
    if (history.length > pointCount) {
      history.shift();
    }

    const xStep = width / (pointCount - 1);
    const maxWaveHeight = height * 0.36;

    const fillGradient = context.createLinearGradient(0, 0, 0, height);
    fillGradient.addColorStop(0, "rgba(16, 185, 129, 0.85)");
    fillGradient.addColorStop(0.5, "rgba(45, 212, 191, 0.78)");
    fillGradient.addColorStop(1, "rgba(16, 185, 129, 0.85)");

    context.shadowColor = "rgba(45, 212, 191, 0.5)";
    context.shadowBlur = 10;
    context.fillStyle = fillGradient;
    context.beginPath();
    context.moveTo(0, centerY);

    for (let i = 0; i < history.length; i += 1) {
      const smoothed = i > 0 ? (history[i - 1] + history[i]) / 2 : history[i];
      const y = centerY - (smoothed * maxWaveHeight);
      context.lineTo(i * xStep, y);
    }

    for (let i = history.length - 1; i >= 0; i -= 1) {
      const smoothed = i < history.length - 1 ? (history[i + 1] + history[i]) / 2 : history[i];
      const y = centerY + (smoothed * maxWaveHeight);
      context.lineTo(i * xStep, y);
    }

    context.closePath();
    context.fill();

    context.shadowBlur = 0;

    const waveGradient = context.createLinearGradient(0, 0, width, 0);
    waveGradient.addColorStop(0, "rgba(94, 234, 212, 0.25)");
    waveGradient.addColorStop(0.5, "rgba(45, 212, 191, 0.95)");
    waveGradient.addColorStop(1, "rgba(94, 234, 212, 0.25)");
    context.strokeStyle = waveGradient;
    context.lineWidth = 1.6;
    context.beginPath();

    for (let i = 0; i < pointCount; i += 1) {
      const sampleIndex = Math.floor((i / pointCount) * timeDomainData.length);
      const normalized = (timeDomainData[sampleIndex] - 128) / 128;
      const x = i * xStep;
      const y = centerY + normalized * (height * 0.2);

      if (i === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }
    context.stroke();

    animationFrameRef.current = window.requestAnimationFrame(drawWaveform);
  };

  const startWaveformLoop = (resetHistory = true) => {
    clearWaveformLoop();
    if (resetHistory) {
      waveformHistoryRef.current = [];
    }
    animationFrameRef.current = window.requestAnimationFrame(drawWaveform);
  };

  const refreshAudioInputDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setAudioInputOptions([]);
      setSelectedAudioInputOptionId("");
      setNoMicrophoneFound(true);
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const microphones = devices.filter((device) => device.kind === "audioinput");
      const options = microphones.map((device, index) => ({
        optionId: device.deviceId || `audio-input-${index}`,
        deviceId: device.deviceId,
        label: device.label || `Microphone ${index + 1}`,
      }));

      setAudioInputOptions(options);
      setNoMicrophoneFound(options.length === 0);
      setSelectedAudioInputOptionId((currentSelection) => {
        if (currentSelection && options.some((option) => option.optionId === currentSelection)) {
          return currentSelection;
        }
        return options[0]?.optionId ?? "";
      });
    } catch {
      // If enumeration fails, keep the recorder available and handle errors on access.
      setAudioInputOptions([]);
      setSelectedAudioInputOptionId("");
      setNoMicrophoneFound(false);
    }
  };

  useEffect(() => {
    const checkMicrophoneAvailability = async () => {
      try {
        await refreshAudioInputDevices();
      } finally {
        setIsCheckingDevices(false);
      }
    };

    void checkMicrophoneAvailability();

    const handleDeviceChange = () => {
      void refreshAudioInputDevices();
    };

    navigator.mediaDevices?.addEventListener?.("devicechange", handleDeviceChange);

    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }

      clearRecordingTimer();
      teardownAudioVisualization();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [previewUrl]);

  useEffect(() => {
    onRecordingStateChange?.({ isRecording, isPaused });
  }, [isRecording, isPaused, onRecordingStateChange]);

  useEffect(() => {
    const audio = previewAudioRef.current;
    if (!audio) {
      return;
    }

    const handleLoadedMetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      setPreviewDurationSec(duration);
      setTrimStartSec(0);
      setTrimEndSec(duration);
      setPlayheadSec(0);
      audio.currentTime = 0;
    };

    const handleTimeUpdate = () => {
      if (audio.currentTime >= trimEndSec) {
        audio.pause();
        setIsPreviewPlaying(false);
        audio.currentTime = 0;
        setPlayheadSec(0);
        return;
      }
      setPlayheadSec(audio.currentTime);
    };

    const handleEnded = () => {
      setIsPreviewPlaying(false);
      audio.currentTime = 0;
      setPlayheadSec(0);
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [previewUrl, trimEndSec]);

  useEffect(() => {
    if (!recordedFile) {
      return;
    }
    void buildPreviewSamples(recordedFile);
  }, [recordedFile]);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || previewDurationSec <= 0) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;

    const nextWidth = Math.floor(width * dpr);
    const nextHeight = Math.floor(height * dpr);
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    context.clearRect(0, 0, width, height);

    const baseGradient = context.createLinearGradient(0, 0, 0, height);
    baseGradient.addColorStop(0, "rgba(34, 65, 133, 0.7)");
    baseGradient.addColorStop(1, "rgba(22, 45, 102, 0.95)");
    context.fillStyle = baseGradient;
    context.fillRect(0, 0, width, height);

    const centerY = height / 2;
    context.strokeStyle = "rgba(45, 212, 191, 0.8)";
    context.lineWidth = 1.4;
    context.beginPath();
    context.moveTo(0, centerY);
    context.lineTo(width, centerY);
    context.stroke();

    const values = previewSamples.length > 0 ? previewSamples : new Array(220).fill(0.03);
    const step = width / Math.max(1, values.length - 1);
    const maxHeight = height * 0.4;

    context.fillStyle = "rgba(16, 185, 129, 0.9)";
    for (let i = 0; i < values.length; i += 1) {
      const x = i * step;
      const half = values[i] * maxHeight;
      context.fillRect(x, centerY - half, 1.5, half * 2);
    }

    const trimStartX = (trimStartSec / previewDurationSec) * width;
    const trimEndX = (trimEndSec / previewDurationSec) * width;
    context.fillStyle = "rgba(8, 16, 45, 0.55)";
    context.fillRect(0, 0, trimStartX, height);
    context.fillRect(trimEndX, 0, width - trimEndX, height);
  }, [previewSamples, previewDurationSec, trimStartSec, trimEndSec]);

  const startRecording = async () => {
    if (permissionChoice === "never") {
      toast.error("Microphone access is blocked by your selection.");
      return;
    }

    if (permissionChoice !== "allow-session") {
      toast.error("Allow microphone access first.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setNoMicrophoneFound(true);
      return;
    }

    try {
      let stream: MediaStream;
      const selectedDeviceId = selectedAudioInput?.deviceId;

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: selectedDeviceId
            ? { deviceId: { exact: selectedDeviceId } }
            : true,
        });
      } catch (error) {
        const err = error as DOMException;
        if (selectedDeviceId && (err.name === "NotFoundError" || err.name === "OverconstrainedError")) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          setSelectedAudioInputOptionId("");
          toast("Selected microphone is unavailable. Using default input.");
        } else {
          throw error;
        }
      }

      streamRef.current = stream;
      chunksRef.current = [];
      setIsPaused(false);
      accumulatedDurationMsRef.current = 0;
      activeSegmentStartMsRef.current = Date.now();
      setRecordingElapsedMs(0);

      clearRecordingTimer();
      timerIntervalRef.current = window.setInterval(() => {
        const runningSegmentMs = activeSegmentStartMsRef.current
          ? Date.now() - activeSegmentStartMsRef.current
          : 0;
        setRecordingElapsedMs(accumulatedDurationMsRef.current + runningSegmentMs);
      }, 200);

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const audioContext = new AudioCtx();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        analyser.minDecibels = -90;
        analyser.maxDecibels = -10;
        analyser.smoothingTimeConstant = 0.85;
        const sourceNode = audioContext.createMediaStreamSource(stream);
        sourceNode.connect(analyser);
        audioContextRef.current = audioContext;
        analyserRef.current = analyser;
        startWaveformLoop(true);
      }

      const recorder = new MediaRecorder(
        stream,
        recordingMimeType ? { mimeType: recordingMimeType } : undefined,
      );
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        if (activeSegmentStartMsRef.current) {
          accumulatedDurationMsRef.current += Date.now() - activeSegmentStartMsRef.current;
          activeSegmentStartMsRef.current = null;
        }

        clearRecordingTimer();
        setRecordingElapsedMs(accumulatedDurationMsRef.current);

        const recordingType = recordingMimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: recordingType });
        const file = new File(
          [blob],
          `voice-recording-${formatRecordingFilenameDate()}.${extensionFromMimeType(recordingType)}`,
          { type: recordingType },
        );

        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
        }

        const nextPreviewUrl = URL.createObjectURL(blob);
        setPreviewUrl(nextPreviewUrl);
        setRecordedFile(file);

        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        teardownAudioVisualization();
        setIsPaused(false);
        setIsRecording(false);
      };

      recorder.start();
      setPermissionChoice("allow-session");
      setIsRecording(true);
      toast.success("Recording started");
    } catch (error) {
      const err = error as DOMException;

      if (err?.name === "NotFoundError") {
        setNoMicrophoneFound(true);
      }

      if (err?.name === "NotAllowedError") {
        toast.error("Microphone permission was denied by the browser.");
      } else {
        toast.error("Unable to start recording.");
      }
    }
  };

  const allowMicrophoneForSession = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setNoMicrophoneFound(true);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setPermissionChoice("allow-session");
      await refreshAudioInputDevices();
      toast.success("Microphone access allowed for this session.");
    } catch (error) {
      const err = error as DOMException;

      if (err?.name === "NotFoundError") {
        setNoMicrophoneFound(true);
        return;
      }

      if (err?.name === "NotAllowedError") {
        toast.error("Microphone permission was denied by the browser.");
      } else {
        toast.error("Unable to request microphone permission.");
      }
    }
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") {
      return;
    }
    mediaRecorderRef.current.stop();
  };

  const pauseRecordingIfActive = () => {
    const recorder = mediaRecorderRef.current;

    if (!recorder || recorder.state !== "recording") {
      return;
    }

    recorder.pause();

    if (activeSegmentStartMsRef.current) {
      accumulatedDurationMsRef.current += Date.now() - activeSegmentStartMsRef.current;
      activeSegmentStartMsRef.current = null;
    }

    setRecordingElapsedMs(accumulatedDurationMsRef.current);
    setIsPaused(true);
    clearWaveformLoop();
  };

  const togglePauseRecording = () => {
    const recorder = mediaRecorderRef.current;

    if (!recorder || recorder.state === "inactive") {
      return;
    }

    if (recorder.state === "recording") {
      pauseRecordingIfActive();
      return;
    }

    if (recorder.state === "paused") {
      recorder.resume();
      activeSegmentStartMsRef.current = Date.now();
      setIsPaused(false);
      startWaveformLoop(false);
    }
  };

  useEffect(() => {
    if (pauseSignal === undefined) {
      return;
    }

    if (lastPauseSignalRef.current === pauseSignal) {
      return;
    }

    lastPauseSignalRef.current = pauseSignal;

    if (isRecording && !isPaused) {
      pauseRecordingIfActive();
    }
  }, [isPaused, isRecording, pauseSignal]);

  const setNeverAllow = () => {
    localStorage.setItem(NEVER_ALLOW_KEY, "never");
    setPermissionChoice("never");

    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    clearRecordingTimer();
    teardownAudioVisualization();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setIsPaused(false);
    activeSegmentStartMsRef.current = null;
    accumulatedDurationMsRef.current = 0;
    setRecordingElapsedMs(0);
  };

  const resetPermissionChoice = () => {
    localStorage.removeItem(NEVER_ALLOW_KEY);
    setPermissionChoice("undecided");
    toast.success("Microphone permission choice reset.");
  };

  const clearRecording = () => {
    const audio = previewAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewDurationSec(0);
    setTrimStartSec(0);
    setTrimEndSec(0);
    setPlayheadSec(0);
    setIsPreviewPlaying(false);
    setPreviewSamples([]);
    setPreviewUrl(null);
    setRecordedFile(null);
  };

  const confirmClosePreview = () => {
    clearRecording();
    setIsClosePreviewDialogOpen(false);
  };

  const movePlayheadFromClientX = (clientX: number) => {
    if (!previewTimelineRef.current || previewDurationSec <= 0) {
      return;
    }

    const rect = previewTimelineRef.current.getBoundingClientRect();
    const ratio = clampTime((clientX - rect.left) / rect.width, 0, 1);
    const nextTime = ratio * previewDurationSec;
    const clamped = clampTime(nextTime, trimStartSec, trimEndSec);
    setPlayheadSec(clamped);

    const audio = previewAudioRef.current;
    if (audio) {
      audio.currentTime = clamped;
    }
  };

  const startDraggingHandle = (event: React.PointerEvent<HTMLDivElement>, handle: "start" | "end") => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    previewDragRef.current = handle;
  };

  const stopDraggingHandle = () => {
    previewDragRef.current = null;
  };

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const dragging = previewDragRef.current;
      if (!dragging || !previewTimelineRef.current || previewDurationSec <= 0) {
        return;
      }

      const rect = previewTimelineRef.current.getBoundingClientRect();
      const ratio = clampTime((event.clientX - rect.left) / rect.width, 0, 1);
      const nextTime = ratio * previewDurationSec;

      if (dragging === "start") {
        const nextStart = clampTime(nextTime, 0, Math.max(0, trimEndSec - MIN_TRIM_GAP_SECONDS));
        setTrimStartSec(nextStart);
        if (playheadSec < nextStart) {
          setPlayheadSec(nextStart);
        }
      } else {
        const nextEnd = clampTime(nextTime, trimStartSec + MIN_TRIM_GAP_SECONDS, previewDurationSec);
        setTrimEndSec(nextEnd);
        if (playheadSec > nextEnd) {
          setPlayheadSec(nextEnd);
        }
      }
    };

    const handleUp = () => {
      stopDraggingHandle();
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [previewDurationSec, trimStartSec, trimEndSec, playheadSec]);

  const togglePreviewPlayback = async () => {
    const audio = previewAudioRef.current;
    if (!audio || previewDurationSec <= 0) {
      return;
    }

    if (isPreviewPlaying) {
      audio.pause();
      setIsPreviewPlaying(false);
      return;
    }

    if (audio.readyState < 1) {
      await new Promise<void>((resolve) => {
        const onReady = () => {
          audio.removeEventListener("loadedmetadata", onReady);
          resolve();
        };
        audio.addEventListener("loadedmetadata", onReady);
        audio.load();
      });
    }

    const safeStart = trimEndSec - trimStartSec <= MIN_TRIM_GAP_SECONDS
      ? trimStartSec
      : clampTime(playheadSec, trimStartSec, trimEndSec - 0.02);
    audio.currentTime = safeStart;
    audio.volume = 1;

    try {
      await audio.play();
      setIsPreviewPlaying(true);
      setPlayheadSec(audio.currentTime);
    } catch {
      toast.error("Unable to play recording preview.");
    }
  };

  const addRecordingToQueue = async () => {
    if (!recordedFile) {
      return;
    }

    setIsSavingPreview(true);

    try {
      const fullSelection = previewDurationSec <= 0
        || (trimStartSec <= 0.01 && trimEndSec >= previewDurationSec - 0.01);

      if (fullSelection) {
        const transcodedFull = await transcodeToSelectedAudioFormat(recordedFile);
        onRecordingReady(transcodedFull);
        toast.success("Recording saved to queue");
        return;
      }

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) {
        throw new Error("Audio editing is unavailable in this browser.");
      }

      const ctx = new AudioCtx();
      const sourceBuffer = await ctx.decodeAudioData((await recordedFile.arrayBuffer()).slice(0));

      const sampleRate = sourceBuffer.sampleRate;
      const startSample = Math.floor(trimStartSec * sampleRate);
      const endSample = Math.floor(trimEndSec * sampleRate);
      const length = Math.max(1, endSample - startSample);
      const channels = sourceBuffer.numberOfChannels;
      const trimmed = ctx.createBuffer(channels, length, sampleRate);

      for (let ch = 0; ch < channels; ch += 1) {
        const source = sourceBuffer.getChannelData(ch).subarray(startSample, endSample);
        trimmed.copyToChannel(source, ch, 0);
      }

      const wavBlob = encodeWav(trimmed);
      const trimmedWavFile = new File(
        [wavBlob],
        `voice-recording-${formatRecordingFilenameDate()}.wav`,
        { type: "audio/wav" },
      );

      const transcodedTrimmed = await transcodeToSelectedAudioFormat(trimmedWavFile);

      onRecordingReady(transcodedTrimmed);
      toast.success("Trimmed recording saved to queue");
      void ctx.close();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save trimmed recording.");
    } finally {
      setIsSavingPreview(false);
    }
  };

  return (
    <div>
      <Card className={`${previewUrl ? "space-y-1" : "space-y-5"} border-slate-800 bg-slate-900/70 p-6`}>
        <div className={`${previewUrl ? "space-y-0" : "space-y-1"}`}>
          <h3 className="text-slate-100">Voice record</h3>
          <p className={`text-sm text-slate-400 ${previewUrl ? "mb-0" : ""}`}>
            Record straight from your microphone and send the clip to the sanitizer queue.
          </p>
        </div>

        {isCheckingDevices ? (
          <p className="text-sm text-slate-400">Detecting microphone...</p>
        ) : noMicrophoneFound ? (
          <Alert className="border-amber-600/50 bg-amber-950/30 text-amber-200">
            <MicOff className="h-4 w-4" />
            <AlertTitle>Microphone unavailable</AlertTitle>
            <AlertDescription>No microphone found. Audio recording is unavailable.</AlertDescription>
          </Alert>
        ) : (
          <>
            {permissionChoice === "undecided" && (
              <Alert className="border-cyan-500/40 bg-cyan-950/20 text-cyan-100">
                <Mic className="h-4 w-4" />
                <AlertTitle className="text-center">Microphone permission</AlertTitle>
                <AlertDescription className="mt-2 flex flex-wrap justify-center gap-2 text-center">
                  <Button type="button" onClick={allowMicrophoneForSession} className="bg-cyan-600 hover:bg-cyan-500">
                    Allow this time
                  </Button>
                  <Button type="button" variant="outline" onClick={setNeverAllow}>
                    Never allow
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {permissionChoice === "never" ? (
              <Alert className="border-rose-500/40 bg-rose-950/20 text-rose-100">
                <MicOff className="h-4 w-4" />
                <AlertTitle className="text-center">Microphone access blocked</AlertTitle>
                <AlertDescription className="mt-3 flex flex-col items-center gap-3 text-center">
                  <p className="max-w-md">You selected "Never allow" for this site session.</p>
                  <div className="w-full flex justify-center">
                    <Button type="button" variant="outline" onClick={resetPermissionChoice} className="min-w-44">
                      Change permission
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            ) : permissionChoice === "allow-session" ? (
              <div className="space-y-3">
                {!isRecording && !previewUrl ? (
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center">
                    <div />
                    <div className="justify-self-center flex flex-col items-center gap-1">
                      <Button
                        type="button"
                        onClick={startRecording}
                        className="h-14 w-14 rounded-full bg-violet-600 p-0 hover:bg-violet-500"
                        aria-label="Start recording"
                        title="Start recording"
                      >
                        <Mic className="h-6 w-6" />
                      </Button>
                    </div>

                    <div className="justify-self-end flex flex-col items-center gap-1">
                      <DropdownMenu onOpenChange={(open) => {
                        if (open) {
                          void refreshAudioInputDevices();
                        }
                      }}>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-14 w-14 rounded-full border-slate-600 bg-slate-900/70 p-0 text-slate-200 hover:bg-slate-800"
                            aria-label="Microphone settings"
                            title="Microphone settings"
                          >
                            <Settings className="h-5 w-5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="w-[320px] border-slate-700 bg-slate-900 text-slate-100"
                        >
                          <DropdownMenuLabel className="text-slate-100">Microphone</DropdownMenuLabel>
                          <DropdownMenuSeparator className="bg-slate-700" />

                          {audioInputOptions.length > 0 ? (
                            <DropdownMenuRadioGroup
                              value={selectedAudioInput?.optionId || audioInputOptions[0].optionId}
                              onValueChange={setSelectedAudioInputOptionId}
                            >
                              {audioInputOptions.map((option) => (
                                <DropdownMenuRadioItem
                                  key={option.optionId}
                                  value={option.optionId}
                                  className="text-slate-200"
                                >
                                  {option.label}
                                </DropdownMenuRadioItem>
                              ))}
                            </DropdownMenuRadioGroup>
                          ) : (
                            <DropdownMenuItem disabled className="text-slate-400">
                              No microphone detected
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ) : isRecording ? (
                  <>
                    <div className="flex items-center justify-center gap-2 text-sm text-slate-200">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-500/20 text-cyan-100">
                        {isPaused ? <Pause className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                      </span>
                      <span>{isPaused ? "Paused" : "Recording"}</span>
                    </div>

                    <div className="relative overflow-hidden rounded-xl border border-cyan-500/25 bg-slate-950/80 p-1">
                      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.18),transparent_62%)]" />
                      <canvas
                        ref={waveformCanvasRef}
                        className="relative h-32 w-full rounded-lg border border-slate-800/80"
                        aria-label="Live recording waveform"
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-center gap-3">
                      <Button
                        type="button"
                        onClick={togglePauseRecording}
                        variant="outline"
                        className="border-cyan-400/70 bg-cyan-500/10 font-semibold text-cyan-100 hover:bg-cyan-500/20 hover:text-white"
                      >
                        {isPaused ? (
                          <>
                            <Play className="mr-2 h-4 w-4" />
                            Resume
                          </>
                        ) : (
                          <>
                            <Pause className="mr-2 h-4 w-4" />
                            Pause
                          </>
                        )}
                      </Button>

                      <Button
                        type="button"
                        onClick={stopRecording}
                        className="bg-rose-600 font-semibold text-white shadow-sm shadow-rose-900/50 hover:bg-rose-500"
                      >
                        <Square className="mr-2 h-4 w-4" />
                        Stop
                        <span className="ml-2 rounded-full bg-rose-950/55 px-2 py-0.5 font-mono text-rose-100">
                          {formatRecordingTime(recordingElapsedMs)}
                        </span>
                      </Button>
                    </div>
                  </>
                ) : null}

              </div>
            ) : null}

            {previewUrl && (
              <div className="w-full -mt-1 space-y-3 rounded-xl border border-slate-700/70 bg-gradient-to-b from-[#25357d] to-[#1e2d6c] p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-cyan-100">Recording preview</p>
                  <button
                    type="button"
                    onClick={() => setIsClosePreviewDialogOpen(true)}
                    className="rounded-full p-1.5 text-slate-300 hover:bg-slate-800/60 hover:text-white"
                    aria-label="Close preview"
                    title="Close preview"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <audio ref={previewAudioRef} src={previewUrl} preload="metadata" className="hidden" />

                <div className="space-y-2">
                  <div
                    ref={previewTimelineRef}
                    className="relative h-48 overflow-hidden rounded-lg border border-cyan-500/30 bg-[#203b79]"
                    onClick={(event) => movePlayheadFromClientX(event.clientX)}
                  >
                    <canvas ref={previewCanvasRef} className="absolute inset-0 h-full w-full" />

                    {previewDurationSec > 0 && (
                      <>
                        <div
                          className="group absolute top-0 z-20 h-full w-4 -translate-x-1/2 cursor-ew-resize touch-none"
                          style={{ left: `${timeToPercent(trimStartSec)}%` }}
                          onPointerDown={(event) => startDraggingHandle(event, "start")}
                        >
                          <div className="mx-auto h-full w-[5px] rounded-full bg-cyan-300 shadow-[0_0_16px_rgba(34,211,238,0.95)]" />
                          <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900/90 px-2 py-0.5 text-[11px] text-cyan-100 opacity-0 transition-opacity group-hover:opacity-100">
                            Start {formatPreviewTime(trimStartSec)}
                          </div>
                        </div>
                        <div
                          className="group absolute top-0 z-20 h-full w-4 -translate-x-1/2 cursor-ew-resize touch-none"
                          style={{ left: `${timeToPercent(trimEndSec)}%` }}
                          onPointerDown={(event) => startDraggingHandle(event, "end")}
                        >
                          <div className="mx-auto h-full w-[5px] rounded-full bg-cyan-300 shadow-[0_0_16px_rgba(34,211,238,0.95)]" />
                          <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900/90 px-2 py-0.5 text-[11px] text-cyan-100 opacity-0 transition-opacity group-hover:opacity-100">
                            End {formatPreviewTime(trimEndSec)}
                          </div>
                        </div>

                        <div
                          className="pointer-events-none absolute top-0 h-full w-px bg-white/95"
                          style={{ left: `${timeToPercent(playheadSec)}%` }}
                        />

                        <div
                          className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded bg-slate-900/85 px-2 py-0.5 text-xs text-cyan-100"
                          style={{ left: `${timeToPercent(playheadSec)}%` }}
                        >
                          {formatPreviewTime(playheadSec)}
                        </div>

                        <div className="pointer-events-none absolute bottom-1 left-2 text-xs text-cyan-300">
                          {formatPreviewTime(trimStartSec)}
                        </div>
                        <div className="pointer-events-none absolute bottom-1 right-2 text-xs text-cyan-300">
                          {formatPreviewTime(trimEndSec)}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <Button
                    type="button"
                    onClick={togglePreviewPlayback}
                    className="min-w-32 rounded-full border border-cyan-300/40 bg-gradient-to-r from-cyan-500/25 to-sky-500/25 font-semibold text-cyan-50 shadow-[0_6px_20px_rgba(34,211,238,0.28)] hover:from-cyan-400/35 hover:to-sky-400/35"
                  >
                    {isPreviewPlaying ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
                    {isPreviewPlaying ? "Pause" : "Play"}
                  </Button>

                  <Button
                    type="button"
                    onClick={addRecordingToQueue}
                    disabled={isSavingPreview}
                    className="min-w-32 rounded-full bg-gradient-to-r from-emerald-300 to-teal-300 font-semibold text-slate-900 shadow-[0_8px_24px_rgba(16,185,129,0.35)] hover:from-emerald-200 hover:to-teal-200 disabled:opacity-70"
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    {isSavingPreview ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            )}

            <AlertDialog open={isClosePreviewDialogOpen} onOpenChange={setIsClosePreviewDialogOpen}>
              <AlertDialogContent className="border-slate-800 bg-slate-950 text-slate-100">
                <AlertDialogHeader>
                  <AlertDialogTitle>Close recording preview?</AlertDialogTitle>
                  <AlertDialogDescription className="text-slate-400">
                    This will discard the current preview and return to the record button.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white">
                    No, keep preview
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={confirmClosePreview}
                    className="bg-rose-600 text-white hover:bg-rose-500"
                  >
                    Yes, close preview
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </Card>
    </div>
  );
}
