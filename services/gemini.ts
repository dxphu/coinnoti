
import { GoogleGenAI, Type } from "@google/genai";
import { CandleData, AnalysisResponse, GeminiModel } from "../types";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Danh sách ưu tiên fallback từ mạnh nhất đến tiết kiệm nhất
const FALLBACK_MODELS: GeminiModel[] = [
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-flash-preview-09-2025',
  'gemini-2.5-flash-lite-latest',
  'gemini-flash-latest',
  'gemini-flash-lite-latest'
];

export const analyzeMarket = async (
  symbol: string, 
  candles: CandleData[], 
  preferredModel: GeminiModel = 'gemini-3-flash-preview'
): Promise<AnalysisResponse> => {
  const apiKey = process.env.API_KEY;
  
  if (!apiKey) {
    throw new Error("Lỗi: API_KEY chưa được thiết lập.");
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

  const prompt = `Bạn là một chuyên gia Scalping khung 5 phút. Phân tích cặp ${symbol}/USDT với dữ liệu nến: ${JSON.stringify(relevantCandles)}
  YÊU CẦU TRẢ VỀ JSON:
  1. signal: BUY, SELL hoặc NEUTRAL.
  2. confidence: % độ tin cậy.
  3. reasoning: 3 lý do kỹ thuật.
  4. keyLevels: { support, resistance }.
  5. tradePlan: { entry, stopLoss, takeProfit }.
  6. indicators: { rsi, trend }.`;

  // Xác định danh sách mô hình sẽ thử (bắt đầu từ mô hình người dùng chọn)
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

      const text = response.text;
      if (!text) throw new Error("AI trả về rỗng");

      const result = JSON.parse(text.trim()) as AnalysisResponse;
      return { ...result, activeModel: modelName };

    } catch (e: any) {
      lastError = e.message || String(e);
      const isRateLimit = lastError.includes("429") || lastError.includes("RESOURCE_EXHAUSTED");
      
      if (isRateLimit) {
        console.warn(`Model ${modelName} bị Rate Limit. Thử fallback...`);
        await sleep(1500);
        continue;
      }
      throw new Error(lastError);
    }
  }

  throw new Error(`Cạn kiệt hạn mức tất cả mô hình: ${lastError}`);
};
