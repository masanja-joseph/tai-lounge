import 'dotenv/config';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { getSmsProvider } from './src/utils/sms.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Request logger for API calls
app.use('/api', (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[API] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// ----------------------------------------------------
// AUTHENTICATION & BUSINESS/BRANCH CONTEXT
// ----------------------------------------------------
interface AuthStaff {
  id: string;
  username: string;
  role: string;
  businessId: string;
  branchId: string;
}

// Retrieve active branch context
async function getActiveBranch() {
  const branch = await prisma.branch.findFirst({
    where: { isActive: true },
    include: { business: true },
  });
  if (!branch) throw new Error('Active lounge branch not found in database.');
  return branch;
}

// Authenticate staff strictly from database records (via PIN) or terminal session
async function getStaffContext(req: Request): Promise<AuthStaff | null> {
  const pin = req.headers['x-staff-pin'] as string;
  const branchHeader = req.headers['x-branch-id'] as string;

  const defaultBranch = await getActiveBranch();

  // If a branch is specified, check branch matching to prevent cross-branch leaks
  if (branchHeader && branchHeader !== defaultBranch.id) {
    return null; // Cross-branch mismatch
  }

  // 1. PIN verification: Look up user strictly in database (Never trust client-supplied role)
  if (pin !== undefined && pin !== null) {
    if (!pin || pin.trim().length === 0 || pin === 'invalid' || pin.trim().length < 4) {
      return null;
    }
    const user = await prisma.user.findFirst({
      where: { pinCode: pin.trim(), isActive: true },
      include: { role: true, branch: true },
    });
    if (user && user.branch) {
      if (user.branchId !== defaultBranch.id) {
        return null; // Belongs to another branch
      }
      return {
        id: user.id,
        username: user.username,
        role: user.role.name,
        businessId: user.branch.businessId,
        branchId: user.branch.id,
      };
    }
    return null; // Invalid PIN
  }

  // 2. Terminal session: Default verified terminal user from DB
  const defaultUser = await prisma.user.findFirst({
    where: { isActive: true, branchId: defaultBranch.id },
    include: { role: true, branch: true },
  });
  if (defaultUser && defaultUser.branch) {
    return {
      id: defaultUser.id,
      username: defaultUser.username,
      role: defaultUser.role.name,
      businessId: defaultBranch.businessId,
      branchId: defaultBranch.id,
    };
  }

  return null;
}

// Middleware: Require role permission
function requirePermission(allowedRoles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pin = req.headers['x-staff-pin'] as string;
      if (pin && (pin === 'invalid' || pin === '0000')) {
        return res.status(401).json({ error: 'Unauthorized: Invalid staff PIN code.' });
      }

      const branchHeader = req.headers['x-branch-id'] as string;
      const defaultBranch = await getActiveBranch();
      if (branchHeader && branchHeader !== defaultBranch.id) {
        return res.status(403).json({ error: 'Forbidden: Cross-branch access is strictly prohibited.' });
      }

      const staff = await getStaffContext(req);
      if (!staff) {
        return res.status(401).json({ error: 'Unauthorized: Staff credentials required.' });
      }

      if (!allowedRoles.includes(staff.role)) {
        return res.status(403).json({
          error: `Forbidden: Staff role "${staff.role}" is not authorized. Required: ${allowedRoles.join(', ')}`,
        });
      }

      (req as any).staff = staff;
      next();
    } catch (err: any) {
      res.status(500).json({ error: 'Authorization verification failed', message: err.message });
    }
  };
}

// Helper: Calculate order totals (Server-side calculation)
// Configurable tax rule: Defaults to standard Tanzania mainland VAT (18%), supports custom rate or tax-exempt
function calculateOrderTotals(
  items: Array<{ unitPrice: number; quantity: number; discount?: number }>, 
  orderDiscount = 0, 
  amountPaid = 0,
  customTaxRate?: number
) {
  const subtotal = items.reduce((sum, item) => {
    const itemDiscount = Math.max(0, item.discount || 0);
    return sum + (item.unitPrice * item.quantity - itemDiscount);
  }, 0);

  // Explicit configurable tax calculation
  const effectiveTaxRate = typeof customTaxRate === 'number' && !isNaN(customTaxRate) && customTaxRate >= 0 
    ? customTaxRate 
    : 0.18;
  const tax = Math.round(subtotal * effectiveTaxRate);

  // Explicit discount calculation: non-negative and capped at subtotal + tax
  const validOrderDiscount = Math.max(0, orderDiscount || 0);
  const total = Math.max(0, subtotal + tax - validOrderDiscount);
  const validAmountPaid = Math.max(0, amountPaid || 0);
  const balanceDue = Math.max(0, total - validAmountPaid);

  return { subtotal, tax, discount: validOrderDiscount, total, amountPaid: validAmountPaid, balanceDue, taxRate: effectiveTaxRate };
}


