import { Router } from 'express';
import { getSales, getSale, getSaleByReceiptNumber, getAvailableReceiptNumbers, createSale, updateSale, deleteSale } from '../controllers/sale.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, checkPermission, resolveBranch, resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('sales'));

// Sales routes (module gated + permission guarded)
router.get('/', checkPermission('read_sale'), getSales);
router.get('/receipt/:receiptNumber', checkPermission('read_sale'), getSaleByReceiptNumber);
router.get('/receipts', checkPermission('read_sale'), getAvailableReceiptNumbers);
router.get('/:id', checkPermission('read_sale'), getSale);
router.post('/', checkPermission('create_sale'), createSale);
router.put('/:id', checkPermission('update_sale'), updateSale);
router.delete('/:id', checkPermission('delete_sale'), deleteSale);

export default router;
