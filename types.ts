
export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type SignalType = 'BUY' | 'SELL' | 'NEUTRAL';

export type GeminiModel = 
  | 'gemini-3-pro-preview' 
  | 'gemini-3-flash-preview' 
  | 'gemini-2.5-flash-preview-09-2025' 
  | 'gemini-2.5-flash-lite-latest'
  | 'gemini-flash-latest'
  | 'gemini-flash-lite-latest';

export interface AnalysisResponse {
  signal: SignalType;
  confidence: number;
  reasoning: string[];
  activeModel?: string;
  keyLevels: {
    support: number;
    resistance: number;
  };
  tradePlan?: {
    entry: number;
    stopLoss: number;
    takeProfit: number;
  };
  indicators: {
    rsi: number;
    trend: string;
  };
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  isEnabled: boolean;
  minConfidence: number; // Ngưỡng độ tin cậy để gửi thông báo
}

export interface MarketState {
  symbol: string;
  price: number;
  change24h: number;
  candles: CandleData[];
  lastAnalysis: AnalysisResponse | null;
  loading: boolean;
  error: string | null;
}