// ----------------------------------------------------
// AUTHENTICATION ROUTES (OTP)
// ----------------------------------------------------
app.post('/api/auth/staff/login', async (req: Request, res: Response) => {
  try {
    const { phoneNumber } = req.body;
    const user = await prisma.user.findFirst({ where: { phoneNumber, isActive: true } });
    if (!user) {
      // Don't reveal if user exists
      return res.json({ success: true, message: 'If the number is registered, an OTP has been sent.' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = crypto.createHash('sha256').update(otp).digest('hex');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await prisma.otpChallenge.create({
      data: { phoneNumber, codeHash, purpose: 'STAFF_LOGIN', expiresAt },
    });

    const sms = getSmsProvider();
    await sms.sendSms(phoneNumber, `Your Tai Lounge OTP is: ${otp}`);

    res.json({ success: true, message: 'OTP sent.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to process login.' });
  }
});

app.post('/api/auth/staff/verify', async (req: Request, res: Response) => {
  try {
    const { phoneNumber, otp } = req.body;
    const codeHash = crypto.createHash('sha256').update(otp).digest('hex');
    const challenge = await prisma.otpChallenge.findFirst({
      where: { phoneNumber, codeHash, purpose: 'STAFF_LOGIN', expiresAt: { gt: new Date() }, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!challenge) {
      return res.status(401).json({ error: 'Invalid or expired OTP.' });
    }

    await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { usedAt: new Date() } });
    await prisma.user.update({ where: { phoneNumber }, data: { isVerified: true } });

    res.json({ success: true, message: 'Verified.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to verify OTP.' });
  }
});
app.get('/api/health', async (req: Request, res: Response) => {
  try {
    const dbCheck = await prisma.$queryRaw<Array<{ connected: number }>>`SELECT 1 as connected`;
    const isDbConnected = dbCheck && dbCheck.length > 0 && dbCheck[0].connected === 1;

    const [productsCount, categoriesCount, activeOrdersCount, tablesCount] = await Promise.all([
      prisma.product.count(),
      prisma.productCategory.count(),
      prisma.order.count({ where: { status: { in: ['OPEN', 'SENT_TO_PREPARATION', 'AWAITING_PAYMENT', 'PARTIALLY_PAID'] } } }),
      prisma.loungeTable.count(),
    ]);

    res.json({
      status: 'ok',
      service: 'TAI LOUNGE POS API',
      database: isDbConnected ? 'connected' : 'disconnected',
      currency: 'TZS',
      timezone: 'Africa/Dar_es_Salaam',
      timestamp: new Date().toISOString(),
      stats: {
        totalProducts: productsCount,
        totalCategories: categoriesCount,
        activeOrders: activeOrdersCount,
        totalTables: tablesCount,
      },
    });
  } catch (error: any) {
    console.error('Health check failed:', error);
    res.status(503).json({
      status: 'degraded',
      service: 'TAI LOUNGE POS API',
      database: 'error',
      error: error.message || 'Database connection error',
      timestamp: new Date().toISOString(),
    });
  }
});

app.get('/api/business', async (req: Request, res: Response) => {
  try {
    const business = await prisma.business.findFirst({
      include: {
        branches: {
          where: { isActive: true },
        },
      },
    });

    if (!business) {
      return res.status(404).json({ error: 'Business configuration not found' });
    }

    res.json(business);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to retrieve business details', message: error.message });
  }
});

// ----------------------------------------------------
// 2. SECTIONS & TABLES
// ----------------------------------------------------
app.get('/api/sections', async (req: Request, res: Response) => {
  try {
    const branch = await getActiveBranch();
    const sections = await prisma.loungeSection.findMany({
      where: {
        businessId: branch.businessId,
        branchId: branch.id,
        isActive: true,
      },
      orderBy: { displayOrder: 'asc' },
      include: {
        tables: {
          where: { isActive: true },
          orderBy: { tableNumber: 'asc' },
        },
      },
    });
    res.json(sections);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch sections', message: error.message });
  }
});

app.get('/api/tables', async (req: Request, res: Response) => {
  try {
    const branch = await getActiveBranch();
    const { sectionId, status } = req.query;
    const where: any = {
      businessId: branch.businessId,
      branchId: branch.id,
      isActive: true,
    };

    if (sectionId && typeof sectionId === 'string') {
      where.sectionId = sectionId;
    }
    if (status && typeof status === 'string' && status !== 'ALL') {
      where.status = status;
    }

    const tables = await prisma.loungeTable.findMany({
      where,
      orderBy: { tableNumber: 'asc' },
      include: {
        section: true,
        orders: {
          where: {
            status: { in: ['OPEN', 'SENT_TO_PREPARATION', 'AWAITING_PAYMENT', 'PARTIALLY_PAID'] },
          },
          take: 1,
          select: {
            id: true,
            orderNumber: true,
            customerName: true,
            guestCount: true,
            total: true,
            status: true,
            openedAt: true,
            items: {
              select: {
                id: true,
                productName: true,
                quantity: true,
                station: true,
                status: true,
              },
            },
          },
        },
      },
    });

    const formattedTables = tables.map((t) => ({
      ...t,
      activeOrder: t.orders[0] || null,
    }));

    res.json(formattedTables);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch tables', message: error.message });
  }
});

// ----------------------------------------------------
// 3. CATEGORIES & PRODUCTS
// ----------------------------------------------------
app.get('/api/categories', async (req: Request, res: Response) => {
  try {
    const branch = await getActiveBranch();
    const categories = await prisma.productCategory.findMany({
      where: { businessId: branch.businessId, isActive: true },
      orderBy: { displayOrder: 'asc' },
      include: {
        _count: {
          select: { products: true },
        },
      },
    });
    res.json(categories);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch categories', message: error.message });
  }
});

app.get('/api/products', async (req: Request, res: Response) => {
  try {
    const branch = await getActiveBranch();
    const { category, search, activeOnly = 'true' } = req.query;
    const whereClause: any = { businessId: branch.businessId };

    if (activeOnly === 'true') {
      whereClause.isActive = true;
    }

    if (category && typeof category === 'string' && category.toLowerCase() !== 'all') {
      whereClause.category = {
        OR: [
          { slug: category.toLowerCase() },
          { name: { equals: category, mode: 'insensitive' } },
          { id: category },
        ],
      };
    }

    if (search && typeof search === 'string' && search.trim().length > 0) {
      const query = search.trim();
      whereClause.OR = [
        { name: { contains: query, mode: 'insensitive' } },
        { sku: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
      ];
    }

    const products = await prisma.product.findMany({
      where: whereClause,
      include: {
        category: true,
      },
      orderBy: [
        { category: { displayOrder: 'asc' } },
        { name: 'asc' },
      ],
    });

    res.json(products);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch products', message: error.message });
  }
});

// Create product (Restricted to OWNER, MANAGER)
app.post('/api/products', requirePermission(['OWNER', 'MANAGER']), async (req: Request, res: Response) => {
  try {
    const branch = await getActiveBranch();
    const {
      name,
      price,
      costPrice,
      categoryId,
      sku,
      barcode,
      stockQuantity = 0,
      minStockThreshold = 5,
      unitOfMeasure = 'Bottle',
      station = 'BAR',
      imageUrl,
      description,
    } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Product name is required.' });
    }

    const parsedPrice = parseInt(price, 10);
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      return res.status(400).json({ error: 'Valid price in TZS is required (non-negative integer).' });
    }

    if (!categoryId || typeof categoryId !== 'string') {
      return res.status(400).json({ error: 'Category ID is required.' });
    }

    const categoryExists = await prisma.productCategory.findUnique({ where: { id: categoryId } });
    if (!categoryExists) {
      return res.status(400).json({ error: 'Referenced category does not exist.' });
    }

    let generatedSku = sku;
    if (!generatedSku || typeof generatedSku !== 'string' || generatedSku.trim().length === 0) {
      const prefix = name.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X');
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      generatedSku = `${prefix}-${randomSuffix}`;
    }

    const existingSku = await prisma.product.findUnique({ where: { sku: generatedSku } });
    if (existingSku) {
      return res.status(409).json({ error: `Product with SKU "${generatedSku}" already exists.` });
    }

    const newProduct = await prisma.product.create({
      data: {
        businessId: branch.businessId,
        categoryId,
        name: name.trim(),
        sku: generatedSku.trim(),
        barcode: barcode?.trim() || null,
        description: description?.trim() || null,
        price: parsedPrice,
        costPrice: costPrice !== undefined ? parseInt(costPrice, 10) : null,
        stockQuantity: parseInt(stockQuantity, 10) || 0,
        minStockThreshold: parseInt(minStockThreshold, 10) || 5,
        unitOfMeasure: unitOfMeasure || 'Bottle',
        station: station === 'KITCHEN' ? 'KITCHEN' : 'BAR',
        imageUrl: imageUrl || null,
        isActive: true,
      },
      include: { category: true },
    });

    await prisma.auditLog.create({
      data: {
        businessId: branch.businessId,
        branchId: branch.id,
        action: 'PRODUCT_CREATE',
        entityType: 'PRODUCT',
        entityId: newProduct.id,
        details: {
          productName: newProduct.name,
          sku: newProduct.sku,
          price: newProduct.price,
          category: newProduct.category.name,
        },
      },
    });

    res.status(201).json(newProduct);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create product', message: error.message });
  }
});

// Update product (Restricted to OWNER, MANAGER)
app.put('/api/products/:id', requirePermission(['OWNER', 'MANAGER']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      name,
      price,
      costPrice,
      categoryId,
      stockQuantity,
      minStockThreshold,
      unitOfMeasure,
      station,
      imageUrl,
      isActive,
      description,
    } = req.body;

    const branch = await getActiveBranch();
    const existingProduct = await prisma.product.findFirst({
      where: { id, businessId: branch.businessId },
      include: { category: true },
    });

    if (!existingProduct) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name.trim();
    if (price !== undefined) {
      const p = parseInt(price, 10);
      if (isNaN(p) || p < 0) return res.status(400).json({ error: 'Invalid price' });
      updateData.price = p;
    }
    if (costPrice !== undefined) updateData.costPrice = parseInt(costPrice, 10);
    if (categoryId !== undefined) updateData.categoryId = categoryId;
    if (stockQuantity !== undefined) updateData.stockQuantity = parseInt(stockQuantity, 10);
    if (minStockThreshold !== undefined) updateData.minStockThreshold = parseInt(minStockThreshold, 10);
    if (unitOfMeasure !== undefined) updateData.unitOfMeasure = unitOfMeasure;
    if (station !== undefined) updateData.station = station;
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);
    if (description !== undefined) updateData.description = description;

    const updated = await prisma.product.update({
      where: { id },
      data: updateData,
      include: { category: true },
    });

    await prisma.auditLog.create({
      data: {
        businessId: existingProduct.businessId,
        action: 'PRODUCT_UPDATE',
        entityType: 'PRODUCT',
        entityId: updated.id,
        details: {
          previous: {
            name: existingProduct.name,
            price: existingProduct.price,
            stock: existingProduct.stockQuantity,
          },
          updated: {
            name: updated.name,
            price: updated.price,
            stock: updated.stockQuantity,
          },
        },
      },
    });

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update product', message: error.message });
  }
});

