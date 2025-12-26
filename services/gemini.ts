import { GoogleGenAI, Type } from "@google/genai";
import { CandleData, AnalysisResponse } from "../types";

export const analyzeMarket = async (symbol: string, candles: CandleData[]): Promise<AnalysisResponse> => {
  // Use process.env.API_KEY as per guidelines. 
  // Our Docker build maps this to window.APP_CONFIG.API_KEY for runtime flexibility.
  const apiKey = 'AIzaSyCpyPu6zZAbj4ZVafQhXq_QzucoMoA2dU8';
  
  if (!apiKey || apiKey === "__API_KEY_PLACEHOLDER__" || apiKey === "undefined") {
    console.error("Critical: API_KEY is missing in the browser environment.");
    throw new Error("API_KEY chưa được cấu hình. Vui lòng kiểm tra biến môi trường trong docker-compose.yml");
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

  const prompt = `Phân tích biểu đồ 15 phút cho cặp ${symbol}USDT. 
  Dữ liệu (50 nến gần nhất): ${JSON.stringify(relevantCandles)}
  
  Hãy đóng vai một chuyên gia phân tích kỹ thuật chuyên nghiệp. Hãy xác định:
  1. Xu hướng hiện tại (Tăng/Giảm/Đi ngang).
  2. Các mức hỗ trợ và kháng cự quan trọng.
  3. Tín hiệu kỹ thuật (RSI, các mô hình nến như nhấn chìm, búa, v.v.).
  4. Đưa ra khuyến nghị giao dịch rõ ràng: BUY (MUA), SELL (BÁN), hoặc NEUTRAL (THEO DÕI).
  
  YÊU CẦU: Tất cả phần giải thích (reasoning) và xu hướng (trend) phải bằng TIẾNG VIỆT.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            signal: { type: Type.STRING, description: "Bắt buộc là BUY, SELL, hoặc NEUTRAL" },
            confidence: { type: Type.NUMBER, description: "Mức độ tin cậy 0-100" },
            reasoning: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING },
              description: "Danh sách các lý do kỹ thuật bằng tiếng Việt"
            },
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
    console.error("Lỗi Gemini API chi tiết:", e);
    if (e.message?.includes('API_KEY_INVALID') || e.message?.includes('403')) {
      throw new Error("API Key không hợp lệ hoặc đã hết hạn.");
    }
    throw new Error(`Lỗi kết nối AI: ${e.message || 'Không rõ nguyên nhân'}`);
  }
};
