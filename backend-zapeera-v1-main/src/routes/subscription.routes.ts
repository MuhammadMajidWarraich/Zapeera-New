import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  getSubscription,
  updateSubscription,
  getPaymentMethods,
  addPaymentMethod,
  setDefaultPaymentMethod,
  deletePaymentMethod,
  getBillingHistory,
  downloadInvoice,
  processPayment,
  getPricingPlans,
  updatePricingPlans,
  updatePlanModule,
  getAnnualDiscount,
  updateAnnualDiscount,
  getBusinessEntitlements,
  updateBusinessEntitlements,
  activateSubscription
} from '../controllers/subscription.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Subscription routes
router.get('/', getSubscription);
router.put('/', updateSubscription);
router.get('/pricing-plans', getPricingPlans);
router.put('/pricing-plans', updatePricingPlans);
router.patch('/pricing-plans/:planId/modules/:moduleId', updatePlanModule);
router.get('/annual-discount', getAnnualDiscount);
router.put('/annual-discount', updateAnnualDiscount);
router.get('/entitlements/business/:companyId', getBusinessEntitlements);
router.put('/entitlements/business/:companyId', updateBusinessEntitlements);

// Payment method routes
router.get('/payment-methods', getPaymentMethods);
router.post('/payment-methods', addPaymentMethod);
router.put('/payment-methods/:methodId/default', setDefaultPaymentMethod);
router.delete('/payment-methods/:methodId', deletePaymentMethod);

// Fake-payment activation (local testing / manual upgrade)
router.post('/activate', activateSubscription);

// Payment processing routes
router.post('/process-payment', processPayment);

// Billing history routes
router.get('/billing-history', getBillingHistory);
router.get('/invoices/:invoiceId/download', downloadInvoice);

export default router;
