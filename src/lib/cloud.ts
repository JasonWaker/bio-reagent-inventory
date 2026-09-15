import type { AppState, RecognitionDraft } from "../types";

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(
    /\/$/,
    "",
  ) ?? "";

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  if (!API_BASE) throw new Error("云端 API 尚未配置");
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const value = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(value.error ?? "云端请求失败");
  return value as T;
}

export const cloudEnabled = Boolean(API_BASE);
export const cloudLogin = (username: string, password: string) =>
  request<{ token: string; mustChangePassword: boolean }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
export const cloudChangePassword = (token: string, password: string) =>
  request<{ token: string }>(
    "/auth/change-password",
    { method: "POST", body: JSON.stringify({ password }) },
    token,
  );
export const cloudReadState = (token: string) =>
  request<{ state: AppState; revision: number }>("/state", {}, token);
export const cloudWriteState = (
  token: string,
  state: AppState,
  expectedRevision: number,
) =>
  request<{ revision: number }>(
    "/state",
    { method: "PUT", body: JSON.stringify({ state, expectedRevision }) },
    token,
  );
export const cloudRecognize = (
  token: string,
  kind: "inbound" | "outbound",
  image: File,
) => {
  const body = new FormData();
  body.append("image", image);
  return request<RecognitionDraft>(
    `/recognition/${kind}`,
    { method: "POST", body },
    token,
  );
};
