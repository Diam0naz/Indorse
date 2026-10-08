/**
 * test/h2-double.ts — a fake `node:http2` for the Gemini-backed routes
 *
 * `classifyWithGemini` talks to Google through `h2Fetch`, a hand-rolled
 * HTTP/2 client in `api/_lib/gemini.ts`. Stubbing `node:http2` lets a route
 * test drive the REAL transport — connect, request headers, status line,
 * body assembly, error and timeout paths — with no network involved, which
 * is the layer `POST /api/classify-gemini` actually talks to (see the test
 * strategy in README).
 *
 * Responses are scripted per test through `h2.state`; `connects` and
 * `requests` record what the client under test actually did.
 *
 * Usage (the dynamic import matters — the `vi.mock` factory may run before
 * this module is otherwise evaluated):
 *
 *   vi.mock('node:http2', async () => ({ connect: (await import('./test/h2-double')).connect }))
 *   import { h2 } from './test/h2-double'
 */

export interface H2State {
  status: number
  body: string
  error: Error | null
  /** Simulate a request that never gets a response frame (→ timeout path). */
  noResponse: boolean
  connects: string[]
  requests: Array<{ headers: Record<string, string>; body: string }>
}

export interface H2Double {
  state: H2State
  connect: (authority: string) => unknown
}

function createDouble(): H2Double {
  const state: H2State = {
    status: 200,
    body: '{}',
    error: null,
    noResponse: false,
    connects: [],
    requests: [],
  }

  const client = {
    on: () => client,
    close: () => {},
    destroy: () => {},
    request(headers: Record<string, string>) {
      const handlers: Record<string, Array<(...args: unknown[]) => void>> = {}
      const fire = (event: string, ...args: unknown[]) => {
        for (const callback of handlers[event] ?? []) callback(...args)
      }
      return {
        on(event: string, callback: (...args: unknown[]) => void) {
          ;(handlers[event] ||= []).push(callback)
          return this
        },
        setEncoding: () => {},
        end(body: string) {
          state.requests.push({ headers, body })
          if (state.noResponse) return
          queueMicrotask(() => {
            if (state.error) {
              fire('error', state.error)
              return
            }
            fire('response', { ':status': state.status })
            if (state.body) fire('data', state.body)
            fire('end')
          })
        },
      }
    },
  }

  const connect = (authority: string) => {
    state.connects.push(authority)
    return client
  }

  return { state, connect }
}

export const h2: H2Double = createDouble()

/** Script a buffered `generateContent` reply — verdict JSON in `candidates`. */
export function scriptGeminiVerdict(verdict: {
  label: string
  confidence: number
  severity: string
  notes: string
}): void {
  h2.state.status = 200
  h2.state.body = JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(verdict) }] } }] })
}
