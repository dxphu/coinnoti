
import React from 'react';
import { AnalysisResponse, SignalType } from '../types';

interface SignalCardProps {
  analysis: AnalysisResponse;
}

const SignalCard: React.FC<SignalCardProps> = ({ analysis }) => {
  const getSignalColor = (signal: SignalType) => {
    switch (signal) {
      case 'BUY': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
      case 'SELL': return 'text-rose-400 bg-rose-400/10 border-rose-400/20';
      default: return 'text-amber-400 bg-amber-400/10 border-amber-400/20';
    }
  };

  const getSignalText = (signal: SignalType) => {
    switch (signal) {
      case 'BUY': return 'NÊN MUA';
      case 'SELL': return 'NÊN BÁN';
      default: return 'THEO DÕI';
    }
  };

  const getSignalBadge = (signal: SignalType) => {
    switch (signal) {
      case 'BUY': return 'bg-emerald-500 text-white';
      case 'SELL': return 'bg-rose-500 text-white';
      default: return 'bg-amber-500 text-white';
    }
  };

  return (
    <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className={`p-6 rounded-2xl border ${getSignalColor(analysis.signal)}`}>
        <div className="flex justify-between items-start mb-4">
          <div>
            <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${getSignalBadge(analysis.signal)}`}>
              TÍN HIỆU: {getSignalText(analysis.signal)}
            </span>
            <h3 className="text-2xl font-bold mt-2">Độ tin cậy: {analysis.confidence}%</h3>
          </div>
          <div className="text-right">
            <p className="text-xs opacity-60 uppercase tracking-widest">Xu hướng</p>
            <p className="font-semibold text-white">{analysis.indicators.trend}</p>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium opacity-80 underline underline-offset-4 decoration-dotted">Lý do kỹ thuật (AI):</p>
          <ul className="space-y-2">
            {analysis.reasoning.map((reason, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-current shrink-0" />
                <span className="text-slate-200">{reason}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
          <p className="text-xs text-slate-400 uppercase mb-1">Mức Hỗ Trợ</p>
          <p className="text-emerald-400 font-mono text-lg">${analysis.keyLevels.support.toLocaleString()}</p>
        </div>
        <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
          <p className="text-xs text-slate-400 uppercase mb-1">Mức Kháng Cự</p>
          <p className="text-rose-400 font-mono text-lg">${analysis.keyLevels.resistance.toLocaleString()}</p>
        </div>
        <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 col-span-2 flex justify-between items-center">
          <div>
            <p className="text-xs text-slate-400 uppercase mb-1">Chỉ số RSI</p>
            <p className="text-slate-200 font-bold">{analysis.indicators.rsi.toFixed(2)}</p>
          </div>
          <div className="h-2 flex-1 mx-4 bg-slate-700 rounded-full overflow-hidden">
             <div 
               className={`h-full ${analysis.indicators.rsi > 70 ? 'bg-rose-500' : analysis.indicators.rsi < 30 ? 'bg-emerald-500' : 'bg-blue-500'}`} 
               style={{ width: `${analysis.indicators.rsi}%` }} 
             />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignalCard;
