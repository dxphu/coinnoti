
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

  return (
    <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className={`p-6 rounded-2xl border ${getSignalColor(analysis.signal)}`}>
        <div className="flex justify-between items-start mb-4">
          <div>
            <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
              analysis.signal === 'BUY' ? 'bg-emerald-500' : analysis.signal === 'SELL' ? 'bg-rose-500' : 'bg-amber-500'
            } text-white`}>
              TÍN HIỆU: {getSignalText(analysis.signal)}
            </span>
            <h3 className="text-2xl font-black mt-2 text-white">Tin cậy: {analysis.confidence}%</h3>
          </div>
          <div className="text-right">
            <p className="text-[10px] opacity-60 uppercase font-bold tracking-widest">Xu hướng</p>
            <p className="font-bold text-white">{analysis.indicators.trend}</p>
          </div>
        </div>

        {analysis.tradePlan && analysis.signal !== 'NEUTRAL' && (
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="bg-emerald-500/20 border border-emerald-500/30 p-3 rounded-xl">
              <p className="text-[10px] text-emerald-400 uppercase font-black mb-1">Target (TP)</p>
              <p className="text-xl font-mono font-black text-emerald-400">${analysis.tradePlan.takeProfit.toLocaleString()}</p>
            </div>
            <div className="bg-rose-500/20 border border-rose-500/30 p-3 rounded-xl">
              <p className="text-[10px] text-rose-400 uppercase font-black mb-1">Cắt lỗ (SL)</p>
              <p className="text-xl font-mono font-black text-rose-400">${analysis.tradePlan.stopLoss.toLocaleString()}</p>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-white/80">Phân tích kỹ thuật:</p>
          <ul className="space-y-2">
            {analysis.reasoning.map((reason, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-current shrink-0" />
                <span className="text-slate-300">{reason}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Hỗ Trợ</p>
          <p className="text-emerald-500 font-mono font-bold">${analysis.keyLevels.support.toLocaleString()}</p>
        </div>
        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Kháng Cự</p>
          <p className="text-rose-500 font-mono font-bold">${analysis.keyLevels.resistance.toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
};

export default SignalCard;
