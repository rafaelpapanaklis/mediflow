"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X, UserPlus, AlertTriangle } from "lucide-react";
import { useDebouncedCallback } from "@/hooks/use-debounced-callback";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import {
  searchPatientsForSpecialty,
  type SpecialtySlug,
  type SpecialtyPatientResult,
} from "@/app/actions/specialties/searchPatients";

const TAB_SLUG: Record<SpecialtySlug, string> = {
  orthodontics: "ortodoncia",
  endodontics: "endodoncia",
  periodontics: "periodoncia",
  implants: "implantes",
  pediatrics: "pediatria",
};

const TITLE: Record<SpecialtySlug, string> = {
  orthodontics: "Iniciar tratamiento ortodóntico",
  endodontics: "Iniciar tratamiento endodóntico",
  periodontics: "Iniciar evaluación periodontal",
  implants: "Iniciar plan de implantes",
  pediatrics: "Iniciar registro pediátrico",
};

const COUNT_LABEL: Record<SpecialtySlug, (n: number) => string> = {
  orthodontics: (n) => (n === 0 ? "Sin diagnósticos" : `${n} diagnóstico${n === 1 ? "" : "s"}`),
  endodontics: (n) => (n === 0 ? "Sin TCs" : `${n} TC${n === 1 ? "" : "s"}`),
  periodontics: (n) => (n === 0 ? "Sin sondaje" : `${n} sondaje${n === 1 ? "" : "s"}`),
  implants: (n) => (n === 0 ? "Sin implantes" : `${n} implante${n === 1 ? "" : "s"}`),
  pediatrics: () => "",
};

export interface PatientSearchModalProps {
  open: boolean;
  onClose: () => void;
  specialty: SpecialtySlug;
}

export function PatientSearchModal({ open, onClose, specialty }: PatientSearchModalProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SpecialtyPatientResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adultConfirm, setAdultConfirm] = useState<SpecialtyPatientResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchPatients = useDebouncedCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await searchPatientsForSpecialty({ specialty, q });
      if (res.ok) setResults(res.results);
    } catch {
      setError("No se pudo cargar la lista de pacientes.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, 200);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setError(null);
      setAdultConfirm(null);
      return;
    }
    fetchPatients("");
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [open, fetchPatients]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (adultConfirm) setAdultConfirm(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, adultConfirm, onClose]);

  if (!open) return null;

  const navigate = (patientId: string) => {
    onClose();
    router.push(`/dashboard/patients/${patientId}?tab=${TAB_SLUG[specialty]}&action=new`);
  };

  const handleSelect = (p: SpecialtyPatientResult) => {
    if (specialty === "pediatrics" && p.isAdult) {
      setAdultConfirm(p);
      return;
    }
    navigate(p.id);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="psm-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1500,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(2px)",
        padding: "48px 16px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 640,
          background: "var(--surface-1)",
          color: "var(--text-1)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "0 16px 48px rgba(0,0,0,0.35)",
          overflow: "hidden",
          maxHeight: "calc(100vh - 96px)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <h2 id="psm-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
            {TITLE[specialty]}
          </h2>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            style={{
              border: 0,
              background: "transparent",
              color: "var(--text-3)",
              cursor: "pointer",
              padding: 4,
              borderRadius: 6,
            }}
          >
            <X size={16} aria-hidden />
          </button>
        </header>

        <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ position: "relative" }}>
            <Search
              size={14}
              aria-hidden
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-3)",
                pointerEvents: "none",
              }}
            />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                fetchPatients(e.target.value);
              }}
              placeholder="Buscar por nombre, teléfono o email…"
              style={{
                width: "100%",
                padding: "8px 12px 8px 34px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--surface-2)",
                color: "var(--text-1)",
                fontSize: 13,
                outline: "none",
              }}
            />
          </div>
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {error ? (
            <div style={{ padding: "24px 18px", textAlign: "center", fontSize: 13, color: "var(--danger, #b91c1c)" }}>
              {error}
            </div>
          ) : loading && results.length === 0 ? (
            <div style={{ padding: "24px 18px", textAlign: "center", fontSize: 13, color: "var(--text-3)" }}>
              Cargando pacientes…
            </div>
          ) : results.length === 0 ? (
            <div style={{ padding: "32px 18px", textAlign: "center", fontSize: 13, color: "var(--text-3)" }}>
              {query
                ? `Ningún paciente coincide con "${query}".`
                : "No hay pacientes activos en esta clínica."}
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {results.map((p) => (
                <li key={p.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <button
                    type="button"
                    onClick={() => handleSelect(p)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      width: "100%",
                      padding: "10px 18px",
                      border: 0,
                      background: "transparent",
                      color: "var(--text-1)",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--surface-2)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <AvatarNew name={p.fullName} size="sm" />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{p.fullName}</div>
                      <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                        {[p.ageYears != null ? `${p.ageYears} años` : null, p.phone || p.email]
                          .filter(Boolean)
                          .join(" · ") || "Sin contacto"}
                      </div>
                    </div>
                    {specialty === "pediatrics" ? (
                      p.isAdult ? (
                        <BadgeNew tone="warning">Mayor de 18</BadgeNew>
                      ) : null
                    ) : (
                      <BadgeNew tone={p.existingCount > 0 ? "info" : "neutral"}>
                        {COUNT_LABEL[specialty](p.existingCount)}
                      </BadgeNew>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            {results.length > 0 ? `${results.length} paciente${results.length === 1 ? "" : "s"}` : ""}
          </span>
          <button
            type="button"
            onClick={() => {
              onClose();
              router.push("/dashboard/patients?new=true");
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--surface-2)",
              color: "var(--text-1)",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            <UserPlus size={14} aria-hidden />
            Crear paciente nuevo
          </button>
        </footer>
      </div>

      {adultConfirm && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="psm-confirm-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAdultConfirm(null);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1600,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.5)",
            padding: 16,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              background: "var(--surface-1)",
              color: "var(--text-1)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              boxShadow: "0 16px 48px rgba(0,0,0,0.35)",
              padding: 18,
            }}
          >
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div
                aria-hidden
                style={{
                  flexShrink: 0,
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: "var(--warning-bg, rgba(245,158,11,0.15))",
                  color: "var(--warning, #b45309)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <AlertTriangle size={18} aria-hidden />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h3 id="psm-confirm-title" style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
                  Paciente mayor de edad
                </h3>
                <p style={{ marginTop: 6, fontSize: 12, color: "var(--text-2)" }}>
                  {adultConfirm.fullName} cumplió {adultConfirm.ageYears} años. ¿Continuar registro
                  pediátrico?
                </p>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button
                type="button"
                onClick={() => setAdultConfirm(null)}
                style={{
                  padding: "6px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  background: "var(--surface-2)",
                  color: "var(--text-1)",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                No
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = adultConfirm.id;
                  setAdultConfirm(null);
                  navigate(id);
                }}
                style={{
                  padding: "6px 12px",
                  border: "1px solid var(--brand, #6366f1)",
                  borderRadius: 6,
                  background: "var(--brand, #6366f1)",
                  color: "white",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                Sí, continuar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
