import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Square, Trash2, Upload } from "lucide-react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { toast } from "sonner";

interface VoiceRecorderPanelProps {
  onRecordingReady: (file: File) => void;
}

const NEVER_ALLOW_KEY = "voice-record-mic-choice";

type PermissionChoice = "undecided" | "allow-session" | "never";

export function VoiceRecorderPanel({ onRecordingReady }: VoiceRecorderPanelProps) {
  const [permissionChoice, setPermissionChoice] = useState<PermissionChoice>(() => {
    if (typeof window === "undefined") {
      return "undecided";
    }
    return localStorage.getItem(NEVER_ALLOW_KEY) === "never" ? "never" : "undecided";
  });
  const [isCheckingDevices, setIsCheckingDevices] = useState(true);
  const [noMicrophoneFound, setNoMicrophoneFound] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedFile, setRecordedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

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

  useEffect(() => {
    const checkMicrophoneAvailability = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) {
        setNoMicrophoneFound(true);
        setIsCheckingDevices(false);
        return;
      }

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasMic = devices.some((device) => device.kind === "audioinput");
        setNoMicrophoneFound(!hasMic);
      } catch {
        // If enumeration fails, keep the recorder available and handle errors on access.
        setNoMicrophoneFound(false);
      } finally {
        setIsCheckingDevices(false);
      }
    };

    void checkMicrophoneAvailability();
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [previewUrl]);

  const startRecording = async () => {
    if (permissionChoice === "never") {
      toast.error("Microphone access is blocked by your selection.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setNoMicrophoneFound(true);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

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
        const type = recordingMimeType || "audio/webm";
        const extension = type.includes("mp4") ? "m4a" : "webm";
        const blob = new Blob(chunksRef.current, { type });
        const file = new File([blob], `voice-recording-${Date.now()}.${extension}`, { type });

        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
        }

        const nextPreviewUrl = URL.createObjectURL(blob);
        setPreviewUrl(nextPreviewUrl);
        setRecordedFile(file);

        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
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

  const stopRecording = () => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== "recording") {
      return;
    }
    mediaRecorderRef.current.stop();
  };

  const setNeverAllow = () => {
    localStorage.setItem(NEVER_ALLOW_KEY, "never");
    setPermissionChoice("never");

    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const clearRecording = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setRecordedFile(null);
  };

  const addRecordingToQueue = () => {
    if (!recordedFile) {
      return;
    }
    onRecordingReady(recordedFile);
    toast.success("Recording added to queue");
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="space-y-5 border-slate-800 bg-slate-900/70 p-6 lg:col-span-2">
        <div className="space-y-1">
          <h3 className="text-slate-100">Voice record</h3>
          <p className="text-sm text-slate-400">
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
                <AlertTitle>Microphone permission</AlertTitle>
                <AlertDescription className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" onClick={startRecording} className="bg-cyan-600 hover:bg-cyan-500">
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
                <AlertTitle>Microphone access blocked</AlertTitle>
                <AlertDescription>
                  You selected "Never allow" for this site session.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                {!isRecording ? (
                  <Button type="button" onClick={startRecording} className="bg-violet-600 hover:bg-violet-500">
                    <Mic className="mr-2 h-4 w-4" />
                    Start recording
                  </Button>
                ) : (
                  <Button type="button" onClick={stopRecording} className="bg-rose-600 hover:bg-rose-500">
                    <Square className="mr-2 h-4 w-4" />
                    Stop recording
                  </Button>
                )}

                <Button type="button" variant="outline" onClick={setNeverAllow}>
                  Never allow
                </Button>
              </div>
            )}

            {previewUrl && (
              <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/50 p-4">
                <p className="text-sm text-slate-300">Recording preview</p>
                <audio controls src={previewUrl} className="w-full" />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={addRecordingToQueue} className="bg-emerald-600 hover:bg-emerald-500">
                    <Upload className="mr-2 h-4 w-4" />
                    Add to queue
                  </Button>
                  <Button type="button" variant="outline" onClick={clearRecording}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Discard
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      <Card className="space-y-3 border-slate-800 bg-slate-900/70 p-6">
        <h4 className="text-slate-100">Permission options</h4>
        <p className="text-sm text-slate-400">
          Allow this time requests browser access once for recording.
        </p>
        <p className="text-sm text-slate-400">
          Never allow saves your choice locally and blocks recording in this app.
        </p>
      </Card>
    </div>
  );
}
