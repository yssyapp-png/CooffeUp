import type { FastifyRequest } from "fastify";

export function managerIdentity(request: FastifyRequest) {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_LEGACY_MANAGER_APPROVAL !== "true") return null;
  const configuredToken = process.env.MANAGER_APPROVAL_TOKEN;
  const token = request.headers["x-manager-approval-token"];
  const actorId = request.headers["x-actor-id"];
  const role = request.headers["x-actor-role"];
  if (!configuredToken || token !== configuredToken || role !== "manager" || typeof actorId !== "string" || !actorId.trim()) return null;
  return actorId.trim();
}
