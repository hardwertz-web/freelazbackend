// Cliente HTTP mínimo para as telas (client components). Sempre same-origin:
// o cookie de sessão (`freelaz_session`) viaja automaticamente.
//
// Importante: nenhuma resposta é engolida — todo erro vira { ok: false } com
// a mensagem que a API mandou, para a tela exibir o motivo real.

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    return { ok: false, status: 0, error: "Falha de conexão com o servidor" };
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Erro ${response.status}`;
    return { ok: false, status: response.status, error: message };
  }

  return { ok: true, status: response.status, data: (payload ?? {}) as T };
}

export function apiGet<T>(path: string): Promise<ApiResult<T>> {
  return request<T>(path);
}

export function apiPost<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export function apiPut<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  return request<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

export function apiPatch<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
  return request<T>(path, {
    method: "PATCH",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
