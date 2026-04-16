import { useEffect, useMemo, useRef, useState } from 'react';
import { Video, Eye, EyeOff } from 'lucide-react';
import type { AudioFile } from '../App';
import { WordTimestamps } from './WordTimestamps';

interface VideoPreviewProps {
  file: AudioFile;
  isCensored?: boolean;
  showHeader?: boolean;
}

export function VideoPreview({ file, isCensored = false, showHeader = true }: VideoPreviewProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [audioWaveformSamples, setAudioWaveformSamples] = useState<number[]>([]);
  const [audioWaveformDuration, setAudioWaveformDuration] = useState(0);
  const [isWaveformLoading, setIsWaveformLoading] = useState(false);
  const [waveformError, setWaveformError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaUrl = isCensored ? (file.outputPreviewUrl ?? file.outputUrl) : file.previewUrl;
  const mediaType = isCensored ? (file.outputPreviewMimeType ?? file.outputMimeType) : file.type;
  const isVideo = mediaType?.startsWith('video/');
  const isAudio = mediaType?.startsWith('audio/');
  const words = file.transcription?.segments.flatMap((segment) => segment.words) ?? [];
  const activeWords = words.filter((word) => currentTime >= word.start && currentTime <= word.end);
  const subtitleWords = activeWords.length > 0 ? activeWords : words.filter((word) => {
    const delta = currentTime - word.end;
    return delta > 0 && delta < 0.12;
  });
  const subtitleText = subtitleWords.map((word) => word.word.trim()).join(' ');
  const profaneWords = new Set(
    (file.safetyReport ?? [])
      .filter((item) => item.is_profane)
      .map((item) => `${item.start.toFixed(2)}-${item.end.toFixed(2)}-${item.word.trim().toLowerCase()}`),
  );

  const waveformDuration = audioWaveformDuration > 0
    ? audioWaveformDuration
    : Math.max(0, ...words.map((word) => word.end));

  const profaneWordKeys = useMemo(
    () => new Set(
      (file.safetyReport ?? [])
        .filter((item) => item.is_profane)
        .map((item) => `${item.start.toFixed(2)}-${item.end.toFixed(2)}-${item.word.trim().toLowerCase()}`),
    ),
    [file.safetyReport],
  );

  const seekToTime = (time: number) => {
    const mediaElement = videoRef.current ?? audioRef.current;
    if (!mediaElement) {
      return;
    }

    const duration = Number.isFinite(mediaElement.duration) && mediaElement.duration > 0
      ? mediaElement.duration
      : waveformDuration;
    const clampedTime = Math.max(0, Math.min(time, duration || time));
    mediaElement.currentTime = clampedTime;
    setCurrentTime(clampedTime);
  };

  const seekFromWaveformClientX = (clientX: number) => {
    const canvas = waveformCanvasRef.current;
    if (!canvas || waveformDuration <= 0) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    seekToTime(ratio * waveformDuration);
  };

  const pauseOtherPreviewMedia = (activeMedia: HTMLMediaElement) => {
    const previewMediaElements = document.querySelectorAll(
      'audio[data-preview-media="true"], video[data-preview-media="true"]',
    );

    previewMediaElements.forEach((element) => {
      if (element instanceof HTMLMediaElement && element !== activeMedia && !element.paused) {
        element.pause();
      }
    });
  };

  const handleMediaPlay = (event: React.SyntheticEvent<HTMLMediaElement>) => {
    const activeMedia = event.currentTarget;
    pauseOtherPreviewMedia(activeMedia);
    setCurrentTime(activeMedia.currentTime);
  };

  const renderSubtitleWords = () => (
    subtitleWords.map((word, index) => {
      const normalizedKey = `${word.start.toFixed(2)}-${word.end.toFixed(2)}-${word.word.trim().toLowerCase()}`;
      const isProfaneWord = profaneWords.has(normalizedKey);
      const displayWord = isCensored && isProfaneWord ? '****' : word.word.trim();
      return (
        <span
          key={`${normalizedKey}-${index}`}
          className={isProfaneWord && !isCensored ? 'text-red-400' : 'text-white'}
        >
          {index > 0 ? ' ' : ''}
          {displayWord}
        </span>
      );
    })
  );

  const renderSubtitle = () => {
    if (!subtitleWords.length) {
      return null;
    }

    return (
      <div className="pointer-events-none absolute inset-x-4 bottom-20 px-4 text-center md:inset-x-6 md:bottom-24">
        <p className="text-sm font-medium leading-relaxed text-white md:text-base" style={{ textShadow: '0 2px 8px rgba(0, 0, 0, 0.9)' }}>
          {renderSubtitleWords()}
        </p>
      </div>
    );
  };

  const handleTimestampClick = (time: number) => {
    const mediaElement = videoRef.current ?? audioRef.current;
    mediaElement?.pause();
    seekToTime(time);
  };

  useEffect(() => {
    if (!mediaUrl || !isAudio) {
      setAudioWaveformSamples([]);
      setAudioWaveformDuration(0);
      setWaveformError(null);
      return;
    }

    let isDisposed = false;
    setIsWaveformLoading(true);
    setWaveformError(null);

    const loadWaveform = async () => {
      try {
        const response = await fetch(mediaUrl);
        if (!response.ok) {
          throw new Error('Waveform source is unavailable.');
        }

        const buffer = await response.arrayBuffer();
        const AudioContextCtor = window.AudioContext
          || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

        if (!AudioContextCtor) {
          throw new Error('This browser does not support waveform decoding.');
        }

        const audioContext = new AudioContextCtor();
        let decoded: AudioBuffer;

        try {
          decoded = await audioContext.decodeAudioData(buffer.slice(0));
        } finally {
          void audioContext.close();
        }

        if (isDisposed) {
          return;
        }

        const channelCount = Math.max(1, decoded.numberOfChannels);
        const bucketCount = 420;
        const blockSize = Math.max(1, Math.floor(decoded.length / bucketCount));
        const nextSamples = new Array(bucketCount).fill(0).map((_, index) => {
          const start = index * blockSize;
          const end = Math.min(decoded.length, start + blockSize);

          let peak = 0;
          for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
            let mixed = 0;
            for (let channel = 0; channel < channelCount; channel += 1) {
              mixed += decoded.getChannelData(channel)[sampleIndex] || 0;
            }
            const normalized = Math.abs(mixed / channelCount);
            if (normalized > peak) {
              peak = normalized;
            }
          }

          return Math.max(0.02, Math.min(1, peak));
        });

        setAudioWaveformSamples(nextSamples);
        setAudioWaveformDuration(decoded.duration);
      } catch (error) {
        if (isDisposed) {
          return;
        }

        setAudioWaveformSamples([]);
        setAudioWaveformDuration(0);
        setWaveformError(error instanceof Error ? error.message : 'Unable to render waveform.');
      } finally {
        if (!isDisposed) {
          setIsWaveformLoading(false);
        }
      }
    };

    void loadWaveform();

    return () => {
      isDisposed = true;
    };
  }, [isAudio, mediaUrl]);

  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas || !isAudio || audioWaveformSamples.length === 0 || waveformDuration <= 0) {
      return;
    }

    const context = canvas.getContext('2d');
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

    const backgroundGradient = context.createLinearGradient(0, 0, 0, height);
    backgroundGradient.addColorStop(0, 'rgba(34, 65, 133, 0.7)');
    backgroundGradient.addColorStop(1, 'rgba(22, 45, 102, 0.95)');
    context.fillStyle = backgroundGradient;
    context.fillRect(0, 0, width, height);

    const pxPerSecond = width / waveformDuration;
    const activeWordKey = subtitleWords.length > 0
      ? `${subtitleWords[0].start.toFixed(2)}-${subtitleWords[0].end.toFixed(2)}-${subtitleWords[0].word.trim().toLowerCase()}`
      : null;

    words.forEach((word) => {
      const key = `${word.start.toFixed(2)}-${word.end.toFixed(2)}-${word.word.trim().toLowerCase()}`;
      const startX = word.start * pxPerSecond;
      const endX = Math.max(startX + 1, word.end * pxPerSecond);
      const isProfane = profaneWordKeys.has(key);
      const isActive = activeWordKey === key;

      context.fillStyle = isActive
        ? 'rgba(34, 211, 238, 0.22)'
        : isProfane
          ? 'rgba(239, 68, 68, 0.18)'
          : 'rgba(8, 16, 45, 0.16)';
      context.fillRect(startX, 0, endX - startX, height);
    });

    const centerY = height / 2;
    context.strokeStyle = 'rgba(45, 212, 191, 0.8)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, centerY);
    context.lineTo(width, centerY);
    context.stroke();

    const values = audioWaveformSamples.length > 0 ? audioWaveformSamples : new Array(220).fill(0.03);
    const step = width / Math.max(1, values.length - 1);
    const maxHeight = height * 0.4;

    context.fillStyle = 'rgba(16, 185, 129, 0.9)';
    for (let index = 0; index < values.length; index += 1) {
      const x = index * step;
      const half = values[index] * maxHeight;
      context.fillRect(x, centerY - half, 1.5, half * 2);
    }

    const playheadX = Math.max(0, Math.min(width, currentTime * pxPerSecond));
    context.strokeStyle = 'rgba(248, 250, 252, 0.95)';
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(playheadX, 0);
    context.lineTo(playheadX, height);
    context.stroke();
  }, [
    audioWaveformSamples,
    currentTime,
    isAudio,
    profaneWordKeys,
    subtitleWords,
    waveformDuration,
    words,
  ]);

  return (
    <div className="p-4">
      {showHeader && (
        <div className="flex items-center gap-2 mb-4">
          {isCensored ? (
            <>
              <EyeOff className="w-4 h-4 text-violet-400" />
              <h4 className="text-slate-200 text-sm font-medium">Censored Media Preview</h4>
              <span className="ml-auto text-xs px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Safe for viewing
              </span>
            </>
          ) : (
            <>
              <Eye className="w-4 h-4 text-violet-400" />
              <h4 className="text-slate-200 text-sm font-medium">Uncensored Media Preview</h4>
              <span className="ml-auto text-xs px-2 py-1 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20">
                Original content
              </span>
            </>
          )}
        </div>
      )}
      
      <div className="bg-slate-950 rounded-lg overflow-hidden aspect-video flex items-center justify-center relative">
        {mediaUrl && isVideo ? (
          <>
            <video
              ref={videoRef}
              src={mediaUrl}
              controls
              data-preview-media="true"
              className="w-full h-full object-contain bg-black"
              onPlay={handleMediaPlay}
              onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
              onSeeked={(event) => setCurrentTime(event.currentTarget.currentTime)}
              onLoadedMetadata={() => setCurrentTime(0)}
            />
            {renderSubtitle()}
          </>
        ) : mediaUrl && isAudio ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="w-full max-w-4xl space-y-2">
              <div
                className="relative h-44 w-full overflow-hidden rounded-lg border border-cyan-500/30 bg-[#203b79]"
                onClick={(event) => seekFromWaveformClientX(event.clientX)}
              >
                <canvas ref={waveformCanvasRef} className="absolute inset-0 h-full w-full" />
                {(isWaveformLoading || waveformError || audioWaveformSamples.length === 0) && (
                  <div className="absolute inset-0 flex items-center justify-center bg-[#1a2c63]/80 px-4 text-center">
                    <p className="text-xs text-slate-300">
                      {isWaveformLoading
                        ? 'Decoding audio waveform...'
                        : waveformError || 'Waveform is unavailable for this source.'}
                    </p>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Click waveform to seek</span>
                <span>{file.name}</span>
              </div>
            </div>
            <audio
              ref={audioRef}
              src={mediaUrl}
              controls
              data-preview-media="true"
              className="w-full max-w-lg"
              onPlay={handleMediaPlay}
              onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
              onSeeked={(event) => setCurrentTime(event.currentTarget.currentTime)}
              onLoadedMetadata={() => setCurrentTime(0)}
            />
            {subtitleText && (
              <div className="px-4 py-1 text-sm text-white" style={{ textShadow: '0 2px 8px rgba(0, 0, 0, 0.9)' }}>
                {renderSubtitleWords()}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center space-y-3">
            <Video className="w-16 h-16 text-slate-700 mx-auto" />
            <div>
              <p className="text-slate-400 text-sm">
                {isCensored ? 'Censored' : 'Original'} media preview
              </p>
              <p className="text-slate-600 text-xs mt-1">
                {file.name}
              </p>
            </div>
            {isCensored && (
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Sanitized output will appear here when processing completes.
              </p>
            )}
          </div>
        )}
      </div>

      {!isCensored && file.transcription && (
        <div className="mt-4 rounded-lg border border-slate-800/50 bg-slate-950/60 p-4">
          <h5 className="mb-3 text-sm font-medium text-slate-200">Word-level Timestamps</h5>
          <WordTimestamps
            file={file}
            currentTime={currentTime}
            onTimestampClick={handleTimestampClick}
          />
        </div>
      )}
    </div>
  );
}