import axios from 'axios';

const OCR_SERVICE_URL = process.env.OCR_SERVICE_URL || 'http://localhost:8000';

// Shared secret for the OCR service (QA fix 2026-10-19, Track A A-11).
// The OCR service requires header `X-OCR-Key` matching its OCR_SHARED_SECRET
// env var; both sides must be configured with the SAME value (set
// OCR_SHARED_SECRET in the deployment .env / docker-compose environment for
// both the backend and ocr services). When unset here, no header is sent and
// the OCR service will refuse scan requests unless it runs in its explicit
// unauthenticated dev mode (OCR_ALLOW_UNAUTHENTICATED=1).
const OCR_SHARED_SECRET = process.env.OCR_SHARED_SECRET || '';

function ocrAuthHeaders(): Record<string, string> {
  return OCR_SHARED_SECRET ? { 'X-OCR-Key': OCR_SHARED_SECRET } : {};
}

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
        headers: { ...ocrAuthHeaders() },
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
          headers: { ...ocrAuthHeaders() },
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
