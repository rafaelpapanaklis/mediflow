"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, User, Calendar, Receipt, Loader2 } from "lucide-react";

interface PatientHit { id: string; firstName: string; lastName: string; patientNumber: string; phone: string | null }
interface AppointmentHit { id: string; date: string; startTime: string; patientName: string; doctorName: string; status: string }
interface InvoiceHit { id: string; folio: string; amount: number; status: string; date: string; patientName: string }
interface SearchResponse { patients: PatientHit[]; appointments: AppointmentHit[]; invoices: InvoiceHit[] }

interface FlatItem { kind: "patient" | "appointment" | "invoice"; href: string; title: string; subtitle: string; icon: typeof User }

interface Props { open: boolean; onClose: () => void }

export function CommandPalette({ open, onClose }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResponse>({ patients: [], appointments: [], invoices: [] });
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (open) {
      setQ("");
      setResults({ patients: [], appointments: [], invoices: [] });
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setResults({ patients: [], appointments: [], invoices: [] });
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/dashboard/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (res.ok) {
          const data = await res.json();
          setResults(data);
          setActiveIndex(0);
        }
      } catch (err: any) {
        if (err.name !== "AbortError") setResults({ patients: [], appointments: [], invoices: [] });
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [q, open]);

  const flat: FlatItem[] = [
    ...results.patients.map(p => ({
      kind: "patient" as const,
      href: `/dashboard/patients/${p.id}`,
      title: `${p.firstName} ${p.lastName}`,
      subtitle: `#${p.patientNumber}${p.phone ? ` · ${p.phone}` : ""}`,
      icon: User,
    })),
    ...results.appointments.map(a => ({
      kind: "appointment" as const,
      href: `/dashboard/appointments?focus=${a.id}`,
      title: a.patientName,
      subtitle: `${new Date(a.date).toLocaleDateString("es-MX", { day: "numeric", month: "short" })} · ${a.startTime} · ${a.doctorName}`,
      icon: Calendar,
    })),
    ...results.invoices.map(i => ({
      kind: "invoice" as const,
      href: `/dashboard/billing?focus=${i.id}`,
      title: `${i.folio} — ${i.patientName}`,
      subtitle: `$${i.amount.toLocaleString("es-MX")} · ${i.status}`,
      icon: Receipt,
    })),
  ];

  function navigate(href: string) {
    router.push(href);
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, flat.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter" && flat[activeIndex]) { e.preventDefault(); navigate(flat[activeIndex].href); }
  }

  if (!open) return null;

  let runningIdx = 0;
  const renderSection = (label: string, items: FlatItem[]) => {
    if (items.length === 0) return null;
    return (
      <div>
        <div style={{ padding: "10px 14px 6px", fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
          {label}
        </div>
        {items.map(item => {
          const idx = runningIdx++;
          const active = idx === activeIndex;
          const Icon = item.icon;
          return (
            <button
              key={`${item.kind}-${item.href}`}
              type="button"
              onClick={() => navigate(item.href)}
              onMouseEnter={() => setActiveIndex(idx)}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                width: "100%", padding: "10px 14px",
                background: active ? "rgba(124,58,237,0.12)" : "transparent",
                border: "none", cursor: "pointer", textAlign: "left",
                color: "var(--text-1)", fontFamily: "inherit",
              }}
            >
              <Icon size={16} style={{ color: "var(--text-3)", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.subtitle}</div>
              </div>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: "10vh",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        style={{
          width: "100%", maxWidth: 640,
          background: "var(--bg-elev)", border: "1px solid var(--border-strong)",
          borderRadius: 16, overflow: "hidden",
          boxShadow: "0 24px 60px -12px rgba(0,0,0,0.6)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
          <Search size={16} style={{ color: "var(--text-3)" }} />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Buscar pacientes, citas, facturas…"
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              fontSize: 15, color: "var(--text-1)", fontFamily: "inherit",
            }}
          />
          {loading && <Loader2 size={14} className="animate-spin" style={{ color: "var(--text-3)" }} />}
        </div>

        <div style={{ maxHeight: "60vh", overflowY: "auto", padding: "4px 0" }}>
          {q.trim().length < 2 ? (
            <div style={{ padding: 30, textAlign: "center", fontSize: 13, color: "var(--text-3)" }}>
              Empieza a escribir para buscar…
            </div>
          ) : loading && flat.length === 0 ? (
            <div style={{ padding: 30, textAlign: "center", fontSize: 13, color: "var(--text-3)" }}>
              Buscando…
            </div>
          ) : flat.length === 0 ? (
            <div style={{ padding: 30, textAlign: "center", fontSize: 13, color: "var(--text-3)" }}>
              Sin coincidencias para “{q}”
            </div>
          ) : (
            <>
              {renderSection("Pacientes", flat.filter(f => f.kind === "patient"))}
              {renderSection("Citas", flat.filter(f => f.kind === "appointment"))}
              {renderSection("Facturas", flat.filter(f => f.kind === "invoice"))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
