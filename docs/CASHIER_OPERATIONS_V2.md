# Cashier operations v2

This increment adds non-breaking operational APIs for café cashiers. Existing checkout clients continue to work without a shift ID, while updated clients can associate sales with an open shift.

## Included

- One active shift per cashier.
- Opening float, cash-in/cash-out movements, expected close cash, counted cash, and variance.
- Suspended carts with one-time resume protection.
- Partial refunds with cumulative over-refund protection.
- Manager-only refund approval using server-side configuration.

## Security

Set `MANAGER_APPROVAL_TOKEN` to a long random secret in the API environment. Do not place it in web or mobile source code. The current token adapter is an integration seam and should be replaced by authenticated employee sessions and permission claims before production use.

## Compatibility

The database remains in-memory in this foundation. The maps in `operations.ts` are intentionally isolated so they can be replaced with transactional PostgreSQL repositories without changing the HTTP contracts.
