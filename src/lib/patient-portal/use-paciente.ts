"use client";

// Hook SWR del portal del paciente. Implementa A10.
// Requisito "lo ve al instante": revalidateOnFocus: true + refreshInterval 20s.
// Si el fetch devuelve 401 → redirige a /paciente/login?next=<ruta actual>.
import useSWR from "swr";

export interface PacienteSWR<T> {
  data: T | undefined;
  error: unknown;
  isLoading: boolean;
  mutate: () => void;
}

/**
 * Fetcher del portal: cookies same-origin, 401 → login con ?next=, errores
 * con el mensaje del body si el endpoint lo manda.
 */
async function pacienteFetcher(url: string) {
  const res = await fetch(url, { credentials: "same-origin" });

  if (res.status === 401) {
    if (typeof window !== "undefined") {
      window.location.assign(
        `/paciente/login?next=${encodeURIComponent(window.location.pathname)}`
      );
    }
    throw new Error("Tu sesión expiró. Inicia sesión de nuevo.");
  }

  if (!res.ok) {
    let message = `Error ${res.status}`;
    try {
      const body = await res.json();
      if (body && typeof body.error === "string" && body.error) {
        message = body.error;
      }
    } catch {
      /* body no-JSON: se queda el mensaje genérico */
    }
    throw new Error(message);
  }

  return res.json();
}

/**
 * useSWR tipado para /api/paciente/*. `url` null desactiva el fetch.
 * Config: { revalidateOnFocus: true, refreshInterval: 20_000 }.
 */
export function usePacienteData<T>(url: string | null): PacienteSWR<T> {
  const { data, error, isLoading, mutate } = useSWR<T>(url, pacienteFetcher, {
    revalidateOnFocus: true,
    refreshInterval: 20_000,
  });

  return { data, error, isLoading, mutate } as PacienteSWR<T>;
}
