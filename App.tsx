
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
}

const App: React.FC = () => {
  const [watchlist, setWatchlist] = useState<string[]>(() => {
    const saved = localStorage.getItem('crypto_watchlist');
    return saved ? JSON.parse(saved) : ['BNB', 'BTC', 'ETH'];
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

  const [newSymbol, setNewSymbol] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [isTestingTg, setIsTestingTg] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [nextScanTime, setNextScanTime] = useState<string>('--:--');
  const [signalLogs, setSignalLogs] = useState<SignalLog[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);
  const [tgConfig, setTgConfig] = useState<TelegramConfig>(() => {
    const saved = localStorage.getItem('tg_config');
    return saved ? JSON.parse(saved) : { botToken: '', chatId: '', isEnabled: false, minConfidence: 75 };
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

  const sendTelegramNotification = async (analysis: AnalysisResponse, symbol: string, price: number, interval: string) => {
    if (analysis.signal !== 'NEUTRAL') {
      setSignalLogs(prev => {
        const timeStr = new Date().toLocaleTimeString();
        return [{ time: timeStr, symbol, signal: analysis.signal, price, confidence: analysis.confidence, interval }, ...prev].slice(0, 20);
      });
    }

    if (!tgConfig.isEnabled || !tgConfig.botToken || !tgConfig.chatId) return;
    if (analysis.signal === 'NEUTRAL' || analysis.confidence < tgConfig.minConfidence) return;

    const emoji = analysis.signal === 'BUY' ? '🟢 MUA (BUY)' : '🔴 BÁN (SELL)';
    const text = `🔔 *TÍN HIỆU CHIẾN THUẬT ${interval}*\n\n💎 Cặp: *${symbol}/USDT*\n🎯 Hành động: *${emoji}*\n🔥 Tin cậy: *${analysis.confidence}%*\n💰 Giá: *$${price.toLocaleString()}*\n🤖 Engine: \`${analysis.activeModel}\`\n\n📝 Lý do: ${analysis.reasoning[0]}`;

    try {
      await fetch(`https://api.telegram.org/bot${tgConfig.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: tgConfig.chatId, text, parse_mode: 'Markdown' })
      });
    } catch (e) { console.error("Telegram Error", e); }
  };

  const testTelegram = async () => {
    if (!tgConfig.botToken || !tgConfig.chatId) {
      alert("Thiếu Token hoặc Chat ID!");
      return;
    }
    setIsTestingTg(true);
    try {
      const text = `✅ *KẾT NỐI SCALPPRO OK*\nID: \`${tgConfig.chatId}\`\nNgưỡng báo: \`${tgConfig.minConfidence}%\``;
      const res = await fetch(`https://api.telegram.org/bot${tgConfig.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: tgConfig.chatId, text, parse_mode: 'Markdown' })
      });
      const data = await res.json();
      if (data.ok) alert("Đã gửi tin nhắn test!");
      else alert("Lỗi Telegram: " + data.description);
    } catch (e: any) { alert("Lỗi kết nối: " + e.message); } finally { setIsTestingTg(false); }
  };

  const loadData = async (symbol: string, isSilent: boolean = false) => {
    if (!isSilent) {
      setAiError(null);
      setState(prev => ({ ...prev, symbol, loading: true, lastAnalysis: null, error: null }));
    }
    
    // Chuyển đổi scanInterval sang định dạng Binance (15 -> '15m')
    const intervalStr = scanInterval >= 60 ? `${scanInterval/60}h` : `${scanInterval}m`;

    try {
      const [klines, ticker] = await Promise.all([
        fetchKlines(symbol, intervalStr), 
        fetchPrice(symbol)
      ]);

      if (currentSymbolRef.current !== symbol && !isSilent) return;
      
      const latestTime = klines[klines.length - 1].time;
      let analysisResult = null;

      if (latestTime !== lastAnalyzedMap.current[symbol] || !isSilent) {
        try {
          analysisResult = await analyzeMarket(symbol, klines, selectedModel);
          lastAnalyzedMap.current[symbol] = latestTime;
          sendTelegramNotification(analysisResult, symbol, ticker.price, intervalStr);
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
      // Giãn cách 8s để tránh kẹt API Binance/Gemini Free tier
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

  const addToWatchlist = () => {
    const sym = newSymbol.toUpperCase().trim().replace('USDT', '');
    if (sym && !watchlist.includes(sym)) {
      setWatchlist([...watchlist, sym]);
      setNewSymbol('');
      setState(p => ({ ...p, symbol: sym }));
    }
  };

  const removeFromWatchlist = (e: React.MouseEvent, sym: string) => {
    e.stopPropagation();
    const newWatchlist = watchlist.filter(s => s !== sym);
    setWatchlist(newWatchlist);
    if (state.symbol === sym) setState(p => ({ ...p, symbol: newWatchlist[0] || 'BNB' }));
  };

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-200 p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
      <header className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-8 gap-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-600 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-900/40">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
          </div>
          <div>
            <h1 className="text-2xl font-black text-white italic uppercase">ScalpPro <span className="text-emerald-400">AI</span></h1>
            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-[0.2em] mt-1">Multi-Model Telegram Hunter</p>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 bg-slate-900/50 p-2 rounded-2xl border border-slate-800 w-full lg:w-auto backdrop-blur-sm">
          <div className="flex items-center gap-2 px-3 border-r border-slate-800">
            <input type="text" value={newSymbol} onChange={(e) => setNewSymbol(e.target.value)} placeholder="Mã..." className="bg-transparent text-xs font-bold outline-none w-16 text-emerald-400 uppercase" onKeyDown={(e) => e.key === 'Enter' && addToWatchlist()} />
            <button onClick={addToWatchlist} className="text-emerald-500 hover:scale-110 transition-transform"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
          </div>
          <div className="flex flex-wrap gap-2">
            {watchlist.map(sym => (
              <div key={sym} onClick={() => setState(p => ({...p, symbol: sym}))} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-black transition-all border cursor-pointer ${state.symbol === sym ? 'bg-emerald-600 border-emerald-500 text-white shadow-lg' : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                {sym}
                <button onClick={(e) => removeFromWatchlist(e, sym)} className="p-0.5 hover:text-rose-500"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg></button>
              </div>
            ))}
          </div>
          <button onClick={() => setShowSettings(!showSettings)} className={`p-2 rounded-xl border transition-all ${showSettings ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800/50 border-slate-700 text-slate-400'}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="mb-8 p-6 bg-slate-900 border border-emerald-600/30 rounded-3xl shadow-2xl animate-in zoom-in duration-300">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Mô hình AI Ưu tiên</label>
              <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value as GeminiModel)} className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl outline-none text-sm text-emerald-400 font-bold">
                <optgroup label="Dòng Pro (Hạn chế Free)">
                  <option value="gemini-3-pro-preview">Gemini 3 Pro</option>
                </optgroup>
                <optgroup label="Dòng 2.5 & 3 Flash (Hạn mức Free cao)">
                  <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
                  <option value="gemini-2.5-flash-preview-09-2025">Gemini 2.5 Flash</option>
                  <option value="gemini-2.5-flash-lite-latest">Gemini 2.5 Flash Lite</option>
                </optgroup>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Khung nến / Chu kỳ quét</label>
              <select value={scanInterval} onChange={(e) => setScanInterval(parseInt(e.target.value))} className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl outline-none text-sm text-emerald-400 font-bold">
                <option value={1}>1 Phút</option>
                <option value={5}>5 Phút</option>
                <option value={15}>15 Phút</option>
                <option value={60}>1 Giờ</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Telegram Token</label>
              <input type="password" value={tgConfig.botToken} onChange={(e) => setTgConfig({...tgConfig, botToken: e.target.value})} className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl outline-none text-sm" placeholder="Bot Token..." />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Telegram Chat ID</label>
              <input type="text" value={tgConfig.chatId} onChange={(e) => setTgConfig({...tgConfig, chatId: e.target.value})} className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl outline-none text-sm" placeholder="ID người nhận..." />
            </div>
          </div>
          
          <div className="mt-8 pt-8 border-t border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-4">
              <div className="flex justify-between items-center mb-1">
                <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Ngưỡng độ tin cậy báo động: {tgConfig.minConfidence}%</label>
              </div>
              <input 
                type="range" 
                min="50" 
                max="95" 
                step="5"
                value={tgConfig.minConfidence} 
                onChange={(e) => setTgConfig({...tgConfig, minConfidence: parseInt(e.target.value)})} 
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
            </div>

            <div className="flex items-center gap-4 bg-slate-950 p-4 rounded-2xl border border-slate-800 h-fit">
               <div className="flex-1">
                 <span className="text-sm font-bold block text-white">Thông báo Telegram</span>
                 <span className="text-[10px] text-slate-500 uppercase">{tgConfig.isEnabled ? 'ĐANG BẬT' : 'ĐANG TẮT'}</span>
               </div>
               <button onClick={() => setTgConfig({...tgConfig, isEnabled: !tgConfig.isEnabled})} className={`w-14 h-7 rounded-full relative transition-all shadow-inner ${tgConfig.isEnabled ? 'bg-emerald-600' : 'bg-slate-700'}`}>
                  <div className={`w-5 h-5 bg-white rounded-full absolute top-1 transition-all ${tgConfig.isEnabled ? 'left-8' : 'left-1'}`} />
               </button>
            </div>

            <button onClick={testTelegram} disabled={isTestingTg} className="bg-slate-800 hover:bg-emerald-600 p-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all h-fit self-end">
              {isTestingTg ? 'Đang gửi...' : 'Gửi Test Telegram'}
            </button>
          </div>
        </div>
      )}

      {aiError && (
        <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-rose-500 text-xs font-bold flex items-center gap-3">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <p>{aiError}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-900/30 p-5 rounded-3xl border border-slate-800/50">
           <p className="text-[10px] text-slate-500 uppercase font-bold mb-1 tracking-tighter">Coin / Giá</p>
           <p className="text-2xl font-black text-white">{state.symbol} <span className="text-sm font-mono text-slate-400 ml-2">${state.price.toLocaleString()}</span></p>
        </div>
        <div className="bg-slate-900/30 p-5 rounded-3xl border border-slate-800/50">
           <p className="text-[10px] text-slate-500 uppercase font-bold mb-1 tracking-tighter">Đếm ngược quét ({scanInterval}m)</p>
           <p className="text-2xl font-mono font-bold text-emerald-400">{nextScanTime}</p>
        </div>
        <div className="bg-slate-900/30 p-5 rounded-3xl border border-slate-800/50">
           <p className="text-[10px] text-slate-500 uppercase font-bold mb-1 tracking-tighter">AI Engine (Env: OK)</p>
           <p className="text-sm font-mono font-bold text-white truncate">{state.lastAnalysis?.activeModel || selectedModel}</p>
        </div>
        <div className="bg-slate-900/30 p-5 rounded-3xl border border-slate-800/50">
           <p className="text-[10px] text-slate-500 uppercase font-bold mb-1 tracking-tighter">Thông báo (>{tgConfig.minConfidence}%)</p>
           <p className={`text-sm font-bold uppercase ${tgConfig.isEnabled ? 'text-emerald-500' : 'text-slate-600'}`}>{tgConfig.isEnabled ? 'Đang bật ✅' : 'Đã tắt ❌'}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <Chart data={state.candles} analysis={state.lastAnalysis} />
          <div className="bg-slate-900/30 rounded-3xl border border-slate-800/50 p-6 shadow-xl">
            <h3 className="text-xs font-black uppercase text-slate-400 mb-6 flex justify-between border-b border-slate-800 pb-4">Nhật ký tín hiệu gần đây</h3>
            <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
              {signalLogs.map((log, i) => (
                <div key={i} onClick={() => setState(p => ({...p, symbol: log.symbol}))} className="flex items-center justify-between p-4 bg-slate-950/40 rounded-2xl border border-slate-800 hover:border-emerald-500/50 cursor-pointer group transition-all">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-[10px] ${log.signal === 'BUY' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>{log.signal}</div>
                    <div>
                      <p className="font-black text-sm text-white group-hover:text-emerald-400">{log.symbol} <span className="text-[9px] text-slate-500 ml-2 font-normal">[{log.interval}] {log.time}</span></p>
                      <p className="text-[9px] font-bold uppercase text-slate-500">Tin cậy: <span className={log.confidence >= tgConfig.minConfidence ? 'text-emerald-500' : 'text-slate-400'}>{log.confidence}%</span></p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-mono font-bold text-white">${log.price.toLocaleString()}</p>
                  </div>
                </div>
              ))}
              {signalLogs.length === 0 && <div className="text-center py-10 opacity-20 text-xs font-bold uppercase tracking-widest">Đang trực chiến...</div>}
            </div>
          </div>
        </div>
        <div className="space-y-6">
          <h2 className="text-lg font-black text-white uppercase flex items-center gap-3"><span className="w-1.5 h-6 bg-emerald-600 rounded-full" /> Phân tích: {state.symbol}</h2>
          {state.loading ? (
            <div className="bg-slate-900/30 border border-slate-800 rounded-3xl p-20 text-center backdrop-blur-md">
              <div className="w-10 h-10 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mx-auto mb-4" />
              <p className="text-emerald-500 font-black text-[10px] uppercase animate-pulse">AI đang phân tích nến {scanInterval}m...</p>
            </div>
          ) : state.lastAnalysis ? (
            <SignalCard analysis={state.lastAnalysis} />
          ) : (
            <div className="bg-slate-900/30 border border-dashed border-slate-800 rounded-3xl p-16 text-center text-slate-500"><p className="italic text-sm">Đang đợi nến đóng hoặc nhấn đổi coin...</p></div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
