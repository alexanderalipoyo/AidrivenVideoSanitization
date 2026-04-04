import { Card } from './ui/card';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
import { useState } from 'react';
import { Play, X, Download, Trash2, CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import type { AudioFile } from '../App';
import { WordSafetyReport } from './WordSafetyReport';
import { VideoPreview } from './VideoPreview';
import { ProfanityGraphs } from './ProfanityGraphs';

interface ProcessingQueueProps {
  files: AudioFile[];
  onStartProcessing: () => void;
  onRemoveFile: (id: string) => void;
  onClearCompleted: () => void;
  onToggleExpanded: (id: string) => void;
  onDownloadFile: (id: string) => void;
}

export function ProcessingQueue({ 
  files, 
  onStartProcessing, 
  onRemoveFile,
  onClearCompleted,
  onToggleExpanded,
  onDownloadFile,
}: ProcessingQueueProps) {
  const [sectionState, setSectionState] = useState<Record<string, boolean>>({});
  const hasPendingFiles = files.some(f => f.status === 'pending');
  const hasCompletedFiles = files.some(f => f.status === 'completed');
  const isProcessing = files.some(f => f.status === 'processing');
  const sortedFiles = files
    .map((file, index) => ({ file, index }))
    .sort((left, right) => {
      const statusPriority: Record<AudioFile['status'], number> = {
        processing: 0,
        pending: 1,
        error: 2,
        completed: 3,
      };

      const priorityDifference = statusPriority[left.file.status] - statusPriority[right.file.status];
      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      if (left.file.status === 'processing') {
        return right.index - left.index;
      }

      if (left.file.status === 'completed') {
        return right.index - left.index;
      }

      return left.index - right.index;
    })
    .map(({ file }) => file);

  const getSectionKey = (fileId: string, sectionId: string) => `${fileId}:${sectionId}`;

  const isSectionOpen = (fileId: string, sectionId: string) => {
    const key = getSectionKey(fileId, sectionId);
    return sectionState[key] ?? true;
  };

  const toggleSection = (fileId: string, sectionId: string) => {
    const key = getSectionKey(fileId, sectionId);
    setSectionState((prev) => ({
      ...prev,
      [key]: !(prev[key] ?? true),
    }));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return 'Unknown size';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const buildMetadataLabel = (file: AudioFile) => {
    const parts: string[] = [];

    if (file.size > 0) {
      parts.push(formatFileSize(file.size));
    }

    parts.push(file.status);
    return parts.join(' • ');
  };

  const renderAnalysisSection = (
    fileId: string,
    sectionId: string,
    title: string,
    content: React.ReactNode,
  ) => {
    const open = isSectionOpen(fileId, sectionId);

    return (
      <div className="bg-slate-900/50 rounded-lg border border-slate-800/50 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-800/50 px-4 py-3">
          <h4 className="text-sm font-medium text-slate-200">{title}</h4>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => toggleSection(fileId, sectionId)}
            className="h-8 border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            {open ? <ChevronUp className="mr-2 h-4 w-4" /> : <ChevronDown className="mr-2 h-4 w-4" />}
            {open ? 'Close' : 'Open'}
          </Button>
        </div>
        {open && content}
      </div>
    );
  };

  return (
    <Card className="bg-slate-900/50 border-slate-800">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-slate-100">Processing Queue ({files.length})</h3>
          <div className="flex gap-2">
            {hasCompletedFiles && (
              <Button
                variant="outline"
                size="sm"
                onClick={onClearCompleted}
                className="border-amber-500/30 bg-amber-500/10 text-amber-200 hover:border-amber-400/50 hover:bg-amber-500/20 hover:text-amber-100"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Clear Completed
              </Button>
            )}
            {hasPendingFiles && !isProcessing && (
              <Button
                size="sm"
                onClick={onStartProcessing}
                className="bg-violet-600 hover:bg-violet-700 text-white"
              >
                <Play className="w-4 h-4 mr-2" />
                Start Processing
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {sortedFiles.map((file) => (
            <div
              key={file.id}
              className="rounded-lg bg-slate-950/50 border border-slate-800 overflow-hidden"
            >
              {/* Main File Card */}
              <div className="p-4">
                <div className="flex items-start gap-3">
                  {/* Status Icon */}
                  <div className="mt-1">
                    {file.status === 'pending' && (
                      <div className="w-5 h-5 rounded-full bg-slate-700 flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-slate-500" />
                      </div>
                    )}
                    {file.status === 'processing' && (
                      <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
                    )}
                    {file.status === 'completed' && (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    )}
                    {file.status === 'error' && (
                      <AlertCircle className="w-5 h-5 text-red-400" />
                    )}
                  </div>

                  {/* File Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="break-all text-slate-200">{file.url || file.name}</p>
                        <p className="text-xs text-slate-500">
                          {buildMetadataLabel(file)}
                        </p>
                      </div>

                      <div className="flex gap-2">
                        {file.status === 'completed' && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => onToggleExpanded(file.id)}
                              className="border-slate-700 text-slate-300 hover:bg-slate-800"
                            >
                              {file.expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => onDownloadFile(file.id)}
                              className="border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:border-emerald-400/50 hover:bg-emerald-500/20 hover:text-emerald-100"
                            >
                              <Download className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onRemoveFile(file.id)}
                          className="text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    {(file.status === 'processing' || file.status === 'completed') && (
                      <div className="space-y-1">
                        <Progress 
                          value={file.progress} 
                          className="h-1.5 bg-slate-800"
                        />
                        <p className="text-xs text-slate-500">
                          {Math.round(file.progress)}% complete
                        </p>
                      </div>
                    )}

                    {file.errorMessage && (
                      <p className="text-xs text-red-400 mt-2">{file.errorMessage}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Collapsible Analysis Widgets */}
              {file.status === 'completed' && file.expanded && (
                <div className="border-t border-slate-800 bg-slate-950/80">
                  <div className="p-4 space-y-4">
                    {/* Word Safety Report */}
                    {file.safetyReport && (
                      renderAnalysisSection(
                        file.id,
                        'word-safety-report',
                        'Word Safety Report',
                        <WordSafetyReport file={file} showHeader={false} />,
                      )
                    )}

                    {/* Uncensored Video Preview */}
                    {renderAnalysisSection(
                      file.id,
                      'uncensored-video-preview',
                      'Uncensored Video Preview',
                      <VideoPreview file={file} isCensored={false} showHeader={false} />,
                    )}

                    {/* Censored Video Preview */}
                    {renderAnalysisSection(
                      file.id,
                      'censored-video-preview',
                      'Censored Video Preview',
                      <VideoPreview file={file} isCensored={true} showHeader={false} />,
                    )}

                    {/* Profanity Analytics Dashboard */}
                    {file.safetyReport && (
                      renderAnalysisSection(
                        file.id,
                        'profanity-analytics-dashboard',
                        'Profanity Analytics Dashboard',
                        <ProfanityGraphs file={file} showHeader={false} />,
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
