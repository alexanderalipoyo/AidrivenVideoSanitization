import { BarChart3, TrendingUp, Globe, AlertCircle } from 'lucide-react';
import type { AudioFile } from '../App';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip,
  RadialBarChart,
  RadialBar,
  Legend,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid
} from 'recharts';

interface ProfanityGraphsProps {
  file: AudioFile;
  showHeader?: boolean;
}

export function ProfanityGraphs({ file, showHeader = true }: ProfanityGraphsProps) {
  if (!file.safetyReport) {
    return null;
  }

  // Filter for only profane words
  const profaneWords = file.safetyReport.filter(w => w.is_profane);

  if (profaneWords.length === 0) {
    return (
      <div className="p-6">
        {showHeader && (
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-violet-400" />
            <h4 className="text-slate-200 text-sm font-medium">Profanity Analysis</h4>
          </div>
        )}
        <div className="bg-gradient-to-br from-emerald-950/30 to-emerald-900/10 border border-emerald-800/30 rounded-xl p-12 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/20 mb-4">
            <AlertCircle className="w-8 h-8 text-emerald-400" />
          </div>
          <p className="text-emerald-400 text-lg font-medium">Clean Content Detected</p>
          <p className="text-emerald-600 text-sm mt-2">No profanity found in this video</p>
        </div>
      </div>
    );
  }

  // 1. Calculate word-specific distribution and counts
  const wordCountsMap = new Map<string, { word: string; language: string; count: number }>();
  
  profaneWords.forEach(item => {
    const key = `${item.word}-${item.matched_profanity_language}`;
    if (wordCountsMap.has(key)) {
      const existing = wordCountsMap.get(key)!;
      existing.count++;
    } else {
      wordCountsMap.set(key, {
        word: item.word,
        language: item.matched_profanity_language,
        count: 1
      });
    }
  });

  const wordFrequencyData = Array.from(wordCountsMap.values())
    .sort((a, b) => b.count - a.count)
    .map((item, index) => ({
      ...item,
      fill: `hsl(${280 - (index * 30)}, 70%, 60%)`
    }));

  // 2. Count the distribution of profane words by language
  const languageCountsMap = new Map<string, number>();
  
  profaneWords.forEach(item => {
    const lang = item.matched_profanity_language || 'Unknown';
    languageCountsMap.set(lang, (languageCountsMap.get(lang) || 0) + 1);
  });

  const totalProfane = profaneWords.length;
  
  // Prepare data for pie chart with colors
  const languagePieData = Array.from(languageCountsMap.entries())
    .map(([language, count], index) => ({
      name: language.toUpperCase(),
      value: count,
      percentage: ((count / totalProfane) * 100).toFixed(1),
      fill: ['#8b5cf6', '#06b6d4', '#f43f5e', '#10b981', '#f59e0b'][index % 5]
    }))
    .sort((a, b) => b.value - a.value);

  // Prepare data for radial bar chart
  const radialData = wordFrequencyData.slice(0, 5).map((item, index) => ({
    name: item.word,
    count: item.count,
    fill: item.fill,
    // For radial bar we need values that work well visually
    value: (item.count / Math.max(...wordFrequencyData.map(w => w.count))) * 100
  }));

  // Prepare timeline data showing profanity distribution over time
  const timelineData = profaneWords
    .map(word => ({
      time: word.start,
      count: 1,
      word: word.word
    }))
    .sort((a, b) => a.time - b.time);

  // Group by time segments (every 0.5 seconds)
  const segmentedTimeline: { time: string; count: number }[] = [];
  const segmentSize = 0.5;
  const maxTime = Math.max(...profaneWords.map(w => w.end));
  
  for (let t = 0; t <= maxTime; t += segmentSize) {
    const count = profaneWords.filter(w => w.start >= t && w.start < t + segmentSize).length;
    segmentedTimeline.push({
      time: `${t.toFixed(1)}s`,
      count
    });
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const tooltipItem = payload[0];
      const occurrenceCount = tooltipItem.payload.count ?? tooltipItem.value;
      return (
        <div className="bg-slate-950 border border-violet-500/30 rounded-lg p-3 shadow-xl">
          <p className="text-slate-200 font-medium">{tooltipItem.name}</p>
          <p className="text-violet-400 text-sm">
            {occurrenceCount} occurrence{occurrenceCount !== 1 ? 's' : ''}
          </p>
          {tooltipItem.payload.percentage && (
            <p className="text-slate-400 text-xs">
              {tooltipItem.payload.percentage}% of total
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="p-6 space-y-6">
      {showHeader && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-violet-500/20 to-purple-600/20 rounded-lg border border-violet-500/30">
              <BarChart3 className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <h4 className="text-slate-200 text-sm font-medium">Profanity Analytics Dashboard</h4>
              <p className="text-slate-400 text-xs">Comprehensive content analysis</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xl font-bold bg-gradient-to-r from-violet-400 to-purple-400 bg-clip-text text-transparent">
              {profaneWords.length}
            </div>
            <div className="text-xs text-slate-500">Total Detections</div>
          </div>
        </div>
      )}

      {/* Grid Layout for Charts */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Donut Chart - Language Distribution */}
        <div className="bg-slate-950/50 rounded-xl p-4 border border-slate-800/50">
          <div className="flex items-center gap-2 mb-4">
            <Globe className="w-4 h-4 text-cyan-400" />
            <h5 className="text-slate-200 text-sm font-medium">Language Distribution</h5>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={languagePieData}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={3}
                dataKey="value"
                label={({ name, percentage }) => `${name} ${percentage}%`}
                labelLine={{ stroke: '#64748b', strokeWidth: 1 }}
              >
                {languagePieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} stroke="#0f172a" strokeWidth={2} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-2 mt-3 justify-center">
            {languagePieData.map((item, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.fill }}></div>
                <span className="text-xs text-slate-400">{item.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Radial Bar Chart - Top Words */}
        <div className="bg-slate-950/50 rounded-xl p-4 border border-slate-800/50">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-violet-400" />
            <h5 className="text-slate-200 text-sm font-medium">Top Profane Words</h5>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <RadialBarChart 
              cx="50%" 
              cy="50%" 
              innerRadius="20%" 
              outerRadius="90%" 
              data={radialData}
              startAngle={90}
              endAngle={-270}
            >
              <RadialBar
                minAngle={15}
                background={{ fill: '#1e293b' }}
                clockWise
                dataKey="value"
                cornerRadius={10}
              />
              <Legend 
                iconSize={8}
                layout="vertical"
                verticalAlign="middle"
                align="right"
                formatter={(value, entry: any) => (
                  <span className="text-slate-300 text-xs">
                    {value} ({entry.payload.count}x)
                  </span>
                )}
              />
              <Tooltip content={<CustomTooltip />} />
            </RadialBarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Timeline Area Chart - Full Width */}
      <div className="bg-slate-950/50 rounded-xl p-4 border border-slate-800/50">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4 text-rose-400" />
          <h5 className="text-slate-200 text-sm font-medium">Profanity Timeline Distribution</h5>
          <span className="ml-auto text-xs text-slate-500">Occurrences over time</span>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={segmentedTimeline} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`colorCount-${file.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.1}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} />
            <XAxis 
              dataKey="time" 
              stroke="#64748b" 
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              tickLine={{ stroke: '#475569' }}
            />
            <YAxis 
              stroke="#64748b" 
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              tickLine={{ stroke: '#475569' }}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: '#0f172a', 
                border: '1px solid rgba(139, 92, 246, 0.3)',
                borderRadius: '8px',
                color: '#e2e8f0'
              }}
              labelStyle={{ color: '#cbd5e1' }}
            />
            <Area 
              type="monotone" 
              dataKey="count" 
              stroke="#f43f5e" 
              strokeWidth={2}
              fillOpacity={1} 
              fill={`url(#colorCount-${file.id})`}
              dot={{ fill: '#f43f5e', strokeWidth: 2, r: 3 }}
              activeDot={{ r: 5, fill: '#f43f5e', stroke: '#fff', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gradient-to-br from-violet-950/30 to-violet-900/10 border border-violet-800/30 rounded-lg p-3">
          <div className="text-xl font-bold text-violet-400">
            {wordFrequencyData.length}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">Unique Words</div>
        </div>
        <div className="bg-gradient-to-br from-cyan-950/30 to-cyan-900/10 border border-cyan-800/30 rounded-lg p-3">
          <div className="text-xl font-bold text-cyan-400">
            {languagePieData.length}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">Languages</div>
        </div>
        <div className="bg-gradient-to-br from-rose-950/30 to-rose-900/10 border border-rose-800/30 rounded-lg p-3">
          <div className="text-xl font-bold text-rose-400">
            {((profaneWords.length / file.safetyReport.length) * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-slate-400 mt-0.5">Profanity Rate</div>
        </div>
      </div>
    </div>
  );
}
