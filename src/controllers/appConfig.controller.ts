import { Request, Response } from 'express';
import { appConfigService } from '../services/appConfig.service';

class AppConfigController {
  async getAll(req: Request, res: Response) {
    try {
      const configs = await appConfigService.getAll();
      return res.json(configs);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  async getOne(req: Request, res: Response) {
    try {
      const { key } = req.params;
      const value = await appConfigService.get(key);
      if (value === null) return res.status(404).json({ error: `Key '${key}' not found` });
      return res.json({ key, value });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  async set(req: Request, res: Response) {
    try {
      const { key, value } = req.body;
      if (!key || value === undefined) {
        return res.status(400).json({ error: 'key and value are required' });
      }
      const record = await appConfigService.set(key, String(value));
      return res.json(record);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
}

export const appConfigController = new AppConfigController();
