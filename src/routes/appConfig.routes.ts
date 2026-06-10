import { Router } from 'express';
import { appConfigController } from '../controllers/appConfig.controller';
import { authenticate } from '../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/', (req, res) => appConfigController.getAll(req, res));
router.get('/:key', (req, res) => appConfigController.getOne(req, res));
router.post('/', (req, res) => appConfigController.set(req, res));

export default router;
