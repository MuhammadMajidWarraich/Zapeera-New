import { Router } from 'express';
import {
  lookupBarcode,
  generateBarcode,
  validateBarcode,
  getBarcodeStats,
  getProductBarcodes,
  updateProductBarcodes,
} from '../controllers/barcode.controller';
import { authenticate } from '../middleware/auth.middleware';
import { resolveBusiness, resolveMembership, resolveBranch, checkModule } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));

// Barcode lookup - fast endpoint for POS scanning (no module check for speed)
router.post('/lookup', lookupBarcode);

// Barcode generation
router.post('/generate', generateBarcode);

// Barcode validation
router.post('/validate', validateBarcode);

// Barcode stats for business
router.get('/stats', getBarcodeStats);

// Product-specific barcode management
router.get('/product/:productId', getProductBarcodes);
router.put('/product/:productId', updateProductBarcodes);

export default router;
