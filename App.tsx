
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
    const nextFive = (Math.floor(minutes / 5) + 1) * 5;
    const nextClose = new Date(now);
    nextClose.setMinutes(nextFive, 0, 0);
    return nextClose;
  };

  const sendTelegram = async (analysis: AnalysisResponse, symbol: string, price: number) => {
    if (!tgConfig.isEnabled || !tgConfig.botToken || !tgConfig.chatId) return;
    
    // Lọc kèo độ tin cậy > 75%
    if (analysis.signal === 'NEUTRAL' || analysis.confidence <= 75) return;

    const signalKey = `${symbol}_${analysis.signal}_${Math.floor(Date.now() / 300000)}`;
    if (lastSignalRef.current[symbol] === signalKey) return;
    lastSignalRef.current[symbol] = signalKey;

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

      setSignalLogs(prev => [{
        time: new Date().toLocaleTimeString(),
        symbol,
        signal: analysis.signal,
        price,
        confidence: analysis.confidence
      }, ...prev].slice(0, 20));
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
      
      // Nếu là nến mới hoặc chưa có phân tích cho coin này
      if (latestTime !== lastAnalyzedMap.current[symbol]) {
        const result = await analyzeMarket(symbol, klines);
        lastAnalyzedMap.current[symbol] = latestTime;
        
        if (symbol === state.symbol) {
          setState(prev => ({ 
            ...prev, 
            lastAnalysis: result,
            price: ticker.price,
            change24h: ticker.change24h,
            candles: klines,
            loading: false
          }));
        }
        
        sendTelegram(result, symbol, ticker.price);
      }
    } catch (e) {
      console.error(`Scan error for ${symbol}:`, e);
      if (symbol === state.symbol) {
        setState(prev => ({ ...prev, error: `Không tìm thấy coin ${symbol}`, loading: false }));
      }
    }
  };

  const runFullScan = useCallback(async () => {
    if (analyzing) return;
    setAnalyzing(true);
    for (const s of watchlist) {
      await scanSymbol(s);
      await new Promise(r => setTimeout(r, 1000));
    }
    setAnalyzing(false);
  }, [watchlist, state.symbol, analyzing]);

  const loadViewData = useCallback(async (symbol: string) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
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
      setState(prev => ({ ...prev, loading: false, error: `Lỗi tải dữ liệu ${symbol}` }));
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
      setWatchlist(prev => [...prev, sym]);
      setNewSymbol('');
      // Chuyển sang xem coin mới ngay lập tức
      setState(prev => ({ ...prev, symbol: sym, loading: true, lastAnalysis: null }));
    }
  };

  const removeFromWatchlist = (e: React.MouseEvent, sym: string) => {
    e.stopPropagation();
    if (watchlist.length > 1) {
      setWatchlist(prev => prev.filter(s => s !== sym));
      if (state.symbol === sym) {
        const nextSym = watchlist.find(s => s !== sym) || 'BTC';
        setState(prev => ({ ...prev, symbol: nextSym, lastAnalysis: null }));
      }
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
            <h1 className="text-2xl font-black text-white tracking-tight uppercase italic leading-none">
              ScalpPro <span className="text-emerald-500">5M</span>
            </h1>
            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-[0.2em] mt-1">High Accuracy Signal</p>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 bg-slate-900/50 p-2 rounded-2xl border border-slate-800 w-full lg:w-auto backdrop-blur-sm">
          <div className="flex items-center gap-2 px-3 border-r border-slate-800 mr-1">
            <input 
              type="text" 
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value)}
              placeholder="Thêm Coin..."
              className="bg-transparent text-xs font-bold outline-none w-20 md:w-28 text-emerald-400 placeholder:text-slate-600"
              onKeyDown={(e) => e.key === 'Enter' && addToWatchlist()}
            />
            <button 
              type="button"
              onClick={addToWatchlist} 
              className="text-emerald-500 hover:text-emerald-400 transition-colors p-1"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M12 4v16m8-8H4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {watchlist.map(sym => (
              <div key={sym} className="relative group">
                <button
                  type="button"
                  onClick={() => setState(p => ({...p, symbol: sym, lastAnalysis: null}))}
                  className={`px-3 py-1.5 rounded-xl text-[10px] font-black transition-all duration-200 border ${
                    state.symbol === sym 
                      ? 'bg-emerald-600 border-emerald-500 text-white shadow-lg shadow-emerald-900/20' 
                      : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  {sym}
                </button>
                <button 
                  type="button"
                  onClick={(e) => removeFromWatchlist(e, sym)}
                  className="absolute -top-1.5 -right-1.5 bg-rose-500/90 text-white rounded-full w-4 h-4 text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:bg-rose-600 shadow-lg z-10"
                >✕</button>
              </div>
            ))}
          </div>
          <button 
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            className={`p-2 rounded-xl border transition-all ${showSettings ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800/50 border-slate-700 text-slate-400'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="mb-8 p-6 bg-slate-900 border border-emerald-600/30 rounded-3xl animate-in zoom-in duration-300">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-emerald-400 flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              Cấu hình Telegram VIP
            </h3>
            <button onClick={() => setShowSettings(false)} className="text-slate-500 hover:text-white transition-colors">✕ Đóng</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Bot Token</p>
              <input 
                type="password"
                value={tgConfig.botToken}
                onChange={(e) => setTgConfig({...tgConfig, botToken: e.target.value})}
                className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl outline-none focus:border-emerald-500/50 transition-all"
                placeholder="Nhập Token từ BotFather..."
              />
            </div>
            <div className="space-y-2">
              <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Chat ID</p>
              <input 
                type="text"
                value={tgConfig.chatId}
                onChange={(e) => setTgConfig({...tgConfig, chatId: e.target.value})}
                className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl outline-none focus:border-emerald-500/50 transition-all"
                placeholder="Nhập ID người nhận/Group..."
              />
            </div>
            <div className="flex items-center gap-4 bg-slate-950 p-5 rounded-2xl border border-slate-800 md:col-span-2">
              <div className="flex-1">
                <p className="text-sm font-black text-white">Chế độ lọc kèo tinh hoa (>75%)</p>
                <p className="text-xs text-slate-500 mt-1">Hệ thống sẽ chỉ bắn tín hiệu lên Telegram khi AI cực kỳ tự tin về lệnh.</p>
              </div>
              <button 
                type="button"
                onClick={() => setTgConfig({...tgConfig, isEnabled: !tgConfig.isEnabled})}
                className={`w-14 h-7 rounded-full relative transition-all duration-300 ${tgConfig.isEnabled ? 'bg-emerald-600' : 'bg-slate-700'}`}
              >
                <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-all duration-300 ${tgConfig.isEnabled ? 'left-8' : 'left-1'}`} />
              </button>
            </div>
          </div>
        </div>
      )}

      {state.error && (
        <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/20 text-rose-500 rounded-2xl text-xs font-bold text-center">
          ⚠️ {state.error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-900/30 p-5 rounded-3xl border border-slate-800/50 backdrop-blur-sm">
           <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Cặp hiện tại</p>
           <p className="text-2xl font-mono font-black text-white tracking-tighter">{state.symbol}/USDT</p>
        </div>
        <div className="bg-slate-900/30 p-5 rounded-3xl border border-slate-800/50 backdrop-blur-sm">
           <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Giá thời gian thực</p>
           <div className="flex items-baseline gap-2">
             <span className="text-xl font-mono font-bold text-white">${state.price.toLocaleString()}</span>
           </div>
        </div>
        <div className="bg-slate-900/30 p-5 rounded-3xl border border-slate-800/50 backdrop-blur-sm">
           <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Quét nến tiếp theo</p>
           <p className="text-2xl font-mono font-bold text-emerald-400">{nextScanTime}</p>
        </div>
        <div className="bg-slate-900/30 p-5 rounded-3xl border border-slate-800/50 backdrop-blur-sm">
           <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Tiến độ Scanner</p>
           <p className={`text-sm font-bold uppercase flex items-center gap-2 ${analyzing ? 'text-amber-500' : 'text-emerald-500'}`}>
             {analyzing && <span className="w-2 h-2 bg-amber-500 rounded-full animate-ping" />}
             {analyzing ? `Đang lọc ${watchlist.length} coin...` : 'Hệ thống Sẵn sàng'}
           </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <Chart data={state.candles} analysis={state.lastAnalysis} />
          
          <div className="bg-slate-900/30 rounded-3xl border border-slate-800/50 p-6 backdrop-blur-sm">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-6 flex justify-between items-center">
              Tín hiệu VIP đã lọc
              <span className="text-[10px] text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded">Accuracy > 75%</span>
            </h3>
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {signalLogs.length > 0 ? signalLogs.map((log, i) => (
                <div 
                  key={i} 
                  className="flex items-center justify-between p-4 bg-slate-950/40 rounded-2xl border border-slate-800 hover:border-slate-700 transition-all cursor-pointer group"
                  onClick={() => setState(p => ({...p, symbol: log.symbol, lastAnalysis: null}))}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm ${log.signal === 'BUY' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                      {log.signal[0]}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-black text-white">{log.symbol}</span>
                        <span className="text-[10px] font-bold text-slate-500">{log.time}</span>
                      </div>
                      <p className={`text-[10px] font-black ${log.signal === 'BUY' ? 'text-emerald-500' : 'text-rose-500'}`}>
                        CONFIDENCE: {log.confidence}%
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-mono font-bold text-white">${log.price.toLocaleString()}</p>
                    <p className="text-[9px] text-slate-600 font-bold uppercase group-hover:text-emerald-500 transition-colors">Xem biểu đồ →</p>
                  </div>
                </div>
              )) : (
                <div className="text-center py-12">
                   <div className="w-12 h-12 border-2 border-slate-800 border-t-emerald-500 rounded-full animate-spin mx-auto mb-4" />
                   <p className="text-slate-500 text-sm font-medium italic">Đang lọc cơ hội thắng lớn từ {watchlist.length} cặp tiền...</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <h2 className="text-lg font-black text-white uppercase flex items-center gap-3">
            <span className="w-1.5 h-6 bg-emerald-600 rounded-full" />
            Phân tích 5M: {state.symbol}
          </h2>
          {state.loading ? (
            <div className="bg-slate-900/30 border border-slate-800 rounded-3xl p-16 text-center backdrop-blur-sm">
               <div className="w-10 h-10 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mx-auto mb-4" />
               <p className="text-emerald-500 font-black text-xs uppercase tracking-widest">Đang tải...</p>
            </div>
          ) : state.lastAnalysis ? (
            <SignalCard analysis={state.lastAnalysis} />
          ) : (
            <div className="bg-slate-900/30 border border-dashed border-slate-800 rounded-3xl p-12 text-center text-slate-500 backdrop-blur-sm">
              <p className="text-sm font-medium mb-2">Đang chờ quét tín hiệu mới</p>
              <p className="text-[10px] uppercase font-bold text-slate-600">Nến 5p tiếp theo sẽ có phân tích</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
