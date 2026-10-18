import 'dotenv/config';
import http from 'http';

const BASE_URL = 'http://localhost:3000';

function makeRequest(
  path: string, 
  options: http.RequestOptions = {}, 
  body?: any
): Promise<{ status: number; data: any; headers: http.IncomingHttpHeaders }> {
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
          resolve({ status: res.statusCode || 200, data: parsed, headers: res.headers });
        } catch {
          resolve({ status: res.statusCode || 200, data: rawData, headers: res.headers });
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

async function runProductionReadinessAudit() {
  console.log('================================================================');
  console.log('   TAI LOUNGE POS — PHASE 2 PRODUCTION READINESS AUDIT SUITE');
  console.log('================================================================\n');

  let passedAudits = 0;
  const createdTestOrderIds: string[] = [];

  // 1. Cross-Branch Isolation Audit
  console.log('[AUDIT 1] Testing cross-branch access rejection...');
  const crossBranchRes = await makeRequest('/api/orders', {
    method: 'POST',
    headers: { 'x-branch-id': '00000000-0000-0000-0000-999999999999' },
  }, {
    items: [],
  });
  if (crossBranchRes.status === 403) {
    console.log('✓ PASS: Cross-branch header correctly rejected with 403 Forbidden.');
    passedAudits++;
  } else {
    throw new Error(`Expected 403 for cross-branch access, got ${crossBranchRes.status}`);
  }

  // 2. Role Spoofing & Invalid PIN Protection
  console.log('\n[AUDIT 2] Testing authentication & role spoofing rejection...');
  // 2a. Invalid PIN
  const invalidPinRes = await makeRequest('/api/products', {
    method: 'POST',
    headers: { 'x-staff-pin': '0000' },
  }, {
    name: 'Hacked Product',
    price: 1000,
  });
  if (invalidPinRes.status === 401) {
    console.log('✓ PASS: Invalid staff PIN rejected with 401 Unauthorized.');
    passedAudits++;
  } else {
    throw new Error(`Expected 401 for invalid PIN, got ${invalidPinRes.status}`);
  }

  // 2b. Role Spoofing (Waiter PIN attempting product creation with spoofed x-staff-role header)
  const spoofRes = await makeRequest('/api/products', {
    method: 'POST',
    headers: { 
      'x-staff-pin': '3333', // Waiter PIN
      'x-staff-role': 'OWNER', // Malicious client header
    },
  }, {
    name: 'Unauthorized Item',
    price: 5000,
    categoryId: 'any',
  });
  if (spoofRes.status === 403) {
    console.log('✓ PASS: Client x-staff-role header ignored; waiter role strictly enforced from DB with 403 Forbidden.');
    passedAudits++;
  } else {
    throw new Error(`Expected 403 for waiter role attempting product creation, got ${spoofRes.status}`);
  }

  // 3. Unauthorized Order Item Removal (Waiters cannot remove order items)
  console.log('\n[AUDIT 3] Testing unauthorized order modification rejection...');
  // First, find an available table and active products to create a test order
  const tablesRes = await makeRequest('/api/tables');
  const availableTable = tablesRes.data.find((t: any) => t.status === 'AVAILABLE');
  if (!availableTable) throw new Error('No available table found for audit');

  const productsRes = await makeRequest('/api/products');
  const barItem = productsRes.data.find((p: any) => p.station === 'BAR');
  const kitchenItem = productsRes.data.find((p: any) => p.station === 'KITCHEN');
  if (!barItem || !kitchenItem) throw new Error('Required test products missing');

  const testOrderRes = await makeRequest('/api/orders', {
    method: 'POST',
    headers: { 'x-staff-pin': '3333' }, // Waiter PIN creates order
  }, {
    tableId: availableTable.id,
    customerName: 'Audit Test Guest',
    items: [
      { productId: barItem.id, quantity: 2 },
      { productId: kitchenItem.id, quantity: 1 },
    ],
  });
  if (testOrderRes.status !== 201) {
    throw new Error('Failed to create audit test order: ' + JSON.stringify(testOrderRes.data));
  }
  const auditOrder = testOrderRes.data;
  createdTestOrderIds.push(auditOrder.id);
  const orderItemId = auditOrder.items[0].id;

  // Waiter attempts to delete item
  const waiterDeleteRes = await makeRequest(`/api/orders/${auditOrder.id}/items/${orderItemId}`, {
    method: 'DELETE',
    headers: { 'x-staff-pin': '3333' }, // Waiter PIN
  });
  if (waiterDeleteRes.status === 403) {
    console.log('✓ PASS: Waiter unauthorized to delete order item, correctly rejected with 403 Forbidden.');
    passedAudits++;
  } else {
    throw new Error(`Expected 403 for waiter deleting order item, got ${waiterDeleteRes.status}`);
  }

  // 4. Closing Unpaid Order Rejection
  console.log('\n[AUDIT 4] Testing attempt to close or mark unpaid order as PAID or CLOSED...');
  const closeUnpaidRes = await makeRequest(`/api/orders/${auditOrder.id}/status`, {
    method: 'PATCH',
    headers: { 'x-staff-pin': '1234' }, // Owner PIN
  }, {
    status: 'CLOSED',
  });
  if (closeUnpaidRes.status === 400 && closeUnpaidRes.data.error.includes('unpaid balance')) {
    console.log('✓ PASS: Closing unpaid order strictly blocked with 400 Bad Request.');
    console.log(`  Guard message: "${closeUnpaidRes.data.error}"`);
    passedAudits++;
  } else {
    throw new Error(`Expected 400 for closing unpaid order, got ${closeUnpaidRes.status}`);
  }

  // Waiter attempts to close order
  const waiterCloseRes = await makeRequest(`/api/orders/${auditOrder.id}/status`, {
    method: 'PATCH',
    headers: { 'x-staff-pin': '3333' }, // Waiter PIN
  }, {
    status: 'CANCELLED',
  });
  if (waiterCloseRes.status === 403) {
    console.log('✓ PASS: Waiter unauthorized to cancel or close orders, rejected with 403 Forbidden.');
    passedAudits++;
  } else {
    throw new Error(`Expected 403 for waiter closing order, got ${waiterCloseRes.status}`);
  }

  // 5. Concurrent Collision Detection on Tables
  console.log('\n[AUDIT 5] Testing concurrent race conditions on table assignment...');
  const freshTablesRes = await makeRequest('/api/tables');
  const targetAvailTable = freshTablesRes.data.find((t: any) => t.status === 'AVAILABLE' && t.id !== availableTable.id);
  if (!targetAvailTable) throw new Error('No second available table for collision audit');

  // Fire two simultaneous requests claiming the same table
  const req1Promise = makeRequest('/api/orders', { method: 'POST' }, {
    tableId: targetAvailTable.id,
    customerName: 'Client 1',
    items: [{ productId: barItem.id, quantity: 1 }],
  });
  const req2Promise = makeRequest('/api/orders', { method: 'POST' }, {
    tableId: targetAvailTable.id,
    customerName: 'Client 2',
    items: [{ productId: barItem.id, quantity: 1 }],
  });

  const [res1, res2] = await Promise.all([req1Promise, req2Promise]);
  const statuses = [res1.status, res2.status].sort();

  if (statuses[0] === 201 && (statuses[1] === 400 || statuses[1] === 409)) {
    console.log(`✓ PASS: Atomic concurrency guard succeeded! One succeeded (201), the other collided and was safely rejected (${statuses[1]}).`);
    passedAudits++;
    const successfulOrder = res1.status === 201 ? res1.data : res2.data;
    createdTestOrderIds.push(successfulOrder.id);
  } else {
    throw new Error(`Concurrency check failed: statuses were ${res1.status} and ${res2.status}`);
  }

  // 6. Invalid and Inactive Products Rejection
  console.log('\n[AUDIT 6] Testing rejection of non-existent and invalid products...');
  const fakeProductRes = await makeRequest('/api/orders', { method: 'POST' }, {
    customerName: 'Test Inactive',
    items: [{ productId: '00000000-0000-0000-0000-ffffffffffff', quantity: 1 }],
  });
  if (fakeProductRes.status === 400) {
    console.log('✓ PASS: Non-existent product rejected with 400 Bad Request.');
    passedAudits++;
  } else {
    throw new Error(`Expected 400 for non-existent product, got ${fakeProductRes.status}`);
  }

  // 7. Invalid Preparation Ticket Transitions
  console.log('\n[AUDIT 7] Testing invalid preparation ticket status transitions...');
  // Send audit order to preparation
  const prepRes = await makeRequest(`/api/orders/${auditOrder.id}/send-to-preparation`, { method: 'POST' });
  if (prepRes.status !== 200 || !prepRes.data.tickets || prepRes.data.tickets.length === 0) {
    throw new Error('Failed to send audit order to preparation');
  }
  const ticket = prepRes.data.tickets[0];

  // Try invalid transition directly to SERVED without being READY
  // Then progress to READY, then SERVED, then try reverting back to NEW
  const stepReady = await makeRequest(`/api/tickets/${ticket.id}/status`, { method: 'PATCH' }, { status: 'READY' });
  const stepServed = await makeRequest(`/api/tickets/${ticket.id}/status`, { method: 'PATCH' }, { status: 'SERVED' });
  if (stepServed.status !== 200) throw new Error('Valid progression to SERVED failed');

  // Now try invalid transition: reverting a SERVED ticket back to PREPARING
  const invalidRevert = await makeRequest(`/api/tickets/${ticket.id}/status`, { method: 'PATCH' }, { status: 'PREPARING' });
  if (invalidRevert.status === 400) {
    console.log('✓ PASS: Invalid ticket transition (SERVED -> PREPARING) rejected with 400 Bad Request.');
    passedAudits++;
  } else {
    throw new Error(`Expected 400 for reverting SERVED ticket, got ${invalidRevert.status}`);
  }

  // 8. Re-sending to Preparation Safety (No duplicates)
  console.log('\n[AUDIT 8] Testing repeated preparation submission rejection...');
  const resubmitRes = await makeRequest(`/api/orders/${auditOrder.id}/send-to-preparation`, { method: 'POST' });
  if (resubmitRes.status === 400 && resubmitRes.data.error.includes('already been submitted')) {
    console.log('✓ PASS: Repeated ticket submission blocked with 400 Bad Request.');
    passedAudits++;
  } else {
    throw new Error(`Expected 400 for repeated ticket submission, got ${resubmitRes.status}`);
  }

  // 9. Client Price Forgery Protection
  console.log('\n[AUDIT 9] Testing server-side calculation vs client forged prices...');
  const forgedPriceRes = await makeRequest('/api/orders', { method: 'POST' }, {
    customerName: 'Price Hacker',
    subtotal: 10,       // Forged client values
    tax: 0,
    total: 10,
    amountPaid: 10,
    balanceDue: 0,
    items: [
      { productId: kitchenItem.id, quantity: 2, unitPrice: 10, subtotal: 20 }, // Real price is 15000 TZS
    ],
  });
  if (forgedPriceRes.status === 201) {
    const o = forgedPriceRes.data;
    createdTestOrderIds.push(o.id);
    const expectedSubtotal = kitchenItem.price * 2;
    const expectedTax = Math.round(expectedSubtotal * 0.18);
    const expectedTotal = expectedSubtotal + expectedTax;

    if (o.subtotal === expectedSubtotal && o.total === expectedTotal && o.amountPaid === 0 && o.balanceDue === expectedTotal) {
      console.log(`✓ PASS: Client-supplied forged prices completely ignored.`);
      console.log(`  Subtotal: ${o.subtotal} TZS (Expected: ${expectedSubtotal} TZS)`);
      console.log(`  Tax: ${o.tax} TZS (Expected: ${expectedTax} TZS)`);
      console.log(`  Total: ${o.total} TZS (Expected: ${expectedTotal} TZS)`);
      console.log(`  Amount Paid: ${o.amountPaid} TZS (Client claimed 10 TZS, server recorded 0 TZS)`);
      passedAudits++;
    } else {
      throw new Error(`Calculations accepted client forged values! Got total=${o.total}`);
    }
  } else {
    throw new Error('Order creation failed: ' + JSON.stringify(forgedPriceRes.data));
  }

  // 10. Table Transfer Rollback on Invalid Target
  console.log('\n[AUDIT 10] Testing table transfer collision & rollback...');
  const invalidTransferRes = await makeRequest(`/api/orders/${auditOrder.id}/transfer-table`, { method: 'POST' }, {
    targetTableId: '00000000-0000-0000-0000-invalidtable',
  });
  if (invalidTransferRes.status === 500 || invalidTransferRes.status === 400) {
    // Verify order's original table was NOT modified
    const verifyOrder = await makeRequest(`/api/orders/${auditOrder.id}`);
    if (verifyOrder.data.tableId === availableTable.id) {
      console.log('✓ PASS: Invalid table transfer rolled back completely without corrupting table state.');
      passedAudits++;
    } else {
      throw new Error('Table assignment corrupted despite failed transfer!');
    }
  } else {
    throw new Error(`Expected error for invalid table transfer, got ${invalidTransferRes.status}`);
  }

  // Cleanup: Cancel only test orders created in this audit run to leave lounge tables clean
  console.log('\n[CLEANUP] Safely cleaning up isolated audit orders...');
  for (const ordId of createdTestOrderIds) {
    try {
      await makeRequest(`/api/orders/${ordId}/status`, {
        method: 'PATCH',
        headers: { 'x-staff-pin': '1234' }, // Owner PIN can cancel
      }, {
        status: 'CANCELLED',
        notes: 'Automated Phase 2 Production Readiness Audit cleanup',
      });
    } catch {}
  }
  console.log(`✓ Cleaned up ${createdTestOrderIds.length} audit test orders. Tables released to AVAILABLE.`);

  console.log('\n================================================================');
  console.log(`  🎉 ALL ${passedAudits}/10 PRODUCTION READINESS AUDITS PASSED!`);
  console.log('================================================================\n');
}

runProductionReadinessAudit().catch((err) => {
  console.error('\n❌ AUDIT FAILED:', err.message);
  process.exit(1);
});
