
import { GoogleGenAI, Type } from "@google/genai";
import { CandleData, AnalysisResponse } from "../types";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const analyzeMarket = async (symbol: string, candles: CandleData[], retries = 3): Promise<AnalysisResponse> => {
  const apiKey = process.env.API_KEY;
  
  if (!apiKey) {
    throw new Error("API_KEY is missing. Please check your configuration.");
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
  - Tập trung vào Price Action, RSI và các vùng Hỗ trợ/Kháng cự trên khung 5M.
  - Mặc dù dữ liệu là 5M, hãy đưa ra chiến thuật giao dịch phù hợp để giữ lệnh trong khoảng 15-45 phút.
  - Chỉ đưa ra độ tin cậy (confidence) cao nếu các chỉ báo hội tụ mạnh mẽ.

  YÊU CẦU TRẢ VỀ JSON:
  1. signal: BUY, SELL hoặc NEUTRAL.
  2. confidence: % độ tin cậy.
  3. reasoning: 3 lý do kỹ thuật ngắn gọn.
  4. keyLevels: { support: số, resistance: số }.
  5. tradePlan: { entry: số, stopLoss: số, takeProfit: số }.
  6. indicators: { rsi: số, trend: "Tăng/Giảm/Sideway" }.`;

  for (let i = 0; i < retries; i++) {
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

      const text = response.text;
      if (!text) throw new Error("AI returned an empty response.");

      const cleanJson = text.replace(/```json/g, "").replace(/```/g, "").trim();
      return JSON.parse(cleanJson) as AnalysisResponse;
    } catch (e: any) {
      const isRateLimit = e.message?.includes("429") || e.status === 429 || JSON.stringify(e).includes("RESOURCE_EXHAUSTED");
      
      if (isRateLimit && i < retries - 1) {
        // Đợi theo lũy thừa: 5s, 10s...
        const waitTime = (i + 1) * 5000;
        console.warn(`Rate limit hit for ${symbol}. Retrying in ${waitTime}ms... (Attempt ${i + 1}/${retries})`);
        await sleep(waitTime);
        continue;
      }
      
      console.error("Gemini Technical Error:", e);
      throw new Error(isRateLimit ? "API Gemini đang bận (Rate Limit). Vui lòng đợi hoặc nâng cấp gói API." : (e.message || "Unknown AI error"));
    }
  }
  throw new Error("Max retries reached");
};
