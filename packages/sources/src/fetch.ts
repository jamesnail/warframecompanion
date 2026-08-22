/**
 * Network layer for the pipeline. Node-only.
 *
 * Network flake must never commit a truncated dataset, so every fetch retries with
 * exponential backoff behind a hard timeout, and exhausting the retries throws rather
 * than returning a partial result (CLAUDE.md § The pipeline is the product).
 */

export interface FetchOptions {
  /** Hard ceiling per attempt. */
  timeoutMs?: number
  retries?: number
  /** Base for exponential backoff; attempt n waits baseDelayMs * 2^n. */
  baseDelayMs?: number
}

const DEFAULTS = { timeoutMs: 60_000, retries: 4, baseDelayMs: 500 } as const

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const { timeoutMs, retries, baseDelayMs } = { ...DEFAULTS, ...options }

  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = baseDelayMs * 2 ** (attempt - 1)
      console.warn(`  retry ${attempt}/${retries} in ${delay}ms — ${url}`)
      await sleep(delay)
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'user-agent': 'provenance-pipeline (+https://github.com/jamesnail/warframecompanion)' },
      })
      if (!response.ok) {
        throw new Error(`HTTP ${String(response.status)} ${response.statusText}`)
      }
      return await response.text()
    } catch (error) {
      lastError = error
    } finally {
      clearTimeout(timer)
    }
  }

  throw new Error(`Failed to fetch ${url} after ${String(retries + 1)} attempts`, {
    cause: lastError,
  })
}

export async function fetchJson<T>(url: string, options?: FetchOptions): Promise<T> {
  const body = await fetchText(url, options)
  try {
    return JSON.parse(body) as T
  } catch (error) {
    throw new Error(`Response from ${url} was not valid JSON`, { cause: error })
  }
}
