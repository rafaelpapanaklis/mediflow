"use client";
import {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import toast from "react-hot-toast";
import type { ActiveConsult } from "@/hooks/use-active-consult";

export interface ActiveConsultContextValue {
  consult: ActiveConsult | null;
  loading: boolean;
  elapsedSeconds: number;
  startConsult: (patientId: string) => Promise<void>;
  endConsult: () => Promise<void>;
}

export const ActiveConsultContext =
  createContext<ActiveConsultContextValue | null>(null);

const COOKIE_NAME = "activeConsultId";
const CHANNEL_NAME = "mediflow:consult";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  const pairs = document.cookie.split(";");
  for (const p of pairs) {
    const s = p.trim();
    if (s.startsWith(prefix)) return decodeURIComponent(s.slice(prefix.length));
  }
  return null;
}

interface ApiGetResponse {
  consult:
    | null
    | {
        id: string;
        patientId: string;
        patientName: string;
        patientAge?: number;
        patientGender?: "F" | "M" | "O";
        patientAlerts: {
          allergies?: string[];
          medications?: string[];
          conditions?: string[];
        };
        startedAt: string;
      };
}

function parseConsult(raw: ApiGetResponse["consult"]): ActiveConsult | null {
  if (!raw) return null;
  return { ...raw, startedAt: new Date(raw.startedAt) };
}

type ConsultBroadcast =
  | { type: "start"; consult: ApiGetResponse["consult"] }
  | { type: "end" };

export function ActiveConsultProvider({ children }: { children: ReactNode }) {
  const [consult, setConsult] = useState<ActiveConsult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();

    const cookieId = readCookie(COOKIE_NAME);
    if (!cookieId) {
      setConsult(null);
      setLoading(false);
      return;
    }

    fetch("/api/dashboard/consultations/active", {
      signal: ac.signal,
      headers: { Accept: "application/json" },
      credentials: "include",
    })
      .then((r) => {
        if (r.status === 401) return { consult: null } as ApiGetResponse;
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ApiGetResponse>;
      })
      .then((data) => {
        if (cancelled) return;
        setConsult(parseConsult(data.consult));
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled || err?.name === "AbortError") return;
        setConsult(null);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, []);

  useEffect(() => {
    if (!consult) {
      setElapsedSeconds(0);
      return;
    }
    const compute = () =>
      Math.max(0, Math.floor((Date.now() - consult.startedAt.getTime()) / 1000));
    setElapsedSeconds(compute());
    const id = window.setInterval(() => setElapsedSeconds(compute()), 1000);
    return () => window.clearInterval(id);
  }, [consult]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = ch;

    ch.onmessage = (evt: MessageEvent<ConsultBroadcast>) => {
      const msg = evt.data;
      if (msg.type === "start") {
        setConsult(parseConsult(msg.consult));
      } else if (msg.type === "end") {
        setConsult(null);
      }
    };

    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, []);

  const startConsult = useCallback(async (patientId: string) => {
    try {
      const res = await fetch("/api/dashboard/consultations/active", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ patientId }),
      });
      if (res.status === 409) {
        toast.error("Ya hay una consulta activa. Termina la actual primero.");
        const data = (await res.json().catch(() => null)) as ApiGetResponse | null;
        if (data?.consult) setConsult(parseConsult(data.consult));
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ApiGetResponse;
      const parsed = parseConsult(data.consult);
      setConsult(parsed);
      channelRef.current?.postMessage({
        type: "start",
        consult: data.consult,
      } satisfies ConsultBroadcast);
    } catch (err) {
      toast.error("No se pudo iniciar la consulta. Intenta de nuevo.");
      console.error("[ActiveConsult] startConsult failed", err);
    }
  }, []);

  const endConsult = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/consultations/active", {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
      setConsult(null);
      channelRef.current?.postMessage({
        type: "end",
      } satisfies ConsultBroadcast);
    } catch (err) {
      toast.error("No se pudo cerrar la consulta. Intenta de nuevo.");
      console.error("[ActiveConsult] endConsult failed", err);
    }
  }, []);

  return (
    <ActiveConsultContext.Provider
      value={{ consult, loading, elapsedSeconds, startConsult, endConsult }}
    >
      {children}
    </ActiveConsultContext.Provider>
  );
}
