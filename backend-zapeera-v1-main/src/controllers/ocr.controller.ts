import { Request, Response } from 'express';
import { OCRService } from '../services/ocr.service';
import { DataMappingService } from '../services/data-mapping.service';

export class OCRController {
  /**
   * Scan document and extract data
   */
  static async scanDocument(req: Request, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ success: false, message: 'No file uploaded' });
        return;
      }

      const extractedData = await OCRService.scanDocument(req.file.buffer);

      res.json({
        success: true,
        data: extractedData,
      });
      return;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error scanning document:', errorMessage);
      res.status(500).json({
        success: false,
        message: `Failed to scan document: ${errorMessage}`,
        error: errorMessage,
      });
      return;
    }
  }

  /**
   * Scan document from base64
   */
  static async scanDocumentBase64(req: Request, res: Response): Promise<void> {
    try {
      const { image } = req.body;

      if (!image) {
        res.status(400).json({ success: false, message: 'No image data provided' });
        return;
      }

      const extractedData = await OCRService.scanDocumentBase64(image);

      res.json({
        success: true,
        data: extractedData,
      });
      return;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error scanning document:', errorMessage);
      res.status(500).json({
        success: false,
        message: `Failed to scan document: ${errorMessage}`,
        error: errorMessage,
      });
      return;
    }
  }

  /**
   * Map extracted data to database entities
   */
  static async mapExtractedData(req: Request, res: Response): Promise<void> {
    try {
      const { extractedData, branchId, companyId } = req.body;

      if (!extractedData || !branchId || !companyId) {
        res.status(400).json({
          success: false,
          message: 'Missing required fields: extractedData, branchId, companyId',
        });
        return;
      }

      const mappedData = await DataMappingService.mapExtractedData(
        extractedData,
        branchId,
        companyId
      );

      res.json({
        success: true,
        data: mappedData,
      });
      return;
    } catch (error) {
      console.error('Error mapping extracted data:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to map extracted data',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return;
    }
  }

  /**
   * Save mapped data to database
   */
  static async saveMappedData(req: Request, res: Response): Promise<void> {
    try {
      const { mappedData, createdBy } = req.body;

      if (!mappedData || !createdBy) {
        res.status(400).json({
          success: false,
          message: 'Missing required fields: mappedData, createdBy',
        });
        return;
      }

      const result = await DataMappingService.saveMappedData(mappedData, createdBy);

      res.json({
        success: result.success,
        data: result.data,
        errors: result.errors,
      });
      return;
    } catch (error) {
      console.error('Error saving mapped data:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to save mapped data',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return;
    }
  }

  /**
   * Health check for OCR service
   */
  static async healthCheck(req: Request, res: Response) {
    try {
      const isHealthy = await OCRService.healthCheck();

      res.json({
        success: true,
        healthy: isHealthy,
        message: isHealthy ? 'OCR service is healthy' : 'OCR service is not responding',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to check OCR service health',
      });
    }
  }
}
