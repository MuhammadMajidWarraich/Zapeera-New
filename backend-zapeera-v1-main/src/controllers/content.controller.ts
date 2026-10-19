// CRITICAL: Import database initialization FIRST to ensure DATABASE_URL is set
import '../config/database.init';

import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';

/**
 * GET /content/:slug (public)
 * Serve a backoffice-managed content page. Only PUBLISHED pages are
 * visible; drafts and unknown slugs are indistinguishable (both 404) so
 * unpublished content never leaks.
 */
export const getPublishedContentPage = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const page = await prisma.contentPage.findFirst({
      where: { slug: req.params.slug, status: 'PUBLISHED' },
      select: { id: true, slug: true, title: true, body: true, status: true, createdAt: true, updatedAt: true }
    });
    if (!page) {
      res.status(404).json({ success: false, message: 'Page not found' });
      return;
    }
    res.json({ success: true, data: page });
  } catch (error: any) {
    console.error('[Content] getPublishedContentPage error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
