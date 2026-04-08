import { Injectable, Logger } from '@nestjs/common';
import { Ollama } from 'ollama';

@Injectable()
export class VlmService {
  private readonly logger = new Logger(VlmService.name);
  private readonly ollama: Ollama;

  constructor() {
    const host = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
    this.ollama = new Ollama({ host });
  }

  /**
   * Phân tích đơn giản với một model (dùng cho follow-up chat).
   */
  async analyze(question: string, base64Image: string, model = 'gemma4') {
    const response = await this.ollama.chat({
      model,
      messages: [
        {
          role: 'user',
          content: question,
          images: [base64Image],
        },
      ],
    });
    return response.message.content;
  }

  /**
   * Phân tích chuyên gia kết hợp PaliGemma (Vision) + Gemma4 (Reasoning).
   * 
   * Pipeline:
   * 1. PaliGemma nhìn ảnh gốc → mô tả cảnh quan
   * 2. PaliGemma nhìn ảnh mask → mô tả vùng phân đoạn
   * 3. Gemma4 tổng hợp: mô tả + metrics số liệu → đánh giá chuyên gia
   */
  async analyzeExpert(
    question: string,
    base64Original: string,
    base64Mask: string,
    metrics: Record<string, any> | null,
  ): Promise<string> {
    this.logger.log('🚀 Đang chạy phân tích chuyên gia với mô hình SIÊU NHẸ (moondream + gemma2:2b)...');

    // === Step 1: Moondream (1.6B) nhìn cả 2 ảnh cực nhanh ===
    this.logger.log('  [1/2] Moondream đang quét ảnh gốc & mask...');
    const visionResponse = await this.ollama.chat({
      model: 'moondream', // Mô hình Vision siêu nhẹ
      messages: [
        {
          role: 'user',
          content: 'Analyze these 2 images. Image 1 is natural, Image 2 is segmentation mask (Red: flooded building, Blue: flooded road, Green: water). Briefly describe the flood scene and disaster extent in Vietnamese.',
          images: [base64Original, base64Mask],
        },
      ],
      options: {
        num_predict: 200,
        temperature: 0.1,
      }
    });
    const visualDescription = visionResponse.message.content;

    // === Step 2: Gemma2:2b tổng hợp báo cáo ===
    this.logger.log('  [2/2] Gemma2:2b đang lập báo cáo nhanh...');
    
    const metricsText = metrics
      ? `SỐ LIỆU: Ngập ${metrics.flood_coverage_percent}%, ${metrics.building_flooded_count} nhà bị ảnh hưởng, ${metrics.road_flood_ratio}% đường ngập.`
      : 'Không có số liệu.';

    const expertPrompt = `Bạn là chuyên gia cứu trợ. Dựa trên:
MÔ TẢ: ${visualDescription}
${metricsText}
CÂU HỎI: ${question}

BÁO CÁO NHANH (Tiếng Việt):
- Tình trạng: [Mức độ]
- Đánh giá: [Ngắn gọn]
- Khuyến nghị: [1 câu duy nhất]`;

    const expertResponse = await this.ollama.chat({
      model: 'gemma2:2b', // Mô hình Reasoning siêu nhẹ
      messages: [{ role: 'user', content: expertPrompt }],
      options: {
        num_predict: 300,
        temperature: 0.5,
      }
    });

    this.logger.log('  ✅ Hoàn tất phân tích siêu tốc.');
    return expertResponse.message.content;
  }

}