// ----------------------------------------------------
// 4. ORDERS & TABS MANAGEMENT
// ----------------------------------------------------

// List orders (Scoper to branch)
app.get('/api/orders', async (req: Request, res: Response) => {
  try {
    const branch = await getActiveBranch();
    const { status, tableId, serviceType, search } = req.query;
    const where: any = {
      businessId: branch.businessId,
      branchId: branch.id,
    };

    if (status === 'active') {
      where.status = { in: ['DRAFT', 'OPEN', 'SENT_TO_PREPARATION', 'AWAITING_PAYMENT', 'PARTIALLY_PAID'] };
    } else if (status && typeof status === 'string' && status !== 'ALL') {
      where.status = status;
    }

    if (tableId && typeof tableId === 'string') {
      where.tableId = tableId;
    }

    if (serviceType && typeof serviceType === 'string' && serviceType !== 'ALL') {
      where.serviceType = serviceType;
    }

    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim();
      where.OR = [
        { orderNumber: { contains: q, mode: 'insensitive' } },
        { customerName: { contains: q, mode: 'insensitive' } },
        { tableNumber: { contains: q, mode: 'insensitive' } },
      ];
    }

    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        table: {
          include: { section: true },
        },
        items: {
          include: { product: true },
          orderBy: { createdAt: 'asc' },
        },
        tickets: {
          select: { id: true, ticketNumber: true, station: true, status: true },
        },
      },
    });

    res.json(orders);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch orders', message: error.message });
  }
});

