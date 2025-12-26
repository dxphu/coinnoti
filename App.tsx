
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MarketState, SignalType, TelegramConfig, AnalysisResponse } from './types';
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
}

const App: React.FC = () => {
  const [state, setState] = useState<MarketState>({
    symbol: 'BTC',
    price: 0,
    change24h: 0,
    candles: [],
    lastAnalysis: null,
    loading: true,
    error: null,
  });

  const [watchlist, setWatchlist] = useState<string[]>(() => {
    const saved = localStorage.getItem('crypto_watchlist');
    return saved ? JSON.parse(saved) : ['BTC', 'ETH', 'SOL', 'NEAR', 'DOGE'];
  });
  const [newSymbol, setNewSymbol] = useState('');
  
  const [analyzing, setAnalyzing] = useState(false);
  const [isTestingTg, setIsTestingTg] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [nextScanTime, setNextScanTime] = useState<string>('--:--');
  const [signalLogs, setSignalLogs] = useState<SignalLog[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);
  const [showErrorDetail, setShowErrorDetail] = useState(false);
  const [tgConfig, setTgConfig] = useState<TelegramConfig>(() => {
    const saved = localStorage.getItem('tg_config');
    return saved ? JSON.parse(saved) : { botToken: '', chatId: '', isEnabled: false };
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
  }, [tgConfig, watchlist]);

  const testTelegram = async () => {
    if (!tgConfig.botToken || !tgConfig.chatId) {
      alert("Vui lòng nhập đầy đủ Token và Chat ID!");
      return;
    }
    setIsTestingTg(true);
    try {
      const text = `🔔 *KIỂM TRA KẾT NỐI*\n\nHệ thống ScalpPro đã kết nối thành công!`;
      const res = await fetch(`https://api.telegram.org/bot${tgConfig.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: tgConfig.chatId, text: text, parse_mode: 'Markdown' })
      });
      const data = await res.json();
      if (data.ok) alert("Gửi tin nhắn test thành công!");
      else throw new Error(data.description);
    } catch (e: any) {
      alert(`Lỗi Telegram: ${e.message}`);
    } finally {
      setIsTestingTg(false);
    }
  };

  const updateSignalLogs = (analysis: AnalysisResponse, symbol: string, price: number) => {
    if (analysis.signal === 'NEUTRAL') return;

    setSignalLogs(prev => {
      const timeKey = new Date().toLocaleTimeString().slice(0, 5);
      const exists = prev.find(log => log.symbol === symbol && log.time.startsWith(timeKey));
      if (exists) return prev;

      return [{
        time: new Date().toLocaleTimeString(),
        symbol,
        signal: analysis.signal,
        price,
        confidence: analysis.confidence
      }, ...prev].slice(0, 20);
    });
  };

  const sendTelegram = async (analysis: AnalysisResponse, symbol: string, price: number) => {
    updateSignalLogs(analysis, symbol, price);
    if (!tgConfig.isEnabled || !tgConfig.botToken || !tgConfig.chatId) return;
    if (analysis.signal === 'NEUTRAL' || analysis.confidence <= 75) return;

    const emoji = analysis.signal === 'BUY' ? '🔥 MUA (BUY)' : '💥 BÁN (SELL)';
    const text = `⭐ *TÍN HIỆU 5M*\n\nCặp: *${symbol}/USDT*\nHành động: *${emoji}*\nTin cậy: *${analysis.confidence}%*\nGiá: *$${price.toLocaleString()}*`;

    try {
      await fetch(`https://api.telegram.org/bot${tgConfig.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: tgConfig.chatId, text, parse_mode: 'Markdown' })
      });
    } catch (e) { console.error("Telegram Error:", e); }
  };

  const loadData = async (symbol: string, isSilent: boolean = false) => {
    if (!isSilent) {
      setAiError(null);
      setState(prev => ({ ...prev, symbol, loading: true, lastAnalysis: null, error: null }));
    }

    try {
      const [klines, ticker] = await Promise.all([
        fetchKlines(symbol, '5m'),
        fetchPrice(symbol)
      ]);

      if (currentSymbolRef.current !== symbol && !isSilent) return;

      const latestTime = klines[klines.length - 1].time;
      let analysisResult = null;

      if (latestTime !== lastAnalyzedMap.current[symbol] || !isSilent) {
        try {
          analysisResult = await analyzeMarket(symbol, klines);
          lastAnalyzedMap.current[symbol] = latestTime;
          sendTelegram(analysisResult, symbol, ticker.price);
          setAiError(null);
        } catch (err: any) {
          console.error("AI Analysis Failed:", err);
          if (!isSilent) setAiError(err.message);
        }
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
      if (currentSymbolRef.current === symbol) {
        setState(prev => ({ ...prev, loading: false, error: `Lỗi kết nối sàn Binance cho ${symbol}` }));
      }
    }
  };

  const runScanner = useCallback(async () => {
    if (analyzing || isUserSwitching.current) return;
    setAnalyzing(true);
    for (const s of watchlist) {
      if (isUserSwitching.current) break;
      await loadData(s, s !== currentSymbolRef.current);
      // Chờ lâu hơn giữa các coin: 10 giây để an toàn nhất với gói miễn phí
      await new Promise(r => setTimeout(r, 10000)); 
    }
    setAnalyzing(false);
  }, [watchlist, analyzing]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const minutes = now.getMinutes();
      const nextQuarter = (Math.floor(minutes / 15) + 1) * 15;
      const nextClose = new Date(now);
      
      if (nextQuarter === 60) {
        nextClose.setHours(now.getHours() + 1);
        nextClose.setMinutes(0, 0, 0);
      } else {
        nextClose.setMinutes(nextQuarter, 0, 0);
      }
      
      const diff = nextClose.getTime() - Date.now();
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setNextScanTime(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
      
      if (diff < 5000 && !analyzing) runScanner();
    }, 1000);
    return () => clearInterval(timer);
  }, [runScanner, analyzing]);

  useEffect(() => {
    isUserSwitching.current = true;
    loadData(state.symbol);
    const timeout = setTimeout(() => isUserSwitching.current = false, 5000);
    return () => clearTimeout(timeout);
  }, [state.symbol]);

  const addToWatchlist = () => {
    const sym = newSymbol.toUpperCase().trim().replace('USDT', '');
    if (sym && !watchlist.includes(sym)) {
      setWatchlist(prev => [...prev, sym]);
      setNewSymbol('');
      setState(p => ({ ...p, symbol: sym }));
    }
  };

  const removeFromWatchlist = (e: React.MouseEvent, sym: string) => {
    e.stopPropagation();
    const newWatchlist = watchlist.filter(s => s !== sym);
    setWatchlist(newWatchlist);
    if (state.symbol === sym && newWatchlist.length > 0) {
      setState(p => ({ ...p, symbol: newWatchlist[0] }));
    } else if (newWatchlist.length === 0) {
      setWatchlist(['BTC']);
      setState(p => ({ ...p, symbol: 'BTC' }));
    }
  };

  // Hàm helper để render thông tin lỗi AI đẹp mắt
  const renderAiError = () => {
    if (!aiError) return null;

    let displayMsg = aiError;
    let isRateLimit = aiError.includes("429") || aiError.includes("RESOURCE_EXHAUSTED");
    let errorCode = "ERR";
    
    try {
      // Thử parse nếu lỗi là JSON string
      const parsed = JSON.parse(aiError);
      if (parsed.error) {
        displayMsg = parsed.error.message;
        errorCode = parsed.error.code || parsed.error.status || "ERR";
      }
    } catch (e) {}

    return (
      <div className={`mb-6 p-4 rounded-2xl border transition-all ${isRateLimit ? 'bg-amber-500/10 border-amber-500/30 text-amber-500' : 'bg-rose-500/10 border-rose-500/30 text-rose-500'}`}>
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 p-1.5 rounded-lg ${isRateLimit ? 'bg-amber-500/20' : 'bg-rose-500/20'}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="flex-1">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] font-black uppercase tracking-wider">
                {isRateLimit ? 'CẢNH BÁO QUOTA (RATE LIMIT)' : 'LỖI HỆ THỐNG AI'}
              </span>
              <span className="text-[9px] font-mono bg-black/30 px-1.5 py-0.5 rounded">CODE: {errorCode}</span>
            </div>
            <p className="text-xs font-bold leading-relaxed">{displayMsg}</p>
            
            <button 
              onClick={() => setShowErrorDetail(!showErrorDetail)}
              className="mt-3 text-[9px] font-black uppercase tracking-tighter hover:underline opacity-70"
            >
              {showErrorDetail ? 'Ẩn chi tiết kỹ thuật' : 'Xem chi tiết kỹ thuật'}
            </button>
            
            {showErrorDetail && (
              <div className="mt-2 p-3 bg-black/40 rounded-xl font-mono text-[9px] overflow-x-auto whitespace-pre-wrap break-all border border-white/5">
                {aiError}
              </div>
            )}
          </div>
        </div>
        
        {isRateLimit && (
          <div className="mt-4 flex items-center gap-2 text-[10px] bg-amber-500/10 p-2 rounded-xl border border-amber-500/20">
            <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
            <span className="font-medium italic">Hệ thống đang tự động giãn thời gian quét. Vui lòng không F5 liên tục.</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-200 p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
      <header className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-8 gap-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-600 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-900/40">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight italic uppercase">ScalpPro <span className="text-emerald-400">5M/15M</span></h1>
            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-[0.2em] mt-1">AI Technical Analysis</p>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 bg-slate-900/50 p-2 rounded-2xl border border-slate-800 w-full lg:w-auto backdrop-blur-sm">
          <div className="flex items-center gap-2 px-3 border-r border-slate-800">
            <input 
              type="text" 
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value)}
              placeholder="Thêm Coin..."
              className="bg-transparent text-xs font-bold outline-none w-24 text-emerald-400 placeholder:text-slate-600"
              onKeyDown={(e) => e.key === 'Enter' && addToWatchlist()}
            />
            <button onClick={addToWatchlist} className="text-emerald-500 hover:text-emerald-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {watchlist.map(sym => (
              <div
                key={sym}
                onClick={() => setState(p => ({...p, symbol: sym}))}
                className={`group flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-black transition-all border cursor-pointer ${
                  state.symbol === sym ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600'
                }`}
              >
                {sym}
                <button 
                  onClick={(e) => removeFromWatchlist(e, sym)}
                  className={`p-0.5 rounded-md hover:bg-black/20 transition-colors ${state.symbol === sym ? 'text-white/60 hover:text-white' : 'text-slate-600 hover:text-rose-500'}`}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            ))}
          </div>
          <button onClick={() => setShowSettings(!showSettings)} className="p-2 rounded-xl border bg-slate-800/50 border-slate-700 text-slate-400 hover:bg-slate-800 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="mb-8 p-6 bg-slate-900 border border-emerald-600/30 rounded-3xl animate-in zoom-in duration-300 shadow-2xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Bot Token</label>
              <input 
                type="password" 
                value={tgConfig.botToken} 
                onChange={(e) => setTgConfig({...tgConfig, botToken: e.target.value})} 
                className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl outline-none text-sm focus:border-emerald-500/50" 
                placeholder="Nhập Token..." 
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Chat ID</label>
              <input 
                type="text" 
                value={tgConfig.chatId} 
                onChange={(e) => setTgConfig({...tgConfig, chatId: e.target.value})} 
                className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl outline-none text-sm focus:border-emerald-500/50" 
                placeholder="Nhập Chat ID..." 
              />
            </div>
            <div className="md:col-span-2 flex justify-between items-center bg-slate-950 p-4 rounded-xl border border-slate-800">
               <div>
                 <span className="text-sm font-bold block">Thông báo Telegram VIP</span>
                 <span className="text-[10px] text-slate-500">Chỉ gửi kèo đẹp (Confidence > 75%)</span>
               </div>
               <button 
                  onClick={() => setTgConfig({...tgConfig, isEnabled: !tgConfig.isEnabled})}
                  className={`w-12 h-6 rounded-full transition-all relative ${tgConfig.isEnabled ? 'bg-emerald-600' : 'bg-slate-700'}`}
               >
                  <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${tgConfig.isEnabled ? 'left-7' : 'left-1'}`} />
               </button>
            </div>
            <button onClick={testTelegram} disabled={isTestingTg} className="md:col-span-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 p-3 rounded-xl font-black text-xs transition-all">
              {isTestingTg ? 'ĐANG GỬI...' : 'TEST GỬI TIN NHẮN'}
            </button>
          </div>
        </div>
      )}

      {state.error && <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/20 text-rose-500 rounded-2xl text-xs font-bold text-center animate-pulse">⚠️ {state.error}</div>}
      
      {renderAiError()}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-900/30 p-5 rounded-3xl border border-slate-800/50">
           <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Cặp hiện tại</p>
           <p className="text-2xl font-mono font-black text-white">{state.symbol}/USDT</p>
        </div>
        <div className="bg-slate-900/30 p-5 rounded-3xl border border-slate-800/50">
           <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Giá Binance</p>
           <p className="text-xl font-mono font-bold text-white">${state.price.toLocaleString()}</p>
        </div>
        <div className="bg-slate-900/30 p-5 rounded-3xl border border-slate-800/50">
           <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Chu kỳ quét tiếp (15m)</p>
           <p className="text-2xl font-mono font-bold text-emerald-400">{nextScanTime}</p>
        </div>
        <div className="bg-slate-900/30 p-5 rounded-3xl border border-slate-800/50">
           <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Scanner AI 5M</p>
           <p className={`text-sm font-bold uppercase flex items-center gap-2 ${analyzing ? 'text-amber-500' : 'text-emerald-500'}`}>
             {analyzing ? (
               <><span className="w-2 h-2 bg-amber-500 rounded-full animate-ping" />Đang quét...</>
             ) : 'Hoạt động'}
           </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <Chart data={state.candles} analysis={state.lastAnalysis} />
          
          <div className="bg-slate-900/30 rounded-3xl border border-slate-800/50 p-6 backdrop-blur-sm">
            <h3 className="text-sm font-black uppercase text-slate-400 mb-6 flex justify-between">
              Lịch sử tín hiệu 5M (Quét 15m)
              <span className="text-[9px] text-slate-600 italic">Scalping Focus</span>
            </h3>
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {signalLogs.length > 0 ? signalLogs.map((log, i) => (
                <div 
                  key={i} 
                  className="flex items-center justify-between p-4 bg-slate-950/40 rounded-2xl border border-slate-800 hover:border-emerald-500/50 transition-all cursor-pointer"
                  onClick={() => setState(p => ({...p, symbol: log.symbol}))}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm ${log.signal === 'BUY' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>{log.signal[0]}</div>
                    <div>
                      <p className="font-black text-white">{log.symbol} <span className="text-[10px] text-slate-500 ml-2 font-normal">{log.time}</span></p>
                      <p className={`text-[10px] font-black ${log.signal === 'BUY' ? 'text-emerald-500' : 'text-rose-500'}`}>CONFIDENCE: {log.confidence}%</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-mono font-bold text-white">${log.price.toLocaleString()}</p>
                    <p className="text-[9px] text-slate-600 font-bold uppercase tracking-tighter">Xem biểu đồ</p>
                  </div>
                </div>
              )) : (
                <div className="text-center py-12 border border-dashed border-slate-800 rounded-2xl">
                   <p className="text-slate-600 text-sm italic">Đang chờ tín hiệu 5M mới...</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <h2 className="text-lg font-black text-white uppercase flex items-center gap-3">
            <span className="w-1.5 h-6 bg-emerald-600 rounded-full" /> AI Phân tích 5M: {state.symbol}
          </h2>
          {state.loading ? (
            <div className="bg-slate-900/30 border border-slate-800 rounded-3xl p-16 text-center shadow-inner">
               <div className="w-10 h-10 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mx-auto mb-4" />
               <p className="text-emerald-500 font-black text-xs uppercase tracking-widest">Tải dữ liệu 5M...</p>
            </div>
          ) : state.lastAnalysis ? (
            <SignalCard analysis={state.lastAnalysis} />
          ) : (
            <div className="bg-slate-900/30 border border-dashed border-slate-800 rounded-3xl p-12 text-center text-slate-500">
              Đang chờ dữ liệu nến 5M mới...
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
