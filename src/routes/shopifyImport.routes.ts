import { Router } from 'express';
import { shopifyImportController } from '../controllers/shopifyImport.controller';
import { requirePermission } from '../middleware/permission';
import { authenticate } from '../middleware/auth';

const router = Router();

// Ensure all shopify routes are authenticated first so req.user is populated
router.use(authenticate);

// Endpoint to fetch orders from Shopify and preview them
router.get('/preview', requirePermission('can_manage_sales'), (req, res) => shopifyImportController.preview(req, res));

// Endpoint to process a single order into the DB
router.post('/import-single', requirePermission('can_manage_sales'), (req, res) => shopifyImportController.importSingle(req, res));

export default router;
