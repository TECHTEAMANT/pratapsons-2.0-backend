import { AppDataSource } from '../config/data-source';
import { AppConfig } from '../entities/AppConfig';

class AppConfigService {
  private repo = AppDataSource.getRepository(AppConfig);

  async get(key: string): Promise<string | null> {
    const record = await this.repo.findOne({ where: { key } });
    return record ? record.value : null;
  }

  async set(key: string, value: string): Promise<AppConfig> {
    let record = await this.repo.findOne({ where: { key } });
    if (record) {
      record.value = value;
    } else {
      record = this.repo.create({ key, value });
    }
    return this.repo.save(record);
  }

  async getAll(): Promise<AppConfig[]> {
    return this.repo.find({ order: { key: 'ASC' } });
  }

  async getNumeric(key: string, defaultValue = 0): Promise<number> {
    const val = await this.get(key);
    const parsed = parseFloat(val ?? '');
    return isNaN(parsed) ? defaultValue : parsed;
  }
}

export const appConfigService = new AppConfigService();
