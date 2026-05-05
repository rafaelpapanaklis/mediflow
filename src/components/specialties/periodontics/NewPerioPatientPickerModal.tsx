"use client";
// Periodontics — modal para escoger un paciente y empezar un sondaje.
// Acceso a un buscador con conteo de PeriodontalRecord previos por paciente.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, UserPlus, X } from "lucide-react";
import { useDebouncedCallback } from "@/hooks/use-debounced-callback";
import type { SearchablePatient } from "@/app/api/periodontics/searchable-patients/route";

export interface NewPerioPatientPickerModalProps {
  open: boolean;
  onClose: () => void;
}

export function NewPerioPatientPickerModal(props: NewPerioPatientPickerModalProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<SearchablePatient[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchPatients = useDebouncedCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/periodontics/searchable-patients${q ? `?q=${encodeURIComponent(q)}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { patients: SearchablePatient[] };
      setPatients(data.patients);
    } catch (e) {
      setError("No se pudo cargar la lista de pacientes.");
      setPatients([]);
    } finally {
      setLoading(false);
    }
  }, 200);

  // Carga inicial cuando abre el modal y reset cuando cierra.
  useEffect(() => {
    if (!props.open) {
      setQuery("");
      setPatients([]);
      setError(null);
      return;
    }
    fetchPatients("");
    // Foco al input
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, [props.open, fetchPatients]);

  // Cierre con Escape.
  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  const filtered = useMemo(() => patients, [patients]);

  if (!props.open) return null;

  const handleSelect = (id: string) => {
    props.onClose();
    router.push(`/dashboard/specialties/periodontics/${id}`);
  };

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="perio-picker-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
      className="fixed inset-0 z-[1500] flex items-start justify-center bg-black/60 px-4 py-12 backdrop-blur-sm"
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        style={{ maxHeight: "calc(100vh - 96px)" }}
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 id="perio-picker-title" className="text-base font-semibold text-foreground">
            Iniciar tratamiento periodontal
          </h2>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={props.onClose}
            className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X size={16} aria-hidden />
          </button>
        </header>

        <div className="border-b border-border px-5 py-3">
          <div className="relative">
            <Search
              size={14}
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                fetchPatients(e.target.value);
              }}
              placeholder="Buscar por nombre, teléfono, CURP, expediente…"
              className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>
        </div>

        <div className="overflow-y-auto" style={{ maxHeight: 460 }}>
          {error ? (
            <div className="px-5 py-6 text-center text-sm text-destructive">{error}</div>
          ) : loading && filtered.length === 0 ? (
            <div className="px-5 py-6 text-center text-sm text-muted-foreground">
              Cargando pacientes…
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              {query
                ? `Ningún paciente coincide con "${query}".`
                : "No hay pacientes activos en esta clínica."}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(p.id)}
                    className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-muted/60"
                  >
                    <span
                      aria-hidden
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold uppercase text-primary"
                    >
                      {initials(p.fullName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground">{p.fullName}</div>
                      <div className="text-xs text-muted-foreground">
                        {[p.age != null ? `${p.age} años` : null, p.phone].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                    <PerioRecordBadge count={p.perioRecordsCount} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          <span className="text-xs text-muted-foreground">
            {filtered.length > 0 ? `${filtered.length} paciente(s)` : ""}
          </span>
          <button
            type="button"
            onClick={() => {
              props.onClose();
              router.push("/dashboard/patients?new=true");
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted"
          >
            <UserPlus size={14} aria-hidden />
            Crear paciente nuevo
          </button>
        </footer>
      </div>
    </div>
  );
}

function PerioRecordBadge({ count }: { count: number }) {
  if (count === 0) {
    return (
      <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Sin sondaje
      </span>
    );
  }
  return (
    <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
      {count} sondaje{count === 1 ? "" : "s"}
    </span>
  );
}

function initials(fullName: string): string {
  return fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0] ?? "")
    .join("")
    .toUpperCase();
}
