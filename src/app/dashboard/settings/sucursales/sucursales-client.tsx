"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, Users, AlertTriangle } from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import {
  PATIENT_SHARING_ENABLED,
  clinicPairKey,
  type ClinicPatientLinkRow,
  type OwnedBranchRow,
} from "@/lib/branches-shared";

interface Props {
  branches: OwnedBranchRow[];
  initialLinks: ClinicPatientLinkRow[];
  activeClinicId: string;
}

/** Un par de sedes con su estado de vínculo. */
interface PairRow {
  key: string;
  a: OwnedBranchRow;
  b: OwnedBranchRow;
  linkId: string | null;
}

/**
 * MULTI-CLÍNICA · FASE 2 — matriz de "qué sedes comparten pacientes".
 *
 * Se listan TODOS los pares posibles de sedes del dueño y cada uno tiene un
 * switch. El estado real vive en la BD (ClinicPatientLink); aquí sólo se
 * refleja y se muta vía /api/clinics/links, que revalida la pertenencia de
 * ambas sedes contra la sesión antes de escribir.
 */
export function SucursalesClient({ branches, initialLinks, activeClinicId }: Props) {
  const t = useT();
  const [links, setLinks] = useState<ClinicPatientLinkRow[]>(initialLinks);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Todos los pares no ordenados (i < j). Con maxClinics=3 son 3 filas; el
  // crecimiento es cuadrático pero el cupo del plan lo mantiene chico.
  const pairs = useMemo<PairRow[]>(() => {
    const out: PairRow[] = [];
    for (let i = 0; i < branches.length; i++) {
      for (let j = i + 1; j < branches.length; j++) {
        const a = branches[i];
        const b = branches[j];
        const key = clinicPairKey(a.clinicId, b.clinicId);
        const found = links.filter(
          (l) => clinicPairKey(l.clinicAId, l.clinicBId) === key,
        )[0];
        out.push({ key, a, b, linkId: found ? found.id : null });
      }
    }
    return out;
  }, [branches, links]);

  async function togglePair(pair: PairRow) {
    if (busyKey) return;
    setBusyKey(pair.key);
    try {
      if (pair.linkId) {
        const res = await fetch(`/api/clinics/links/${pair.linkId}`, {
          method: "DELETE",
          credentials: "include",
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error ?? t("settings.branches.errUnlink"));
        setLinks((prev) => prev.filter((l) => l.id !== pair.linkId));
        toast.success(t("settings.branches.unlinked"));
      } else {
        const res = await fetch("/api/clinics/links", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ clinicAId: pair.a.clinicId, clinicBId: pair.b.clinicId }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error ?? t("settings.branches.errLink"));
        if (payload.link) setLinks((prev) => [...prev, payload.link]);
        toast.success(t("settings.branches.linked"));
      }
    } catch (err: any) {
      toast.error(err?.message ?? t("settings.branches.errLink"));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 4px" }}>
      <Link
        href="/dashboard/settings"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: "var(--text-3)",
          marginBottom: 14,
        }}
      >
        <ArrowLeft size={14} aria-hidden />
        {t("settings.branches.back")}
      </Link>

      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
        {t("settings.branches.title")}
      </h1>
      <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5, marginBottom: 18 }}>
        {t("settings.branches.subtitle")}
      </p>

      {!PATIENT_SHARING_ENABLED && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "10px 12px",
            marginBottom: 16,
            border: "1px dashed var(--border-strong)",
            borderRadius: 10,
            fontSize: 12,
            color: "var(--text-2)",
            lineHeight: 1.5,
          }}
        >
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />
          <span>{t("settings.branches.disabledNotice")}</span>
        </div>
      )}

      {/* Lista de sedes — contexto para el dueño antes de la matriz. */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
          {t("settings.branches.myBranches")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {branches.map((b) => (
            <div
              key={b.clinicId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 12px",
                border: "1px solid var(--border)",
                borderRadius: 10,
                fontSize: 13,
                minWidth: 0,
              }}
            >
              <Building2 size={14} style={{ color: "var(--text-3)", flexShrink: 0 }} aria-hidden />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {b.clinicName}
              </span>
              {b.clinicId === activeClinicId && (
                <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-3)", flexShrink: 0 }}>
                  {t("sidebar.current")}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Matriz de pares */}
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
        {t("settings.branches.sharingTitle")}
      </div>

      {pairs.length === 0 ? (
        <div
          style={{
            padding: "14px 12px",
            border: "1px dashed var(--border-strong)",
            borderRadius: 10,
            fontSize: 13,
            color: "var(--text-3)",
            lineHeight: 1.5,
          }}
        >
          {t("settings.branches.needTwo")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {pairs.map((pair) => {
            const on = pair.linkId !== null;
            const busy = busyKey === pair.key;
            return (
              <div
                key={pair.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 10,
                  padding: "11px 13px",
                  border: `1px solid ${on ? "var(--brand-soft, var(--border-strong))" : "var(--border)"}`,
                  borderRadius: 10,
                  minWidth: 0,
                }}
              >
                <Users size={15} style={{ color: "var(--text-3)", flexShrink: 0 }} aria-hidden />
                <div style={{ flex: "1 1 220px", minWidth: 0, fontSize: 13, lineHeight: 1.45 }}>
                  <span style={{ fontWeight: 600 }}>{pair.a.clinicName}</span>
                  <span style={{ color: "var(--text-3)", margin: "0 6px" }}>↔</span>
                  <span style={{ fontWeight: 600 }}>{pair.b.clinicName}</span>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                    {on ? t("settings.branches.stateShared") : t("settings.branches.stateIsolated")}
                  </div>
                </div>
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    flexShrink: 0,
                    cursor: busy ? "wait" : "pointer",
                    opacity: busy ? 0.6 : 1,
                    fontSize: 12,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={busy}
                    onChange={() => togglePair(pair)}
                    style={{ width: 16, height: 16, cursor: busy ? "wait" : "pointer" }}
                  />
                  {t("settings.branches.sharePatients")}
                </label>
              </div>
            );
          })}
        </div>
      )}

      <p style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.55, marginTop: 16 }}>
        {t("settings.branches.footnote")}
      </p>
    </div>
  );
}
