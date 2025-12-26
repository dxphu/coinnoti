
import { GoogleGenAI, Type } from "@google/genai";
import { CandleData, AnalysisResponse, GeminiModel } from "../types";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const FALLBACK_MODELS: GeminiModel[] = [
  'gemini-3-flash-preview',
  'gemini-2.5-flash-preview-09-2025',
  'gemini-2.5-flash-lite-latest'
];

export const analyzeMarket = async (
  symbol: string, 
  candles: CandleData[], 
  preferredModel: GeminiModel = 'gemini-3-flash-preview'
): Promise<AnalysisResponse> => {
  const apiKey = 'AIzaSyCzk9WrtTRQe1xsffRMk68ytP6EsrFdfPo';
  
  if (!apiKey) {
    throw new Error("Lỗi: Không tìm thấy API_KEY trong môi trường (Docker/System).");
  }

  const ai = new GoogleGenAI({ apiKey: apiKey });
  
  // Lấy dữ liệu nến thưa dần về quá khứ để tiết kiệm token nhưng vẫn giữ được cấu trúc giá
  const recentCandles = candles.slice(-300).map(c => ({
    t: new Date(c.time).toLocaleTimeString('vi-VN'),
    o: c.open, h: c.high, l: c.low, c: c.close, v: Math.round(c.volume)
  }));

  const prompt = `Bạn là một chuyên gia bắt đáy (Bottom Fishing Expert). Chiến thuật của bạn là đợi giá sập mạnh (3-5% trong thời gian ngắn) và chạm các vùng hỗ trợ cực cứng để báo lệnh mua ăn nhịp hồi (rebound).

  NHIỆM VỤ:
  1. Tính toán độ sụt giảm từ đỉnh gần nhất trong 20 nến qua. Nếu giá chưa giảm sâu hoặc đang đi ngang, hãy trả về NEUTRAL.
  2. Tìm kiếm các mô hình nến đảo chiều tại đáy (Pin bar, Bullish Engulfing, Hammer) kết hợp với RSI quá bán (<30).
  3. Chỉ đưa ra tín hiệu BUY/SELL khi có xác suất thắng cực cao (>85%). Mục tiêu chỉ đánh 1-2 lệnh/ngày. Bỏ qua mọi tín hiệu nhiễu.
  
  DỮ LIỆU 15 PHÚT: ${JSON.stringify(recentCandles)}
  
  TRẢ VỀ JSON:
  - signal: BUY (Bắt đáy), SELL (Thoát hàng), hoặc NEUTRAL (Đứng ngoài).
  - confidence: 0-100.
  - reasoning: Liệt kê rõ: % sụt giảm vừa qua, Vùng hỗ trợ đang chạm, Tín hiệu đảo chiều thấy được.
  - keyLevels: Support/Resistance.
  - tradePlan: Entry, StopLoss (phải có), TakeProfit (Target nhịp hồi).
  - indicators: RSI và Trend.`;

  let modelsToTry: GeminiModel[] = [preferredModel, ...FALLBACK_MODELS.filter(m => m !== preferredModel)];
  let lastError = "";

  for (const modelName of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
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
                properties: { support: { type: Type.NUMBER }, resistance: { type: Type.NUMBER } },
                required: ["support", "resistance"]
              },
              tradePlan: {
                type: Type.OBJECT,
                properties: { entry: { type: Type.NUMBER }, stopLoss: { type: Type.NUMBER }, takeProfit: { type: Type.NUMBER } }
              },
              indicators: {
                type: Type.OBJECT,
                properties: { rsi: { type: Type.NUMBER }, trend: { type: Type.STRING } },
                required: ["rsi", "trend"]
              }
            },
            required: ["signal", "confidence", "reasoning", "keyLevels", "indicators"],
          },
        },
      });

      const text = response.text;
      if (!text) throw new Error("AI Empty Response");

      const result = JSON.parse(text.trim()) as AnalysisResponse;
      return { ...result, activeModel: modelName };
    } catch (e: any) {
      lastError = e.message || String(e);
      if (lastError.includes("429") || lastError.includes("limit")) {
        await sleep(2000); continue;
      }
      throw new Error(lastError);
    }
  }
  throw new Error(`API Error: ${lastError}`);
};
