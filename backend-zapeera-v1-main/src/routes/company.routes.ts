import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { checkSubscription, enforceMembershipInviteLimit } from '../middleware/subscription.middleware';
import {
  getCompanies,
  getMyCompanies,
  getCompany,
  getCompanyBySlug,
  createCompany,
  updateCompany,
  deleteCompany,
  getCompanyStats,
  updateCompanyBusinessType,
  addCompanyMember,
  getCompanyMembers,
  removeCompanyMember
} from '../controllers/company.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Company routes
router.get('/', getCompanies);                    // GET /api/companies
router.get('/my/list', getMyCompanies);           // GET /api/companies/my/list
router.get('/slug/:slug', getCompanyBySlug);      // GET /api/companies/slug/:slug
router.get('/:id', getCompany);                   // GET /api/companies/:id
router.post('/', createCompany);                  // POST /api/companies
router.put('/:id', updateCompany);                // PUT /api/companies/:id
router.patch('/:id/business-type', updateCompanyBusinessType); // PATCH /api/companies/:id/business-type
router.delete('/:id', deleteCompany);             // DELETE /api/companies/:id
router.get('/:id/stats', getCompanyStats);        // GET /api/companies/:id/stats
router.get('/:id/members', getCompanyMembers);    // GET /api/companies/:id/members

router.post('/:id/members', checkSubscription(), enforceMembershipInviteLimit(), addCompanyMember);    // POST /api/companies/:id/members
router.delete('/:id/members/:userId', removeCompanyMember); // DELETE /api/companies/:id/members/:userId

export default router;
