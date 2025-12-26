
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

  // Ref để theo dõi symbol hiện tại chính xác nhất, tránh race condition
  const currentSymbolRef = useRef(state.symbol);
  const lastAnalyzedMap = useRef<Record<string, number>>({});
  const isUserSwitching = useRef(false);

  useEffect(() => {
    currentSymbolRef.current = state.symbol;
  }, [state.symbol]);

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

    const text = `⭐ *TÍN HIỆU VIP - KHUNG 5P*\n\n` +
                 `Cặp: *${symbol}/USDT*\n` +
                 `Hành động: *${analysis.signal === 'BUY' ? '🔥 MUA' : '💥 BÁN'}*\n` +
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

  // Hàm tải dữ liệu cực kỳ an toàn
  const loadData = async (symbol: string, isSilent: boolean = false) => {
    if (!isSilent) {
      setState(prev => ({ ...prev, symbol, loading: true, lastAnalysis: null, error: null }));
    }

    try {
      const [klines, ticker] = await Promise.all([
        fetchKlines(symbol, '5m'),
        fetchPrice(symbol)
      ]);

      // KIỂM TRA QUAN TRỌNG: Nếu người dùng đã chuyển sang coin khác trong lúc đợi API, thì bỏ kết quả này
      if (currentSymbolRef.current !== symbol && !isSilent) return;

      const latestTime = klines[klines.length - 1].time;
      let analysisResult = null;

      // Chỉ phân tích nếu dữ liệu mới hoặc coin đang xem trực tiếp
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
        // Một lần nữa kiểm tra symbol để tránh ghi đè nhầm
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
      if (isUserSwitching.current) break; // Thoát ngay nếu người dùng đang thao tác
      await loadData(s, s !== currentSymbolRef.current);
      await new Promise(r => setTimeout(r, 1200)); 
    }
    setAnalyzing(false);
  }, [watchlist, analyzing]);

  // Vòng lặp đếm ngược và kích hoạt scanner
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

  // Khởi tạo khi đổi symbol
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
            <h1 className="text-2xl font-black text-white tracking-tight italic uppercase">ScalpPro <span className="text-emerald-500">5M</span></h1>
            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-[0.2em] mt-1">AI Trading Assistant</p>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 bg-slate-900/50 p-2 rounded-2xl border border-slate-800 w-full lg:w-auto">
          <div className="flex items-center gap-2 px-3 border-r border-slate-800">
            <input 
              type="text" 
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value)}
              placeholder="Thêm Coin..."
              className="bg-transparent text-xs font-bold outline-none w-24 text-emerald-400"
              onKeyDown={(e) => e.key === 'Enter' && addToWatchlist()}
            />
            <button onClick={addToWatchlist} className="text-emerald-500">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {watchlist.map(sym => (
              <button
                key={sym}
                onClick={() => setState(p => ({...p, symbol: sym}))}
                className={`px-3 py-1.5 rounded-xl text-[10px] font-black transition-all border ${
                  state.symbol === sym ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                {sym}
              </button>
            ))}
          </div>
        </div>
      </header>

      {state.error && (
        <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/20 text-rose-500 rounded-2xl text-xs font-bold text-center">
          ⚠️ {state.error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-900/30 p-5 rounded-3xl border border-slate-800/50">
           <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Cặp hiện tại</p>
           <p className="text-2xl font-mono font-black text-white">{state.symbol}/USDT</p>
        </div>
        <div className="bg-slate-900/30 p-5 rounded-3xl border border-slate-800/50">
           <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Giá Binance</p>
           <p className="text-xl font-mono font-bold text-white">${state.price.toLocaleString()}</p>
        </div>
        <div className="bg-slate-900/30 p-5 rounded-3xl border border-slate-800/50">
           <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Đóng nến 5m</p>
           <p className="text-2xl font-mono font-bold text-emerald-400">{nextScanTime}</p>
        </div>
        <div className="bg-slate-900/30 p-5 rounded-3xl border border-slate-800/50">
           <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Scanner AI</p>
           <p className={`text-sm font-bold uppercase flex items-center gap-2 ${analyzing ? 'text-amber-500' : 'text-emerald-500'}`}>
             {analyzing ? 'Đang lọc thị trường...' : 'Hoạt động'}
           </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <Chart data={state.candles} analysis={state.lastAnalysis} />
          
          <div className="bg-slate-900/30 rounded-3xl border border-slate-800/50 p-6 backdrop-blur-sm">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-6">Lịch sử tín hiệu VIP</h3>
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
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
                      <p className="font-black text-white">{log.symbol} <span className="text-[10px] text-slate-500 ml-2">{log.time}</span></p>
                      <p className={`text-[10px] font-black ${log.signal === 'BUY' ? 'text-emerald-500' : 'text-rose-500'}`}>CONFIDENCE: {log.confidence}%</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-mono font-bold text-white">${log.price.toLocaleString()}</p>
                    <p className="text-[9px] text-slate-600 font-bold uppercase group-hover:text-emerald-500">Xem nến →</p>
                  </div>
                </div>
              )) : (
                <div className="text-center py-12">
                   <p className="text-slate-600 text-sm italic">Đang chờ cơ hội đẹp từ thị trường...</p>
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
            <div className="bg-slate-900/30 border border-slate-800 rounded-3xl p-16 text-center">
               <div className="w-10 h-10 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mx-auto mb-4" />
               <p className="text-emerald-500 font-black text-xs uppercase tracking-widest">Đang tải nến...</p>
            </div>
          ) : state.lastAnalysis ? (
            <SignalCard analysis={state.lastAnalysis} />
          ) : (
            <div className="bg-slate-900/30 border border-dashed border-slate-800 rounded-3xl p-12 text-center text-slate-500">
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
