"use client";
// Periodontics — sub-tab Cirugías. Lista cronológica + acceso a consentimiento.
// SPEC §6.1.

export interface CirugiasTabProps {
  surgeries: Array<{
    id: string;
    surgeryDate: string;
    surgeryType: string;
    teeth: number[];
    sutureRemovalDate?: string | null;
    hasConsent: boolean;
    onSignConsent?: () => void;
  }>;
  onCreateSurgery?: () => void;
}

export function CirugiasTab(props: CirugiasTabProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ fontSize: 11, textTransform: "uppercase", color: "var(--text-2)", margin: 0 }}>
          Cirugías periodontales ({props.surgeries.length})
        </h3>
        {props.onCreateSurgery ? (
          <button
            type="button"
            onClick={props.onCreateSurgery}
            style={{
              padding: "6px 12px",
              fontSize: 11,
              borderRadius: 4,
              border: "1px solid var(--brand)",
              background: "var(--brand)",
              color: "white",
              cursor: "pointer",
            }}
          >
            + Nueva cirugía
          </button>
        ) : null}
      </header>

      {props.surgeries.length === 0 ? (
        <div
          style={{
            padding: 24,
            textAlign: "center",
            color: "var(--text-3)",
            background: "var(--bg-elev)",
            border: "1px dashed var(--border)",
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          Aún no hay cirugías periodontales registradas.
        </div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
          {props.surgeries.map((s) => (
            <li
              key={s.id}
              style={{
                padding: 12,
                background: "var(--bg-elev)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>
                  {humanizeSurgeryType(s.surgeryType)}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                  {s.surgeryDate} · Dientes: {s.teeth.join(", ") || "—"}
                  {s.sutureRemovalDate ? ` · Retiro suturas: ${s.sutureRemovalDate}` : ""}
                </div>
              </div>
              {s.hasConsent ? (
                <span
                  style={{
                    fontSize: 10,
                    padding: "3px 8px",
                    borderRadius: 3,
                    background: "var(--success-soft, rgba(34,197,94,0.16))",
                    color: "var(--success, #22c55e)",
                    textTransform: "uppercase",
                  }}
                >
                  Consentimiento firmado
                </span>
              ) : s.onSignConsent ? (
                <button
                  type="button"
                  onClick={s.onSignConsent}
                  style={{
                    fontSize: 11,
                    padding: "5px 10px",
                    borderRadius: 4,
                    border: "1px solid var(--warning, #eab308)",
                    background: "transparent",
                    color: "var(--warning, #eab308)",
                    cursor: "pointer",
                  }}
                >
                  Firmar consentimiento
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function humanizeSurgeryType(t: string): string {
  const map: Record<string, string> = {
    COLGAJO_ACCESO: "Colgajo de acceso",
    GINGIVECTOMIA: "Gingivectomía",
    RESECTIVA_OSEA: "Resectiva ósea",
    RTG: "Regeneración tisular guiada (RTG)",
    INJERTO_GINGIVAL_LIBRE: "Injerto gingival libre",
    INJERTO_TEJIDO_CONECTIVO: "Injerto de tejido conectivo",
    TUNELIZACION: "Tunelización",
    CORONALLY_ADVANCED_FLAP: "Colgajo de avance coronal",
    OTRO: "Otra cirugía periodontal",
  };
  return map[t] ?? t;
}
