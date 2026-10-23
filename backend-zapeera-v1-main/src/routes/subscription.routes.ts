import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  getAddonCatalogue,
  getBusinessAddons,
  purchaseAddon,
  cancelAddon
} from '../controllers/addon.controller';
import {
  getSubscription,
  updateSubscription,
  getPaymentMethods,
  addPaymentMethod,
  updatePaymentMethod,
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
router.put('/payment-methods/:methodId', updatePaymentMethod);
router.put('/payment-methods/:methodId/default', setDefaultPaymentMethod);
router.delete('/payment-methods/:methodId', deletePaymentMethod);

// Subscription add-ons (HR Pack, extra seats/branches, packs, boosters)
router.get('/addons/catalogue', getAddonCatalogue);
router.get('/addons', getBusinessAddons);
router.post('/addons', purchaseAddon);
router.post('/addons/cancel', cancelAddon);

// Fake-payment activation (local testing / manual upgrade)
router.post('/activate', activateSubscription);

// Payment processing routes
router.post('/process-payment', processPayment);

// Billing history routes
router.get('/billing-history', getBillingHistory);
router.get('/invoices/:invoiceId/download', downloadInvoice);

export default router;
