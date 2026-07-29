import { Router } from 'express';
import multer from 'multer';
import { OCRController } from '../controllers/ocr.controller';

const router = Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

/**
 * @route   POST /api/ocr/scan
 * @desc    Scan document and extract data
 * @access  Private
 */
router.post('/scan', upload.single('file'), OCRController.scanDocument);

/**
 * @route   POST /api/ocr/scan-base64
 * @desc    Scan document from base64
 * @access  Private
 */
router.post('/scan-base64', OCRController.scanDocumentBase64);

/**
 * @route   POST /api/ocr/map
 * @desc    Map extracted data to database entities
 * @access  Private
 */
router.post('/map', OCRController.mapExtractedData);

/**
 * @route   POST /api/ocr/save
 * @desc    Save mapped data to database
 * @access  Private
 */
router.post('/save', OCRController.saveMappedData);

/**
 * @route   GET /api/ocr/health
 * @desc    Health check for OCR service
 * @access  Private
 */
router.get('/health', OCRController.healthCheck);

export default router;
