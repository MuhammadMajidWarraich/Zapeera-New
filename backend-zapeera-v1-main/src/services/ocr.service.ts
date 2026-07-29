import axios from 'axios';

const OCR_SERVICE_URL = process.env.OCR_SERVICE_URL || 'http://localhost:8000';

export interface ExtractedData {
  productName?: string;
  category?: string;
  manufacturer?: string;
  batchNo?: string;
  quantity?: number;
  expiryDate?: string;
  price?: number;
  shelf?: string;
  supplier?: string;
  rawText?: string;
  confidence?: Record<string, number>;
}

export class OCRService {
  /**
   * Scan document using OCR microservice
   */
  static async scanDocument(imageBuffer: Buffer): Promise<ExtractedData> {
    try {
      const formData = new FormData();
      formData.append('file', new Blob([imageBuffer]), 'document.jpg');

      const response = await axios.post(`${OCR_SERVICE_URL}/scan-document`, formData, {
        timeout: 30000, // 30 second timeout
      });

      return response.data;
    } catch (error: any) {
      console.error('OCR Service Error:', error);
      const message = error?.response?.data?.detail || error?.message || 'Failed to scan document';
      throw new Error(`OCR failed: ${message}`);
    }
  }

  /**
   * Scan document from base64
   */
  static async scanDocumentBase64(base64Image: string): Promise<ExtractedData> {
    try {
      const response = await axios.post(
        `${OCR_SERVICE_URL}/scan-document-base64`,
        { image: base64Image },
        {
          timeout: 30000,
        }
      );

      return response.data;
    } catch (error: any) {
      console.error('OCR Service Error:', error);
      const message = error?.response?.data?.detail || error?.message || 'Failed to scan document';
      throw new Error(`OCR failed: ${message}`);
    }
  }

  /**
   * Check if OCR service is healthy
   */
  static async healthCheck(): Promise<boolean> {
    try {
      const response = await axios.get(`${OCR_SERVICE_URL}/`, { timeout: 5000 });
      return response.status === 200;
    } catch (error) {
      console.error('OCR Health Check Error:', error);
      return false;
    }
  }
}
