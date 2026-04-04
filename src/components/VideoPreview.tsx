import { useRef, useState } from 'react';
import { Video, Eye, EyeOff } from 'lucide-react';
import type { AudioFile } from '../App';
import { WordTimestamps } from './WordTimestamps';

interface VideoPreviewProps {
  file: AudioFile;
  isCensored?: boolean;
}

export function VideoPreview({ file, isCensored = false }: VideoPreviewProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaUrl = isCensored ? file.outputUrl : file.previewUrl;
  const mediaType = isCensored ? file.outputMimeType : file.type;
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
    if (!mediaElement) {
      return;
    }

    mediaElement.pause();
    mediaElement.currentTime = time;
    setCurrentTime(time);
  };

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-4">
        {isCensored ? (
          <>
            <EyeOff className="w-4 h-4 text-violet-400" />
            <h4 className="text-slate-200 text-sm font-medium">Censored Video Preview</h4>
            <span className="ml-auto text-xs px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Safe for viewing
            </span>
          </>
        ) : (
          <>
            <Eye className="w-4 h-4 text-violet-400" />
            <h4 className="text-slate-200 text-sm font-medium">Uncensored Video Preview</h4>
            <span className="ml-auto text-xs px-2 py-1 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20">
              Original content
            </span>
          </>
        )}
      </div>
      
      <div className="bg-slate-950 rounded-lg overflow-hidden aspect-video flex items-center justify-center relative">
        {mediaUrl && isVideo ? (
          <>
            <video
              ref={videoRef}
              src={mediaUrl}
              controls
              className="w-full h-full object-contain bg-black"
              onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
              onSeeked={(event) => setCurrentTime(event.currentTarget.currentTime)}
              onLoadedMetadata={() => setCurrentTime(0)}
            />
            {renderSubtitle()}
          </>
        ) : mediaUrl && isAudio ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-4 px-6 text-center">
            <Video className="w-16 h-16 text-slate-700" />
            <div>
              <p className="text-slate-300 text-sm">{isCensored ? 'Sanitized' : 'Original'} audio preview</p>
              <p className="text-slate-600 text-xs mt-1">{file.name}</p>
            </div>
            <audio
              ref={audioRef}
              src={mediaUrl}
              controls
              className="w-full max-w-lg"
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