import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';

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

export function DictionaryTooltipWord({ term, language, displayText, className }: DictionaryTooltipWordProps) {
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