import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seeding...');

  // 1. Default Business
  const business = await prisma.business.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'TAI LOUNGE',
      currency: 'TZS',
      timezone: 'Africa/Dar_es_Salaam',
    },
  });
  console.log('Business ready:', business.name);

  // 2. Default Branch
  const branch = await prisma.branch.upsert({
    where: { id: '00000000-0000-0000-0000-000000000002' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      businessId: business.id,
      name: 'Main Lounge & Bar',
      code: 'MAIN',
      address: 'Dar es Salaam, Tanzania',
      phone: '+255 700 000 000',
    },
  });
  console.log('Branch ready:', branch.name);

  // 3. Roles
  const roles = [
    { name: 'OWNER', description: 'Complete business access and analytics' },
    { name: 'MANAGER', description: 'Operational management, approvals and reports' },
    { name: 'CASHIER', description: 'POS transactions and payments' },
    { name: 'WAITER', description: 'Table management and order creation' },
    { name: 'BARTENDER', description: 'Beverage preparation and bar tickets' },
    { name: 'KITCHEN', description: 'Food preparation and kitchen tickets' },
    { name: 'STOREKEEPER', description: 'Inventory, receiving and stock counts' },
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: { name: role.name, description: role.description },
    });
  }
  console.log('Roles seeded');

  // 4. Default Admin / Owner User
  const ownerRole = await prisma.role.findUnique({ where: { name: 'OWNER' } });
  if (ownerRole) {
    await prisma.user.upsert({
      where: { username: 'admin' },
      update: { roleId: ownerRole.id },
      create: {
        businessId: business.id,
        branchId: branch.id,
        roleId: ownerRole.id,
        username: 'admin',
        email: 'owner@tailounge.co.tz',
        fullName: 'Tai Lounge Manager',
        pinCode: '1234',
      },
    });
    console.log('Default Admin user ready (PIN: 1234)');
  }

  // 5. Product Categories
  const categoriesData = [
    { name: 'Beer', slug: 'beer', displayOrder: 1 },
    { name: 'Spirits', slug: 'spirits', displayOrder: 2 },
    { name: 'Wine', slug: 'wine', displayOrder: 3 },
    { name: 'Cocktails', slug: 'cocktails', displayOrder: 4 },
    { name: 'Soft Drinks', slug: 'soft-drinks', displayOrder: 5 },
    { name: 'Water', slug: 'water', displayOrder: 6 },
    { name: 'Food', slug: 'food', displayOrder: 7 },
    { name: 'Snacks', slug: 'snacks', displayOrder: 8 },
  ];

  const categoryMap = new Map<string, string>();
  for (const cat of categoriesData) {
    const createdCat = await prisma.productCategory.upsert({
      where: {
        businessId_slug: {
          businessId: business.id,
          slug: cat.slug,
        },
      },
      update: { name: cat.name, displayOrder: cat.displayOrder },
      create: {
        businessId: business.id,
        name: cat.name,
        slug: cat.slug,
        displayOrder: cat.displayOrder,
      },
    });
    categoryMap.set(cat.slug, createdCat.id);
  }
  console.log('Categories seeded');

  // 6. Products
  const productsData = [
    {
      sku: 'BEER-SER-01',
      name: 'Serengeti Lager',
      categorySlug: 'beer',
      price: 3500,
      costPrice: 2200,
      stockQuantity: 120,
      unitOfMeasure: 'Bottle (330ml)',
      station: 'BAR',
      imageUrl: '/src/assets/images/product_serengeti_lager_1792056335693.jpg',
    },
    {
      sku: 'BEER-KIL-02',
      name: 'Kilimanjaro Lager',
      categorySlug: 'beer',
      price: 3500,
      costPrice: 2200,
      stockQuantity: 95,
      unitOfMeasure: 'Bottle (330ml)',
      station: 'BAR',
      imageUrl: null,
    },
    {
      sku: 'BEER-HEI-03',
      name: 'Heineken',
      categorySlug: 'beer',
      price: 5000,
      costPrice: 3200,
      stockQuantity: 60,
      unitOfMeasure: 'Bottle (330ml)',
      station: 'BAR',
      imageUrl: null,
    },
    {
      sku: 'COCK-MOJ-01',
      name: 'Mojito Cocktail',
      categorySlug: 'cocktails',
      price: 12000,
      costPrice: 4500,
      stockQuantity: 40,
      unitOfMeasure: 'Glass',
      station: 'BAR',
      imageUrl: null,
    },
    {
      sku: 'SOFT-COCA-01',
      name: 'Coca-Cola',
      categorySlug: 'soft-drinks',
      price: 1500,
      costPrice: 900,
      stockQuantity: 150,
      unitOfMeasure: 'Bottle (350ml)',
      station: 'BAR',
      imageUrl: null,
    },
    {
      sku: 'WAT-350-01',
      name: 'Bottled Water',
      categorySlug: 'water',
      price: 1000,
      costPrice: 500,
      stockQuantity: 200,
      unitOfMeasure: 'Bottle (500ml)',
      station: 'BAR',
      imageUrl: null,
    },
    {
      sku: 'SPIR-JW-BLK',
      name: 'Johnnie Walker Black',
      categorySlug: 'spirits',
      price: 120000,
      costPrice: 85000,
      stockQuantity: 15,
      unitOfMeasure: 'Bottle (750ml)',
      station: 'BAR',
      imageUrl: null,
    },
    {
      sku: 'SPIR-SMIR-01',
      name: 'Smirnoff Vodka',
      categorySlug: 'spirits',
      price: 45000,
      costPrice: 30000,
      stockQuantity: 25,
      unitOfMeasure: 'Bottle (750ml)',
      station: 'BAR',
      imageUrl: null,
    },
    {
      sku: 'FOOD-CHIK-01',
      name: 'Chicken Wings',
      categorySlug: 'food',
      price: 15000,
      costPrice: 8000,
      stockQuantity: 30,
      unitOfMeasure: 'Portion (6 pcs)',
      station: 'KITCHEN',
      imageUrl: null,
    },
    {
      sku: 'SNAK-PEA-01',
      name: 'Roasted Cashews & Peanuts',
      categorySlug: 'snacks',
      price: 5000,
      costPrice: 2500,
      stockQuantity: 50,
      unitOfMeasure: 'Bowl',
      station: 'BAR',
      imageUrl: null,
    },
  ];

  for (const prod of productsData) {
    const categoryId = categoryMap.get(prod.categorySlug);
    if (!categoryId) continue;

    await prisma.product.upsert({
      where: { sku: prod.sku },
      update: {
        name: prod.name,
        price: prod.price,
        costPrice: prod.costPrice,
        stockQuantity: prod.stockQuantity,
        unitOfMeasure: prod.unitOfMeasure,
        station: prod.station,
        imageUrl: prod.imageUrl,
        categoryId,
      },
      create: {
        businessId: business.id,
        categoryId,
        sku: prod.sku,
        name: prod.name,
        price: prod.price,
        costPrice: prod.costPrice,
        stockQuantity: prod.stockQuantity,
        unitOfMeasure: prod.unitOfMeasure,
        station: prod.station,
        imageUrl: prod.imageUrl,
      },
    });
  }

  console.log('Products seeded successfully!');

  // 7. Lounge Sections
  const sectionsData = [
    { name: 'Main Lounge', code: 'MAIN', isVip: false, displayOrder: 1 },
    { name: 'VIP Lounge', code: 'VIP', isVip: true, displayOrder: 2 },
    { name: 'Terrace & Bar', code: 'TERRACE', isVip: false, displayOrder: 3 },
    { name: 'Garden Area', code: 'GARDEN', isVip: false, displayOrder: 4 },
  ];

  const sectionMap = new Map<string, string>();
  for (const sec of sectionsData) {
    const s = await prisma.loungeSection.upsert({
      where: {
        branchId_code: {
          branchId: branch.id,
          code: sec.code,
        },
      },
      update: { name: sec.name, isVip: sec.isVip, displayOrder: sec.displayOrder },
      create: {
        businessId: business.id,
        branchId: branch.id,
        name: sec.name,
        code: sec.code,
        isVip: sec.isVip,
        displayOrder: sec.displayOrder,
      },
    });
    sectionMap.set(sec.code, s.id);
  }
  console.log('Lounge Sections seeded');

  // 8. Lounge Tables
  const tablesData = [
    // Main Lounge
    { sectionCode: 'MAIN', tableNumber: 'Table 10', capacity: 4 },
    { sectionCode: 'MAIN', tableNumber: 'Table 11', capacity: 4 },
    { sectionCode: 'MAIN', tableNumber: 'Table 12', capacity: 6 },
    { sectionCode: 'MAIN', tableNumber: 'Table 14', capacity: 6 },
    { sectionCode: 'MAIN', tableNumber: 'Table 15', capacity: 8 },
    // VIP Lounge
    { sectionCode: 'VIP', tableNumber: 'VIP 1 - Serengeti', capacity: 8 },
    { sectionCode: 'VIP', tableNumber: 'VIP 2 - Kilimanjaro', capacity: 10 },
    { sectionCode: 'VIP', tableNumber: 'VIP 3 - Ngorongoro', capacity: 6 },
    // Terrace & Bar
    { sectionCode: 'TERRACE', tableNumber: 'Table 31', capacity: 4 },
    { sectionCode: 'TERRACE', tableNumber: 'Table 32', capacity: 4 },
    { sectionCode: 'TERRACE', tableNumber: 'Bar Counter 01', capacity: 2 },
    { sectionCode: 'TERRACE', tableNumber: 'Bar Counter 02', capacity: 2 },
    // Garden Area
    { sectionCode: 'GARDEN', tableNumber: 'Garden 01', capacity: 6 },
    { sectionCode: 'GARDEN', tableNumber: 'Garden 02', capacity: 8 },
  ];

  for (const tbl of tablesData) {
    const secId = sectionMap.get(tbl.sectionCode);
    if (!secId) continue;

    await prisma.loungeTable.upsert({
      where: {
        branchId_tableNumber: {
          branchId: branch.id,
          tableNumber: tbl.tableNumber,
        },
      },
      update: { capacity: tbl.capacity, sectionId: secId },
      create: {
        businessId: business.id,
        branchId: branch.id,
        sectionId: secId,
        tableNumber: tbl.tableNumber,
        capacity: tbl.capacity,
        status: 'AVAILABLE',
      },
    });
  }
  console.log('Lounge Tables seeded successfully!');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
