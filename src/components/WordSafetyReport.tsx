import { Card } from './ui/card';
import { Shield, AlertTriangle, CheckCircle } from 'lucide-react';
import type { AudioFile } from '../App';
import { DictionaryTooltipWord } from './DictionaryTooltipWord';

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