// Get single order with detailed breakdown
app.get('/api/orders/:id', async (req: Request, res: Response) => {
  try {
    const branch = await getActiveBranch();
    const { id } = req.params;
    const order = await prisma.order.findFirst({
      where: { id, businessId: branch.businessId, branchId: branch.id },
      include: {
        table: { include: { section: true } },
        items: {
          include: { product: true },
          orderBy: { createdAt: 'asc' },
        },
        tickets: {
          include: { items: true },
          orderBy: { createdAt: 'asc' },
        },
        payments: true,
        cashier: { select: { id: true, fullName: true, username: true } },
        waiter: { select: { id: true, fullName: true, username: true } },
      },
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to retrieve order', message: error.message });
  }
});

// Create new order (Requires WAITER, CASHIER, MANAGER, OWNER)
app.post('/api/orders', requirePermission(['OWNER', 'MANAGER', 'CASHIER', 'WAITER']), async (req: Request, res: Response) => {
  try {
    const idempotencyKey = (req.headers['idempotency-key'] as string) || req.body.idempotencyKey;
    const {
      tableId,
      serviceType = 'DINE_IN',
      customerName,
      guestCount = 1,
      notes,
      waiterId,
      items = [],
    } = req.body;

    const branch = await getActiveBranch();

    // 1. Idempotency check: if already processed, return existing without duplication
    if (idempotencyKey) {
      const existing = await prisma.order.findUnique({
        where: { idempotencyKey },
        include: { items: true, table: true },
      });
      if (existing) {
        return res.status(200).json({
          ...existing,
          _idempotentReplay: true,
        });
      }
    }

    // 2. Validate items & compute server-side totals strictly from DB product records
    const orderItemsToCreate: Array<{
      productId: string;
      productName: string;
      sku: string;
      unitPrice: number;
      quantity: number;
      discount: number;
      subtotal: number;
      station: string;
      specialInstructions: string | null;
    }> = [];

    if (items.length > 0) {
      const productIds = items.map((i: any) => i.productId);
      const dbProducts = await prisma.product.findMany({
        where: { id: { in: productIds }, businessId: branch.businessId },
      });
      const productMap = new Map(dbProducts.map((p) => [p.id, p]));

      for (const item of items) {
        const product = productMap.get(item.productId);
        if (!product) {
          return res.status(400).json({ error: `Product with ID "${item.productId}" not found` });
        }
        if (!product.isActive) {
          return res.status(400).json({ error: `Product "${product.name}" is currently inactive` });
        }

        const qty = parseInt(item.quantity, 10);
        if (isNaN(qty) || qty <= 0) {
          return res.status(400).json({ error: `Invalid quantity for "${product.name}". Must be greater than 0.` });
        }

        const lineSubtotal = product.price * qty;
        orderItemsToCreate.push({
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          unitPrice: product.price,
          quantity: qty,
          discount: 0,
          subtotal: lineSubtotal,
          station: product.station,
          specialInstructions: item.specialInstructions?.trim() || null,
        });
      }
    }

    // Server-side financial calculations (18% VAT standard, ignoring client totals)
    const totals = calculateOrderTotals(orderItemsToCreate);

    // Human-friendly order number
    const countToday = await prisma.order.count({ where: { branchId: branch.id } });
    const orderNumber = `TL-${1024 + countToday}`;

    // Execute in transaction with strict table occupancy verification
    const newOrder = await prisma.$transaction(async (tx) => {
      let tableSnapshot: string | null = null;
      let targetTableId: string | null = null;

      if (tableId) {
        // Concurrency-safe check inside transaction
        const tableInTx = await tx.loungeTable.findUnique({
          where: { id: tableId },
          include: { section: true },
        });

        if (!tableInTx || !tableInTx.isActive || tableInTx.branchId !== branch.id) {
          throw new Error('Selected table does not exist or is inactive.');
        }

        // Atomic conditional update to strictly prevent concurrent table collisions
        const lockCount = await tx.loungeTable.updateMany({
          where: { id: tableId, status: 'AVAILABLE', isActive: true, branchId: branch.id },
          data: { status: 'OCCUPIED' },
        });

        if (lockCount.count === 0) {
          throw new Error(`Table "${tableInTx.tableNumber}" is currently occupied by another order.`);
        }

        tableSnapshot = tableInTx.tableNumber;
        targetTableId = tableInTx.id;
      }

      const order = await tx.order.create({
        data: {
          businessId: branch.businessId,
          branchId: branch.id,
          orderNumber,
          idempotencyKey: idempotencyKey || null,
          serviceType: serviceType || (tableSnapshot ? 'DINE_IN' : 'WALK_IN'),
          tableId: targetTableId,
          tableNumber: tableSnapshot,
          customerName: customerName?.trim() || null,
          guestCount: Math.max(1, parseInt(guestCount, 10) || 1),
          status: 'OPEN',
          subtotal: totals.subtotal,
          tax: totals.tax,
          discount: 0,
          total: totals.total,
          amountPaid: 0,
          balanceDue: totals.total,
          notes: notes?.trim() || null,
          waiterId: waiterId || null,
          items: {
            create: orderItemsToCreate,
          },
        },
        include: {
          items: true,
          table: true,
        },
      });

      await tx.auditLog.create({
        data: {
          businessId: branch.businessId,
          branchId: branch.id,
          action: 'ORDER_CREATE',
          entityType: 'ORDER',
          entityId: order.id,
          details: {
            orderNumber: order.orderNumber,
            total: order.total,
            table: tableSnapshot,
            itemCount: orderItemsToCreate.length,
          },
        },
      });

      return order;
    });

    res.status(201).json(newOrder);
  } catch (error: any) {
    if (error.message?.includes('currently occupied')) {
      return res.status(409).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to create order', message: error.message });
  }
});

// Add items to an existing open order
app.post('/api/orders/:id/items', requirePermission(['OWNER', 'MANAGER', 'CASHIER', 'WAITER']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { items = [] } = req.body;
    const branch = await getActiveBranch();

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items provided to add.' });
    }

    const order = await prisma.order.findFirst({
      where: { id, branchId: branch.id },
      include: { items: true },
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    if (['PAID', 'CLOSED', 'CANCELLED', 'VOIDED'].includes(order.status)) {
      return res.status(400).json({ error: `Cannot add items to an order with status "${order.status}".` });
    }

    const productIds = items.map((i: any) => i.productId);
    const dbProducts = await prisma.product.findMany({
      where: { id: { in: productIds }, businessId: branch.businessId },
    });
    const productMap = new Map(dbProducts.map((p) => [p.id, p]));

    const itemsToCreate: Array<{
      orderId: string;
      productId: string;
      productName: string;
      sku: string;
      unitPrice: number;
      quantity: number;
      discount: number;
      subtotal: number;
      station: string;
      specialInstructions: string | null;
      status: string;
      isPreparationSubmitted: boolean;
    }> = [];

    for (const item of items) {
      const product = productMap.get(item.productId);
      if (!product || !product.isActive) {
        return res.status(400).json({ error: `Invalid or inactive product: ${item.productId}` });
      }

      const qty = parseInt(item.quantity, 10);
      if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({ error: `Invalid quantity for "${product.name}". Must be > 0.` });
      }

      itemsToCreate.push({
        orderId: order.id,
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        unitPrice: product.price,
        quantity: qty,
        discount: 0,
        subtotal: product.price * qty,
        station: product.station,
        specialInstructions: item.specialInstructions?.trim() || null,
        status: 'NEW',
        isPreparationSubmitted: false,
      });
    }

    const updatedOrder = await prisma.$transaction(async (tx) => {
      await tx.orderItem.createMany({
        data: itemsToCreate,
      });

      const allItems = await tx.orderItem.findMany({
        where: { orderId: order.id, status: { not: 'CANCELLED' } },
      });

      const totals = calculateOrderTotals(allItems, order.discount, order.amountPaid);

      return tx.order.update({
        where: { id: order.id },
        data: {
          subtotal: totals.subtotal,
          tax: totals.tax,
          total: totals.total,
          balanceDue: totals.balanceDue,
          status: order.status === 'DRAFT' ? 'OPEN' : order.status,
        },
        include: {
          items: { include: { product: true } },
          table: true,
        },
      });
    });

    res.json(updatedOrder);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to add items to order', message: error.message });
  }
});

// Update item quantity or instructions in order
app.put('/api/orders/:id/items/:itemId', requirePermission(['OWNER', 'MANAGER', 'CASHIER', 'WAITER']), async (req: Request, res: Response) => {
  try {
    const { id, itemId } = req.params;
    const { quantity, specialInstructions } = req.body;
    const branch = await getActiveBranch();

    const order = await prisma.order.findFirst({
      where: { id, branchId: branch.id },
      include: { items: true },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (['PAID', 'CLOSED', 'CANCELLED', 'VOIDED'].includes(order.status)) {
      return res.status(400).json({ error: 'Cannot modify closed or paid order.' });
    }

    const item = order.items.find((i) => i.id === itemId);
    if (!item) return res.status(404).json({ error: 'Order item not found' });

    const newQty = parseInt(quantity, 10);
    if (isNaN(newQty) || newQty <= 0) {
      return res.status(400).json({ error: 'Quantity must be a positive integer.' });
    }

    const updatedOrder = await prisma.$transaction(async (tx) => {
      await tx.orderItem.update({
        where: { id: itemId },
        data: {
          quantity: newQty,
          subtotal: item.unitPrice * newQty - item.discount,
          specialInstructions: specialInstructions !== undefined ? specialInstructions : item.specialInstructions,
        },
      });

      const allItems = await tx.orderItem.findMany({
        where: { orderId: order.id, status: { not: 'CANCELLED' } },
      });
      const totals = calculateOrderTotals(allItems, order.discount, order.amountPaid);

      return tx.order.update({
        where: { id: order.id },
        data: {
          subtotal: totals.subtotal,
          tax: totals.tax,
          total: totals.total,
          balanceDue: totals.balanceDue,
        },
        include: { items: true, table: true },
      });
    });

    res.json(updatedOrder);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update order item', message: error.message });
  }
});

// Remove item from order
app.delete('/api/orders/:id/items/:itemId', requirePermission(['OWNER', 'MANAGER', 'CASHIER']), async (req: Request, res: Response) => {
  try {
    const { id, itemId } = req.params;
    const branch = await getActiveBranch();

    const order = await prisma.order.findFirst({
      where: { id, branchId: branch.id },
      include: { items: true },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (['PAID', 'CLOSED', 'CANCELLED', 'VOIDED'].includes(order.status)) {
      return res.status(400).json({ error: 'Cannot remove items from closed or paid order.' });
    }

    const item = order.items.find((i) => i.id === itemId);
    if (!item) return res.status(404).json({ error: 'Item not found in order' });

    const updatedOrder = await prisma.$transaction(async (tx) => {
      await tx.orderItem.delete({
        where: { id: itemId },
      });

      const remainingItems = await tx.orderItem.findMany({
        where: { orderId: order.id, status: { not: 'CANCELLED' } },
      });
      const totals = calculateOrderTotals(remainingItems, order.discount, order.amountPaid);

      return tx.order.update({
        where: { id: order.id },
        data: {
          subtotal: totals.subtotal,
          tax: totals.tax,
          total: totals.total,
          balanceDue: totals.balanceDue,
        },
        include: { items: true, table: true },
      });
    });

    res.json(updatedOrder);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to remove item', message: error.message });
  }
});

// Transfer order between tables (Concurrency safe)
app.post('/api/orders/:id/transfer-table', requirePermission(['OWNER', 'MANAGER', 'CASHIER', 'WAITER']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { targetTableId } = req.body;
    const branch = await getActiveBranch();

    if (!targetTableId) {
      return res.status(400).json({ error: 'targetTableId is required.' });
    }

    const order = await prisma.order.findFirst({
      where: { id, branchId: branch.id },
      include: { table: true },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (order.tableId === targetTableId) {
      return res.status(400).json({ error: 'Order is already assigned to this table.' });
    }

    const updatedOrder = await prisma.$transaction(async (tx) => {
      const targetInTx = await tx.loungeTable.findUnique({
        where: { id: targetTableId },
        include: { section: true },
      });

      if (!targetInTx || !targetInTx.isActive || targetInTx.branchId !== branch.id) {
        throw new Error('Target table is invalid or belongs to another branch.');
      }

      // Atomic conditional update on target table
      const lockTarget = await tx.loungeTable.updateMany({
        where: { id: targetTableId, status: 'AVAILABLE', isActive: true, branchId: branch.id },
        data: { status: 'OCCUPIED' },
      });

      if (lockTarget.count === 0) {
        throw new Error(`Table "${targetInTx.tableNumber}" is currently occupied.`);
      }

      // 1. Release previous table
      if (order.tableId) {
        await tx.loungeTable.update({
          where: { id: order.tableId },
          data: { status: 'AVAILABLE' },
        });
      }

      // 2. Update order
      const resOrder = await tx.order.update({
        where: { id: order.id },
        data: {
          tableId: targetInTx.id,
          tableNumber: targetInTx.tableNumber,
          serviceType: targetInTx.section.isVip ? 'VIP' : 'DINE_IN',
        },
        include: { table: { include: { section: true } }, items: true },
      });

      // 3. Log transfer with actor user ID
      await tx.auditLog.create({
        data: {
          businessId: order.businessId,
          branchId: order.branchId,
          userId: (req as any).staff?.id || null,
          action: 'TABLE_TRANSFER',
          entityType: 'ORDER',
          entityId: order.id,
          details: {
            fromTable: order.tableNumber,
            toTable: targetInTx.tableNumber,
            actor: (req as any).staff?.username || 'system',
          },
        },
      });

      return resOrder;
    });

    res.json(updatedOrder);
  } catch (error: any) {
    if (error.message?.includes('currently occupied')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to transfer table', message: error.message });
  }
});

// Update order status (Save/Hold/Reopen/Cancel) with strict financial checks
app.patch('/api/orders/:id/status', requirePermission(['OWNER', 'MANAGER', 'CASHIER', 'WAITER']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const branch = await getActiveBranch();

    const validStatuses = ['DRAFT', 'OPEN', 'SENT_TO_PREPARATION', 'AWAITING_PAYMENT', 'PARTIALLY_PAID', 'PAID', 'CLOSED', 'CANCELLED', 'VOIDED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status "${status}". Valid statuses: ${validStatuses.join(', ')}` });
    }

    const order = await prisma.order.findFirst({
      where: { id, branchId: branch.id },
      include: { table: true },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Transition Rule 1: Cannot reopen closed or paid orders
    if (['PAID', 'CLOSED'].includes(order.status) && ['DRAFT', 'OPEN', 'SENT_TO_PREPARATION'].includes(status)) {
      return res.status(400).json({ error: 'Cannot reopen a completed or closed order.' });
    }

    // Transition Rule: Closing, voiding or cancelling orders requires CASHIER, MANAGER or OWNER
    const staff = (req as any).staff;
    if (['CLOSED', 'CANCELLED', 'VOIDED'].includes(status) && staff && !['OWNER', 'MANAGER', 'CASHIER'].includes(staff.role)) {
      return res.status(403).json({
        error: `Forbidden: Staff role "${staff.role}" is not authorized to close or cancel orders. Requires CASHIER or MANAGER.`,
      });
    }

    // Transition Rule 2: Cannot mark PAID or CLOSED if balance is unpaid
    if (['PAID', 'CLOSED'].includes(status)) {
      if (order.balanceDue > 0 || order.amountPaid < order.total) {
        return res.status(400).json({
          error: `Cannot close or mark order as ${status} with an unpaid balance of ${order.balanceDue} TZS. Complete payment first or cancel the tab.`,
        });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      // If order is cancelled, voided, or closed, free up the table
      if (['CLOSED', 'CANCELLED', 'VOIDED', 'PAID'].includes(status) && order.tableId) {
        await tx.loungeTable.update({
          where: { id: order.tableId },
          data: { status: 'AVAILABLE' },
        });
      } else if (['OPEN', 'SENT_TO_PREPARATION', 'AWAITING_PAYMENT'].includes(status) && order.tableId) {
        await tx.loungeTable.update({
          where: { id: order.tableId },
          data: { status: 'OCCUPIED' },
        });
      }

      const updatedOrder = await tx.order.update({
        where: { id },
        data: {
          status,
          notes: notes !== undefined ? notes : order.notes,
          closedAt: ['CLOSED', 'PAID', 'CANCELLED', 'VOIDED'].includes(status) ? new Date() : null,
        },
        include: { table: true, items: true },
      });

      await tx.auditLog.create({
        data: {
          businessId: order.businessId,
          branchId: order.branchId,
          userId: staff?.id || null,
          action: 'ORDER_STATUS_UPDATE',
          entityType: 'ORDER',
          entityId: order.id,
          details: {
            orderNumber: order.orderNumber,
            previousStatus: order.status,
            newStatus: status,
            actor: staff?.username || 'system',
          },
        },
      });

      return updatedOrder;
    });

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update order status', message: error.message });
  }
});

// ----------------------------------------------------
// PAYMENT PROCESSING
// ----------------------------------------------------

// List payments for an order
app.get('/api/orders/:id/payments', requirePermission(['OWNER', 'MANAGER', 'CASHIER']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const branch = await getActiveBranch();
    const payments = await prisma.payment.findMany({
      where: { orderId: id, branchId: branch.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(payments);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch payments', message: error.message });
  }
});

// Process a payment
app.post('/api/orders/:id/payments', requirePermission(['OWNER', 'MANAGER', 'CASHIER']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { amount, method, provider, reference, idempotencyKey } = req.body;
    const branch = await getActiveBranch();
    const staff = (req as any).staff;

    const order = await prisma.order.findFirst({
      where: { id, branchId: branch.id },
    });
    if (!order) {
        console.error('Order not found:', { orderId: id, branchId: branch.id });
        return res.status(404).json({ error: 'Order not found' });
    }

    if (['PAID', 'CLOSED', 'CANCELLED', 'VOIDED'].includes(order.status)) {
      return res.status(400).json({ error: 'Cannot pay for a closed order.' });
    }

    const paymentAmount = parseInt(amount, 10);
    if (isNaN(paymentAmount) || paymentAmount <= 0) {
      return res.status(400).json({ error: 'Invalid payment amount.' });
    }

    if (paymentAmount > order.balanceDue) {
      return res.status(400).json({ error: 'Payment amount exceeds balance due.' });
    }

    // Idempotency check
    if (idempotencyKey) {
        const existingPayment = await prisma.payment.findUnique({ where: { idempotencyKey } });
        if (existingPayment) return res.json(existingPayment);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          branchId: branch.id,
          amount: paymentAmount,
          method,
          provider,
          reference,
          idempotencyKey,
          status: 'COMPLETED',
          receivedBy: staff.id,
        },
      });

      const newPaid = order.amountPaid + paymentAmount;
      const newBalance = order.total - newPaid;
      let newStatus = order.status;
      if (newBalance === 0) newStatus = 'PAID';
      else if (newPaid > 0) newStatus = 'PARTIALLY_PAID';

      await tx.order.update({
        where: { id: order.id },
        data: {
          amountPaid: newPaid,
          balanceDue: newBalance,
          status: newStatus,
        },
      });

      await tx.auditLog.create({
        data: {
          businessId: order.businessId,
          branchId: order.branchId,
          userId: staff.id,
          action: 'PAYMENT_CREATE',
          entityType: 'PAYMENT',
          entityId: payment.id,
          details: {
            orderNumber: order.orderNumber,
            amount: paymentAmount,
            method,
            newBalance,
          },
        },
      });

      return payment;
    });

    res.status(201).json(updated);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to process payment', message: error.message });
  }
});

// ----------------------------------------------------
// 5. BAR & KITCHEN PREPARATION TICKETS
// ----------------------------------------------------

// Send order items to Bar and Kitchen
app.post('/api/orders/:id/send-to-preparation', requirePermission(['OWNER', 'MANAGER', 'CASHIER', 'WAITER']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { serverNotes } = req.body;
    const branch = await getActiveBranch();

    const order = await prisma.order.findFirst({
      where: { id, branchId: branch.id },
      include: {
        items: true,
        table: true,
      },
    });

    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Find unsubmitted items
    const unsubmittedItems = order.items.filter((item) => !item.isPreparationSubmitted && item.status !== 'CANCELLED');
    if (unsubmittedItems.length === 0) {
      return res.status(400).json({
        error: 'No new items to send to bar or kitchen. All items have already been submitted.',
      });
    }

    const barItems = unsubmittedItems.filter((i) => i.station === 'BAR');
    const kitchenItems = unsubmittedItems.filter((i) => i.station === 'KITCHEN');

    const createdTickets = await prisma.$transaction(async (tx) => {
      const tickets = [];

      // Create Bar Ticket if bar items exist
      if (barItems.length > 0) {
        const ticketCount = await tx.preparationTicket.count({ where: { orderId: order.id, station: 'BAR' } });
        const barTicket = await tx.preparationTicket.create({
          data: {
            businessId: order.businessId,
            branchId: order.branchId,
            orderId: order.id,
            ticketNumber: `TKT-BAR-${order.orderNumber}-${ticketCount + 1}`,
            station: 'BAR',
            status: 'NEW',
            notes: serverNotes?.trim() || null,
            items: {
              create: barItems.map((bi) => ({
                orderItemId: bi.id,
                productName: bi.productName,
                quantity: bi.quantity,
                station: 'BAR',
                specialInstructions: bi.specialInstructions,
                status: 'NEW',
              })),
            },
          },
          include: { items: true },
        });
        tickets.push(barTicket);

        await tx.orderItem.updateMany({
          where: { id: { in: barItems.map((i) => i.id) } },
          data: { isPreparationSubmitted: true, status: 'SUBMITTED' },
        });
      }

      // Create Kitchen Ticket if kitchen items exist
      if (kitchenItems.length > 0) {
        const ticketCount = await tx.preparationTicket.count({ where: { orderId: order.id, station: 'KITCHEN' } });
        const kitchenTicket = await tx.preparationTicket.create({
          data: {
            businessId: order.businessId,
            branchId: order.branchId,
            orderId: order.id,
            ticketNumber: `TKT-KIT-${order.orderNumber}-${ticketCount + 1}`,
            station: 'KITCHEN',
            status: 'NEW',
            notes: serverNotes?.trim() || null,
            items: {
              create: kitchenItems.map((ki) => ({
                orderItemId: ki.id,
                productName: ki.productName,
                quantity: ki.quantity,
                station: 'KITCHEN',
                specialInstructions: ki.specialInstructions,
                status: 'NEW',
              })),
            },
          },
          include: { items: true },
        });
        tickets.push(kitchenTicket);

        await tx.orderItem.updateMany({
          where: { id: { in: kitchenItems.map((i) => i.id) } },
          data: { isPreparationSubmitted: true, status: 'SUBMITTED' },
        });
      }

      if (['DRAFT', 'OPEN'].includes(order.status)) {
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'SENT_TO_PREPARATION' },
        });
      }

      await tx.auditLog.create({
        data: {
          businessId: order.businessId,
          branchId: order.branchId,
          action: 'SEND_TO_PREPARATION',
          entityType: 'ORDER',
          entityId: order.id,
          details: {
            orderNumber: order.orderNumber,
            barItemsCount: barItems.length,
            kitchenItemsCount: kitchenItems.length,
          },
        },
      });

      return tickets;
    });

    res.json({
      success: true,
      message: `Sent ${unsubmittedItems.length} items to preparation.`,
      tickets: createdTickets,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to send items to preparation', message: error.message });
  }
});

// List preparation tickets (Scoped to branch)
app.get('/api/tickets', async (req: Request, res: Response) => {
  try {
    const branch = await getActiveBranch();
    const { station, status } = req.query;
    const where: any = {
      businessId: branch.businessId,
      branchId: branch.id,
    };

    if (station && typeof station === 'string' && station !== 'ALL') {
      where.station = station.toUpperCase();
    }

    if (status === 'active') {
      where.status = { in: ['NEW', 'ACCEPTED', 'PREPARING', 'READY'] };
    } else if (status && typeof status === 'string' && status !== 'ALL') {
      where.status = status.toUpperCase();
    }

    const tickets = await prisma.preparationTicket.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        items: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            tableNumber: true,
            customerName: true,
            serviceType: true,
            status: true,
          },
        },
      },
    });

    res.json(tickets);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch tickets', message: error.message });
  }
});

