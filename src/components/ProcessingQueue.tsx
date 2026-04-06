import { Card } from './ui/card';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
import { useState } from 'react';
import { Play, X, Download, Trash2, CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronUp, RotateCcw, FileText, FileArchive } from 'lucide-react';
import type { AudioFile } from '../App';
import { WordSafetyReport } from './WordSafetyReport';
import { VideoPreview } from './VideoPreview';
import { ProfanityGraphs } from './ProfanityGraphs';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';

interface ProcessingQueueProps {
  files: AudioFile[];
  onStartProcessing: () => void;
  onRemoveFile: (id: string) => void;
  onClearCompleted: () => void;
  onToggleExpanded: (id: string) => void;
  onDownloadFile: (id: string) => void;
  onDownloadReport: (id: string) => void | Promise<void>;
  onDownloadBundle: (id: string) => void | Promise<void>;
  onReprocessFile: (id: string) => void;
}

export function ProcessingQueue({ 
  files, 
  onStartProcessing, 
  onRemoveFile,
  onClearCompleted,
  onToggleExpanded,
  onDownloadFile,
  onDownloadReport,
  onDownloadBundle,
  onReprocessFile,
}: ProcessingQueueProps) {
  const [sectionState, setSectionState] = useState<Record<string, boolean>>({});
  const [filePendingRemoval, setFilePendingRemoval] = useState<AudioFile | null>(null);
  const [clearCompletedPending, setClearCompletedPending] = useState(false);
  const hasPendingFiles = files.some(f => f.status === 'pending');
  const hasCompletedFiles = files.some(f => f.status === 'completed');
  const isProcessing = files.some(f => f.status === 'processing');
  const processingCount = files.filter((file) => file.status === 'processing').length;
  const pendingCount = files.filter((file) => file.status === 'pending').length;
  const completedCount = files.filter((file) => file.status === 'completed').length;
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

    if (file.status !== 'completed') {
      parts.push(file.status);
    }

    return parts.length > 0 ? parts.join(' • ') : null;
  };

  const formatCompletedAt = (completedAt?: number) => {
    if (!completedAt) {
      return null;
    }

    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(completedAt));
  };

  const formatEta = (remainingMs: number) => {
    const totalSeconds = Math.max(1, Math.round(remainingMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }

    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }

    return `${seconds}s`;
  };

  const getEtaLabel = (file: AudioFile) => {
    if (file.status !== 'processing') {
      return null;
    }

    if (!file.processingStartedAt) {
      return 'Estimating time remaining...';
    }

    const baselineProgress = file.processingBaselineProgress ?? 0;
    const progressedBy = file.progress - baselineProgress;
    const elapsedMs = Date.now() - file.processingStartedAt;

    if (progressedBy < 8 || elapsedMs < 4000) {
      return 'Estimating time remaining...';
    }

    const remainingProgress = 100 - file.progress;
    if (remainingProgress <= 0) {
      return 'Finishing up...';
    }

    const msPerProgressPoint = elapsedMs / progressedBy;
    const remainingMs = msPerProgressPoint * remainingProgress;

    if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
      return 'Estimating time remaining...';
    }

    return `Estimated ${formatEta(remainingMs)} left`;
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

  const handleRemoveClick = (file: AudioFile) => {
    if (file.status === 'completed' || file.status === 'processing') {
      setClearCompletedPending(false);
      setFilePendingRemoval(file);
      return;
    }

    onRemoveFile(file.id);
  };

  const handleClearCompletedClick = () => {
    setFilePendingRemoval(null);
    setClearCompletedPending(true);
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (!open) {
      setFilePendingRemoval(null);
      setClearCompletedPending(false);
    }
  };

  const handleDialogConfirm = () => {
    if (filePendingRemoval) {
      onRemoveFile(filePendingRemoval.id);
    } else if (clearCompletedPending) {
      onClearCompleted();
    }

    setFilePendingRemoval(null);
    setClearCompletedPending(false);
  };

  return (
    <>
      <Card className="bg-slate-900/50 border-slate-800">
        <div className="p-6">
        <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
          <div className="md:justify-self-start">
            <h3 className="text-slate-100">Processing Queue</h3>
            <p className="text-xs text-slate-400">Live status overview for your uploaded jobs</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 md:justify-self-center">
            <div className="inline-flex min-w-[78px] flex-col items-center justify-center rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-center text-xs font-medium text-cyan-100">
              <span className="uppercase tracking-[0.08em] text-[10px] opacity-90">Total</span>
              <span className="text-sm font-semibold leading-none">{files.length}</span>
            </div>
            <div className="inline-flex min-w-[78px] flex-col items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-center text-xs font-medium text-amber-100">
              <span className="uppercase tracking-[0.08em] text-[10px] opacity-90">Pending</span>
              <span className="text-sm font-semibold leading-none">{pendingCount}</span>
            </div>
            <div className="inline-flex min-w-[78px] flex-col items-center justify-center rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-center text-xs font-medium text-violet-100">
              <span className="uppercase tracking-[0.08em] text-[10px] opacity-90">Processing</span>
              <span className="text-sm font-semibold leading-none">{processingCount}</span>
            </div>
            <div className="inline-flex min-w-[78px] flex-col items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-center text-xs font-medium text-emerald-100">
              <span className="uppercase tracking-[0.08em] text-[10px] opacity-90">Completed</span>
              <span className="text-sm font-semibold leading-none">{completedCount}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 md:justify-self-end">
            {hasCompletedFiles && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearCompletedClick}
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
                        <p className="break-all text-slate-200">{file.name}</p>
                        {file.url && file.url !== file.name && (
                          <p className="mt-1 break-all text-xs text-slate-500">{file.url}</p>
                        )}
                        {buildMetadataLabel(file) && (
                          <p className="mt-1 text-xs text-slate-500">
                            {buildMetadataLabel(file)}
                          </p>
                        )}
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
                          </>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRemoveClick(file)}
                          className="text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    {file.status === 'processing' && (
                      <div className="space-y-1">
                        <Progress 
                          value={file.progress} 
                          className="h-1.5 bg-slate-800"
                        />
                        <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                          <p>{Math.round(file.progress)}% complete</p>
                          <p>{getEtaLabel(file)}</p>
                        </div>
                      </div>
                    )}

                    {file.errorMessage && (
                      <p className="text-xs text-red-400 mt-2">{file.errorMessage}</p>
                    )}

                    {file.status === 'completed' && (
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-emerald-400/80">
                          Completed {formatCompletedAt(file.completedAt)}
                        </p>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onReprocessFile(file.id)}
                            className="border-cyan-500/30 bg-cyan-500/10 text-cyan-200 hover:border-cyan-400/50 hover:bg-cyan-500/20 hover:text-cyan-100"
                            title="Reprocess"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onDownloadFile(file.id)}
                            className="border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:border-emerald-400/50 hover:bg-emerald-500/20 hover:text-emerald-100"
                            title="Download video"
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void onDownloadReport(file.id)}
                            className="border-indigo-500/30 bg-indigo-500/10 text-indigo-200 hover:border-indigo-400/50 hover:bg-indigo-500/20 hover:text-indigo-100"
                            title="Download PDF report"
                          >
                            <FileText className="w-4 h-4" />
                          </Button>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void onDownloadBundle(file.id)}
                                className="border-amber-500/30 bg-amber-500/10 text-amber-200 hover:border-amber-400/50 hover:bg-amber-500/20 hover:text-amber-100"
                                title="Download ZIP bundle"
                              >
                                <FileArchive className="w-4 h-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top" sideOffset={8}>
                              Download ZIP: PDF report + uncensored + censored media
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
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

                    {/* Uncensored Media Preview */}
                    {renderAnalysisSection(
                      file.id,
                      'uncensored-video-preview',
                      'Uncensored Media Preview',
                      <VideoPreview file={file} isCensored={false} showHeader={false} />,
                    )}

                    {/* Censored Media Preview */}
                    {renderAnalysisSection(
                      file.id,
                      'censored-video-preview',
                      'Censored Media Preview',
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

      <AlertDialog
        open={filePendingRemoval !== null || clearCompletedPending}
        onOpenChange={handleDialogOpenChange}
      >
        <AlertDialogContent className="border-slate-800 bg-slate-950 text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {clearCompletedPending
                ? 'Clear all completed items?'
                : filePendingRemoval?.status === 'processing'
                  ? 'Delete processing item?'
                  : 'Delete completed item?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {clearCompletedPending
                ? 'This will remove every completed result from the processing queue. Processed files, previews, and analysis panels for those completed items will no longer be available in this list.'
                : filePendingRemoval
                  ? filePendingRemoval.status === 'processing'
                    ? `This will remove ${filePendingRemoval.name} while it is still processing. You can continue working, but this item will no longer be shown in the queue.`
                    : `This will remove ${filePendingRemoval.name} from the processing queue, including its completed preview and analysis details shown in the queue.`
                  : 'This will remove the completed item from the processing queue and hide its preview and analysis details from this list.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDialogConfirm}
              className="bg-red-600 text-white hover:bg-red-500"
            >
              {clearCompletedPending ? 'Clear Completed' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
