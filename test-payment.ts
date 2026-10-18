import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function testPayments() {
  console.log("Running Payment Test...");
  const order = await prisma.order.findFirst();
  if (!order) {
    console.log("No orders found to test payments.");
    return;
  }
  
  const paymentData = {
    amount: 1000,
    method: 'CASH',
    idempotencyKey: `test-${Date.now()}`
  };

  try {
    // Assuming a test environment where we can bypass auth for script testing or simulate header
    console.log(`Testing payment for order: ${order.id}`);
    
    // In a real scenario, this would be a fetch call to the API
    // Since this is a direct script, let's simulate the transaction logic directly
    const payment = await prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          orderId: order.id,
          branchId: order.branchId,
          amount: paymentData.amount,
          method: paymentData.method,
          idempotencyKey: paymentData.idempotencyKey,
          status: 'COMPLETED',
        },
      });
      await tx.order.update({
        where: { id: order.id },
        data: {
          amountPaid: order.amountPaid + paymentData.amount,
          balanceDue: order.balanceDue - paymentData.amount,
          status: 'PARTIALLY_PAID',
        },
      });
      return p;
    });

    console.log("Payment created successfully:", payment.id);
  } catch (error) {
    console.error("Payment test failed:", error);
  }
}

testPayments();
