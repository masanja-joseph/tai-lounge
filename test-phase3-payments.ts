import 'dotenv/config';
import http from 'http';

const BASE_URL = 'http://localhost:3000';

function makeRequest(
  path: string, 
  options: http.RequestOptions = {}, 
  body?: any
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqOptions: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-staff-pin': '1111', // MANAGER PIN
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

async function runPaymentTests() {
  console.log('--- STARTING PHASE 3 PAYMENT TESTS ---');

  // 1. Fetch product
  const productsRes = await makeRequest('/api/products');
  const product = productsRes.data[0];
  if (!product) throw new Error('No products found');

  // 1. Create order
  const orderRes = await makeRequest('/api/orders', { method: 'POST' }, {
    guestCount: 1,
    items: [{ productId: product.id, quantity: 1 }],
  });
  const order = orderRes.data;
  console.log('Order created:', order.orderNumber, 'Total:', order.total);

  // 2. Full payment
  const paymentRes = await makeRequest(`/api/orders/${order.id}/payments`, { method: 'POST' }, {
    amount: order.total,
    method: 'CASH',
    idempotencyKey: `pay-${Date.now()}`
  });
  console.log('Full payment status:', paymentRes.status);
  if (paymentRes.status !== 201) throw new Error('Payment failed');

  // 3. Verify order status
  const orderCheckRes = await makeRequest(`/api/orders/${order.id}`);
  console.log('Order status after payment:', orderCheckRes.data.status);
  if (orderCheckRes.data.status !== 'PAID') throw new Error('Order not marked PAID');

  console.log('--- PHASE 3 TESTS PASSED ---');
}

runPaymentTests().catch(err => {
    console.error('Payment tests failed:', err.message);
    process.exit(1);
});
