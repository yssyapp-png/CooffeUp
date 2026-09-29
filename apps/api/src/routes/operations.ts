import type { FastifyInstance } from "fastify";
import {
  APPOINTMENT_STATUS_LABELS, KITCHEN_STATUS_LABELS, TABLE_STATUS_LABELS, canTransitionAppointment, canTransitionKitchen, findAppointmentConflict,
  riyadhDate, type Appointment, type AppointmentStatus, type DiningTable, type KitchenStatus, type Permission, type TableStatus
} from "@cooffeup/shared";
import { z } from "zod";
import { actor, audit, fail, guarded, newId, now, parse, type AppContext } from "../context.js";

const keys = <T extends string>(record: Record<T, string>) => Object.keys(record) as [T, ...T[]];

export function registerOperationsRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store } = ctx;
  const guard = (...permissions: Permission[]) => guarded(ctx, ...permissions);

  // ---------- Tables ----------
  const presentTable = (table: DiningTable) => {
    const orders = table.orderIds.map((id) => store.orders.get(id)).filter((order) => order !== undefined);
    return { ...table, statusLabel: TABLE_STATUS_LABELS[table.status], openTotal: orders.reduce((sum, order) => sum + order.totals.total, 0), orderCount: orders.length };
  };

  app.get("/api/v1/tables", guard("tables.manage"), async () => ({ data: [...store.tables.values()].map(presentTable) }));

  app.post("/api/v1/tables", guard("tables.manage"), async (request, reply) => {
    const body = parse(z.object({ label: z.string().min(1).max(40), area: z.string().min(1).max(40), seats: z.number().int().min(1).max(40) }), request.body);
    const table: DiningTable = { id: newId(), ...body, status: "available", orderIds: [] };
    store.tables.set(table.id, table);
    return reply.code(201).send({ data: presentTable(table) });
  });

  app.patch<{ Params: { id: string } }>("/api/v1/tables/:id", guard("tables.manage"), async (request) => {
    const table = store.tables.get(request.params.id) ?? fail(404, "TABLE_NOT_FOUND");
    const body = parse(z.object({ status: z.enum(keys(TABLE_STATUS_LABELS)) }), request.body);
    table.status = body.status as TableStatus;
    // Freeing or cleaning a table closes its current seating.
    if (body.status === "available" || body.status === "cleaning") {
      table.orderIds = [];
      table.occupiedSince = undefined;
    }
    return { data: presentTable(table) };
  });

  // ---------- Kitchen display ----------
  app.get("/api/v1/kitchen/tickets", guard("kitchen.view"), async (request) => {
    const query = parse(z.object({ includeDone: z.coerce.boolean().default(false) }), request.query);
    const data = [...store.kitchenTickets.values()]
      .filter((ticket) => query.includeDone || (ticket.status !== "served" && ticket.status !== "cancelled"))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((ticket) => ({ ...ticket, statusLabel: KITCHEN_STATUS_LABELS[ticket.status] }));
    return { data };
  });

  app.patch<{ Params: { id: string } }>("/api/v1/kitchen/tickets/:id", guard("kitchen.view"), async (request) => {
    const ticket = store.kitchenTickets.get(request.params.id) ?? fail(404, "TICKET_NOT_FOUND");
    const body = parse(z.object({ status: z.enum(keys(KITCHEN_STATUS_LABELS)) }), request.body);
    const status = body.status as KitchenStatus;
    if (!canTransitionKitchen(ticket.status, status)) fail(409, "INVALID_STATUS_TRANSITION", { from: ticket.status, to: status });
    ticket.status = status;
    const at = now();
    if (status === "preparing") ticket.startedAt = at;
    if (status === "ready") ticket.readyAt = at;
    if (status === "served") ticket.servedAt = at;
    return { data: ticket };
  });

  // ---------- Appointments (salons, clinics, laundries) ----------
  app.get("/api/v1/appointments", guard("appointments.manage"), async (request) => {
    const query = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), request.query);
    const data = [...store.appointments.values()]
      .filter((appointment) => !query.date || riyadhDate(appointment.startsAt) === query.date)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map((appointment) => ({ ...appointment, statusLabel: APPOINTMENT_STATUS_LABELS[appointment.status], staffName: store.staff.get(appointment.staffId)?.name }));
    return { data };
  });

  app.post("/api/v1/appointments", guard("appointments.manage"), async (request, reply) => {
    const body = parse(z.object({
      customerId: z.string().optional(), customerName: z.string().min(2).max(100), serviceProductId: z.string(), staffId: z.string(),
      startsAt: z.string().datetime(), durationMinutes: z.number().int().min(5).max(600), notes: z.string().max(500).optional()
    }), request.body);
    if (!store.products.has(body.serviceProductId)) fail(404, "SERVICE_NOT_FOUND");
    if (!store.staff.get(body.staffId)?.active) fail(404, "STAFF_NOT_FOUND");
    if (body.customerId && !store.customers.has(body.customerId)) fail(404, "CUSTOMER_NOT_FOUND");
    const appointment: Appointment = { id: newId(), ...body, status: "booked" };
    const conflict = findAppointmentConflict([...store.appointments.values()], appointment);
    if (conflict) fail(409, "APPOINTMENT_CONFLICT", { conflictingId: conflict.id, startsAt: conflict.startsAt });
    store.appointments.set(appointment.id, appointment);
    audit(ctx, request, "appointment.created", { type: "appointment", id: appointment.id });
    return reply.code(201).send({ data: appointment });
  });

  app.patch<{ Params: { id: string } }>("/api/v1/appointments/:id", guard("appointments.manage"), async (request) => {
    const appointment = store.appointments.get(request.params.id) ?? fail(404, "APPOINTMENT_NOT_FOUND");
    const body = parse(z.object({ status: z.enum(keys(APPOINTMENT_STATUS_LABELS)), orderId: z.string().optional() }), request.body);
    const status = body.status as AppointmentStatus;
    if (!canTransitionAppointment(appointment.status, status)) fail(409, "INVALID_STATUS_TRANSITION", { from: appointment.status, to: status });
    if (body.orderId && !store.orders.has(body.orderId)) fail(404, "ORDER_NOT_FOUND");
    appointment.status = status;
    if (body.orderId) appointment.orderId = body.orderId;
    audit(ctx, request, "appointment.status", { type: "appointment", id: appointment.id }, { status, by: actor(request).id });
    return { data: appointment };
  });
}
