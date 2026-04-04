import { Card } from './ui/card';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Button } from './ui/button';
import { Volume2 } from 'lucide-react';
import type { ConversionSettings } from '../App';
import { useState, useRef } from 'react';
import { resolveCensorSoundUrl } from '../lib/api';

interface FormatSelectorProps {
  settings: ConversionSettings;
  onSettingsChange: (settings: ConversionSettings) => void;
}

const formats = [
  { value: 'mp4', label: 'MP4', description: 'Universal compatibility' },
  { value: 'avi', label: 'AVI', description: 'Windows standard' },
  { value: 'mov', label: 'MOV', description: 'Apple QuickTime' },
  { value: 'mkv', label: 'MKV', description: 'High quality' },
];

const sensorTypes = [
  { value: 'beep', label: 'Beep', description: 'Replace with beep sound' },
  { value: 'silence', label: 'Silence', description: 'Mute censored content' },
  { value: 'faaa', label: 'Faaa', description: 'Use backend_data/censor_sounds/faaa.mp3' },
];

export function FormatSelector({ settings, onSettingsChange }: FormatSelectorProps) {
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const selectedFormat = formats.find((format) => format.value === settings.format);
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
    } else if (settings.sensorType === 'faaa') {
      audioRef.current = new Audio(resolveCensorSoundUrl('faaa'));
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
          <div className="space-y-2">
            <Label className="text-slate-300">Video Format</Label>
            <Select
              value={settings.format}
              onValueChange={(value) => onSettingsChange({ ...settings, format: value })}
            >
              <SelectTrigger className="bg-slate-950 border-slate-700 text-slate-200">
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
          </div>

          <div className="space-y-2">
            <Label className="text-slate-300">Sensor Type</Label>
            <Select
              value={settings.sensorType}
              onValueChange={(value: "beep" | "silence" | "faaa") => onSettingsChange({ ...settings, sensorType: value })}
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