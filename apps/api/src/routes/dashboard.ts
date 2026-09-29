import type { FastifyInstance } from "fastify";
import { riyadhDate, type PaymentMethod, type SalesChannel } from "@cooffeup/shared";
import { actor, guarded, type AppContext } from "../context.js";
import { branchIsOpen } from "../services/orders.js";
import { MAIN_BRANCH_ID } from "../store.js";

const channelGroup = (channel: SalesChannel) => (channel === "pos" ? "pos" : channel === "zid" || channel === "salla" ? "online" : "delivery");

/**
 * One screen for the owner: today's sales across every channel and branch, what is waiting
 * (platform orders, kitchen, pickups), stock alerts and integration problems.
 */
export function registerDashboardRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store } = ctx;

  app.get("/api/v1/dashboard", guarded(ctx, "reports.view"), async (request) => {
    const fixed = actor(request).branchId;
    const inScope = (branchId?: string) => !fixed || (branchId ?? MAIN_BRANCH_ID) === fixed;
    const today = riyadhDate(new Date().toISOString());
    const orders = [...store.orders.values()].filter((order) => inScope(order.branchId));
    const todays = orders.filter((order) => riyadhDate(order.createdAt) === today);
    const scopedOrderIds = new Set(orders.map((order) => order.id));
    const refunds = [...store.refunds.values()].filter((refund) => riyadhDate(refund.createdAt) === today && scopedOrderIds.has(refund.orderId));
    const sales = todays.reduce((sum, order) => sum + order.totals.total, 0);
    const refunded = refunds.reduce((sum, refund) => sum + refund.total, 0);

    const byChannel = { pos: 0, online: 0, delivery: 0 };
    const byPayment: Partial<Record<PaymentMethod, number>> = {};
    for (const order of todays) {
      byChannel[channelGroup(order.channel)] += order.totals.total;
      for (const payment of order.payments) byPayment[payment.method] = (byPayment[payment.method] ?? 0) + payment.amount - (payment.method === "cash" ? order.change : 0);
    }

    const week = Array.from({ length: 7 }, (_, index) => {
      const day = riyadhDate(new Date(Date.now() - (6 - index) * 86_400_000).toISOString());
      const dayOrders = orders.filter((order) => riyadhDate(order.createdAt) === day);
      return { day, sales: dayOrders.reduce((sum, order) => sum + order.totals.total, 0), orders: dayOrders.length };
    });

    const branches = [...store.branches.values()].filter((branch) => branch.active && inScope(branch.id)).map((branch) => {
      const branchOrders = todays.filter((order) => (order.branchId ?? MAIN_BRANCH_ID) === branch.id);
      return {
        id: branch.id, name: branch.name, kind: branch.kind, isOpen: branchIsOpen(branch), shiftOpen: Boolean(store.openShift(branch.id)),
        sales: branchOrders.reduce((sum, order) => sum + order.totals.total, 0), orders: branchOrders.length
      };
    });

    const lowStock = [...store.products.values()]
      .filter((product) => product.active && product.stock <= (product.reorderLevel ?? 0))
      .map((product) => ({ id: product.id, nameAr: product.nameAr, nameEn: product.nameEn, stock: product.stock, reorderLevel: product.reorderLevel ?? 0 }))
      .sort((a, b) => a.stock - b.stock);

    const externalWaiting = [...store.externalOrders.values()].filter((order) => order.status === "new");
    return {
      data: {
        today, sales, refunded, netSales: sales - refunded, orders: todays.length,
        averageTicket: todays.length ? Math.round(sales / todays.length) : 0,
        customers: new Set(todays.map((order) => order.customerId).filter(Boolean)).size,
        byChannel, byPayment, week, branches, lowStock,
        waiting: {
          platformOrders: externalWaiting.length,
          platforms: [...new Set(externalWaiting.map((order) => order.platform))],
          kitchen: [...store.kitchenTickets.values()].filter((ticket) => inScope(ticket.branchId) && (ticket.status === "new" || ticket.status === "preparing")).length,
          pickups: [...store.pickupTickets.values()].filter((ticket) => inScope(ticket.branchId) && ticket.status !== "collected").length
        },
        alerts: {
          storeSync: [...store.syncJobs.values()].filter((job) => job.status === "failed" || job.status === "needs_configuration").length,
          webhooks: [...store.webhookDeliveries.values()].filter((delivery) => delivery.status === "failed").length,
          offlineConflicts: todays.filter((order) => order.offline?.stockConflict).length,
          integrationErrors: store.integrationLog.filter((entry) => entry.status === "failed" && riyadhDate(entry.createdAt) === today).length
        }
      }
    };
  });
}
