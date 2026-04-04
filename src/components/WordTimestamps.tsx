import type { AudioFile } from '../App';

interface WordTimestampsProps {
  file: AudioFile;
  currentTime?: number;
  onTimestampClick?: (time: number) => void;
}

export function WordTimestamps({ file, currentTime, onTimestampClick }: WordTimestampsProps) {
  if (!file.transcription) {
    return null;
  }

  const allWords = file.transcription.segments.flatMap(segment => segment.words);
  const profaneWords = new Set(
    (file.safetyReport ?? [])
      .filter((item) => item.is_profane)
      .map((item) => `${item.start.toFixed(2)}-${item.end.toFixed(2)}-${item.word.trim().toLowerCase()}`),
  );

  return (
    <div className="flex flex-wrap gap-2">
      {allWords.map((word, index) => {
        const wordKey = `${word.start.toFixed(2)}-${word.end.toFixed(2)}-${word.word.trim().toLowerCase()}`;
        const isProfaneWord = profaneWords.has(wordKey);
        const isActiveWord = currentTime !== undefined && currentTime >= word.start && currentTime <= word.end;

        return (
          <button
            type="button"
            key={index}
            onClick={() => onTimestampClick?.(word.start)}
            className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs transition-colors ${
              isActiveWord
                ? 'border-violet-500/60 bg-violet-500/10'
                : isProfaneWord
                  ? 'border-red-500/40 bg-red-500/10 hover:border-red-400/60 hover:bg-red-500/15'
                  : 'border-slate-700/50 bg-slate-800/50 hover:border-slate-600 hover:bg-slate-800'
            }`}
          >
            <span className={`font-mono ${isProfaneWord ? 'text-red-300' : 'text-slate-500'}`}>
              [{word.start.toFixed(2)}s → {word.end.toFixed(2)}s]
            </span>
            <span className={isProfaneWord ? 'text-red-400' : 'text-slate-300'}>{word.word}</span>
          </button>
        );
      })}
    </div>
  );
}