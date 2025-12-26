
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MarketState, SignalType, TelegramConfig, AnalysisResponse } from './types';
import { fetchKlines, fetchPrice } from './services/binance';
import { analyzeMarket } from './services/gemini';
import Chart from './components/Chart';
import SignalCard from './components/SignalCard';

const SYMBOLS = [
  { label: 'Bitcoin', value: 'BTC' },
  { label: 'Ethereum', value: 'ETH' },
  { label: 'Solana', value: 'SOL' },
  { label: 'Near', value: 'NEAR' },
  { label: 'BNB', value: 'BNB' },
];

interface SignalLog {
  time: string;
  symbol: string;
  signal: SignalType;
  price: number;
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

  const [analyzing, setAnalyzing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [nextScanTime, setNextScanTime] = useState<string>('--:--');
  const [signalLogs, setSignalLogs] = useState<SignalLog[]>([]);
  const [tgConfig, setTgConfig] = useState<TelegramConfig>(() => {
    const saved = localStorage.getItem('tg_config');
    return saved ? JSON.parse(saved) : { botToken: '', chatId: '', isEnabled: false };
  });

  const lastSignalRef = useRef<string | null>(null);
  const lastAnalyzedCandleTime = useRef<number>(0);

  const getNextCandleClose = () => {
    const now = new Date();
    const minutes = now.getMinutes();
    const nextQuarter = (Math.floor(minutes / 15) + 1) * 15;
    const nextClose = new Date(now);
    nextClose.setMinutes(nextQuarter, 0, 0);
    return nextClose;
  };

  const sendTelegram = async (analysis: AnalysisResponse, symbol: string, price: number) => {
    if (!tgConfig.isEnabled || !tgConfig.botToken || !tgConfig.chatId) return;
    if (analysis.signal === 'NEUTRAL') return;

    const signalKey = `${symbol}_${analysis.signal}_${Math.floor(Date.now() / 900000)}`;
    if (lastSignalRef.current === signalKey) return;
    lastSignalRef.current = signalKey;

    setSignalLogs(prev => [{
      time: new Date().toLocaleTimeString(),
      symbol,
      signal: analysis.signal,
      price
    }, ...prev].slice(0, 10));

    const emoji = analysis.signal === 'BUY' ? '🟢 LỆNH MUA (BUY)' : '🔴 LỆNH BÁN (SELL)';
    const tradePlanText = analysis.tradePlan ? 
      `🎯 *Target (TP):* $${analysis.tradePlan.takeProfit.toLocaleString()}\n` +
      `🛑 *Stop Loss (SL):* $${analysis.tradePlan.stopLoss.toLocaleString()}\n\n` : '';

    const text = `🚀 *TÍN HIỆU CRYPTO 15P*\n\n` +
                 `Cặp: *${symbol}/USDT*\n` +
                 `Hành động: *${emoji}*\n` +
                 `Giá vào lệnh: *$${price.toLocaleString()}*\n\n` +
                 tradePlanText +
                 `📊 *Phân tích kỹ thuật:*\n${analysis.reasoning.map(r => `• ${r}`).join('\n')}\n\n` +
                 `💡 Độ tin cậy: *${analysis.confidence}%* | RSI: *${analysis.indicators.rsi.toFixed(1)}*\n\n` +
                 `⚠️ _Ghi chú: Luôn quản lý rủi ro và tuân thủ kỷ luật._`;

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
      console.error("Telegram API Error:", e);
    }
  };

  const loadData = useCallback(async (symbol: string, forceAnalyze: boolean = false) => {
    try {
      const [klines, ticker] = await Promise.all([
        fetchKlines(symbol),
        fetchPrice(symbol)
      ]);
      
      setState(prev => ({
        ...prev,
        candles: klines,
        price: ticker.price,
        change24h: ticker.change24h,
        loading: false
      }));

      const latestCandleTime = klines[klines.length - 1].time;
      if (forceAnalyze || latestCandleTime !== lastAnalyzedCandleTime.current) {
        setAnalyzing(true);
        try {
          const result = await analyzeMarket(symbol, klines);
          setState(prev => ({ ...prev, lastAnalysis: result }));
          lastAnalyzedCandleTime.current = latestCandleTime;
          sendTelegram(result, symbol, ticker.price);
        } catch (e) {
          console.error(e);
        } finally {
          setAnalyzing(false);
        }
      }
    } catch (error) {
      setState(prev => ({ ...prev, loading: false, error: 'Lỗi API' }));
    }
  }, [tgConfig]);

