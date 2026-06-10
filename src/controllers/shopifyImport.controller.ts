import { Request, Response } from 'express';
import { fetchAndPreview, importSingleOrder } from '../services/shopifyImport.service';

class ShopifyImportController {
  async preview(req: Request, res: Response) {
    try {
      const store = (req.query.store as string) || 'domestic';
      if (store !== 'domestic' && store !== 'global') {
        return res.status(400).json({ error: "store must be 'domestic' or 'global'" });
      }
      const result = await fetchAndPreview(store);
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Failed to fetch Shopify orders' });
    }
  }

  async importSingle(req: Request, res: Response) {
    try {
      const { order, store_type } = req.body;
      if (!order) return res.status(400).json({ error: 'order is required' });
      if (store_type !== 'domestic' && store_type !== 'global') {
        return res.status(400).json({ error: "store_type must be 'domestic' or 'global'" });
      }
      const result = await importSingleOrder(order, store_type);
      const statusCode = result.success ? 200 : 422;
      return res.status(statusCode).json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Import failed' });
    }
  }
}

export const shopifyImportController = new ShopifyImportController();
