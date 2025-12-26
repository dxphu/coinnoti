
import React from 'react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';
import { CandleData, AnalysisResponse } from '../types';

interface ChartProps {
  data: CandleData[];
  analysis: AnalysisResponse | null;
}

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-slate-950/95 border border-slate-800 p-4 rounded-2xl shadow-2xl backdrop-blur-md">
        <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-2 border-b border-slate-800 pb-1">
          {new Date(data.time).toLocaleString('vi-VN')}
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <p className="text-slate-400 text-[10px] uppercase">Đóng</p>
          <p className="text-white font-mono font-bold text-xs text-right">${data.close.toLocaleString()}</p>
          <p className="text-slate-400 text-[10px] uppercase">Cao</p>
          <p className="text-emerald-500 font-mono font-bold text-xs text-right">${data.high.toLocaleString()}</p>
          <p className="text-slate-400 text-[10px] uppercase">Thấp</p>
          <p className="text-rose-500 font-mono font-bold text-xs text-right">${data.low.toLocaleString()}</p>
        </div>
      </div>
    );
  }
  return null;
};

const Chart: React.FC<ChartProps> = ({ data, analysis }) => {
  const chartData = data.map(c => ({
    ...c,
    formattedTime: new Date(c.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }));

  const minPrice = Math.min(...data.map(d => d.low)) * 0.999;
  const maxPrice = Math.max(...data.map(d => d.high)) * 1.001;

  return (
    <div className="h-[450px] w-full bg-slate-950/30 rounded-3xl p-6 border border-slate-900 shadow-inner overflow-hidden relative">
      <div className="absolute top-6 left-8 z-10">
         <div className="flex items-center gap-2">
            <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">Strategic Trend View</span>
         </div>
      </div>
      
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.2}/>
              <stop offset="100%" stopColor="#10b981" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} strokeOpacity={0.3} />
          <XAxis 
            dataKey="formattedTime" 
            stroke="#475569" 
            fontSize={9} 
            tickLine={false} 
            axisLine={false}
            interval={Math.floor(chartData.length / 10)}
          />
          <YAxis domain={[minPrice, maxPrice]} hide />
          <Tooltip content={<CustomTooltip />} />
          <Area 
            type="monotone" 
            dataKey="close" 
            stroke="#10b981" 
            strokeWidth={2}
            fillOpacity={1} 
            fill="url(#colorPrice)" 
          />
          {analysis && (
            <>
              <ReferenceLine y={analysis.keyLevels.support} stroke="#10b981" strokeDasharray="3 3" label={{ position: 'right', value: 'Support', fill: '#10b981', fontSize: 10 }} />
              <ReferenceLine y={analysis.keyLevels.resistance} stroke="#ef4444" strokeDasharray="3 3" label={{ position: 'right', value: 'Resistance', fill: '#ef4444', fontSize: 10 }} />
            </>
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default Chart;
