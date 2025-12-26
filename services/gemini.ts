
import { GoogleGenAI, Type } from "@google/genai";
import { CandleData, AnalysisResponse } from "../types";

export const analyzeMarket = async (symbol: string, candles: CandleData[]): Promise<AnalysisResponse> => {
  const apiKey = process.env.API_KEY || 'AIzaSyCpyPu6zZAbj4ZVafQhXq_QzucoMoA2dU8';
  
  if (!apiKey || apiKey === "__API_KEY_PLACEHOLDER__") {
    throw new Error("API_KEY chưa được cấu hình.");
  }

  const ai = new GoogleGenAI({ apiKey: apiKey });
  
  const relevantCandles = candles.slice(-50).map(c => ({
    t: new Date(c.time).toLocaleTimeString('vi-VN'),
    o: c.open,
    h: c.high,
    l: c.low,
    c: c.close,
    v: Math.round(c.volume)
  }));

  const prompt = `Bạn là một chuyên gia Scalping Crypto trên khung 15 phút. 
  Phân tích cặp ${symbol}/USDT với dữ liệu 50 nến gần nhất: ${JSON.stringify(relevantCandles)}
  
  YÊU CẦU:
  - Nếu signal là BUY hoặc SELL, bạn PHẢI cung cấp một kế hoạch giao dịch (tradePlan) cụ thể.
  - Stop Loss (SL) phải đặt ở mức an toàn (ví dụ: dưới hỗ trợ gần nhất cho lệnh BUY).
  - Take Profit (TP) phải đảm bảo tỷ lệ R:R (Risk:Reward) tối thiểu là 1:1.5.
  
  TRẢ VỀ JSON:
  1. signal: BUY, SELL hoặc NEUTRAL.
  2. confidence: % độ tin cậy.
  3. reasoning: 3-4 lý do kỹ thuật.
  4. keyLevels: { support: số, resistance: số }.
  5. tradePlan: { entry: số, stopLoss: số, takeProfit: số } (chỉ khi signal != NEUTRAL).
  6. indicators: { rsi: số, trend: "Tăng/Giảm/Sideway" }.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            signal: { type: Type.STRING },
            confidence: { type: Type.NUMBER },
            reasoning: { type: Type.ARRAY, items: { type: Type.STRING } },
            keyLevels: {
              type: Type.OBJECT,
              properties: {
                support: { type: Type.NUMBER },
                resistance: { type: Type.NUMBER }
              },
              required: ["support", "resistance"]
            },
            tradePlan: {
              type: Type.OBJECT,
              properties: {
                entry: { type: Type.NUMBER },
                stopLoss: { type: Type.NUMBER },
                takeProfit: { type: Type.NUMBER }
              }
            },
            indicators: {
              type: Type.OBJECT,
              properties: {
                rsi: { type: Type.NUMBER },
                trend: { type: Type.STRING }
              },
              required: ["rsi", "trend"]
            }
          },
          required: ["signal", "confidence", "reasoning", "keyLevels", "indicators"],
        },
      },
    });

    return JSON.parse(response.text.trim()) as AnalysisResponse;
  } catch (e: any) {
    console.error("Gemini Analysis Error:", e);
    throw new Error(`AI Analysis Failed: ${e.message}`);
  }
};
