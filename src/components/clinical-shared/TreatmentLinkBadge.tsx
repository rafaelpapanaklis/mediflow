"use client";
// Clinical-shared — badge que muestra a qué TreatmentSession quedó
// vinculada una entidad del módulo, y permite vincularla on-demand si
// está pendiente.

import { useEffect, useState } from "react";
import { Link2, Link2Off } from "lucide-react";
import {
  findTreatmentLinksFor,
  linkSessionToTreatmentPlan,
  listOpenTreatmentSessions,
} from "@/app/actions/clinical-shared/treatment-links";
import { isFailure } from "@/lib/clinical-shared/result";
import type { ClinicalModule } from "@prisma/client";

export interface TreatmentLinkBadgeProps {
  patientId: string;
  module: ClinicalModule;
  moduleEntityType: string;
  moduleSessionId: string;
}

interface Linked {
  linkId: string;
  sessionNumber: number;
  treatmentPlanId: string;
}

interface OpenSession {
  treatmentSessionId: string;
  treatmentPlanId: string;
  planName: string;
  sessionNumber: number;
}

export function TreatmentLinkBadge(props: TreatmentLinkBadgeProps) {
  const [linked, setLinked] = useState<Linked[]>([]);
  const [open, setOpen] = useState<OpenSession[]>([]);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    const linksRes = await findTreatmentLinksFor({
      moduleEntityType: props.moduleEntityType,
      moduleSessionId: props.moduleSessionId,
    });
    if (!isFailure(linksRes)) {
      setLinked(
        linksRes.data.map((l) => ({
          linkId: l.linkId,
          sessionNumber: l.sessionNumber,
          treatmentPlanId: l.treatmentPlanId,
        })),
      );
    }
    const openRes = await listOpenTreatmentSessions({ patientId: props.patientId });
    if (!isFailure(openRes)) setOpen(openRes.data);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.moduleEntityType, props.moduleSessionId, props.patientId]);

  const onLink = async (treatmentSessionId: string) => {
    setError(null);
    const r = await linkSessionToTreatmentPlan({
      module: props.module,
      moduleEntityType: props.moduleEntityType,
      moduleSessionId: props.moduleSessionId,
      treatmentSessionId,
    });
    if (isFailure(r)) {
      setError(r.error);
      return;
    }
    setPickerVisible(false);
    await reload();
  };

  if (linked.length > 0) {
    return (
      <span style={badgeLinkedStyle} title="Vinculado a plan de tratamiento">
        <Link2 size={11} aria-hidden /> Plan #{linked[0]?.sessionNumber}
        {linked.length > 1 ? ` +${linked.length - 1}` : ""}
      </span>
    );
  }

  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        onClick={() => setPickerVisible((v) => !v)}
        style={badgePendingStyle}
        aria-label="Vincular a plan de tratamiento"
      >
        <Link2Off size={11} aria-hidden /> Sin plan
      </button>
      {pickerVisible ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 60,
            minWidth: 240,
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            padding: 4,
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          {open.length === 0 ? (
            <div style={{ padding: 8, fontSize: 11, color: "var(--text-2)" }}>
              No hay sesiones abiertas en planes activos.
            </div>
          ) : (
            open.map((s) => (
              <button
                key={s.treatmentSessionId}
                type="button"
                onClick={() => void onLink(s.treatmentSessionId)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  width: "100%",
                  padding: "6px 8px",
                  background: "transparent",
                  border: "none",
                  textAlign: "left",
                  fontSize: 11,
                  color: "var(--text-1)",
                  cursor: "pointer",
                  borderRadius: 4,
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--surface-2)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <strong>{s.planName}</strong>
                <span style={{ color: "var(--text-2)" }}>
                  Sesión #{s.sessionNumber}
                </span>
              </button>
            ))
          )}
          {error ? (
            <div
              role="alert"
              style={{ padding: 6, fontSize: 11, color: "var(--danger)" }}
            >
              {error}
            </div>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}

const badgeLinkedStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  fontSize: 10,
  padding: "2px 6px",
  borderRadius: 10,
  background: "var(--success-surface, #dcfce7)",
  color: "var(--success, #15803d)",
  border: "1px solid var(--success-border, #86efac)",
};

const badgePendingStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  fontSize: 10,
  padding: "2px 6px",
  borderRadius: 10,
  background: "var(--surface-2)",
  color: "var(--text-2)",
  border: "1px dashed var(--border)",
  cursor: "pointer",
};
