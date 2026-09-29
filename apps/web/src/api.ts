import { errorText } from "./i18n";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(public status: number, public code: string, public body: Record<string, unknown> = {}) {
    super(errorText(code));
  }
}

let token: string | null = null;
/** Branch this till works at; sent on every request so stock, shifts and kitchen are scoped to it. */
let branchId: string | null = null;
export const setBranch = (value: string | null) => { branchId = value; };
export const currentBranch = () => branchId;
let onUnauthorized: () => void = () => undefined;

export function setSession(value: string | null, unauthorized?: () => void) {
  token = value;
  if (unauthorized) onUnauthorized = unauthorized;
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(branchId ? { "x-branch-id": branchId } : {}),
        ...init.headers
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined
    });
  } catch {
    throw new ApiError(0, "NETWORK");
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    if (response.status === 401 && token) onUnauthorized();
    throw new ApiError(response.status, body.error ?? `HTTP_${response.status}`, body);
  }
  return body as T;
}

export async function download(path: string, filename: string) {
  const response = await fetch(`${API_URL}${path}`, { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(branchId ? { "x-branch-id": branchId } : {}) } });
  if (!response.ok) throw new ApiError(response.status, `HTTP_${response.status}`);
  const url = URL.createObjectURL(await response.blob());
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  link.click();
  URL.revokeObjectURL(url);
}

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : errorText("UNEXPECTED"));
