import 'dotenv/config';
import http from 'http';

const BASE_URL = 'http://localhost:3000';

function makeRequest(path: string, options: http.RequestOptions = {}, body?: any): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqOptions: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    };

    const req = http.request(reqOptions, (res) => {
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(rawData);
          resolve({ status: res.statusCode || 200, data: parsed });
        } catch {
          resolve({ status: res.statusCode || 200, data: rawData });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- STARTING BACKEND FOUNDATION TESTS ---');

  // Test 1: Health endpoint
  console.log('\n[TEST 1] Testing /api/health...');
  const healthRes = await makeRequest('/api/health');
  console.log('Health status:', healthRes.status, JSON.stringify(healthRes.data));
  if (healthRes.status !== 200 || healthRes.data.database !== 'connected') {
    throw new Error('Health check failed or database not connected');
  }

  // Test 2: Categories endpoint
  console.log('\n[TEST 2] Testing /api/categories...');
  const categoriesRes = await makeRequest('/api/categories');
  console.log(`Retrieved ${categoriesRes.data.length} categories.`);
  if (categoriesRes.status !== 200 || categoriesRes.data.length === 0) {
    throw new Error('Categories retrieval failed');
  }
  const firstCategory = categoriesRes.data[0];

  // Test 3: Products listing endpoint
  console.log('\n[TEST 3] Testing /api/products...');
  const productsRes = await makeRequest('/api/products');
  console.log(`Retrieved ${productsRes.data.length} products from Neon database.`);
  if (productsRes.status !== 200 || productsRes.data.length === 0) {
    throw new Error('Products listing failed');
  }

  // Test 4: Product creation with validation
  console.log('\n[TEST 4] Testing POST /api/products (Product Creation)...');
  const testProductSku = `TEST-BEER-${Date.now().toString().slice(-4)}`;
  const createRes = await makeRequest('/api/products', { method: 'POST' }, {
    name: 'Kilimanjaro Premium Malt',
    price: 4200,
    costPrice: 2800,
    categoryId: firstCategory.id,
    sku: testProductSku,
    stockQuantity: 75,
    unitOfMeasure: 'Bottle (500ml)',
    station: 'BAR',
    description: 'Crisp Tanzanian malt beer',
  });
  console.log('Create result status:', createRes.status, 'ID:', createRes.data.id, 'SKU:', createRes.data.sku);
  if (createRes.status !== 201 || !createRes.data.id) {
    throw new Error('Product creation failed: ' + JSON.stringify(createRes.data));
  }

  // Test 5: Verify product persistence
  console.log('\n[TEST 5] Testing Product Persistence via search query...');
  const searchRes = await makeRequest(`/api/products?search=${encodeURIComponent(testProductSku)}`);
  const found = searchRes.data.find((p: any) => p.sku === testProductSku);
  if (!found) {
    throw new Error('Created product was not found in database query!');
  }
  console.log('Product verified in database:', found.name, 'Price:', found.price, 'TZS');

  // Test 6: Product update
  console.log('\n[TEST 6] Testing PUT /api/products/:id (Product Update)...');
  const updateRes = await makeRequest(`/api/products/${found.id}`, { method: 'PUT' }, {
    price: 4500,
    stockQuantity: 100,
  });
  console.log('Update result status:', updateRes.status, 'New Price:', updateRes.data.price);
  if (updateRes.status !== 200 || updateRes.data.price !== 4500) {
    throw new Error('Product update failed');
  }

  // Test 7: Error handling for invalid input (should return 400 without crashing)
  console.log('\n[TEST 7] Testing validation error handling...');
  const invalidRes = await makeRequest('/api/products', { method: 'POST' }, {
    name: '', // Invalid empty name
    price: -100, // Invalid negative price
  });
  console.log('Invalid request response status:', invalidRes.status, 'Error message:', invalidRes.data.error);
  if (invalidRes.status !== 400) {
    throw new Error('Expected 400 Bad Request for invalid input');
  }

  console.log('\n✅ ALL BACKEND AND DATABASE TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('\n❌ TEST RUN FAILED:', err.message);
  process.exit(1);
});
