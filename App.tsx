
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MarketState, SignalType, TelegramConfig, AnalysisResponse, GeminiModel } from './types';
import { fetchKlines, fetchPrice } from './services/binance';
import { analyzeMarket } from './services/gemini';
import Chart from './components/Chart';
import SignalCard from './components/SignalCard';

interface SignalLog {
  time: string;
  symbol: string;
  signal: SignalType;
  price: number;
  confidence: number;
  interval: string;
  dropPercent?: number;
}

const App: React.FC = () => {
  const [watchlist, setWatchlist] = useState<string[]>(() => {
    const saved = localStorage.getItem('crypto_watchlist');
    return saved ? JSON.parse(saved) : ['BNB', 'BTC', 'ETH', 'SOL'];
  });

  const [scanInterval, setScanInterval] = useState<number>(() => {
    const saved = localStorage.getItem('scan_interval');
    return saved ? parseInt(saved) : 15;
  });

  const [selectedModel, setSelectedModel] = useState<GeminiModel>(() => {
    const saved = localStorage.getItem('selected_model');
    return (saved as GeminiModel) || 'gemini-2.5-flash-preview-09-2025';
  });

  const [state, setState] = useState<MarketState>(() => ({
    symbol: watchlist[0] || 'BNB',
    price: 0,
    change24h: 0,
    candles: [],
    lastAnalysis: null,
    loading: true,
    error: null,
  }));

  const [currentDrop, setCurrentDrop] = useState<number>(0);
  const [newSymbol, setNewSymbol] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [isTestingTg, setIsTestingTg] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [nextScanTime, setNextScanTime] = useState<string>('--:--');
  const [signalLogs, setSignalLogs] = useState<SignalLog[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);
  const [tgConfig, setTgConfig] = useState<TelegramConfig>(() => {
    const saved = localStorage.getItem('tg_config');
    return saved ? JSON.parse(saved) : { botToken: '', chatId: '', isEnabled: false, minConfidence: 85 };
  });

  const currentSymbolRef = useRef(state.symbol);
  const lastAnalyzedMap = useRef<Record<string, number>>({});
  const isUserSwitching = useRef(false);

  useEffect(() => {
    currentSymbolRef.current = state.symbol;
  }, [state.symbol]);

  useEffect(() => {
    localStorage.setItem('tg_config', JSON.stringify(tgConfig));
    localStorage.setItem('crypto_watchlist', JSON.stringify(watchlist));
    localStorage.setItem('scan_interval', scanInterval.toString());
    localStorage.setItem('selected_model', selectedModel);
  }, [tgConfig, watchlist, scanInterval, selectedModel]);

  const calculateDrop = (candles: any[]) => {
    if (candles.length < 10) return 0;
    const recent = candles.slice(-8); // Xem xét 8 nến gần nhất (2 tiếng nếu nến 15p)
    const highs = recent.map(c => c.high);
    const maxHigh = Math.max(...highs);
    const lastClose = recent[recent.length - 1].close;
    return ((maxHigh - lastClose) / maxHigh) * 100;
  };

  const sendTelegramNotification = async (analysis: AnalysisResponse, symbol: string, price: number, interval: string, drop: number) => {
    if (analysis.signal !== 'NEUTRAL') {
      setSignalLogs(prev => {
        const timeStr = new Date().toLocaleTimeString();
        return [{ time: timeStr, symbol, signal: analysis.signal, price, confidence: analysis.confidence, interval, dropPercent: drop }, ...prev].slice(0, 20);
      });
    }

    if (!tgConfig.isEnabled || !tgConfig.botToken || !tgConfig.chatId) return;
    if (analysis.signal === 'NEUTRAL' || analysis.confidence < tgConfig.minConfidence) return;

    const emoji = analysis.signal === 'BUY' ? '🔥 BẮT ĐÁY (BUY DIP)' : '⚠️ BÁN (SELL)';
    
    let tradePlanText = '';
    if (analysis.tradePlan) {
      tradePlanText = `\n🎯 *KẾ HOẠCH HỒI PHỤC:*\n` +
                      `📍 Entry: \`${analysis.tradePlan.entry.toLocaleString()}\`\n` +
                      `🏁 Target (TP): \`${analysis.tradePlan.takeProfit.toLocaleString()}\`\n` +
                      `🛡️ Stop Loss (SL): \`${analysis.tradePlan.stopLoss.toLocaleString()}\`\n`;
    }

    const text = `🔔 *TÍN HIỆU CHIẾN THUẬT ${interval}*\n\n` +
                 `💎 Cặp: *${symbol}/USDT*\n` +
                 `📉 Độ sụt giảm: *-${drop.toFixed(2)}%*\n` +
                 `🎯 Hành động: *${emoji}*\n` +
                 `🔥 Tin cậy: *${analysis.confidence}%*\n` +
                 tradePlanText +
                 `🤖 Engine: \`${analysis.activeModel}\`\n\n` +
                 `📝 *Lý do:* ${analysis.reasoning.join('\n• ')}`;

    try {
      await fetch(`https://api.telegram.org/bot${tgConfig.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: tgConfig.chatId, text, parse_mode: 'Markdown' })
      });
    } catch (e) { console.error("Telegram Error", e); }
  };

  const loadData = async (symbol: string, isSilent: boolean = false) => {
    if (!isSilent) {
      setAiError(null);
      setState(prev => ({ ...prev, symbol, loading: true, lastAnalysis: null, error: null }));
    }
    
    const intervalStr = scanInterval >= 60 ? `${scanInterval/60}h` : `${scanInterval}m`;

    try {
      const [klines, ticker] = await Promise.all([
        fetchKlines(symbol, intervalStr), 
        fetchPrice(symbol)
      ]);

      if (currentSymbolRef.current !== symbol && !isSilent) return;
      
      const drop = calculateDrop(klines);
      if (currentSymbolRef.current === symbol) setCurrentDrop(drop);

      const latestTime = klines[klines.length - 1].time;
      let analysisResult = null;

      // Chỉ thực hiện phân tích sâu khi có biến động hoặc đến kỳ quét mới
      if (latestTime !== lastAnalyzedMap.current[symbol] || !isSilent) {
        try {
          analysisResult = await analyzeMarket(symbol, klines, selectedModel);
          lastAnalyzedMap.current[symbol] = latestTime;
          sendTelegramNotification(analysisResult, symbol, ticker.price, intervalStr, drop);
          setAiError(null);
        } catch (err: any) { if (!isSilent) setAiError(err.message); }
      }

      setState(prev => {
        if (prev.symbol !== symbol && !isSilent) return prev;
        return {
          ...prev,
          price: ticker.price,
          change24h: ticker.change24h,
          candles: klines,
          lastAnalysis: (isSilent && prev.symbol !== symbol) ? prev.lastAnalysis : (analysisResult || prev.lastAnalysis),
          loading: false,
          error: null
        };
      });
    } catch (err) {
      if (currentSymbolRef.current === symbol) setState(prev => ({ ...prev, loading: false, error: `Lỗi kết nối` }));
    }
  };

  const runScanner = useCallback(async () => {
    if (analyzing || isUserSwitching.current) return;
    setAnalyzing(true);
    for (const s of watchlist) {
      if (isUserSwitching.current) break;
      await loadData(s, s !== currentSymbolRef.current);
      await new Promise(r => setTimeout(r, 8000)); 
    }
    setAnalyzing(false);
  }, [watchlist, analyzing, selectedModel, scanInterval]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const totalMinutes = now.getHours() * 60 + now.getMinutes();
      const nextIntervalPoint = (Math.floor(totalMinutes / scanInterval) + 1) * scanInterval;
      const nextScanDate = new Date();
      nextScanDate.setHours(0, nextIntervalPoint, 0, 0);
      const diff = nextScanDate.getTime() - Date.now();
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setNextScanTime(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
      if (diff < 2000 && !analyzing) runScanner();
    }, 1000);
    return () => clearInterval(timer);
  }, [runScanner, analyzing, scanInterval]);

  useEffect(() => {
    isUserSwitching.current = true;
    loadData(state.symbol);
    const timeout = setTimeout(() => isUserSwitching.current = false, 5000);
    return () => clearTimeout(timeout);
  }, [state.symbol, selectedModel, scanInterval]);

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-200 p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
      <header className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-8 gap-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-600 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-900/40">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
          </div>
          <div>
            <h1 className="text-2xl font-black text-white italic uppercase tracking-tighter">ScalpPro <span className="text-emerald-400">DipHunter</span></h1>
            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-[0.2em] mt-1">Hệ thống bắt nhịp hồi AI (Docker Powered)</p>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 bg-slate-900/50 p-2 rounded-2xl border border-slate-800 w-full lg:w-auto backdrop-blur-sm">
          <div className="flex items-center gap-2 px-3 border-r border-slate-800">
            <input type="text" value={newSymbol} onChange={(e) => setNewSymbol(e.target.value)} placeholder="Mã..." className="bg-transparent text-xs font-bold outline-none w-16 text-emerald-400 uppercase" onKeyDown={(e) => e.key === 'Enter' && (()=>{const sym = newSymbol.toUpperCase().trim().replace('USDT',''); if(sym && !watchlist.includes(sym)){setWatchlist([...watchlist,sym]); setNewSymbol(''); setState(p=>({...p,symbol:sym}));}})()} />
          </div>
          <div className="flex flex-wrap gap-2">
            {watchlist.map(sym => (
              <div key={sym} onClick={() => setState(p => ({...p, symbol: sym}))} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-black transition-all border cursor-pointer ${state.symbol === sym ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800/50 border-slate-700 text-slate-400'}`}>
                {sym}
              </div>
            ))}
          </div>
          <button onClick={() => setShowSettings(!showSettings)} className="p-2 rounded-xl bg-slate-800 border border-slate-700">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="mb-8 p-6 bg-slate-900 border border-emerald-600/30 rounded-3xl animate-in slide-in-from-top-4 duration-300">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500 font-bold uppercase">Mô hình AI</label>
              <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value as GeminiModel)} className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl outline-none text-sm text-emerald-400">
                <option value="gemini-2.5-flash-preview-09-2025">Gemini 2.5 Flash (Khuyên dùng)</option>
                <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500 font-bold uppercase">Chu kỳ quét (Phút)</label>
              <select value={scanInterval} onChange={(e) => setScanInterval(parseInt(e.target.value))} className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl outline-none text-sm">
                <option value={15}>15 Phút</option>
                <option value={30}>30 Phút</option>
                <option value={60}>1 Giờ</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500 font-bold uppercase">Telegram Token</label>
              <input type="password" value={tgConfig.botToken} onChange={(e) => setTgConfig({...tgConfig, botToken: e.target.value})} className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl outline-none text-sm" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500 font-bold uppercase">Chat ID</label>
              <input type="text" value={tgConfig.chatId} onChange={(e) => setTgConfig({...tgConfig, chatId: e.target.value})} className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl outline-none text-sm" />
            </div>
          </div>
          <div className="mt-6 flex justify-between items-center border-t border-slate-800 pt-6">
             <div className="flex gap-4 items-center">
               <span className="text-xs font-bold uppercase text-slate-500">Ngưỡng tin cậy báo Tele: {tgConfig.minConfidence}%</span>
               <input type="range" min="70" max="95" step="5" value={tgConfig.minConfidence} onChange={(e)=>setTgConfig({...tgConfig, minConfidence: parseInt(e.target.value)})} className="w-32 accent-emerald-500" />
             </div>
             <button onClick={() => setTgConfig({...tgConfig, isEnabled: !tgConfig.isEnabled})} className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${tgConfig.isEnabled ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-500'}`}>
                {tgConfig.isEnabled ? 'Thông báo: ĐANG BẬT' : 'Thông báo: ĐÃ TẮT'}
             </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-900/30 p-5 rounded-3xl border border-slate-800/50">
           <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Cặp Giao Dịch</p>
           <p className="text-2xl font-black text-white">{state.symbol}/USDT</p>
        </div>
        <div className="bg-slate-900/30 p-5 rounded-3xl border border-slate-800/50">
           <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Độ sụt giảm hiện tại</p>
           <p className={`text-2xl font-mono font-bold ${currentDrop > 2.5 ? 'text-rose-500 animate-pulse' : 'text-emerald-400'}`}>
             -{currentDrop.toFixed(2)}%
           </p>
        </div>
        <div className="bg-slate-900/30 p-5 rounded-3xl border border-slate-800/50">
           <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Trạng thái hệ thống</p>
           <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${analyzing ? 'bg-amber-500 animate-ping' : 'bg-emerald-500'}`} />
              <p className="text-sm font-bold text-white uppercase">{analyzing ? 'Đang săn đáy...' : 'Đang trực chiến'}</p>
           </div>
        </div>
        <div className="bg-slate-900/30 p-5 rounded-3xl border border-slate-800/50">
           <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Lần quét kế tiếp</p>
           <p className="text-2xl font-mono font-bold text-white">{nextScanTime}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <Chart data={state.candles} analysis={state.lastAnalysis} />
          <div className="bg-slate-900/30 rounded-3xl border border-slate-800/50 p-6">
            <h3 className="text-xs font-black uppercase text-slate-400 mb-6 border-b border-slate-800 pb-4">Nhật ký thợ săn (24h qua)</h3>
            <div className="space-y-3 max-h-[300px] overflow-y-auto custom-scrollbar">
              {signalLogs.map((log, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-slate-950/40 rounded-2xl border border-slate-800">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-[10px] ${log.signal === 'BUY' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>{log.signal}</div>
                    <div>
                      <p className="font-black text-sm text-white">{log.symbol} <span className="text-[9px] text-slate-500 ml-2">{log.time}</span></p>
                      <p className="text-[9px] font-bold uppercase text-slate-400">Biến động: <span className="text-rose-500">-{log.dropPercent?.toFixed(2)}%</span> | Tin cậy: {log.confidence}%</p>
                    </div>
                  </div>
                  <p className="text-xs font-mono font-bold text-white">${log.price.toLocaleString()}</p>
                </div>
              ))}
              {signalLogs.length === 0 && <div className="text-center py-10 opacity-20 text-xs font-bold uppercase">Chưa có nhịp sập nào đủ sâu để báo lệnh...</div>}
            </div>
          </div>
        </div>
        <div className="space-y-6">
          <h2 className="text-lg font-black text-white uppercase flex items-center gap-3"><span className="w-1.5 h-6 bg-emerald-600 rounded-full" /> Phân tích chiến thuật</h2>
          {state.loading ? (
            <div className="bg-slate-900/30 border border-slate-800 rounded-3xl p-20 text-center">
              <div className="w-10 h-10 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mx-auto mb-4" />
              <p className="text-emerald-500 font-black text-[10px] uppercase">AI Đang tính toán nhịp hồi...</p>
            </div>
          ) : state.lastAnalysis ? (
            <SignalCard analysis={state.lastAnalysis} />
          ) : (
            <div className="bg-slate-900/30 border border-dashed border-slate-800 rounded-3xl p-16 text-center text-slate-500">
              <p className="text-sm italic">Giá đang ổn định. Kiên nhẫn đợi cú sập 3-4% để AI báo lệnh bắt đáy.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
