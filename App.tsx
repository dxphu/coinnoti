
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
  { label: 'Dogecoin', value: 'DOGE' },
];

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
  const [testingTg, setTestingTg] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [nextScanTime, setNextScanTime] = useState<string>('--:--');
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

    const emoji = analysis.signal === 'BUY' ? '🟢 LỆNH MUA (BUY)' : '🔴 LỆNH BÁN (SELL)';
    const text = `🚀 *THÔNG BÁO TÍN HIỆU 15P*\n\n` +
                 `Cặp: *${symbol}/USDT*\n` +
                 `Tín hiệu: *${emoji}*\n` +
                 `Giá vào lệnh: *$${price.toLocaleString()}*\n` +
                 `Độ tin cậy: *${analysis.confidence}%*\n` +
                 `Xu hướng: *${analysis.indicators.trend}*\n\n` +
                 `💡 *Phân tích chuyên sâu:*\n${analysis.reasoning.map(r => `• ${r}`).join('\n')}\n\n` +
                 `📉 Hỗ trợ: $${analysis.keyLevels.support.toLocaleString()}\n` +
                 `📈 Kháng cự: $${analysis.keyLevels.resistance.toLocaleString()}\n\n` +
                 `⚠️ _Lưu ý: Luôn tuân thủ quản lý vốn._`;

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

  const handleTestTelegram = async () => {
    if (!tgConfig.botToken || !tgConfig.chatId) {
      alert("Vui lòng nhập đủ Token và Chat ID!");
      return;
    }
    setTestingTg(true);
    try {
      const response = await fetch(`https://api.telegram.org/bot${tgConfig.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: tgConfig.chatId,
          text: "🔔 *TEST KẾT NỐI CHÀO BRO!*\nHệ thống đã kết nối thành công. 🚀",
          parse_mode: 'Markdown'
        })
      });
      if (response.ok) alert("Gửi test thành công!");
      else alert("Lỗi Telegram. Kiểm tra ID và Token.");
    } catch (e) {
      alert("Lỗi kết nối API.");
    } finally {
      setTestingTg(false);
    }
  };

  const performAnalysis = async (symbol: string, candles: any[], price: number, force: boolean = false) => {
    if (candles.length === 0 || analyzing) return;
    
    const currentCandleTime = candles[candles.length - 1].time;
    // Chỉ chặn nếu không phải bấm nút thủ công VÀ nến chưa thay đổi
    if (!force && currentCandleTime === lastAnalyzedCandleTime.current) return;
    
    setAnalyzing(true);
    try {
      const result = await analyzeMarket(symbol, candles);
      setState(prev => ({ ...prev, lastAnalysis: result }));
      lastAnalyzedCandleTime.current = currentCandleTime;
      sendTelegram(result, symbol, price);
    } catch (error) {
      console.error("Analysis Error:", error);
      alert("Lỗi khi AI phân tích. Kiểm tra API Key.");
    } finally {
      setAnalyzing(false);
    }
  };

  const loadData = useCallback(async (symbol: string, forceAnalyze: boolean = false) => {
    setState(prev => ({ ...prev, loading: prev.candles.length === 0, error: null, symbol }));
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
      // Chạy phân tích nếu là nến mới HOẶC người dùng bấm nút thủ công
      if (forceAnalyze || latestCandleTime !== lastAnalyzedCandleTime.current) {
        performAnalysis(symbol, klines, ticker.price, forceAnalyze);
      }
    } catch (error) {
      setState(prev => ({ ...prev, loading: false, error: 'Lỗi Binance' }));
    }
  }, [analyzing]);

  useEffect(() => {
    const timer = setInterval(() => {
      const nextClose = getNextCandleClose();
      const diff = nextClose.getTime() - Date.now();
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setNextScanTime(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
      if (diff < 2000) loadData(state.symbol);
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
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight uppercase italic flex items-center gap-2">
              CryptoSignal <span className="text-blue-500">15M</span>
            </h1>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 bg-slate-900/80 p-1.5 rounded-2xl border border-slate-800">
          {SYMBOLS.map(coin => (
            <button
              key={coin.value}
              onClick={() => {
                 lastAnalyzedCandleTime.current = 0;
                 loadData(coin.value, true);
              }}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                state.symbol === coin.value ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {coin.value}
            </button>
          ))}
          <div className="h-6 w-px bg-slate-800 mx-1" />
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className={`p-2 rounded-xl border transition-all ${showSettings ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="mb-8 p-6 bg-slate-900/90 border border-blue-600/30 rounded-3xl animate-in zoom-in duration-300">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold flex items-center gap-3 text-blue-400">Robot Telegram</h3>
            <button onClick={() => setShowSettings(false)} className="text-slate-500 hover:text-white transition-colors">Đóng [x]</button>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-2 block">Bot Token API</label>
                <input 
                  type="password"
                  value={tgConfig.botToken}
                  onChange={(e) => setTgConfig({...tgConfig, botToken: e.target.value})}
                  className="w-full bg-slate-950 border border-slate-800 p-3.5 rounded-2xl focus:border-blue-500 outline-none font-mono text-sm"
                  placeholder="Dán token bot..."
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-2 block">Chat ID</label>
                <input 
                  type="text"
                  value={tgConfig.chatId}
                  onChange={(e) => setTgConfig({...tgConfig, chatId: e.target.value})}
                  className="w-full bg-slate-950 border border-slate-800 p-3.5 rounded-2xl focus:border-blue-500 outline-none font-mono text-sm"
                  placeholder="ID chat cá nhân..."
                />
              </div>
            </div>
            <div className="bg-slate-950/50 p-6 rounded-2xl border border-slate-800 flex flex-col justify-between">
               <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-6 rounded-full relative transition-colors cursor-pointer ${tgConfig.isEnabled ? 'bg-blue-600' : 'bg-slate-700'}`}
                        onClick={() => setTgConfig({...tgConfig, isEnabled: !tgConfig.isEnabled})}>
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${tgConfig.isEnabled ? 'left-7' : 'left-1'}`} />
                    </div>
                    <span className="font-bold text-sm">Bật thông báo tự động</span>
                  </div>
               </div>
               <button
                  onClick={handleTestTelegram}
                  disabled={testingTg}
                  className="mt-4 w-full py-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-blue-400 font-bold text-xs uppercase tracking-widest rounded-xl border border-slate-700 transition-all flex items-center justify-center gap-2"
               >
                  {testingTg ? 'Đang gửi...' : 'Gửi tin nhắn test ngay'}
               </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-900/50 p-5 rounded-3xl border border-slate-800">
           <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Giá hiện tại</p>
           <p className="text-3xl font-mono font-black text-white">${state.price.toLocaleString()}</p>
        </div>
        <div className="bg-slate-900/50 p-5 rounded-3xl border border-slate-800">
           <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Thay đổi 24h</p>
           <p className={`text-2xl font-bold ${state.change24h >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
             {state.change24h >= 0 ? '▲' : '▼'} {Math.abs(state.change24h).toFixed(2)}%
           </p>
        </div>
        <div className="bg-slate-900/50 p-5 rounded-3xl border border-slate-800">
           <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Đóng nến 15p sau</p>
           <p className="text-2xl font-mono font-bold text-blue-400">{nextScanTime}</p>
        </div>
        <div className="bg-slate-900/50 p-5 rounded-3xl border border-slate-800 flex items-center justify-between">
           <div>
              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Trạng thái AI</p>
              <p className="text-sm font-bold uppercase">{analyzing ? 'Đang quét...' : 'Sẵn sàng'}</p>
           </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <Chart data={state.candles} analysis={state.lastAnalysis} />
          <div className="bg-blue-900/10 border border-blue-900/30 p-6 rounded-3xl flex flex-col sm:flex-row items-center justify-between gap-4">
             <div>
                <p className="font-bold text-white text-sm">Chế độ quét sóng 15 phút</p>
                <p className="text-xs text-slate-500">Bấm nút để ép buộc AI phân tích lại ngay lập tức.</p>
             </div>
             <button
               onClick={() => loadData(state.symbol, true)}
               disabled={analyzing}
               className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all"
             >
               {analyzing ? 'Đang quét AI...' : 'Phân tích thủ công'}
             </button>
          </div>
        </div>

        <div className="space-y-6">
          <h2 className="text-lg font-black text-white uppercase">Khuyến nghị</h2>
          {analyzing ? (
            <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-12 text-center animate-pulse">
               <p className="text-blue-400 font-bold text-sm uppercase tracking-widest">Đang tính toán...</p>
            </div>
          ) : state.lastAnalysis ? (
            <SignalCard analysis={state.lastAnalysis} />
          ) : (
            <div className="bg-slate-900/40 border border-dashed border-slate-800 rounded-3xl p-12 text-center text-slate-500 text-sm">
              Chưa có dữ liệu phân tích.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
