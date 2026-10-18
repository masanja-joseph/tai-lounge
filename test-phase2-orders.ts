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

async function runPhase2Tests() {
  console.log('==================================================');
  console.log('   TAI LOUNGE POS — PHASE 2 AUTOMATED TESTS');
  console.log('==================================================\n');

  // 1. Tables and Sections
  console.log('[TEST 1] Fetching tables and sections...');
  const tablesRes = await makeRequest('/api/tables');
  if (tablesRes.status !== 200 || tablesRes.data.length === 0) {
    throw new Error('Failed to fetch tables: ' + JSON.stringify(tablesRes.data));
  }
  console.log(`✓ Retrieved ${tablesRes.data.length} tables.`);

  const availableTables = tablesRes.data.filter((t: any) => t.status === 'AVAILABLE');
  if (availableTables.length < 2) throw new Error('Need at least 2 available tables');
  const table31 = availableTables[0];
  const table32 = availableTables[1];

  // 2. Fetch products to get Serengeti Lager (BAR) and Chicken Wings (KITCHEN)
  console.log('\n[TEST 2] Finding test products (BAR & KITCHEN stations)...');
  const productsRes = await makeRequest('/api/products');
  const serengeti = productsRes.data.find((p: any) => p.name.includes('Serengeti'));
  const chickenWings = productsRes.data.find((p: any) => p.station === 'KITCHEN' || p.name.includes('Chicken'));
  if (!serengeti || !chickenWings) {
    throw new Error('Required test products not found in database');
  }
  console.log(`✓ Products found: ${serengeti.name} (${serengeti.price} TZS, ${serengeti.station}) & ${chickenWings.name} (${chickenWings.price} TZS, ${chickenWings.station})`);

  // 3. Reject invalid quantities (e.g. quantity <= 0)
  console.log('\n[TEST 3] Testing rejection of invalid item quantity...');
  const invalidRes = await makeRequest('/api/orders', { method: 'POST' }, {
    tableId: table31.id,
    items: [{ productId: serengeti.id, quantity: -2 }],
  });
  if (invalidRes.status !== 400) {
    throw new Error(`Expected 400 for negative quantity, received ${invalidRes.status}`);
  }
  console.log('✓ Rejected invalid quantity with status 400:', invalidRes.data.error);

  // 4. Create Order with Idempotency Key & Table Assignment
  console.log('\n[TEST 4] Creating Order assigned to Table 31 with Idempotency Key...');
  const testIdempotencyKey = `idemp-${Date.now()}`;
  const createOrderRes = await makeRequest('/api/orders', {
    method: 'POST',
    headers: { 'idempotency-key': testIdempotencyKey },
  }, {
    tableId: table31.id,
    customerName: 'Juma Mwamba',
    guestCount: 3,
    notes: 'Lounge guest, prefers chilled glasses',
    items: [
      { productId: serengeti.id, quantity: 2, specialInstructions: 'Chilled glasses' },
      { productId: chickenWings.id, quantity: 1, specialInstructions: 'Extra spicy peri-peri' },
    ],
  });

  if (createOrderRes.status !== 201) {
    throw new Error('Order creation failed: ' + JSON.stringify(createOrderRes.data));
  }
  const order = createOrderRes.data;
  console.log(`✓ Order created: ${order.orderNumber} (ID: ${order.id})`);
  console.log(`  Table: ${order.tableNumber}`);
  console.log(`  Subtotal: ${order.subtotal} TZS`);
  console.log(`  Tax (18%): ${order.tax} TZS`);
  console.log(`  Total: ${order.total} TZS`);
  console.log(`  Balance Due: ${order.balanceDue} TZS`);

  // Verify server-side price calculation
  const expectedSubtotal = serengeti.price * 2 + chickenWings.price * 1;
  const expectedTax = Math.round(expectedSubtotal * 0.18);
  const expectedTotal = expectedSubtotal + expectedTax;

  if (order.subtotal !== expectedSubtotal || order.total !== expectedTotal) {
    throw new Error(`Calculation mismatch! Expected ${expectedTotal}, got ${order.total}`);
  }
  console.log('✓ Server-side prices and totals verified accurate to the shilling.');

  // 5. Test Idempotency (replay same request should return existing order without duplicates)
  console.log('\n[TEST 5] Testing Idempotent Retry with same key...');
  const replayRes = await makeRequest('/api/orders', {
    method: 'POST',
    headers: { 'idempotency-key': testIdempotencyKey },
  }, {
    tableId: table31.id,
    customerName: 'Juma Mwamba',
    items: [{ productId: serengeti.id, quantity: 2 }],
  });
  if (replayRes.status !== 200 || replayRes.data.id !== order.id) {
    throw new Error('Idempotent replay failed');
  }
  console.log('✓ Idempotency protected against duplicate order creation.');

  // 6. Verify Table 31 is now marked OCCUPIED
  console.log('\n[TEST 6] Verifying Table 31 occupancy status in database...');
  const updatedTables = await makeRequest('/api/tables');
  const t31Updated = updatedTables.data.find((t: any) => t.id === table31.id);
  if (t31Updated.status !== 'OCCUPIED') {
    throw new Error(`Expected Table 31 to be OCCUPIED, found ${t31Updated.status}`);
  }
  console.log('✓ Table 31 occupancy successfully updated to OCCUPIED.');

  // 7. Add Items to Existing Open Tab
  console.log('\n[TEST 7] Adding extra round to open order...');
  const addItemsRes = await makeRequest(`/api/orders/${order.id}/items`, { method: 'POST' }, {
    items: [{ productId: serengeti.id, quantity: 1, specialInstructions: 'Second round' }],
  });
  if (addItemsRes.status !== 200) {
    throw new Error('Failed to add items: ' + JSON.stringify(addItemsRes.data));
  }
  console.log(`✓ Added items. Order item count now: ${addItemsRes.data.items.length}, new Total: ${addItemsRes.data.total} TZS`);

  // 8. Send to Preparation (Bar & Kitchen tickets created)
  console.log('\n[TEST 8] Sending order items to preparation stations...');
  const prepRes = await makeRequest(`/api/orders/${order.id}/send-to-preparation`, { method: 'POST' }, {
    serverNotes: 'VIP guest table, expedite please',
  });
  if (prepRes.status !== 200 || !prepRes.data.tickets || prepRes.data.tickets.length === 0) {
    throw new Error('Failed to send to preparation: ' + JSON.stringify(prepRes.data));
  }
  console.log(`✓ ${prepRes.data.message}`);
  for (const tkt of prepRes.data.tickets) {
    console.log(`  Ticket created: ${tkt.ticketNumber} [Station: ${tkt.station}, Status: ${tkt.status}, Items: ${tkt.items.length}]`);
  }

  // 9. Send again immediately should NOT duplicate tickets
  console.log('\n[TEST 9] Verifying re-send prevents duplicate ticket creation...');
  const resendRes = await makeRequest(`/api/orders/${order.id}/send-to-preparation`, { method: 'POST' });
  if (resendRes.status !== 400) {
    throw new Error('Expected 400 when no new items need preparation');
  }
  console.log('✓ Re-send safely blocked duplicate ticket generation:', resendRes.data.error);

  // 10. Table Transfer (Transfer to an available table and test occupied rejection)
  console.log('\n[TEST 10] Testing Table Transfer and collision rejection...');
  const currentTablesRes = await makeRequest('/api/tables');
  const availableTargetTable = currentTablesRes.data.find((t: any) => t.status === 'AVAILABLE' && t.id !== order.tableId);
  if (!availableTargetTable) {
    throw new Error('No available table found for transfer test');
  }

  // First transfer
  const transferRes = await makeRequest(`/api/orders/${order.id}/transfer-table`, { method: 'POST' }, {
    targetTableId: availableTargetTable.id,
  });
  if (transferRes.status !== 200 || transferRes.data.tableId !== availableTargetTable.id) {
    throw new Error('Table transfer failed: ' + JSON.stringify(transferRes.data));
  }
  console.log(`✓ Order successfully transferred to: ${transferRes.data.tableNumber}`);

  // Test rejecting transfer to an already occupied table
  const occupiedCollisionRes = await makeRequest(`/api/orders/${order.id}/transfer-table`, { method: 'POST' }, {
    targetTableId: availableTargetTable.id, // now occupied by this order
  });
  if (occupiedCollisionRes.status !== 400) {
    throw new Error('Expected 400 when transferring to already occupied table');
  }
  console.log('✓ Rejected collision transfer with status 400:', occupiedCollisionRes.data.error);

  // Verify Table 31 is now AVAILABLE and Table 32 is OCCUPIED
  const tablesAfterTransfer = await makeRequest('/api/tables');
  const t31After = tablesAfterTransfer.data.find((t: any) => t.id === table31.id);
  const t32After = tablesAfterTransfer.data.find((t: any) => t.id === table32.id);
  if (t31After.status !== 'AVAILABLE' || t32After.status !== 'OCCUPIED') {
    throw new Error(`Table statuses incorrect after transfer: T31=${t31After.status}, T32=${t32After.status}`);
  }
  console.log('✓ Old Table 31 released to AVAILABLE, new Table 32 set to OCCUPIED.');

  // 11. Ticket Status Updates (NEW -> PREPARING -> READY -> SERVED)
  console.log('\n[TEST 11] Updating preparation ticket status...');
  const barTicket = prepRes.data.tickets.find((t: any) => t.station === 'BAR');
  if (barTicket) {
    const ticketUpdateRes = await makeRequest(`/api/tickets/${barTicket.id}/status`, { method: 'PATCH' }, {
      status: 'READY',
    });
    if (ticketUpdateRes.status !== 200 || ticketUpdateRes.data.status !== 'READY') {
      throw new Error('Ticket status update failed');
    }
    console.log(`✓ Ticket ${barTicket.ticketNumber} updated to READY.`);
  }

  // 12. Reopening / Holding Order (Keeping Unpaid Order Open)
  console.log('\n[TEST 12] Testing holding open order without marking it paid...');
  const holdRes = await makeRequest(`/api/orders/${order.id}/status`, { method: 'PATCH' }, {
    status: 'OPEN',
    notes: 'Tab on hold for customer guest arrivals',
  });
  if (holdRes.status !== 200 || holdRes.data.amountPaid !== 0 || holdRes.data.balanceDue <= 0) {
    throw new Error('Holding order failed or improperly marked paid');
  }
  console.log(`✓ Order ${holdRes.data.orderNumber} successfully held with open balance ${holdRes.data.balanceDue} TZS (Not paid).`);

  console.log('\n==================================================');
  console.log('  🎉 ALL 12 PHASE 2 AUTOMATED TESTS PASSED!');
  console.log('==================================================\n');
}

runPhase2Tests().catch((err) => {
  console.error('\n❌ PHASE 2 TESTS FAILED:', err.message);
  process.exit(1);
});
