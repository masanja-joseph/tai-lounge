# TAI LOUNGE POS - Implementation Plan

TAI LOUNGE POS is a comprehensive bar and lounge management system designed for operational efficiency in Tanzania. It provides a POS, inventory, finance, staff management, and analytics platform.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following decisions are central to the application's architecture and performance.

- **Confirmed Decision 1**: **Stack**: React, TypeScript, Tailwind CSS, PostgreSQL, Prisma, Express.
- **Confirmed Decision 2**: **Authentication**: Firebase Authentication for user sessions, linked to PostgreSQL user records via Firebase UID.
- **Open Question / Choice 1**: **Offline Strategy**: Initial scope will focus on online operations with basic local caching (`localStorage` for cart state). Full offline synchronization (Conflict resolution, background sync) is slated for Phase 5.
- **Open Question / Choice 2**: **Tanzania Localization**: Default TZS currency, Africa/Dar_es_Salaam timezone, and DD/MM/YYYY formatting.

## 1. Overview & Core Concept

- **What It Does**: A POS and management system for bars/lounges to handle sales, inventory, orders, payments, and staff.
- **Target Audience**: Bar managers, cashiers, waiters, bartenders, and owners.
- **Key Value**: Accurate financial reporting, inventory integrity, fast POS transactions, and robust role-based access control.

## 2. User Experience & Visual Design

- **Visual Identity**: Professional, premium lounge aesthetic. Deep charcoal, black, warm gold, cream colors. Dark-mode primary.
- **Navigation**: Collapsible sidebar (desktop), mobile-first touch-optimized navigation.
- **POS Screen**: High-density grid of products, quick category switching, clear order summary, responsive touch-target sizing (minimum 44px).

## 3. Key Product Decisions & Trade-Offs

- **Decision**: Server-side validation for all financial, inventory, and permission-related operations.
    - *Why*: Ensuring data integrity and security in a business-critical environment.
- **Decision**: Using minor currency units (integers) in the database for TZS.
    - *Why*: Avoiding floating-point precision errors in financial calculations.
- **Decision**: Append-only Audit Log for critical actions (refunds, voids, stock adjustments).
    - *Why*: Full accountability and business intelligence tracking.

## 4. Technical Architecture & Data Strategy

```text
┌────────────────────────┐
│  Client (React, TAILWIND) ├─> Firebase Auth
└───────────┬────────────┘
            │
            ▼
┌────────────────────────┐
│  Express Backend       ├─> Prisma ORM
└───────────┬────────────┘      │
            │                   │
            └─────────> PostgreSQL (Neon)
```

### Data Model & State
Key Entities: `User` (RBAC), `Branch`, `Product`, `Order`, `OrderItem`, `InventoryBalance`, `StockMovement`, `Payment`, `Expense`, `StaffShift`, `AuditLog`.

### Implementation Phases
1. **Foundation**: DB schema (PostgreSQL/Prisma), Auth setup, Roles.
2. **Core POS**: Catalog, Order creation, Tables, Payments.
3. **Inventory**: Stock tracking, Recipes, Purchases.
4. **Finance & Staff**: Shifts, Expenses, Reports, Audit Logs.
5. **Hardening**: Offline syncing, Realtime tickets, Printer support, Testing.