  useEffect(() => {
    const timer = setInterval(() => {
      const nextClose = getNextCandleClose();
      const diff = nextClose.getTime() - Date.now();
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setNextScanTime(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
      if (diff < 3000) loadData(state.symbol);
    }, 1000);
    return () => clearInterval(timer);
  }, [state.symbol, loadData]);

  useEffect(() => {
    loadData(state.symbol, true);
  }, [state.symbol]);

  useEffect(() => {
    localStorage.setItem('tg_config', JSON.stringify(tgConfig));
  }, [tgConfig]);

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-200 p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-900/40">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight uppercase italic">
            CryptoSignal <span className="text-blue-500">15M</span>
          </h1>
        </div>
        
        <div className="flex items-center gap-3 bg-slate-900/80 p-1.5 rounded-2xl border border-slate-800">
          {SYMBOLS.map(coin => (
            <button
              key={coin.value}
              onClick={() => {
                 lastAnalyzedCandleTime.current = 0;
                 setState(p => ({...p, symbol: coin.value}));
              }}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                state.symbol === coin.value ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {coin.value}
            </button>
          ))}
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className={`p-2 rounded-xl border transition-all ${showSettings ? 'bg-blue-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="mb-8 p-6 bg-slate-900 border border-blue-600/30 rounded-3xl animate-in zoom-in duration-300">
          <h3 className="text-lg font-bold mb-4 text-blue-400">Cài đặt Telegram</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input 
              type="password"
              value={tgConfig.botToken}
              onChange={(e) => setTgConfig({...tgConfig, botToken: e.target.value})}
              className="bg-slate-950 border border-slate-800 p-3 rounded-xl outline-none"
              placeholder="Bot Token..."
            />
            <input 
              type="text"
              value={tgConfig.chatId}
              onChange={(e) => setTgConfig({...tgConfig, chatId: e.target.value})}
              className="bg-slate-950 border border-slate-800 p-3 rounded-xl outline-none"
              placeholder="Chat ID..."
            />
            <div className="flex items-center gap-4">
              <label className="text-sm">Bật thông báo tự động:</label>
              <button 
                onClick={() => setTgConfig({...tgConfig, isEnabled: !tgConfig.isEnabled})}
                className={`w-12 h-6 rounded-full relative transition-colors ${tgConfig.isEnabled ? 'bg-blue-600' : 'bg-slate-700'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${tgConfig.isEnabled ? 'left-7' : 'left-1'}`} />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-900/50 p-5 rounded-3xl border border-slate-800">
           <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Giá hiện tại</p>
           <p className="text-2xl font-mono font-black text-white">${state.price.toLocaleString()}</p>
        </div>
        <div className="bg-slate-900/50 p-5 rounded-3xl border border-slate-800">
           <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">24h Change</p>
           <p className={`text-2xl font-bold ${state.change24h >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
             {state.change24h.toFixed(2)}%
           </p>
        </div>
        <div className="bg-slate-900/50 p-5 rounded-3xl border border-slate-800">
           <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Quét nến kế tiếp</p>
           <p className="text-2xl font-mono font-bold text-blue-400">{nextScanTime}</p>
        </div>
        <div className="bg-slate-900/50 p-5 rounded-3xl border border-slate-800">
           <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">AI Status</p>
           <p className="text-sm font-bold uppercase">{analyzing ? 'Đang phân tích...' : 'Đang chờ nến'}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <Chart data={state.candles} analysis={state.lastAnalysis} />
          
          <div className="bg-slate-900/50 rounded-3xl border border-slate-800 p-6">
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500 mb-4">Lịch sử thông báo gần đây</h3>
            <div className="space-y-3">
              {signalLogs.length > 0 ? signalLogs.map((log, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-slate-950/50 rounded-xl border border-slate-800">
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full ${log.signal === 'BUY' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                    <span className="font-bold text-sm">{log.symbol}</span>
                    <span className={`text-xs font-bold ${log.signal === 'BUY' ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {log.signal}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-mono">
                    <span className="text-slate-400">${log.price.toLocaleString()}</span>
                    <span className="text-slate-600">{log.time}</span>
                  </div>
                </div>
              )) : (
                <p className="text-center py-4 text-slate-600 text-sm italic">Chưa có thông báo nào được gửi.</p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <h2 className="text-lg font-black text-white uppercase">Phân tích chi tiết</h2>
          {analyzing ? (
            <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-12 text-center animate-pulse">
               <p className="text-blue-400 font-bold text-sm uppercase">Đang quét sóng AI...</p>
            </div>
          ) : state.lastAnalysis ? (
            <SignalCard analysis={state.lastAnalysis} />
          ) : (
            <div className="bg-slate-900/40 border border-dashed border-slate-800 rounded-3xl p-12 text-center text-slate-500 text-sm">
              Đang đợi nến đóng để phân tích tự động.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