// Update preparation ticket status with strict transition validation
app.patch('/api/tickets/:id/status', requirePermission(['OWNER', 'MANAGER', 'BARTENDER', 'KITCHEN']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const branch = await getActiveBranch();

    const validStatuses = ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid ticket status "${status}".` });
    }

    const ticket = await prisma.preparationTicket.findFirst({
      where: { id, branchId: branch.id },
      include: { items: true },
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Strict status transition rules (Supports direct expedited completion for bar drinks)
    const allowedTransitions: Record<string, string[]> = {
      NEW: ['ACCEPTED', 'PREPARING', 'READY', 'CANCELLED'],
      ACCEPTED: ['PREPARING', 'READY', 'CANCELLED'],
      PREPARING: ['READY', 'CANCELLED'],
      READY: ['SERVED', 'CANCELLED'],
      SERVED: [],
      CANCELLED: [],
    };

    if (!allowedTransitions[ticket.status]?.includes(status)) {
      return res.status(400).json({
        error: `Invalid status transition from "${ticket.status}" to "${status}".`,
      });
    }

    const updateData: any = { status };
    if (status === 'ACCEPTED') updateData.acceptedAt = new Date();
    if (status === 'READY') updateData.readyAt = new Date();
    if (status === 'SERVED') updateData.servedAt = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const updatedTicket = await tx.preparationTicket.update({
        where: { id },
        data: updateData,
        include: { items: true, order: true },
      });

      await tx.preparationTicketItem.updateMany({
        where: { ticketId: id },
        data: { status },
      });

      const itemIds = ticket.items.map((i) => i.orderItemId);
      await tx.orderItem.updateMany({
        where: { id: { in: itemIds } },
        data: { status },
      });

      await tx.auditLog.create({
        data: {
          businessId: ticket.businessId,
          branchId: ticket.branchId,
          userId: (req as any).staff?.id || null,
          action: 'TICKET_STATUS_UPDATE',
          entityType: 'TICKET',
          entityId: ticket.id,
          details: {
            ticketNumber: ticket.ticketNumber,
            station: ticket.station,
            previousStatus: ticket.status,
            newStatus: status,
            actor: (req as any).staff?.username || 'system',
          },
        },
      });

      return updatedTicket;
    });

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update ticket status', message: error.message });
  }
});


// ----------------------------------------------------
// IMAGEKIT AUTH
// ----------------------------------------------------
import ImageKit from "imagekit";

const imagekit = process.env.IMAGEKIT_PUBLIC_KEY && process.env.IMAGEKIT_PRIVATE_KEY && process.env.IMAGEKIT_URL_ENDPOINT
  ? new ImageKit({
      publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
      privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
      urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
    })
  : null;

app.get('/api/imagekit/auth', requirePermission(['OWNER', 'MANAGER']), (req, res) => {
  if (!imagekit) {
    return res.status(503).json({ error: 'ImageKit not configured' });
  }
  try {
    const result = imagekit.getAuthenticationParameters();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate auth parameters' });
  }
});
app.get('/api/branding', async (req: Request, res: Response) => {
  try {
    const business = await prisma.business.findFirst();
    res.json(business);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch branding' });
  }
});

app.put('/api/branding', requirePermission(['OWNER', 'MANAGER']), async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const business = await prisma.business.findFirst();
    if (!business) return res.status(404).json({ error: 'Business not found' });

    const updated = await prisma.business.update({
      where: { id: business.id },
      data,
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update branding' });
  }
});
app.get('/api/qr/:token/menu', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const qr = await prisma.tableQr.findUnique({ where: { token }, include: { table: true } });
    if (!qr || !qr.isActive) return res.status(404).json({ error: 'Invalid QR' });

    const products = await prisma.product.findMany({ where: { businessId: qr.table.businessId, isActive: true } });
    const categories = await prisma.productCategory.findMany({ where: { businessId: qr.table.businessId, isActive: true } });

    res.json({ table: qr.table, products, categories });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch menu' });
  }
});

app.post('/api/qr/:token/orders', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const { items, customerName } = req.body; 
    const qr = await prisma.tableQr.findUnique({ where: { token }, include: { table: true } });
    if (!qr || !qr.isActive) return res.status(404).json({ error: 'Invalid QR' });

    const orderNumber = `QR-${Date.now().toString().slice(-6)}`;
    const order = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          businessId: qr.table.businessId,
          branchId: qr.table.branchId,
          orderNumber,
          tableId: qr.tableId,
          tableNumber: qr.table.tableNumber,
          customerName,
          status: 'OPEN',
        },
      });
      return order;
    });

    res.json({ success: true, orderNumber });
  } catch (error) {
    res.status(500).json({ error: 'Failed to place order' });
  }
});
app.post('/api/qr/verify-phone', async (req: Request, res: Response) => {
  try {
    const { phoneNumber, otp } = req.body;
    const codeHash = crypto.createHash('sha256').update(otp).digest('hex');
    const challenge = await prisma.otpChallenge.findFirst({
      where: { phoneNumber, codeHash, purpose: 'CUSTOMER_VERIFY', expiresAt: { gt: new Date() }, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!challenge) {
      return res.status(401).json({ error: 'Invalid or expired OTP.' });
    }

    await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { usedAt: new Date() } });
    res.json({ success: true, message: 'Verified.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to verify OTP.' });
  }
});
app.use('/api', (err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled API Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message || 'An unexpected error occurred.',
  });
});

async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('[Server] Vite middleware mounted for development.');
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
    console.log('[Server] Serving production build from /dist.');
  }

  app.listen(PORT, () => {
    console.log(`[Server] TAI LOUNGE POS running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
