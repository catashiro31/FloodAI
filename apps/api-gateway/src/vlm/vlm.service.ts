import { Injectable } from '@nestjs/common';
import ollama from 'ollama'; // Import thư viện chuẩn của Ollama

@Injectable()
export class VlmService {

  async analyze(question: string, base64Image: string) {
    const response = await ollama.chat({
      model: 'paligemma',
      messages: [
        {
          role: 'user',
          content: question,
          images: [base64Image] // Nhét ảnh vào đây cực dễ
        }
      ]
    });

    return response.message.content;
  }
}
