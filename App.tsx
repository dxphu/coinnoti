
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

  // Lưu cấu hình Telegram vào LocalStorage
  useEffect(() => {
    localStorage.setItem('tg_config', JSON.stringify(tgConfig));
  }, [tgConfig]);

  const testTelegram = async () => {
    if (!tgConfig.botToken || !tgConfig.chatId) {
      alert("Vui lòng nhập đầy đủ Token và Chat ID!");
      return;
    }
    setIsTestingTg(true);
    try {
      const text = `🔔 *KIỂM TRA KẾT NỐI*\n\nHệ thống ScalpPro 5M đã kết nối thành công với Telegram của bạn!\nTín hiệu sẽ được gửi tại đây khi có kèo trên 75%.`;
      const res = await fetch(`https://api.telegram.org/bot${tgConfig.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: tgConfig.chatId,
          text: text,
          parse_mode: 'Markdown'
        })
      });
      const data = await res.json();
      if (data.ok) {
        alert("Gửi tin nhắn test thành công! Hãy kiểm tra Telegram.");
      } else {
        throw new Error(data.description || "Lỗi không xác định");
      }
    } catch (e: any) {
      alert(`Lỗi kết nối Telegram: ${e.message}`);
    } finally {
      setIsTestingTg(false);
    }
  };

  const updateSignalLogs = (analysis: AnalysisResponse, symbol: string, price: number) => {
    if (analysis.signal === 'NEUTRAL' || analysis.confidence <= 65) return;

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

    const emoji = analysis.signal === 'BUY' ? '🔥 KÈO MUA (BUY)' : '💥 KÈO BÁN (SELL)';
    const text = `⭐ *TÍN HIỆU VIP - KHUNG 5P*\n\n` +
                 `Cặp: *${symbol}/USDT*\n` +
                 `Hành động: *${emoji}*\n` +
                 `Độ tin cậy: *${analysis.confidence}%*\n` +
                 `Giá vào: *$${price.toLocaleString()}*\n\n` +
                 `📝 *Lý do:* ${analysis.reasoning[0]}\n\n` +
                 `⚠️ _Duyệt bởi ScalpPro AI_`;

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
        } catch (aiError) {
          console.error("AI Error:", aiError);
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
        setState(prev => ({ ...prev, loading: false, error: `Lỗi kết nối sàn cho ${symbol}` }));
      }
    }
  };

  const runScanner = useCallback(async () => {
    if (analyzing || isUserSwitching.current) return;
    setAnalyzing(true);
    for (const s of watchlist) {
      if (isUserSwitching.current) break;
      await loadData(s, s !== currentSymbolRef.current);
      await new Promise(r => setTimeout(r, 1200)); 
    }
    setAnalyzing(false);
  }, [watchlist, analyzing]);

  useEffect(() => {
    const timer = setInterval(() => {
      const nextClose = getNextCandleClose();
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

  const getNextCandleClose = () => {
    const now = new Date();
    const minutes = now.getMinutes();
    const nextFive = (Math.floor(minutes / 5) + 1) * 5;
    const nextClose = new Date(now);
    nextClose.setMinutes(nextFive, 0, 0);
    return nextClose;
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
            <h1 className="text-2xl font-black text-white tracking-tight italic uppercase leading-none">ScalpPro <span className="text-emerald-500">5M</span></h1>
            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-[0.2em] mt-1">AI Trading Assistant</p>
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
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {watchlist.map(sym => (
              <button
                key={sym}
                onClick={() => setState(p => ({...p, symbol: sym}))}
                className={`px-3 py-1.5 rounded-xl text-[10px] font-black transition-all border ${
                  state.symbol === sym ? 'bg-emerald-600 border-emerald-500 text-white shadow-lg shadow-emerald-900/20' : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                {sym}
              </button>
            ))}
          </div>
          <button 
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            className={`p-2 rounded-xl border transition-all ${showSettings ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:bg-slate-800'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="mb-8 p-6 bg-slate-900 border border-emerald-600/30 rounded-3xl animate-in zoom-in duration-300 shadow-2xl">
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
                className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl outline-none focus:border-emerald-500/50 transition-all text-sm font-mono"
                placeholder="Nhập Token từ BotFather..."
              />
            </div>
            <div className="space-y-2">
              <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Chat ID</p>
              <input 
                type="text"
                value={tgConfig.chatId}
                onChange={(e) => setTgConfig({...tgConfig, chatId: e.target.value})}
                className="w-full bg-slate-950 border border-slate-800 p-3 rounded-xl outline-none focus:border-emerald-500/50 transition-all text-sm font-mono"
                placeholder="Nhập ID người nhận/Group..."
              />
            </div>
            <div className="md:col-span-2 flex flex-col md:flex-row gap-4">
              <div className="flex-1 flex items-center gap-4 bg-slate-950 p-5 rounded-2xl border border-slate-800">
                <div className="flex-1">
                  <p className="text-sm font-black text-white uppercase tracking-tight">Kích hoạt thông báo</p>
                  <p className="text-[10px] text-slate-500 mt-1 font-bold">Chỉ bắn tín hiệu cực đẹp (Confidence  75%) lên Telegram.</p>
                </div>
                <button 
                  type="button"
                  onClick={() => setTgConfig({...tgConfig, isEnabled: !tgConfig.isEnabled})}
                  className={`w-14 h-7 rounded-full relative transition-all duration-300 ${tgConfig.isEnabled ? 'bg-emerald-600' : 'bg-slate-700'}`}
                >
                  <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-all duration-300 ${tgConfig.isEnabled ? 'left-8' : 'left-1'}`} />
                </button>
              </div>
              <button
                onClick={testTelegram}
                disabled={isTestingTg}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white font-black text-xs uppercase px-8 py-5 rounded-2xl transition-all shadow-lg flex items-center justify-center gap-2 shrink-0 min-w-[200px]"
              >
                {isTestingTg ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    TEST GỬI TELEGRAM
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {state.error && (
        <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/20 text-rose-500 rounded-2xl text-xs font-bold text-center animate-pulse">
          ⚠️ {state.error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-900/30 p-5 rounded-3xl border border-slate-800/50 backdrop-blur-sm">
           <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Cặp hiện tại</p>
           <p className="text-2xl font-mono font-black text-white tracking-tighter">{state.symbol}/USDT</p>
        </div>
        <div className="bg-slate-900/30 p-5 rounded-3xl border border-slate-800/50 backdrop-blur-sm">
           <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Giá Binance</p>
           <p className="text-xl font-mono font-bold text-white tracking-tight">${state.price.toLocaleString()}</p>
        </div>
        <div className="bg-slate-900/30 p-5 rounded-3xl border border-slate-800/50 backdrop-blur-sm">
           <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Đóng nến 5m</p>
           <p className="text-2xl font-mono font-bold text-emerald-400">{nextScanTime}</p>
        </div>
        <div className="bg-slate-900/30 p-5 rounded-3xl border border-slate-800/50 backdrop-blur-sm">
           <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Scanner AI</p>
           <p className={`text-sm font-bold uppercase flex items-center gap-2 ${analyzing ? 'text-amber-500' : 'text-emerald-500'}`}>
             {analyzing ? (
               <>
                 <span className="w-2 h-2 bg-amber-500 rounded-full animate-ping" />
                 Đang quét thị trường...
               </>
             ) : 'Hoạt động'}
           </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <Chart data={state.candles} analysis={state.lastAnalysis} />
          
          <div className="bg-slate-900/30 rounded-3xl border border-slate-800/50 p-6 backdrop-blur-sm">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-6 flex justify-between items-center">
              Lịch sử tín hiệu VIP
              <span className="text-[9px] text-emerald-500 font-bold bg-emerald-500/10 px-2 py-0.5 rounded">AUTO-SCAN</span>
            </h3>
            <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
              {signalLogs.length > 0 ? signalLogs.map((log, i) => (
                <div 
                  key={i} 
                  className="flex items-center justify-between p-4 bg-slate-950/40 rounded-2xl border border-slate-800 hover:border-emerald-500/50 transition-all cursor-pointer group"
                  onClick={() => setState(p => ({...p, symbol: log.symbol}))}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm ${log.signal === 'BUY' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                      {log.signal[0]}
                    </div>
                    <div>
                      <p className="font-black text-white text-sm">{log.symbol} <span className="text-[10px] text-slate-600 ml-2 font-normal italic">{log.time}</span></p>
                      <p className={`text-[10px] font-black ${log.signal === 'BUY' ? 'text-emerald-500' : 'text-rose-500'}`}>CONFIDENCE: {log.confidence}%</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-mono font-bold text-white tracking-tight">${log.price.toLocaleString()}</p>
                    <p className="text-[9px] text-slate-600 font-bold uppercase group-hover:text-emerald-500 transition-colors">Xem biểu đồ →</p>
                  </div>
                </div>
              )) : (
                <div className="text-center py-12 border border-dashed border-slate-800 rounded-2xl">
                   <p className="text-slate-600 text-sm italic font-medium">Đang chờ cơ hội đẹp từ thị trường...</p>
                   <p className="text-[9px] text-slate-700 mt-2 uppercase font-black">AI sẽ tự hiện danh sách khi tìm thấy kèo tốt</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <h2 className="text-lg font-black text-white uppercase flex items-center gap-3">
            <span className="w-1.5 h-6 bg-emerald-600 rounded-full" />
            AI Phân tích: {state.symbol}
          </h2>
          {state.loading ? (
            <div className="bg-slate-900/30 border border-slate-800 rounded-3xl p-16 text-center backdrop-blur-sm">
               <div className="w-10 h-10 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mx-auto mb-4" />
               <p className="text-emerald-500 font-black text-[10px] uppercase tracking-widest">Đang tải nến...</p>
            </div>
          ) : state.lastAnalysis ? (
            <SignalCard analysis={state.lastAnalysis} />
          ) : (
            <div className="bg-slate-900/30 border border-dashed border-slate-800 rounded-3xl p-12 text-center text-slate-500 backdrop-blur-sm">
              <p className="text-sm font-medium mb-2">Đang chờ AI duyệt tín hiệu</p>
              <p className="text-[10px] uppercase font-bold text-slate-600">Thường xuất hiện khi nến 5m kết thúc</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
