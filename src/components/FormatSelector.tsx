import { Card } from './ui/card';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Button } from './ui/button';
import { Volume2, Music } from 'lucide-react';
import type { ConversionSettings } from '../App';
import { useState, useRef } from 'react';
import { resolveCensorSoundUrl } from '../lib/api';
import { Switch } from './ui/switch';

interface FormatSelectorProps {
  settings: ConversionSettings;
  onSettingsChange: (settings: ConversionSettings) => void;
  showAudioOnly?: boolean;
  hideVideoFormat?: boolean;
  forceAudioFormat?: boolean;
}

const formats = [
  { value: 'mp4', label: 'MP4', description: 'Universal compatibility' },
  { value: 'avi', label: 'AVI', description: 'Windows standard' },
  { value: 'mov', label: 'MOV', description: 'Apple QuickTime' },
  { value: 'mkv', label: 'MKV', description: 'High quality' },
];

const audioFormats = [
  { value: 'mp3', label: 'MP3', description: 'Best compatibility' },
  { value: 'wav', label: 'WAV', description: 'Uncompressed audio' },
  { value: 'flac', label: 'FLAC', description: 'Lossless compression' },
  { value: 'ogg', label: 'OGG', description: 'Open compressed audio' },
  { value: 'aac', label: 'AAC', description: 'Efficient streaming audio' },
  { value: 'm4a', label: 'M4A', description: 'Apple-compatible audio' },
];

const sensorTypes = [
  { value: 'beep', label: 'Beep', description: 'Replace with beep sound' },
  { value: 'silence', label: 'Silence', description: 'Mute censored content' },
  { value: 'faaa', label: 'Faaa', description: 'Use backend_data/censor_sounds/faaa.mp3' },
  { value: 'mac-quack', label: 'Mac Quack', description: 'Use backend_data/censor_sounds/mac-quack.mp3' },
  { value: 'bruh', label: 'Bruh', description: 'Use backend_data/censor_sounds/bruh.mp3' },
];

export function FormatSelector({
  settings,
  onSettingsChange,
  showAudioOnly = false,
  hideVideoFormat = false,
  forceAudioFormat = false,
}: FormatSelectorProps) {
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const selectedFormat = formats.find((format) => format.value === settings.format);
  const selectedAudioFormat = audioFormats.find((format) => format.value === settings.audioFormat);
  const selectedSensorType = sensorTypes.find((type) => type.value === settings.sensorType);

  const handlePlayPreview = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    if (settings.sensorType === 'beep') {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.frequency.value = 1000; // 1kHz beep
      gainNode.gain.value = 0.3;
      oscillator.type = 'sine';
      
      setIsPlayingPreview(true);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.5);
      
      setTimeout(() => {
        setIsPlayingPreview(false);
        audioContext.close();
      }, 500);
    } else if (settings.sensorType !== 'silence') {
      audioRef.current = new Audio(resolveCensorSoundUrl(settings.sensorType));
      audioRef.current.play().catch(() => {
        setIsPlayingPreview(false);
      });
      setIsPlayingPreview(true);
      audioRef.current.onended = () => {
        setIsPlayingPreview(false);
      };
    } else {
      // For silence, just show a brief indicator
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      setIsPlayingPreview(true);
      setTimeout(() => {
        setIsPlayingPreview(false);
        audioContext.close();
      }, 500);
    }
  };

  return (
    <Card className="bg-slate-900/50 border-slate-800">
      <div className="p-6 space-y-4">
        <h3 className="text-slate-100">Output Settings</h3>

        <div className="space-y-4">
          {showAudioOnly && !forceAudioFormat && (
            <div
              className={`flex items-center justify-between rounded-lg border p-3 transition-all ${
                settings.audioOnly
                  ? 'border-emerald-500/40 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(16,185,129,0.2)]'
                  : 'border-slate-800 bg-slate-950/50'
              }`}
            >
              <div className="flex items-center gap-3">
                <Music className="h-4 w-4 text-violet-400" />
                <div>
                  <Label className="text-slate-300 cursor-pointer">Audio Only</Label>
                  <p className="text-xs text-slate-500">Extract audio track before sanitization</p>
                </div>
              </div>
              <Switch
                checked={settings.audioOnly}
                onCheckedChange={(value) => onSettingsChange({ ...settings, audioOnly: value })}
                className="border border-slate-500/70 data-[state=checked]:border-emerald-300/70 data-[state=checked]:bg-emerald-500 data-[state=checked]:shadow-[0_0_0_3px_rgba(16,185,129,0.32)] data-[state=unchecked]:bg-slate-700 focus-visible:ring-emerald-400/60 [&_[data-slot=switch-thumb]]:bg-slate-200 data-[state=checked]:[&_[data-slot=switch-thumb]]:bg-white"
              />
            </div>
          )}

          {!hideVideoFormat && (
            <div className="space-y-2">
              <Label className="text-slate-300">Video Format</Label>
              <Select
                value={settings.format}
                disabled={settings.audioOnly}
                onValueChange={(value) => onSettingsChange({ ...settings, format: value })}
              >
                <SelectTrigger className="bg-slate-950 border-slate-700 text-slate-200 disabled:opacity-50">
                  <SelectValue placeholder="Select format">
                    {selectedFormat?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  {formats.map((format) => (
                    <SelectItem 
                      key={format.value} 
                      value={format.value}
                      className="text-slate-200 focus:bg-slate-800"
                    >
                      <div>
                        <div>{format.label}</div>
                        <div className="text-xs text-slate-500">{format.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {settings.audioOnly && (
                <p className="text-xs text-slate-500">Video format is ignored while Audio Only is enabled.</p>
              )}
            </div>
          )}

          {(settings.audioOnly || forceAudioFormat) && (
            <div className="space-y-2">
              <Label className="text-slate-300">Audio Format</Label>
              <Select
                value={settings.audioFormat}
                onValueChange={(value) => onSettingsChange({ ...settings, audioFormat: value })}
              >
                <SelectTrigger className="bg-slate-950 border-slate-700 text-slate-200">
                  <SelectValue placeholder="Select audio format">
                    {selectedAudioFormat?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  {audioFormats.map((format) => (
                    <SelectItem
                      key={format.value}
                      value={format.value}
                      className="text-slate-200 focus:bg-slate-800"
                    >
                      <div>
                        <div>{format.label}</div>
                        <div className="text-xs text-slate-500">{format.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-slate-300">Sensor Type</Label>
            <Select
              value={settings.sensorType}
              onValueChange={(value: "beep" | "silence" | "faaa" | "mac-quack" | "bruh") => onSettingsChange({ ...settings, sensorType: value })}
            >
              <SelectTrigger className="bg-slate-950 border-slate-700 text-slate-200">
                <SelectValue placeholder="Select sensor type">
                  {selectedSensorType?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700">
                {sensorTypes.map((type) => (
                  <SelectItem 
                    key={type.value} 
                    value={type.value}
                    className="text-slate-200 focus:bg-slate-800"
                  >
                    <div>
                      <div>{type.label}</div>
                      <div className="text-xs text-slate-500">{type.description}</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Button
              onClick={handlePlayPreview}
              disabled={isPlayingPreview}
              variant="outline"
              size="sm"
              className="w-full mt-2 bg-slate-950 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-slate-100"
            >
              <Volume2 className="w-4 h-4 mr-2" />
              {isPlayingPreview ? 'Playing...' : 'Preview Audio'}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}