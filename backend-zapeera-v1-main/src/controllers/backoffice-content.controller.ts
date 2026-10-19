import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AdminAuthRequest, logAdminAction } from '../middleware/admin-auth.middleware';

// Backoffice content management (A-11): minimal honest CMS over the
// ContentPage model. Pages are edited here and served publicly only while
// PUBLISHED (see controllers/content.controller.ts for the public read).

export const CONTENT_PAGE_STATUSES = ['DRAFT', 'PUBLISHED'];
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const isRecordNotFound = (error: any): boolean => error?.code === 'P2025';
const isUniqueViolation = (error: any): boolean => error?.code === 'P2002';

const validateSlugAndStatus = (
  res: Response,
  fields: { slug?: string; status?: string }
): boolean => {
  if (fields.slug !== undefined && !SLUG_PATTERN.test(fields.slug)) {
    res.status(400).json({
      success: false,
      message: 'Invalid slug. Use lowercase letters, numbers and single hyphens (e.g. privacy-policy).'
    });
    return false;
  }
  if (fields.status !== undefined && !CONTENT_PAGE_STATUSES.includes(fields.status)) {
    res.status(400).json({
      success: false,
      message: `Invalid status. Must be one of: ${CONTENT_PAGE_STATUSES.join(', ')}`
    });
    return false;
  }
  return true;
};

/**
 * GET /backoffice/content/pages
 * List all content pages (drafts included). Optional ?status=&search=.
 */
export const getContentPages = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;

    const where: any = {};
    if (status && CONTENT_PAGE_STATUSES.includes(status)) where.status = status;
    if (search) {
      where.OR = [{ title: { contains: search } }, { slug: { contains: search } }];
    }

    const pages = await prisma.contentPage.findMany({
      where,
      orderBy: { updatedAt: 'desc' }
    });

    res.json({ success: true, data: pages });
  } catch (error: any) {
    console.error('[Content] getContentPages error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * GET /backoffice/content/pages/:id
 */
export const getContentPage = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const page = await prisma.contentPage.findUnique({ where: { id: req.params.id } });
    if (!page) {
      res.status(404).json({ success: false, message: 'Content page not found' });
      return;
    }
    res.json({ success: true, data: page });
  } catch (error: any) {
    console.error('[Content] getContentPage error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * POST /backoffice/content/pages
 */
export const createContentPage = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { slug, title, body, status } = req.body || {};
    const adminId = req.admin!.id;

    if (!slug || !title || !body) {
      res.status(400).json({ success: false, message: 'Slug, title and body are required' });
      return;
    }
    if (!validateSlugAndStatus(res, { slug, status })) return;

    let page;
    try {
      page = await prisma.contentPage.create({
        data: {
          slug,
          title,
          body,
          status: status || 'DRAFT',
          createdBy: adminId
        }
      });
    } catch (error: any) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ success: false, message: `A content page with slug '${slug}' already exists` });
        return;
      }
      throw error;
    }

    await logAdminAction(adminId, 'CREATE_CONTENT_PAGE', 'ContentPage', page.id, {
      slug,
      title,
      status: page.status
    });

    res.status(201).json({ success: true, data: page });
  } catch (error: any) {
    console.error('[Content] createContentPage error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * PATCH /backoffice/content/pages/:id
 */
export const updateContentPage = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const { slug, title, body, status } = req.body || {};
    const adminId = req.admin!.id;

    if (!validateSlugAndStatus(res, { slug, status })) return;

    const data: { slug?: string; title?: string; body?: string; status?: string } = {};
    if (slug !== undefined) data.slug = slug;
    if (title !== undefined) data.title = title;
    if (body !== undefined) data.body = body;
    if (status !== undefined) data.status = status;

    if (Object.keys(data).length === 0) {
      res.status(400).json({ success: false, message: 'No fields to update' });
      return;
    }

    let page;
    try {
      page = await prisma.contentPage.update({ where: { id }, data });
    } catch (error: any) {
      if (isRecordNotFound(error)) {
        res.status(404).json({ success: false, message: 'Content page not found' });
        return;
      }
      if (isUniqueViolation(error)) {
        res.status(409).json({ success: false, message: `A content page with slug '${slug}' already exists` });
        return;
      }
      throw error;
    }

    await logAdminAction(adminId, 'UPDATE_CONTENT_PAGE', 'ContentPage', id, data);

    res.json({ success: true, data: page });
  } catch (error: any) {
    console.error('[Content] updateContentPage error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * DELETE /backoffice/content/pages/:id
 */
export const deleteContentPage = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const adminId = req.admin!.id;

    try {
      await prisma.contentPage.delete({ where: { id } });
    } catch (error: any) {
      if (isRecordNotFound(error)) {
        res.status(404).json({ success: false, message: 'Content page not found' });
        return;
      }
      throw error;
    }

    await logAdminAction(adminId, 'DELETE_CONTENT_PAGE', 'ContentPage', id);

    res.json({ success: true, data: null });
  } catch (error: any) {
    console.error('[Content] deleteContentPage error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
