import https from 'https';
import http from 'http';
import { AppDataSource } from '../config/data-source';
import { Customer } from '../entities/Customer';
import { ProductMaster } from '../entities/ProductMaster';
import { ProductGroup } from '../entities/ProductGroup';
import { SalesOrder } from '../entities/SalesOrder';
import { SalesOrderItem } from '../entities/SalesOrderItem';
import { appConfigService } from './appConfig.service';

// ─────────────────────────────────────────────────────────────────
// NATIVE HTTP GET HELPER (replaces axios — no extra dependency)
// ─────────────────────────────────────────────────────────────────
function httpGet(url: string, headers: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse Shopify response: ${data.slice(0, 200)}`));
        }
      });
    }).on('error', reject);
  });
}

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

/**
 * Mirrors Electron's extractOrderNumber:
 * "#116047" → 116047 | "#G15208" → 15208 | 116047 → 116047
 */
function extractOrderNumber(identifier: string | number): number {
  if (!identifier) return 0;
  if (typeof identifier === 'number') return identifier;
  const match = String(identifier).match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

/**
 * Parse design_no from new 8-part SKU format.
 * "PTEB-CH-M-003212-R0096B-CC-R-J79" → "003212" (index 3)
 */
function parseDesignNo(sku: string): string {
  if (!sku) return 'UNKNOWN';
  const parts = sku.split('-');
  if (parts.length === 8) return parts[3];
  return 'UNKNOWN';
}

/**
 * Clean phone number — strip country codes and non-digits.
 */
function cleanPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  // Remove leading country codes: 91 (India), 1 (US/CA) if > 10 digits
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits || null;
}

/**
 * GST logic mirroring Electron's domestic XML generator.
 * Global orders → 0%. Domestic: saree or price ≤ 2624 → 5%, else 18%.
 */
function calcGst(title: string, price: number, storeType: string): number {
  if (storeType === 'global') return 0;
  if (title.toLowerCase().includes('saree') || price <= 2624) return 5;
  return 18;
}

// ─────────────────────────────────────────────────────────────────
// CUSTOMER RESOLUTION
// ─────────────────────────────────────────────────────────────────

async function resolveCustomer(order: any): Promise<Customer> {
  const customerRepo = AppDataSource.getRepository(Customer);
  const billing = order.billing_address || {};
  const shopifyCustomer = order.customer || {};

  // Build lookup phone
  const rawPhone =
    billing.phone || shopifyCustomer.phone || order.phone || null;
  let mobile = cleanPhone(rawPhone);

  // Fallback if no phone at all
  if (!mobile) {
    mobile = `SHOPIFY_${shopifyCustomer.id || order.id}`;
  }

  // Try to find existing customer
  let customer = await customerRepo.findOne({ where: { mobile } });
  if (customer) return customer;

  // Create new customer
  const name = [billing.first_name, billing.last_name]
    .filter(Boolean)
    .join(' ')
    .trim() || shopifyCustomer.first_name || 'Unknown';

  customer = customerRepo.create({
    mobile,
    name,
    email: order.email || order.contact_email || null,
    address: billing.address1 || null,
    city: billing.city || null,
    pincode: billing.zip || null,
  });

  return customerRepo.save(customer);
}

// ─────────────────────────────────────────────────────────────────
// PRODUCT RESOLUTION
// ─────────────────────────────────────────────────────────────────

async function resolveProduct(lineItem: any, price: number): Promise<ProductMaster> {
  const productRepo = AppDataSource.getRepository(ProductMaster);
  const groupRepo = AppDataSource.getRepository(ProductGroup);

  const design_no = parseDesignNo(lineItem.sku);

  // Try to find existing product
  let product = await productRepo.findOne({ where: { design_no } });
  if (product) return product;

  // Find or create "Unknown Group"
  let unknownGroup = await groupRepo.findOne({ where: { name: 'Unknown Group' } });
  if (!unknownGroup) {
    unknownGroup = groupRepo.create({
      name: 'Unknown Group',
      group_code: 'UNKNOWN',
      description: 'Auto-created for unmatched Shopify products',
    });
    unknownGroup = await groupRepo.save(unknownGroup);
  }

  // Create new ProductMaster
  product = productRepo.create({
    design_no,
    sku: lineItem.sku || null,
    name: lineItem.title || lineItem.name || '',
    product_group_id: unknownGroup.id,
    mrp: price,
    gst_logic: 'AUTO_5_18',
  });

  return productRepo.save(product);
}

// ─────────────────────────────────────────────────────────────────
// PREVIEW
// ─────────────────────────────────────────────────────────────────

export async function fetchAndPreview(storeType: 'domestic' | 'global') {
  const configKey =
    storeType === 'global' ? 'HIGHEST_GLOBAL_ORDER' : 'HIGHEST_DOMESTIC_ORDER';
  const highest = await appConfigService.getNumeric(configKey, 0);

  // Fetch from Shopify
  const url =
    storeType === 'global'
      ? process.env.SHOPIFY_GLOBAL_URL
      : process.env.SHOPIFY_DOMESTIC_URL;
  const token =
    storeType === 'global'
      ? process.env.SHOPIFY_GLOBAL_TOKEN
      : process.env.SHOPIFY_DOMESTIC_TOKEN;

  if (!url || !token) {
    throw new Error(`Shopify credentials not configured for ${storeType} store. Check .env file.`);
  }

  const responseData = await httpGet(url, {
    'X-Shopify-Access-Token': token,
    'Content-Type': 'application/json',
  });

  let rawOrders: any[] = [];
  if (Array.isArray(responseData)) rawOrders = responseData;
  else if (Array.isArray(responseData?.orders)) rawOrders = responseData.orders;

  // IMPORTANT: Shopify returns newest first (DESC). We must reverse it to oldest-first (ASC)
  // so that when the frontend imports them chronologically, the high-water mark climbs correctly!
  rawOrders.reverse();

  // Tag and filter
  const orders = rawOrders.map((o: any) => {
    const numericId = extractOrderNumber(o.order_number || o.name);
    return {
      name: o.name,
      order_number: o.order_number,
      numeric_id: numericId,
      is_new: numericId > highest,
      customer_name:
        o.billing_address
          ? `${o.billing_address.first_name || ''} ${o.billing_address.last_name || ''}`.trim()
          : o.customer?.first_name || 'Unknown',
      total_price: o.total_price,
      currency: o.currency,
      financial_status: o.financial_status,
      created_at: o.created_at,
      item_count: o.line_items?.length || 0,
      _raw: o, // frontend will pass this back for import
    };
  });

  const newOrders = orders.filter((o: any) => o.is_new);
  const importedOrders = orders.filter((o: any) => !o.is_new);

  return {
    highest_tracked: highest,
    new_count: newOrders.length,
    already_imported_count: importedOrders.length,
    orders,
  };
}

// ─────────────────────────────────────────────────────────────────
// IMPORT SINGLE ORDER
// ─────────────────────────────────────────────────────────────────

export async function importSingleOrder(
  order: any,
  storeType: 'domestic' | 'global'
): Promise<{ success: boolean; order_number: string; sales_order_id?: string; error?: string }> {
  const orderNumber = order.name || `#${order.order_number}`;
  const numericId = extractOrderNumber(order.order_number || order.name);

  try {
    // Fast in-memory guard: check high-water mark
    const configKey = storeType === 'global' ? 'HIGHEST_GLOBAL_ORDER' : 'HIGHEST_DOMESTIC_ORDER';
    const highest = await appConfigService.getNumeric(configKey, 0);
    if (numericId > 0 && numericId <= highest) {
      return { success: false, order_number: orderNumber, error: `Order ${orderNumber} already imported (below high-water mark ${highest})` };
    }

    // 1. Resolve customer
    const customer = await resolveCustomer(order);

    // 2. Extract total amount directly (no currency conversion)
    const totalAmount = parseFloat(order.total_price || '0');

    // 3. Build line items
    const lineItems: Partial<SalesOrderItem>[] = [];
    for (let i = 0; i < (order.line_items || []).length; i++) {
      const li = order.line_items[i];
      const price = parseFloat(li.price || '0');

      // Resolve product (auto-creates if needed)
      const product = await resolveProduct(li, price);

      // Calculate discount percentage
      let discountPct = 0;
      if (li.discount_allocations?.length > 0) {
        const totalDiscount = li.discount_allocations.reduce(
          (sum: number, d: any) => sum + parseFloat(d.amount || '0'),
          0
        );
        discountPct = price > 0 ? parseFloat(((totalDiscount / price) * 100).toFixed(2)) : 0;
      }

      lineItems.push({
        sr_no: i + 1,
        design_no: product.design_no,
        sku: li.sku || null,
        product_description: li.title || li.name || '',
        quantity: li.quantity || 1,
        mrp: price,
        gst_percentage: calcGst(li.title || '', price, storeType),
        discount_percentage: discountPct,
        total: parseFloat((price * (li.quantity || 1)).toFixed(2)),
        delivered_quantity: 0,
      });
    }

    // 4. Wrap in transaction
    let savedOrderId: string = '';
    await AppDataSource.transaction(async (manager) => {
      // Save SalesOrder
      const salesOrder = manager.create(SalesOrder, {
        order_number: orderNumber,
        customer_id: customer.id,
        order_date: new Date(order.created_at || Date.now()),
        status: 'pending',
        total_amount: totalAmount,
        advance_received: 0,
        balance_amount: totalAmount,
        store_type: storeType,
        currency: order.currency || (storeType === 'global' ? 'USD' : 'INR'),
        notes: order.note || '',
      });
      const savedOrder = await manager.save(SalesOrder, salesOrder);
      savedOrderId = savedOrder.id;

      // Save SalesOrderItems
      const items = lineItems.map((item) =>
        manager.create(SalesOrderItem, {
          ...item,
          sales_order_id: savedOrder.id,
        })
      );
      await manager.save(SalesOrderItem, items);
    });

    // 5. Update high-water mark (only after successful DB write)
    if (numericId > highest) {
      await appConfigService.set(configKey, String(numericId));
    }

    return { success: true, order_number: orderNumber, sales_order_id: savedOrderId };
  } catch (err: any) {
    return {
      success: false,
      order_number: orderNumber,
      error: err?.message || 'Unknown error during import',
    };
  }
}
