import { Router } from 'express';
import { getPublishedContentPage } from '../controllers/content.controller';

const router = Router();

// Public read of backoffice-managed content pages (PUBLISHED only — the
// controller fails closed with 404 for drafts and unknown slugs). Editing
// happens exclusively through the backoffice routes.
router.get('/:slug', getPublishedContentPage);

export default router;
