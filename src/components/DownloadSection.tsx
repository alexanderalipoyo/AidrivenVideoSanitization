import { useState } from 'react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Alert, AlertDescription } from './ui/alert';
import { Download, Link, Info, AlertTriangle } from 'lucide-react';
import type { ConversionSettings } from '../App';
import { FormatSelector } from './FormatSelector';

interface DownloadSectionProps {
  settings: ConversionSettings;
  onSettingsChange: (settings: ConversionSettings) => void;
  onUrlAdded: (options: {
    url: string;
  }) => Promise<void>;
}

export function DownloadSection({ settings, onSettingsChange, onUrlAdded }: DownloadSectionProps) {
  const [url, setUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{ detail: string; rawType?: string } | null>(null);

  const stripAnsi = (value: string) => value.replace(/\x1B\[[0-9;]*m/g, '').trim();

  const getUrlErrorDescription = (error: unknown): { detail: string; rawType?: string } => {
    const message = error instanceof Error ? stripAnsi(error.message) : '';
    const normalizedMessage = message.toLowerCase();

    if (message === 'A valid http or https URL is required') {
      return {
        detail: 'Enter a full link starting with http:// or https://. Example: https://www.youtube.com/watch?v=...',
      };
    }

    if (
      normalizedMessage.includes('unsupported url')
      || normalizedMessage.includes('no suitable extractor')
      || normalizedMessage.includes('did not produce a supported media file')
      || normalizedMessage.includes('no playable entries')
    ) {
      return {
        rawType: message,
        detail: 'This URL is not currently supported. Try a public media link from YouTube, SoundCloud, Vimeo, Facebook, TikTok, X, or Bandcamp.',
      };
    }

    return {
      rawType: message || undefined,
      detail: message || 'Could not process the supplied URL.',
    };
  };

  const handleDownload = async () => {
    if (!url.trim() || isSubmitting) {
      return;
    }

    setSubmitError(null);
    setIsSubmitting(true);
    try {
      await onUrlAdded({
        url: url.trim(),
      });
      setUrl('');
    } catch (error) {
      setSubmitError(getUrlErrorDescription(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* Left Column - Download Options */}
      <div className="lg:col-span-2 space-y-6">
        <Card className="bg-slate-900/50 border-slate-800">
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-violet-500/20 rounded-lg">
                <Download className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <h3 className="text-slate-100">Download from URL</h3>
                <p className="text-sm text-slate-400">YouTube, SoundCloud, and more</p>
              </div>
            </div>

            <Alert className="bg-slate-950/50 border-slate-800">
              <Info className="h-4 w-4 text-violet-400" />
              <AlertDescription className="text-slate-400">
                Powered by yt-dlp. Supports YouTube, SoundCloud, Vimeo, and 1000+ sites.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label className="text-slate-300">URL</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <Input
                    placeholder="https://www.youtube.com/watch?v=..."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void handleDownload()}
                    className="bg-slate-950 border-slate-700 text-slate-200 pl-10"
                  />
                </div>
                <Button
                  onClick={() => void handleDownload()}
                  disabled={!url.trim() || isSubmitting}
                  className="bg-violet-600 hover:bg-violet-700 text-white"
                >
                  <Download className="w-4 h-4 mr-2" />
                  {isSubmitting ? 'Starting...' : 'Download'}
                </Button>
              </div>
              {submitError && (
                <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
                  <AlertTriangle className="h-4 w-4 text-red-300" />
                  <AlertDescription className="space-y-1">
                    <p className="font-medium">Unable to process this URL</p>
                    {submitError.rawType && (
                      <p className="text-xs text-red-200/80">{submitError.rawType}</p>
                    )}
                    <p className="text-sm text-red-200/95">{submitError.detail}</p>
                  </AlertDescription>
                </Alert>
              )}
            </div>

          </div>
        </Card>

        {/* Quick Examples */}
        <Card className="bg-slate-900/50 border-slate-800">
          <div className="p-6 space-y-3">
            <h4 className="text-slate-100">Supported Platforms</h4>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                {
                  name: 'YouTube',
                  icon: (
                    <img
                      src="https://www.youtube.com/favicon.ico"
                      alt="YouTube"
                      className="h-8 w-8 rounded-full"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ),
                },
                {
                  name: 'SoundCloud',
                  icon: (
                    <img
                      src="https://soundcloud.com/favicon.ico"
                      alt="SoundCloud"
                      className="h-8 w-8 rounded-full"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ),
                },
                {
                  name: 'Vimeo',
                  icon: (
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#1ab7ea] text-sm font-bold lowercase text-white">
                      v
                    </span>
                  ),
                },
                {
                  name: 'Facebook',
                  icon: (
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-lg font-bold text-white">
                      f
                    </span>
                  ),
                },
                {
                  name: 'Bandcamp',
                  icon: (
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[#0f4c5c] text-[11px] font-semibold uppercase tracking-[0.08em] text-white">
                      bc
                    </span>
                  ),
                },
                {
                  name: 'X (twitter)',
                  icon: (
                    <img
                      src="https://x.com/favicon.ico"
                      alt="X"
                      className="h-8 w-8 rounded-full"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ),
                },
                {
                  name: 'TikTok',
                  icon: (
                    <img
                      src="https://www.tiktok.com/favicon.ico"
                      alt="TikTok"
                      className="h-8 w-8 rounded-full"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ),
                },
                { name: '1000+ more', icon: '✨' },
              ].map((platform) => (
                <div
                  key={platform.name}
                  className="p-3 rounded-lg bg-slate-950/50 border border-slate-800 text-center"
                >
                  <div className="mb-1 flex justify-center text-2xl">{platform.icon}</div>
                  <div className="text-xs text-slate-400">{platform.name}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Right Column - Format Settings */}
      <div>
        <FormatSelector settings={settings} onSettingsChange={onSettingsChange} showAudioOnly />
      </div>
    </div>
  );
}
