import { useEffect, useMemo, useRef, useState } from 'react';
import { Card } from './ui/card';
import { Shield, AlertTriangle, CheckCircle, Search } from 'lucide-react';
import type { AudioFile } from '../App';
import { DictionaryTooltipWord } from './DictionaryTooltipWord';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from './ui/pagination';

interface WordSafetyReportProps {
  file: AudioFile;
  showHeader?: boolean;
}

export function WordSafetyReport({ file, showHeader = true }: WordSafetyReportProps) {
  if (!file.safetyReport) {
    return null;
  }

  const reportTopRef = useRef<HTMLDivElement | null>(null);
  const previousShowAllRef = useRef(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [profanityFilter, setProfanityFilter] = useState<'all' | 'profane' | 'non-profane'>('all');
  const [languageFilter, setLanguageFilter] = useState('all');
  const [timeRange, setTimeRange] = useState<[number, number]>([0, 0]);
  const [currentPage, setCurrentPage] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const profaneCount = file.safetyReport.filter(w => w.is_profane).length;
  const pageSize = 10;
  const maxTime = useMemo(
    () => (file.safetyReport ?? []).reduce((highest, item) => Math.max(highest, item.end), 0),
    [file.safetyReport],
  );

  useEffect(() => {
    setTimeRange([0, maxTime]);
  }, [file.id, maxTime]);

  const availableLanguages = useMemo(() => {
    const languages = new Set<string>();

    file.safetyReport?.forEach((item) => {
      if (item.matched_profanity_language) {
        languages.add(item.matched_profanity_language);
      }
    });

    return Array.from(languages).sort((left, right) => left.localeCompare(right));
  }, [file.safetyReport]);

  const filteredReport = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const [rangeStart, rangeEnd] = timeRange;

    return (file.safetyReport ?? []).filter((item) => {
      const matchesSearch = normalizedSearch.length === 0
        || item.word.toLowerCase().includes(normalizedSearch)
        || (item.matched_profanity || '').toLowerCase().includes(normalizedSearch);

      const matchesProfanity = profanityFilter === 'all'
        || (profanityFilter === 'profane' && item.is_profane)
        || (profanityFilter === 'non-profane' && !item.is_profane);

      const matchesLanguage = languageFilter === 'all'
        || item.matched_profanity_language === languageFilter;

      const matchesStartFrom = item.start >= rangeStart;

      const matchesEndTo = item.end <= rangeEnd;

      return matchesSearch && matchesProfanity && matchesLanguage && matchesStartFrom && matchesEndTo;
    });
  }, [file.safetyReport, languageFilter, profanityFilter, searchTerm, timeRange]);

  const totalPages = Math.max(1, Math.ceil(filteredReport.length / pageSize));
  const currentPageItems = useMemo(() => {
    if (showAll) {
      return filteredReport;
    }

    const startIndex = (currentPage - 1) * pageSize;
    return filteredReport.slice(startIndex, startIndex + pageSize);
  }, [currentPage, filteredReport, showAll]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, profanityFilter, languageFilter, timeRange, showAll]);

  useEffect(() => {
    if (!showAll && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, showAll, totalPages]);

  useEffect(() => {
    if (previousShowAllRef.current && !showAll) {
      requestAnimationFrame(() => {
        reportTopRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      });
    }

    previousShowAllRef.current = showAll;
  }, [showAll]);

  const startRowNumber = showAll ? 1 : ((currentPage - 1) * pageSize + 1);

  return (
    <div ref={reportTopRef} className="p-4">
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

      <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(180px,0.8fr)_minmax(180px,0.8fr)]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search words or matched profanity"
            className="border-slate-800 bg-slate-950 pl-9 text-slate-200 placeholder:text-slate-500"
          />
        </div>

        <Select value={profanityFilter} onValueChange={(value: 'all' | 'profane' | 'non-profane') => setProfanityFilter(value)}>
          <SelectTrigger className="border-slate-800 bg-slate-950 text-slate-200">
            <SelectValue placeholder="Filter by profanity" />
          </SelectTrigger>
          <SelectContent className="border-slate-800 bg-slate-950 text-slate-200">
            <SelectItem value="all">All Words</SelectItem>
            <SelectItem value="profane">Profane Only</SelectItem>
            <SelectItem value="non-profane">Non-Profane Only</SelectItem>
          </SelectContent>
        </Select>

        <Select value={languageFilter} onValueChange={setLanguageFilter}>
          <SelectTrigger className="border-slate-800 bg-slate-950 text-slate-200">
            <SelectValue placeholder="Filter by language" />
          </SelectTrigger>
          <SelectContent className="border-slate-800 bg-slate-950 text-slate-200">
            <SelectItem value="all">All Languages</SelectItem>
            {availableLanguages.map((language) => (
              <SelectItem key={language} value={language}>{language}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mb-4 rounded-lg border border-slate-700/80 bg-slate-950/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
        <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-200">Time Range</p>
            <p className="mt-1 text-sm font-semibold text-[oklch(0.541_0.281_293.009)]">
              {timeRange[0].toFixed(2)}s to {timeRange[1].toFixed(2)}s
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setTimeRange([0, maxTime])}
            disabled={timeRange[0] === 0 && timeRange[1] === maxTime}
            className="border-[oklch(0.541_0.281_293.009)]/35 bg-slate-900/80 font-semibold tracking-wide text-[oklch(0.541_0.281_293.009)] hover:border-[oklch(0.541_0.281_293.009)]/55 hover:bg-[oklch(0.541_0.281_293.009)]/12 hover:text-white"
          >
            Reset Range
          </Button>
        </div>

        <Slider
          min={0}
          max={Math.max(maxTime, 0.01)}
          step={0.01}
          value={timeRange}
          onValueChange={(value) => {
            if (value.length !== 2) {
              return;
            }

            setTimeRange([value[0], value[1]]);
          }}
          className="py-2 [&_[data-slot=slider-track]]:h-3 [&_[data-slot=slider-track]]:bg-slate-800 [&_[data-slot=slider-range]]:bg-[oklch(0.541_0.281_293.009)] [&_[data-slot=slider-thumb]]:border-[oklch(0.541_0.281_293.009)] [&_[data-slot=slider-thumb]]:bg-slate-950 [&_[data-slot=slider-thumb]]:shadow-[0_0_0_3px_color-mix(in_oklab,oklch(0.541_0.281_293.009)_24%,transparent)] [&_[data-slot=slider-thumb]]:hover:ring-[oklch(0.541_0.281_293.009)]/30 [&_[data-slot=slider-thumb]]:focus-visible:ring-[oklch(0.541_0.281_293.009)]/40"
        />

        <div className="mt-3 flex items-center justify-between text-xs font-medium tracking-wide text-slate-400">
          <span>0.00s</span>
          <span>{maxTime.toFixed(2)}s</span>
        </div>
      </div>
      
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
              {currentPageItems.map((item, index) => (
                <tr 
                  key={`${item.start}-${item.end}-${item.word}-${index}`} 
                  className={`border-b border-slate-800/50 ${item.is_profane ? 'bg-red-950/20' : ''}`}
                >
                  <td className="px-4 py-3 text-slate-500">{startRowNumber + index}</td>
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
              {currentPageItems.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                    No matching words found for the current search and filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col items-center gap-3 border-t border-slate-800 px-4 py-3">
          <p className="text-center text-xs font-medium tracking-wide text-slate-400">
            Showing {filteredReport.length === 0 ? 0 : startRowNumber}-{Math.min(startRowNumber + currentPageItems.length - 1, filteredReport.length)} of {filteredReport.length} words
          </p>

          {filteredReport.length > pageSize && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowAll((value) => !value)}
              className="border-slate-700 bg-slate-900/80 font-semibold tracking-wide text-slate-100 hover:bg-slate-800 hover:text-white"
            >
              {showAll ? 'Show Pages' : 'Show All'}
            </Button>
          )}

          {!showAll && totalPages > 1 && (
            <Pagination className="mx-auto w-full justify-center">
              <PaginationContent className="flex-wrap justify-center gap-2">
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      setCurrentPage((page) => Math.max(1, page - 1));
                    }}
                    className={`border border-slate-700 bg-slate-900/80 font-semibold tracking-wide text-slate-100 hover:bg-slate-800 hover:text-white ${currentPage === 1 ? 'pointer-events-none opacity-50' : ''}`}
                  />
                </PaginationItem>
                {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
                  <PaginationItem key={page}>
                    <PaginationLink
                      href="#"
                      isActive={page === currentPage}
                      onClick={(event) => {
                        event.preventDefault();
                        setCurrentPage(page);
                      }}
                      className={page === currentPage
                        ? 'border border-violet-400/50 bg-violet-500/20 font-semibold tracking-wide text-violet-100 hover:bg-violet-500/30'
                        : 'border border-slate-700 bg-slate-900/80 font-semibold tracking-wide text-slate-100 hover:bg-slate-800 hover:text-white'}
                    >
                      {page}
                    </PaginationLink>
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      setCurrentPage((page) => Math.min(totalPages, page + 1));
                    }}
                    className={`border border-slate-700 bg-slate-900/80 font-semibold tracking-wide text-slate-100 hover:bg-slate-800 hover:text-white ${currentPage === totalPages ? 'pointer-events-none opacity-50' : ''}`}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      </div>
    </div>
  );
}