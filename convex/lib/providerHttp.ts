import { internal } from "../_generated/api"
import type { ActionCtx } from "../_generated/server"

type Provider = "zernio" | "fetchlayer"

export class ProviderHttpError extends Error {
  status: number
  body: unknown
  provider: Provider
  endpoint: string
  retryable: boolean
  retryAfterMs?: number

  constructor(
    provider: Provider,
    endpoint: string,
    status: number,
    body: unknown,
    options: { message?: string; retryable?: boolean; retryAfterMs?: number } = {},
  ) {
    const message =
      options.message ??
      (typeof body === "object" && body !== null && "error" in body
        ? String((body as { error?: unknown }).error)
        : `${provider} request failed with status ${status}`)
    super(message)
    this.name = "ProviderHttpError"
    this.status = status
    this.body = body
    this.provider = provider
    this.endpoint = endpoint
    this.retryable =
      options.retryable ?? [408, 425, 429, 500, 502, 503, 504].includes(status)
    this.retryAfterMs = options.retryAfterMs
  }
}

function parseRetryAfterMs(value: string | null) {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined
}

function parseRateLimitResetMs(value: string | null) {
  if (!value) return undefined
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return parseRetryAfterMs(value)
  const timestamp = numeric > 10_000_000_000 ? numeric : numeric * 1000
  return Math.max(0, timestamp - Date.now())
}

async function readResponseBody(response: Response) {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function shortBodyError(body: unknown) {
  if (typeof body === "string") return body.slice(0, 500)
  if (body && typeof body === "object" && "error" in body) {
    return String((body as { error?: unknown }).error).slice(0, 500)
  }
  return undefined
}

export async function providerFetchJson<T>(
  ctx: ActionCtx,
  provider: Provider,
  endpoint: string,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = 10_000,
): Promise<T> {
  const requestedAt = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(input, { ...init, signal: controller.signal })
    const body = await readResponseBody(response)

    if (!response.ok) {
      const durationMs = Date.now() - requestedAt
      void ctx.runMutation(internal.providerRequestLog.log, {
        provider,
        endpoint,
        status: response.status,
        ok: false,
        durationMs,
        error: shortBodyError(body),
        requestedAt,
      }).catch(() => null)
      const retryAfterMs =
        parseRetryAfterMs(response.headers.get("Retry-After")) ??
        parseRateLimitResetMs(response.headers.get("X-RateLimit-Reset"))
      throw new ProviderHttpError(provider, endpoint, response.status, body, {
        retryAfterMs,
      })
    }

    return body as T
  } catch (error) {
    if (error instanceof ProviderHttpError) throw error

    const message =
      error instanceof DOMException && error.name === "AbortError"
        ? `${provider} ${endpoint} timed out`
        : error instanceof Error
          ? error.message
          : `${provider} ${endpoint} failed`
    void ctx.runMutation(internal.providerRequestLog.log, {
      provider,
      endpoint,
      ok: false,
      durationMs: Date.now() - requestedAt,
      error: message.slice(0, 500),
      requestedAt,
    }).catch(() => null)
    throw new ProviderHttpError(
      provider,
      endpoint,
      0,
      { error: message },
      { message, retryable: true },
    )
  } finally {
    clearTimeout(timer)
  }
}
