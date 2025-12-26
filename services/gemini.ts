
import { GoogleGenAI, Type } from "@google/genai";
import { CandleData, AnalysisResponse } from "../types";

export const analyzeMarket = async (symbol: string, candles: CandleData[]): Promise<AnalysisResponse> => {
  const apiKey = process.env.API_KEY || 'AIzaSyCpyPu6zZAbj4ZVafQhXq_QzucoMoA2dU8';
  
  if (!apiKey || apiKey === "__API_KEY_PLACEHOLDER__") {
    throw new Error("API_KEY chưa được cấu hình.");
  }

  const ai = new GoogleGenAI({ apiKey: apiKey });
  
  const relevantCandles = candles.slice(-60).map(c => ({
    t: new Date(c.time).toLocaleTimeString('vi-VN'),
    o: c.open,
    h: c.high,
    l: c.low,
    c: c.close,
    v: Math.round(c.volume)
  }));

  const prompt = `Bạn là một chuyên gia Scalping siêu hạng trên khung 5 phút (5M).
  Phân tích cặp ${symbol}/USDT với 60 nến 5 phút gần nhất: ${JSON.stringify(relevantCandles)}
  
  CHIẾN THUẬT:
  - Tập trung vào Price Action, RSI và các vùng quá mua/quá bán trên khung ngắn.
  - Chỉ đưa ra độ tin cậy (confidence) vượt ngưỡng 75% nếu các chỉ báo hội tụ mạnh (Ví dụ: RSI phân kỳ + Chạm hỗ trợ mạnh + Nến đảo chiều).
  - Khung 5 phút biến động nhanh, hãy ưu tiên Stop Loss ngắn và Take Profit nhanh.

  YÊU CẦU TRẢ VỀ JSON:
  1. signal: BUY, SELL hoặc NEUTRAL.
  2. confidence: % độ tin cậy (Hãy khắt khe, chỉ trả về mức trên 75% khi thực sự đẹp).
  3. reasoning: 3 lý do kỹ thuật ngắn gọn.
  4. keyLevels: { support: số, resistance: số }.
  5. tradePlan: { entry: số, stopLoss: số, takeProfit: số }.
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
