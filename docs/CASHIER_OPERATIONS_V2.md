# Cashier operations v2

This increment adds operational APIs for café cashiers. Checkout now requires an existing open shift so every sale is included in shift reconciliation.

## Included

- One active shift per cashier.
- Opening float, cash-in/cash-out movements, expected close cash, counted cash, and variance.
- Suspended carts with one-time resume protection.
- Partial refunds with cumulative over-refund protection.
- Cash refunds are tied to an open shift and reduce expected drawer cash.
- Cash withdrawals cannot exceed the calculated drawer balance.
- Suspended orders cannot be resumed after their shift closes.
- Manager-only refund approval using server-side configuration.
- Cash change is stored on the order and excluded from drawer cash.
- Manual discounts require manager approval and record the approving manager.
- Refund values are calculated from the original order lines and must use an original payment method.
- Refunds restore inventory and reverse earned loyalty points; full refunds also reverse the visit and restore redeemed reward points.

## Security

Set `MANAGER_APPROVAL_TOKEN` to a long random secret in the API environment. Do not place it in web or mobile source code. The current token adapter is an integration seam and should be replaced by authenticated employee sessions and permission claims before production use.

The legacy approval adapter is blocked in `NODE_ENV=production` unless `ALLOW_LEGACY_MANAGER_APPROVAL=true` is explicitly set. This override is for controlled migration only and must not be enabled for real operation.

## Compatibility

The database remains in-memory in this foundation. The maps in `operations.ts` are intentionally isolated so they can be replaced with transactional PostgreSQL repositories without changing the HTTP contracts. Because shift IDs are now required, older checkout clients must be upgraded before adopting this version.

`GET /api/v1/operations/readiness` deliberately reports `productionReady: false` until persistent storage and authenticated employee sessions replace the temporary adapters.
