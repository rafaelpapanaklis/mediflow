"use client";

import { useEffect, useRef, useState } from "react";
import { Search, UserPlus, Check, Loader2 } from "lucide-react";
import { useNewPatientDialog } from "@/components/dashboard/new-patient/new-patient-provider";
import type { PatientSearchHit } from "@/lib/new-appointment/types";
import { useT } from "@/i18n/i18n-provider";

interface Props {
  value: { id: string; name: string } | null;
  onChange: (patient: { id: string; name: string } | null) => void;
}

export function PatientCombobox({ value, onChange }: Props) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PatientSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { open: openNewPatient } = useNewPatientDialog();

  useEffect(() => {
    if (value) return;
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/patients/search?q=${encodeURIComponent(query.trim())}`,
          { credentials: "include" },
        );
        if (res.ok) {
          const body = (await res.json()) as { hits: PatientSearchHit[] };
          setHits(body.hits);
          setActiveIndex(0);
        }
      } catch {
        /* noop */
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [query, value]);

  const triggerCreate = () => {
    console.log("[PatientCombobox] triggerCreate called with query:", query);
    setOpen(false);
    openNewPatient({
      initialName: query,
      onCreated: (p) => {
        console.log("[PatientCombobox] new patient created:", p);
        onChange(p);
        setQuery("");
      },
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    const total = hits.length + 1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % total);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + total) % total);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex < hits.length) {
        const hit = hits[activeIndex];
        onChange({ id: hit.id, name: hit.name });
        setOpen(false);
      } else {
        triggerCreate();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  if (value) {
    return (
      <div style={pickedRowStyle}>
        <Check size={14} style={{ color: "var(--success)" }} aria-hidden />
        <span style={{ flex: 1, fontSize: 13, color: "var(--text-1)", fontWeight: 500 }}>
          {value.name}
        </span>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setQuery("");
            window.setTimeout(() => inputRef.current?.focus(), 0);
          }}
          style={changeBtnStyle}
        >
          {t("appointments.patientCombobox.change")}
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: "relative", display: "flex", flexDirection: "column" }}>
      <div className="search-field" style={{ width: "100%" }}>
        <Search size={14} aria-hidden />
        <input
          ref={inputRef}
          type="text"
          placeholder={t("appointments.patientCombobox.searchPlaceholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Delay para que el onClick del button del hit (si el usuario click
            // un resultado) se procese antes del cierre. Sin delay, el blur
            // dispara setOpen(false) inmediatamente y el button se desmonta
            // antes del onClick → patient no se selecciona.
            console.log("[PatientCombobox] input onBlur — scheduling close in 250ms");
            setTimeout(() => {
              console.log("[PatientCombobox] closing dropdown after blur delay");
              setOpen(false);
            }, 250);
          }}
          onKeyDown={onKeyDown}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="patient-combobox-list"
        />
        {loading && (
          <Loader2 size={12} className="animate-spin" style={{ color: "var(--text-3)" }} />
        )}
      </div>

      <button
        type="button"
        onClick={triggerCreate}
        style={inlineCreateBtnStyle}
      >
        <UserPlus size={12} aria-hidden />
        <span>{t("appointments.patientCombobox.createNewPatient")}</span>
      </button>

      {open && (query.trim().length >= 2 || hits.length > 0) && (
        <div
          id="patient-combobox-list"
          role="listbox"
          style={dropdownStyle}
        >
          {hits.length === 0 && !loading && (
            <div style={{ padding: "12px 14px", fontSize: 12, color: "var(--text-3)" }}>
              {t("appointments.patientCombobox.noPatientFound", { query })}
            </div>
          )}
          {hits.map((hit, i) => (
            <button
              key={hit.id}
              type="button"
              role="option"
              aria-selected={activeIndex === i}
              onClick={() => {
                console.log("[PatientCombobox] HIT CLICK:", hit.id, hit.name);
                onChange({ id: hit.id, name: hit.name });
                console.log("[PatientCombobox] onChange called, closing dropdown");
                setOpen(false);
              }}
              onMouseEnter={() => setActiveIndex(i)}
              style={{
                ...itemStyle,
                background: activeIndex === i ? "var(--bg-hover)" : "transparent",
              }}
            >
              <div style={{ flex: 1, textAlign: "left" }}>
                <div style={{ fontSize: 13, color: "var(--text-1)", fontWeight: 500 }}>
                  {hit.name}
                </div>
                {hit.phone && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-3)",
                      fontFamily: "var(--font-mono, monospace)",
                      marginTop: 2,
                    }}
                  >
                    {hit.phone}
                  </div>
                )}
              </div>
            </button>
          ))}

          <button
            type="button"
            onClick={triggerCreate}
            onMouseEnter={() => setActiveIndex(hits.length)}
            style={{
              ...itemStyle,
              borderTop: "1px solid var(--border-soft)",
              background: activeIndex === hits.length ? "var(--bg-hover)" : "transparent",
              color: "var(--brand)",
              fontWeight: 500,
            }}
          >
            <UserPlus size={14} aria-hidden />
            <span style={{ flex: 1, textAlign: "left", fontSize: 13 }}>
              {query
                ? t("appointments.patientCombobox.createNewPatientWithQuery", { query })
                : t("appointments.patientCombobox.createNewPatient")}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

const pickedRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 12px",
  background: "var(--bg-elev-2)",
  border: "1px solid var(--border-soft)",
  borderRadius: 8,
};

const changeBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--brand)",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "inherit",
};

const dropdownStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  right: 0,
  maxHeight: 280,
  overflowY: "auto",
  background: "var(--bg-elev)",
  border: "1px solid var(--border-strong)",
  borderRadius: 10,
  boxShadow: "0 12px 32px -8px rgba(15,10,30,0.25)",
  zIndex: 90,
  display: "flex",
  flexDirection: "column",
};

const itemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 12px",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  fontFamily: "inherit",
};

const inlineCreateBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  marginTop: 6,
  padding: "6px 10px",
  background: "transparent",
  border: "1px dashed var(--border-soft)",
  borderRadius: 8,
  color: "var(--brand)",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "inherit",
  alignSelf: "flex-start",
};
