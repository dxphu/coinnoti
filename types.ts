
export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type SignalType = 'BUY' | 'SELL' | 'NEUTRAL';

export interface AnalysisResponse {
  signal: SignalType;
  confidence: number;
  reasoning: string[];
  keyLevels: {
    support: number;
    resistance: number;
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
