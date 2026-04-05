import { useEffect, useState } from "react";
import { Languages, LoaderCircle } from "lucide-react";

import {
  fetchDictionaryDefinition,
  fetchSupportedLanguageEntries,
  fetchSupportedLanguages,
  type SupportedLanguage,
} from "../lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

type DefinitionState = {
  status: "idle" | "loading" | "ready" | "error";
  definition?: string;
  partOfSpeech?: string;
  source?: string;
  errorMessage?: string;
};

export function SupportedLanguagesPage() {
  const [languages, setLanguages] = useState<SupportedLanguage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<SupportedLanguage | null>(null);
  const [languageEntries, setLanguageEntries] = useState<string[]>([]);
  const [isDialogLoading, setIsDialogLoading] = useState(false);
  const [dialogErrorMessage, setDialogErrorMessage] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [definitionCache, setDefinitionCache] = useState<Record<string, DefinitionState>>({});

  const normalizedSearchTerm = searchTerm.trim().toLocaleLowerCase();
  const filteredEntries = normalizedSearchTerm
    ? languageEntries.filter((entry) => entry.toLocaleLowerCase().includes(normalizedSearchTerm))
    : languageEntries;

  const loadDefinition = async (entry: string) => {
    if (!selectedLanguage) {
      return;
    }

    const cacheKey = `${selectedLanguage.file.toLocaleLowerCase()}:${entry.toLocaleLowerCase()}`;
    const cachedEntry = definitionCache[cacheKey];
    if (cachedEntry && cachedEntry.status !== "idle") {
      return;
    }

    setDefinitionCache((prev) => ({
      ...prev,
      [cacheKey]: {
        status: "loading",
      },
    }));

    try {
      const response = await fetchDictionaryDefinition(entry, selectedLanguage.file);
      setDefinitionCache((prev) => ({
        ...prev,
        [cacheKey]: {
          status: "ready",
          definition: response.definition,
          partOfSpeech: response.part_of_speech,
          source: response.source,
        },
      }));
    } catch (error) {
      setDefinitionCache((prev) => ({
        ...prev,
        [cacheKey]: {
          status: "error",
          errorMessage: error instanceof Error ? error.message : "Definition not available.",
        },
      }));
    }
  };

  const renderDefinitionTooltip = (entry: string) => {
    const selectedLanguageKey = selectedLanguage?.file.toLocaleLowerCase() ?? "unknown";
    const cacheKey = `${selectedLanguageKey}:${entry.toLocaleLowerCase()}`;
    const definitionState = definitionCache[cacheKey];

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="break-all text-cyan-100 underline decoration-dotted underline-offset-4 cursor-help"
            onMouseEnter={() => {
              void loadDefinition(entry);
            }}
            onFocus={() => {
              void loadDefinition(entry);
            }}
            tabIndex={0}
          >
            {entry}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8} className="max-w-xs border border-slate-700 bg-slate-900 text-slate-100 shadow-xl">
          {definitionState?.status === "ready" ? (
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300">
                {definitionState.partOfSpeech || "Meaning"}
              </div>
              <div className="text-sm leading-5 text-slate-100">{definitionState.definition}</div>
            </div>
          ) : definitionState?.status === "error" ? (
            <div className="text-sm leading-5 text-rose-200">{definitionState.errorMessage || "Definition not available."}</div>
          ) : definitionState?.status === "loading" ? (
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
  };

  useEffect(() => {
    let isMounted = true;

    const loadLanguages = async () => {
      try {
        setIsLoading(true);
        setErrorMessage(null);
        const response = await fetchSupportedLanguages();
        if (!isMounted) {
          return;
        }
        setLanguages(response.languages);
      } catch (error) {
        if (!isMounted) {
          return;
        }
        setErrorMessage(
          error instanceof Error ? error.message : "Failed to load supported languages.",
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadLanguages();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadLanguageEntries = async () => {
      if (!selectedLanguage) {
        setLanguageEntries([]);
        setDialogErrorMessage(null);
        setIsDialogLoading(false);
        setSearchTerm("");
        return;
      }

      try {
        setIsDialogLoading(true);
        setDialogErrorMessage(null);
        setSearchTerm("");
        setDefinitionCache({});
        const response = await fetchSupportedLanguageEntries(selectedLanguage.file);
        if (!isMounted) {
          return;
        }
        setLanguageEntries(response.entries);
      } catch (error) {
        if (!isMounted) {
          return;
        }
        setDialogErrorMessage(
          error instanceof Error ? error.message : "Failed to load CSV entries.",
        );
        setLanguageEntries([]);
      } finally {
        if (isMounted) {
          setIsDialogLoading(false);
        }
      }
    };

    void loadLanguageEntries();

    return () => {
      isMounted = false;
    };
  }, [selectedLanguage]);

  return (
    <div className="space-y-6">
      <Dialog
        open={selectedLanguage !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedLanguage(null);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-3xl border-slate-800 bg-slate-950 text-slate-100">
          <DialogHeader>
            <DialogTitle className="text-base font-medium leading-6 text-slate-100">
              {selectedLanguage?.name ?? "Supported Language"}
            </DialogTitle>
            <DialogDescription className="text-sm leading-6 text-slate-500">
              {selectedLanguage?.file ?? ""}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
            {isDialogLoading ? (
              <div className="flex items-center gap-3 py-8 text-slate-300">
                <LoaderCircle className="h-5 w-5 animate-spin" />
                Loading CSV data...
              </div>
            ) : dialogErrorMessage ? (
              <div className="py-4 text-rose-300">{dialogErrorMessage}</div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4 border-b border-slate-800 pb-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.22em] text-slate-500">
                      CSV entries
                    </div>
                    <div className="mt-1 text-sm leading-6 text-slate-400">
                      Words loaded from the selected profanity CSV file. Hover any word to see its meaning.
                    </div>
                  </div>
                  <div className="rounded-full bg-slate-800 px-3 py-1 text-sm text-slate-100">
                    {filteredEntries.length.toLocaleString()}
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="language-entry-search" className="text-xs uppercase tracking-[0.22em] text-slate-500">
                    Search profanity
                  </label>
                  <Input
                    id="language-entry-search"
                    type="text"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search for a word in this CSV"
                    className="border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-500"
                  />
                </div>

                <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/80">
                  {filteredEntries.length > 0 ? (
                    <div className="grid gap-px bg-slate-800">
                      {filteredEntries.map((entry, index) => (
                        <div
                          key={`${selectedLanguage?.file}-${entry}-${index}`}
                          className="grid grid-cols-[80px_1fr] gap-4 bg-slate-950 px-4 py-3 text-sm text-slate-200"
                        >
                          <span className="text-slate-500">{index + 1}</span>
                          <span className="break-all">{renderDefinitionTooltip(entry)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-10 text-center text-sm text-slate-400">
                      No matching profanity found in this CSV.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Card className="border-slate-800 bg-slate-900/60">
        <div className="flex flex-col gap-4 px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-300">
                <Languages className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-medium leading-6 text-slate-100">Supported Languages</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  These languages are discovered directly from the profanity CSV files in backend_data/profanity_csv.
                </p>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center self-start sm:self-center">
            <div className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-sm leading-none text-cyan-200">
            {languages.length} language{languages.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <Card className="border-slate-800 bg-slate-900/40">
          <CardContent className="flex items-center justify-center gap-3 py-12 text-slate-300">
            <LoaderCircle className="h-5 w-5 animate-spin" />
            Loading supported languages...
          </CardContent>
        </Card>
      ) : errorMessage ? (
        <Card className="border-rose-500/30 bg-rose-950/20">
          <CardContent className="py-8 text-rose-200">{errorMessage}</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {languages.map((language) => (
            <Card
              key={language.file}
              className="h-full border-slate-800 bg-gradient-to-br from-slate-900/80 via-slate-900/70 to-cyan-950/30 transition-colors hover:border-cyan-500/40"
            >
              <button
                type="button"
                onClick={() => setSelectedLanguage(language)}
                className="group flex h-full w-full cursor-pointer flex-col text-left"
              >
                <CardHeader className="flex h-full flex-col gap-4">
                  <div className="space-y-3">
                    <CardTitle className="min-h-7 text-base font-medium leading-6 text-slate-100 transition-colors group-hover:text-cyan-300">
                      {language.name}
                    </CardTitle>
                    <CardDescription className="break-all text-sm leading-6 text-slate-500">
                      {language.file}
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="mt-auto flex items-end justify-between gap-4 border-t border-slate-800/80 pt-5 text-sm text-slate-300">
                  <div className="space-y-1">
                    <div className="text-xs uppercase tracking-[0.22em] text-slate-500">
                      Profanity entries
                    </div>
                    <div className="text-sm leading-6 text-slate-400">Dictionary size</div>
                  </div>
                  <span className="min-w-20 rounded-full bg-slate-800 px-3 py-1 text-center text-slate-100">
                    {language.word_count.toLocaleString()}
                  </span>
                </CardContent>
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}