import { Router } from 'express';
import { salesOrderController } from '../controllers/salesOrder.controller';
import { shopifyImportController } from '../controllers/shopifyImport.controller';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';

const router = Router();
router.use(authenticate);
router.use(requirePermission('can_manage_sales'));

// ── Shopify Import (must be before /:id routes) ─────────────────
router.get('/shopify/preview', (req, res) => shopifyImportController.preview(req, res));
router.post('/shopify/import-single', (req, res) => shopifyImportController.importSingle(req, res));

router.get('/items', (req, res) => salesOrderController.getItems(req, res));
router.post('/items', (req, res) => salesOrderController.createItem(req, res));
router.get('/advances', (req, res) => salesOrderController.getAdvances(req, res));
router.get('/advances/:id', (req, res) => salesOrderController.findAdvanceById(req, res));
router.post('/advances/:id/adjust', (req, res) => salesOrderController.adjustAdvance(req, res));
router.post('/advances', (req, res) => salesOrderController.addAdvance(req, res));

router.get('/', (req, res) => salesOrderController.findAll(req, res));
router.post('/', (req, res) => salesOrderController.create(req, res));
router.get('/:id', (req, res) => salesOrderController.findById(req, res));
router.put('/:id', (req, res) => salesOrderController.update(req, res));
router.delete('/:id', (req, res) => salesOrderController.delete(req, res));
router.post('/:id/advances', (req, res) => salesOrderController.addAdvance(req, res));

export default router;
