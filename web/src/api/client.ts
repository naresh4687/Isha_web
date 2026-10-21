export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
    public details?: any,
  ) {
    super(message);
  }

  /** Flattened field errors from zod `flatten()` responses. */
  fieldErrors(): Record<string, string> {
    const fe = this.details?.fieldErrors ?? {};
    return Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, (v as string[])[0]]));
  }
}

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      ...rest,
      headers: {
        'X-Requested-With': 'fetch',
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError(0, 'Could not reach the store. Check your connection and try again.', 'network');
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(res.status, e?.message ?? `Request failed (${res.status})`, e?.code ?? 'error', e?.details);
  }
  return data as T;
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : '';
};
