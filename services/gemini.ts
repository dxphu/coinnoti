
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
  // Đọc API KEY từ môi trường (Docker/System)
  const apiKey = "AIzaSyCzk9WrtTRQe1xsffRMk68ytP6EsrFdfPo";
  
  if (!apiKey) {
    throw new Error("Lỗi: API_KEY chưa được thiết lập trong môi trường.");
  }

  const ai = new GoogleGenAI({ apiKey: apiKey });
  
  // Lấy dữ liệu nến với mật độ thưa hơn ở phía xa để AI thấy "bức tranh lớn" và dày đặc ở gần
  const relevantCandles = candles.map(c => ({
    t: new Date(c.time).toLocaleTimeString('vi-VN'),
    o: c.open,
    h: c.high,
    l: c.low,
    c: c.close,
    v: Math.round(c.volume)
  }));

  const prompt = `Bạn là một Nhà phân tích định lượng chuyên nghiệp (Strategic Price Action Analyst).
  Phân tích cặp ${symbol}/USDT dựa trên dữ liệu 300 nến gần nhất.
  
  NHIỆM VỤ CỦA BẠN:
  1. Nhìn rộng: Xác định cấu trúc thị trường tổng thể (Tăng/Giảm/Đi ngang) và các mô hình giá vĩ mô (Double Top, Head & Shoulders, Symmetrical Triangle, Liquidity Sweeps).
  2. Lọc nhiễu: Bỏ qua các biến động nhỏ. Chỉ đưa ra tín hiệu khi giá đang ở vùng Supply/Demand cực quan trọng hoặc có sự phá vỡ mô hình xác suất cao.
  3. Kỷ luật: Nếu không có thiết lập giao dịch hoàn hảo (A+ Setup), hãy trả về NEUTRAL. Mục tiêu là chỉ đánh 1-2 lệnh cực kỳ chất lượng mỗi ngày.
  
  DỮ LIỆU NẾN: ${JSON.stringify(relevantCandles)}
  
  YÊU CẦU TRẢ VỀ JSON:
  - signal: BUY, SELL hoặc NEUTRAL.
  - confidence: Độ tự tin (0-100). Chỉ chọn BUY/SELL nếu confidence > 85.
  - reasoning: 3 phân tích sâu về cấu trúc giá và mô hình.
  - keyLevels: Vùng hỗ trợ/kháng cự cứng.
  - tradePlan: Entry, StopLoss (phải cực kỳ an toàn), TakeProfit (tỷ lệ R:R tối thiểu 1:2).
  - indicators: RSI và Trend dài hạn.`;

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
      if (lastError.includes("429") || lastError.includes("RESOURCE_EXHAUSTED")) {
        await sleep(2000);
        continue;
      }
      throw new Error(lastError);
    }
  }

  throw new Error(`Cạn kiệt hạn mức: ${lastError}`);
};
