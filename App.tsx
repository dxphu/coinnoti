
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
  const [showSettings, setShowSettings] = useState(false);
  const [nextScanTime, setNextScanTime] = useState<string>('--:--');
  const [signalLogs, setSignalLogs] = useState<SignalLog[]>([]);
  const [tgConfig, setTgConfig] = useState<TelegramConfig>(() => {
    const saved = localStorage.getItem('tg_config');
    return saved ? JSON.parse(saved) : { botToken: '', chatId: '', isEnabled: false };
  });

  const lastSignalRef = useRef<Record<string, string>>({});
  const lastAnalyzedMap = useRef<Record<string, number>>({});

  const getNextCandleClose = () => {
    const now = new Date();
    const minutes = now.getMinutes();
    // Khung 5 phút
    const nextFive = (Math.floor(minutes / 5) + 1) * 5;
    const nextClose = new Date(now);
    nextClose.setMinutes(nextFive, 0, 0);
    return nextClose;
  };

  const sendTelegram = async (analysis: AnalysisResponse, symbol: string, price: number) => {
    if (!tgConfig.isEnabled || !tgConfig.botToken || !tgConfig.chatId) return;
    
    // BỘ LỌC QUAN TRỌNG: Chỉ thông báo khi signal rõ ràng và độ tin cậy > 75%
    if (analysis.signal === 'NEUTRAL' || analysis.confidence <= 75) return;

    // Tránh bắn trùng lặp trong cùng 1 nến 5p (300.000ms = 5 phút)
    const signalKey = `${symbol}_${analysis.signal}_${Math.floor(Date.now() / 300000)}`;
    if (lastSignalRef.current[symbol] === signalKey) return;
    lastSignalRef.current[symbol] = signalKey;

    setSignalLogs(prev => [{
      time: new Date().toLocaleTimeString(),
      symbol,
      signal: analysis.signal,
      price,
      confidence: analysis.confidence
    }, ...prev].slice(0, 20));

    const emoji = analysis.signal === 'BUY' ? '🔥 KÈO MUA MẠNH (BUY)' : '💥 KÈO BÁN MẠNH (SELL)';
    const tradePlanText = analysis.tradePlan ? 
      `🎯 *Target (TP):* $${analysis.tradePlan.takeProfit.toLocaleString()}\n` +
      `🛑 *Stop Loss (SL):* $${analysis.tradePlan.stopLoss.toLocaleString()}\n\n` : '';

    const text = `⭐ *TÍN HIỆU VIP - KHUNG 5P*\n\n` +
                 `Cặp: *${symbol}/USDT*\n` +
                 `Hành động: *${emoji}*\n` +
                 `Độ tin cậy: 🔥 *${analysis.confidence}%*\n` +
                 `Giá vào: *$${price.toLocaleString()}*\n\n` +
                 tradePlanText +
                 `📝 *Lý do:* ${analysis.reasoning.join(', ')}\n\n` +
                 `⚠️ _Chỉ lọc kèo có độ tin cậy > 75%_`;

    try {
      await fetch(`https://api.telegram.org/bot${tgConfig.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: tgConfig.chatId,
          text: text,
          parse_mode: 'Markdown'
        })
      });
    } catch (e) {
      console.error("Telegram Error:", e);
    }
  };

  const scanSymbol = async (symbol: string) => {
    try {
      const [klines, ticker] = await Promise.all([
        fetchKlines(symbol, '5m'),
        fetchPrice(symbol)
      ]);

      const latestTime = klines[klines.length - 1].time;
      
      if (latestTime !== lastAnalyzedMap.current[symbol]) {
        const result = await analyzeMarket(symbol, klines);
        lastAnalyzedMap.current[symbol] = latestTime;
        
        if (symbol === state.symbol) {
          setState(prev => ({ 
            ...prev, 
            lastAnalysis: result,
            price: ticker.price,
            change24h: ticker.change24h,
            candles: klines
          }));
        }
        
        sendTelegram(result, symbol, ticker.price);
      }
    } catch (e) {
      console.error(`Scan error for ${symbol}:`, e);
    }
  };

  const runFullScan = useCallback(async () => {
    if (analyzing) return;
    setAnalyzing(true);
    for (const s of watchlist) {
      await scanSymbol(s);
      await new Promise(r => setTimeout(r, 800));
    }
    setAnalyzing(false);
  }, [watchlist, state.symbol, analyzing]);

  const loadViewData = useCallback(async (symbol: string) => {
    try {
      const [klines, ticker] = await Promise.all([
        fetchKlines(symbol, '5m'),
        fetchPrice(symbol)
      ]);
      setState(prev => ({
        ...prev,
        candles: klines,
        price: ticker.price,
        change24h: ticker.change24h,
        loading: false
      }));
    } catch (e) {
      setState(prev => ({ ...prev, loading: false, error: 'Lỗi kết nối' }));
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const nextClose = getNextCandleClose();
      const diff = nextClose.getTime() - Date.now();
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setNextScanTime(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
      
      if (diff < 3000 && !analyzing) runFullScan();
    }, 1000);
    return () => clearInterval(timer);
  }, [runFullScan, analyzing]);

  useEffect(() => {
    loadViewData(state.symbol);
    scanSymbol(state.symbol);
  }, [state.symbol]);

  useEffect(() => {
    localStorage.setItem('crypto_watchlist', JSON.stringify(watchlist));
  }, [watchlist]);

  useEffect(() => {
    localStorage.setItem('tg_config', JSON.stringify(tgConfig));
  }, [tgConfig]);

  const addToWatchlist = () => {
    const sym = newSymbol.toUpperCase().trim().replace('USDT', '');
    if (sym && !watchlist.includes(sym)) {
      setWatchlist([...watchlist, sym]);
      setNewSymbol('');
    }
  };

  const removeFromWatchlist = (sym: string) => {
    if (watchlist.length > 1) {
      setWatchlist(watchlist.filter(s => s !== sym));
    }
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
            <h1 className="text-2xl font-black text-white tracking-tight uppercase italic">
              ScalpPro <span className="text-emerald-500">5M</span>
            </h1>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">High Confidence Scan (&gt;75%)</p>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 bg-slate-900/80 p-2 rounded-2xl border border-slate-800 w-full lg:w-auto">
          <div className="flex items-center gap-2 px-2 border-r border-slate-800 mr-2">
            <input 
              type="text" 
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value)}
              placeholder="Coin (Vd: PEPE)"
              className="bg-transparent text-xs font-bold outline-none w-24"
              onKeyDown={(e) => e.key === 'Enter' && addToWatchlist()}
            />
            <button onClick={addToWatchlist} className="text-emerald-500 hover:text-emerald-400">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4" strokeWidth="2" strokeLinecap="round"/></svg>
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {watchlist.map(sym => (
              <div key={sym} className="relative group">
                <button
                  onClick={() => setState(p => ({...p, symbol: sym}))}
                  className={`px-3 py-2 rounded-xl text-[11px] font-black transition-all ${
                    state.symbol === sym ? 'bg-emerald-600 text-white shadow-lg' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {sym}
                </button>
                <button 
                  onClick={() => removeFromWatchlist(sym)}
                  className="absolute -top-1 -right-1 bg-rose-500 text-white rounded-full w-4 h-4 text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                >✕</button>
              </div>
            ))}
          </div>
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className={`p-2 rounded-xl border transition-all ${showSettings ? 'bg-emerald-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="mb-8 p-6 bg-slate-900 border border-emerald-600/30 rounded-3xl animate-in zoom-in duration-300">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-emerald-400">Cấu hình Cảnh báo 5P</h3>
            <button onClick={() => setShowSettings(false)} className="text-slate-500 hover:text-white">✕ Đóng</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className="text-[10px] text-slate-500 font-bold uppercase">Bot Token</p>
              <input 
                type="password"
                value={tgConfig.botToken}
                onChange={(e) => setTgConfig({...tgConfig, botToken: e.target.value})}
                className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl outline-none focus:border-emerald-500/50"
              />
            </div>
            <div className="space-y-2">
              <p className="text-[10px] text-slate-500 font-bold uppercase">Chat ID</p>
              <input 
                type="text"
                value={tgConfig.chatId}
                onChange={(e) => setTgConfig({...tgConfig, chatId: e.target.value})}
                className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl outline-none focus:border-emerald-500/50"
              />
            </div>
            <div className="flex items-center gap-4 bg-slate-950 p-4 rounded-xl border border-slate-800 md:col-span-2">
              <div className="flex-1">
                <p className="text-sm font-bold">Lọc tín hiệu VIP (>75%)</p>
                <p className="text-xs text-slate-500">Chỉ gửi Telegram khi AI xác nhận nến 5p có độ tin cậy cực cao.</p>
              </div>
              <button 
                onClick={() => setTgConfig({...tgConfig, isEnabled: !tgConfig.isEnabled})}
                className={`w-14 h-7 rounded-full relative transition-colors ${tgConfig.isEnabled ? 'bg-emerald-600' : 'bg-slate-700'}`}
              >
                <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-all ${tgConfig.isEnabled ? 'left-8' : 'left-1'}`} />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-900/50 p-5 rounded-3xl border border-slate-800">
           <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Cặp đang xem</p>
           <p className="text-2xl font-mono font-black text-white">{state.symbol}/USDT</p>
        </div>
        <div className="bg-slate-900/50 p-5 rounded-3xl border border-slate-800">
           <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Giá 5M</p>
           <div className="flex items-baseline gap-2">
             <span className="text-xl font-mono font-bold">${state.price.toLocaleString()}</span>
           </div>
        </div>
        <div className="bg-slate-900/50 p-5 rounded-3xl border border-slate-800">
           <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Nến 5p đóng sau</p>
           <p className="text-2xl font-mono font-bold text-emerald-400">{nextScanTime}</p>
        </div>
        <div className="bg-slate-900/50 p-5 rounded-3xl border border-slate-800">
           <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Máy quét AI</p>
           <p className={`text-sm font-bold uppercase flex items-center gap-2 ${analyzing ? 'text-amber-500' : 'text-emerald-500'}`}>
             {analyzing ? 'Đang lọc kèo...' : 'Sẵn sàng'}
           </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <Chart data={state.candles} analysis={state.lastAnalysis} />
          
          <div className="bg-slate-900/50 rounded-3xl border border-slate-800 p-6">
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500 mb-4">
              Kèo VIP gần đây (&gt;75% Confidence)
            </h3>
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {signalLogs.length > 0 ? signalLogs.map((log, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-slate-950/50 rounded-xl border border-slate-800">
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-black ${log.signal === 'BUY' ? 'bg-emerald-500/20 text-emerald-500' : 'bg-rose-500/20 text-rose-500'}`}>
                      {log.signal} {log.confidence}%
                    </span>
                    <span className="font-bold text-sm text-white">{log.symbol}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-mono">
                    <span className="text-slate-400">${log.price.toLocaleString()}</span>
                    <span className="text-slate-600">{log.time}</span>
                  </div>
                </div>
              )) : (
                <p className="text-center py-8 text-slate-600 text-sm italic">Đang lọc các cơ hội thắng lớn trên khung 5 phút...</p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <h2 className="text-lg font-black text-white uppercase flex items-center gap-2">
            <span className="w-2 h-6 bg-emerald-600 rounded-full" />
            Chi tiết {state.symbol} (5M)
          </h2>
          {analyzing ? (
            <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-12 text-center animate-pulse">
               <p className="text-emerald-400 font-bold text-sm uppercase tracking-tighter">Đang tính toán win-rate...</p>
            </div>
          ) : state.lastAnalysis ? (
            <SignalCard analysis={state.lastAnalysis} />
          ) : (
            <div className="bg-slate-900/40 border border-dashed border-slate-800 rounded-3xl p-12 text-center text-slate-500 text-sm">
              Chọn coin và đợi nến 5p đóng để nhận phân tích.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
