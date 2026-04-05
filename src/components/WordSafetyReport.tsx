import { useState } from 'react';
import { Card } from './ui/card';
import { Shield, AlertTriangle, CheckCircle, LoaderCircle } from 'lucide-react';
import type { AudioFile } from '../App';
import { fetchDictionaryDefinition } from '../lib/api';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

type DefinitionState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  definition?: string;
  partOfSpeech?: string;
  source?: string;
  errorMessage?: string;
};

const definitionCache: Record<string, DefinitionState> = {};

interface DictionaryTooltipWordProps {
  term: string;
  language: string;
  displayText?: string;
  className?: string;
}

function DictionaryTooltipWord({ term, language, displayText, className }: DictionaryTooltipWordProps) {
  const cacheKey = `${language.toLocaleLowerCase()}:${term.toLocaleLowerCase()}`;
  const [definitionState, setDefinitionState] = useState<DefinitionState>(definitionCache[cacheKey] ?? { status: 'idle' });

  const loadDefinition = async () => {
    const cachedEntry = definitionCache[cacheKey];
    if (cachedEntry && cachedEntry.status !== 'idle' && cachedEntry.status !== 'error') {
      setDefinitionState(cachedEntry);
      return;
    }

    const loadingState: DefinitionState = { status: 'loading' };
    definitionCache[cacheKey] = loadingState;
    setDefinitionState(loadingState);

    try {
      const response = await fetchDictionaryDefinition(term, language);
      const readyState: DefinitionState = {
        status: 'ready',
        definition: response.definition,
        partOfSpeech: response.part_of_speech,
        source: response.source,
      };
      definitionCache[cacheKey] = readyState;
      setDefinitionState(readyState);
    } catch (error) {
      const errorState: DefinitionState = {
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Definition not available.',
      };
      setDefinitionState(errorState);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={className}
          onMouseEnter={() => {
            void loadDefinition();
          }}
          onFocus={() => {
            void loadDefinition();
          }}
          tabIndex={0}
        >
          {displayText ?? term}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8} className="max-w-xs border border-slate-700 bg-slate-900 text-slate-100 shadow-xl">
        {definitionState.status === 'ready' ? (
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300">
              {definitionState.partOfSpeech || 'Meaning'}
            </div>
            <div className="text-sm leading-5 text-slate-100">{definitionState.definition}</div>
          </div>
        ) : definitionState.status === 'error' ? (
          <div className="text-sm leading-5 text-rose-200">{definitionState.errorMessage || 'Definition not available.'}</div>
        ) : definitionState.status === 'loading' ? (
          <div className="flex items-center gap-2 text-sm text-slate-200">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Loading meaning...
          </div>
        ) : (
          <div className="text-sm text-slate-200">Hover to load meaning.</div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

interface WordSafetyReportProps {
  file: AudioFile;
  showHeader?: boolean;
}

export function WordSafetyReport({ file, showHeader = true }: WordSafetyReportProps) {
  if (!file.safetyReport) {
    return null;
  }

  const profaneCount = file.safetyReport.filter(w => w.is_profane).length;

  return (
    <div className="p-4">
      {showHeader && (
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-violet-400" />
            <h4 className="text-slate-200 text-sm font-medium">Word Safety Report</h4>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {profaneCount > 0 ? (
              <>
                <AlertTriangle className="w-3 h-3 text-amber-400" />
                <span className="text-amber-400">{profaneCount} profane word{profaneCount !== 1 ? 's' : ''} detected</span>
              </>
            ) : (
              <>
                <CheckCircle className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">No profanity detected</span>
              </>
            )}
          </div>
        </div>
      )}
      
      <div className="bg-slate-950 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left px-4 py-3 text-slate-400 font-medium">#</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Word</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Start</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">End</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Is Profane</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Matched Profanity</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Language</th>
              </tr>
            </thead>
            <tbody>
              {file.safetyReport.map((item, index) => (
                <tr 
                  key={index} 
                  className={`border-b border-slate-800/50 ${item.is_profane ? 'bg-red-950/20' : ''}`}
                >
                  <td className="px-4 py-3 text-slate-500">{index}</td>
                  <td className="px-4 py-3 text-slate-200 font-medium">
                    {item.is_profane && item.matched_profanity_language ? (
                      <DictionaryTooltipWord
                        term={item.matched_profanity || item.word}
                        language={item.matched_profanity_language}
                        displayText={item.word}
                        className="cursor-help break-all underline decoration-dotted underline-offset-4 text-red-200"
                      />
                    ) : (
                      item.word
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-300 font-mono">{item.start.toFixed(2)}s</td>
                  <td className="px-4 py-3 text-slate-300 font-mono">{item.end.toFixed(2)}s</td>
                  <td className="px-4 py-3">
                    {item.is_profane ? (
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-500/10 text-red-400 border border-red-500/20">
                        <AlertTriangle className="w-3 h-3" />
                        True
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <CheckCircle className="w-3 h-3" />
                        False
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {item.matched_profanity && item.matched_profanity_language ? (
                      <DictionaryTooltipWord
                        term={item.matched_profanity}
                        language={item.matched_profanity_language}
                        className="cursor-help break-all underline decoration-dotted underline-offset-4 text-cyan-100"
                      />
                    ) : (
                      <span className="text-slate-600">None</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {item.matched_profanity_language || <span className="text-slate-600">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}