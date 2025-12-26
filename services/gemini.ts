
import { GoogleGenAI, Type } from "@google/genai";
import { CandleData, AnalysisResponse } from "../types";

export const analyzeMarket = async (symbol: string, candles: CandleData[]): Promise<AnalysisResponse> => {
  // Tuân thủ hướng dẫn: Sử dụng trực tiếp từ process.env.API_KEY
  const apiKey = process.env.API_KEY;
  
  if (!apiKey || apiKey === "__API_KEY_PLACEHOLDER__") {
    throw new Error("API_KEY chưa được cấu hình. Vui lòng kiểm tra môi trường.");
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
  
  YÊU CẦU ĐẶC BIỆT:
  - Tập trung tìm kiếm các tín hiệu "Mua khi giá thấp": Kiểm tra xem giá có đang ở vùng Hỗ trợ quan trọng hoặc RSI < 30 (quá bán) không.
  - Kiểm tra các mô hình nến đảo chiều (Pinbar, Bullish Engulfing) tại vùng giá thấp.
  - Chỉ đưa ra BUY khi có sự hội tụ của ít nhất 2 yếu tố kỹ thuật.
  
  TRẢ VỀ JSON:
  1. signal: BUY, SELL hoặc NEUTRAL.
  2. confidence: % độ tin cậy.
  3. reasoning: Danh sách 3-4 lý do kỹ thuật (Tiếng Việt).
  4. keyLevels: { support: số, resistance: số }.
  5. indicators: { rsi: số, trend: "Tăng/Giảm/Sideway" }.`;

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
