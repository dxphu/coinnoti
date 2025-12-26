
import { CandleData } from '../types';

export const fetchKlines = async (symbol: string, interval: string = '5m', limit: number = 300): Promise<CandleData[]> => {
  try {
    const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=${interval}&limit=${limit}`);
    if (!response.ok) throw new Error('Failed to fetch market data');
    
    const data = await response.json();
    return data.map((d: any) => ({
      time: d[0],
      open: parseFloat(d[1]),
      high: parseFloat(d[2]),
      low: parseFloat(d[3]),
      close: parseFloat(d[4]),
      volume: parseFloat(d[5]),
    }));
  } catch (error) {
    console.error('Binance API Error:', error);
    throw error;
  }
};

export const fetchPrice = async (symbol: string): Promise<{ price: number; change24h: number }> => {
  try {
    const response = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}USDT`);
    const data = await response.json();
    return {
      price: parseFloat(data.lastPrice),
      change24h: parseFloat(data.priceChangePercent)
    };
  } catch (error) {
    console.error('Binance Price Error:', error);
    throw error;
  }
};
