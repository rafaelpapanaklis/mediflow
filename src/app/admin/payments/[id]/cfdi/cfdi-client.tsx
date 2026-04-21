"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { FileText, Download, AlertTriangle } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { formatCurrency } from "@/lib/utils";

interface Clinic {
  id: string;
  name: string;
  email: string | null;
  taxId: string | null;
  rfcEmisor: string | null;
  regimenFiscal: string | null;
  cpEmisor: string | null;
  city: string | null;
  address: string | null;
}

interface Props {
  paymentId: string;
  clinic: Clinic;
  amount: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  cfdiConfigured: boolean;
  cfdiInstructions: string;
}

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 10,
  color: "var(--text-3)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontWeight: 600,
  marginBottom: 4,
};

const CELL_STYLE: React.CSSProperties = {
  padding: 12,
  background: "var(--bg-elev-2)",
  border: "1px solid var(--border-soft)",
  borderRadius: 10,
};

const VALUE_STYLE: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-1)",
  fontWeight: 500,
};

export function CfdiClient({ paymentId, clinic, amount, currency, periodStart, periodEnd, cfdiConfigured, cfdiInstructions }: Props) {
  const [showInstructions, setShowInstructions] = useState(false);

  async function generate() {
    if (!cfdiConfigured) { setShowInstructions(true); return; }
    try {
      const res = await fetch(`/api/admin/payments/${paymentId}/cfdi`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        if (err.instructions) { setShowInstructions(true); return; }
        throw new Error(err.error ?? "Error");
      }
      const data = await res.json();
      toast.success(`CFDI generado: ${data.uuid}`);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  function downloadReceipt() {
    // Abre en nueva pestaña una vista imprimible; el usuario puede "Guardar como PDF"
    window.open(`/api/admin/payments/${paymentId}/receipt`, "_blank");
  }

  const missingFiscales = !clinic.rfcEmisor || !clinic.regimenFiscal || !clinic.cpEmisor;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Datos fiscales de la clínica */}
      <CardNew title="Datos fiscales de la clínica receptora">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px 14px" }}>
          <div style={CELL_STYLE}>
            <div style={LABEL_STYLE}>Razón social / Nombre</div>
            <div style={VALUE_STYLE}>{clinic.name}</div>
          </div>
          <div style={CELL_STYLE}>
            <div style={LABEL_STYLE}>RFC emisor</div>
            <div
              style={{
                ...VALUE_STYLE,
                fontFamily: "var(--font-jetbrains-mono, monospace)",
                fontWeight: 600,
                color: clinic.rfcEmisor ? "var(--success)" : "var(--danger)",
              }}
            >
              {clinic.rfcEmisor ?? "— falta configurar"}
            </div>
          </div>
          <div style={CELL_STYLE}>
            <div style={LABEL_STYLE}>Régimen fiscal</div>
            <div
              style={{
                ...VALUE_STYLE,
                fontWeight: 600,
                color: clinic.regimenFiscal ? "var(--text-1)" : "var(--danger)",
              }}
            >
              {clinic.regimenFiscal ?? "— falta configurar"}
            </div>
          </div>
          <div style={CELL_STYLE}>
            <div style={LABEL_STYLE}>CP emisor</div>
            <div
              style={{
                ...VALUE_STYLE,
                fontFamily: "var(--font-jetbrains-mono, monospace)",
                fontWeight: 600,
                color: clinic.cpEmisor ? "var(--text-1)" : "var(--danger)",
              }}
            >
              {clinic.cpEmisor ?? "— falta configurar"}
            </div>
          </div>
          <div style={CELL_STYLE}>
            <div style={LABEL_STYLE}>Email</div>
            <div style={VALUE_STYLE}>{clinic.email ?? "—"}</div>
          </div>
          <div style={CELL_STYLE}>
            <div style={LABEL_STYLE}>Ubicación</div>
            <div style={VALUE_STYLE}>{[clinic.city, clinic.address].filter(Boolean).join(", ") || "—"}</div>
          </div>
        </div>
        {missingFiscales && (
          <div
            style={{
              marginTop: 12,
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              padding: 12,
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: 10,
              color: "var(--danger)",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            <AlertTriangle style={{ width: 16, height: 16, flexShrink: 0, marginTop: 2 }} />
            <div>
              Faltan datos fiscales obligatorios. Pídele al cliente que los complete en
              <code
                style={{
                  background: "var(--bg-elev-2)",
                  padding: "2px 5px",
                  borderRadius: 4,
                  fontFamily: "var(--font-jetbrains-mono, monospace)",
                  fontSize: 11,
                  color: "var(--brand)",
                  margin: "0 4px",
                }}
              >
                /dashboard/settings
              </code>
              antes de generar CFDI.
            </div>
          </div>
        )}
      </CardNew>

      {/* Datos del pago */}
      <CardNew title="Detalle del pago">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px 14px" }}>
          <div style={CELL_STYLE}>
            <div style={LABEL_STYLE}>Monto</div>
            <div
              className="mono"
              style={{
                fontSize: 24,
                fontWeight: 800,
                color: "var(--success)",
              }}
            >
              {formatCurrency(amount, currency)}
            </div>
          </div>
          <div style={CELL_STYLE}>
            <div style={LABEL_STYLE}>Periodo</div>
            <div style={{ ...VALUE_STYLE, fontWeight: 600 }}>
              {new Date(periodStart).toLocaleDateString("es-MX")} → {new Date(periodEnd).toLocaleDateString("es-MX")}
            </div>
          </div>
        </div>
      </CardNew>

      {/* Actions */}
      <CardNew title="Acciones">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ButtonNew variant="primary" onClick={generate}>
            <FileText style={{ width: 14, height: 14 }} />
            Generar CFDI
          </ButtonNew>
          <ButtonNew variant="ghost" onClick={downloadReceipt}>
            <Download style={{ width: 14, height: 14 }} />
            Descargar recibo (no fiscal)
          </ButtonNew>
        </div>
        <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 12, lineHeight: 1.5 }}>
          El recibo no fiscal es un comprobante informativo del pago, no sustituye al CFDI emitido ante el SAT.
        </p>
      </CardNew>

      {/* Modal instrucciones cuando no hay PAC */}
      {showInstructions && (
        <div className="modal-overlay" onClick={() => setShowInstructions(false)}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 640, width: "100%" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <AlertTriangle style={{ width: 18, height: 18, color: "var(--warning)" }} />
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)", margin: 0 }}>
                Contrata un PAC primero
              </h2>
            </div>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                fontSize: 12,
                color: "var(--text-2)",
                background: "var(--bg-elev-2)",
                border: "1px solid var(--border-soft)",
                borderRadius: 10,
                padding: 14,
                lineHeight: 1.6,
                fontFamily: "var(--font-jetbrains-mono, monospace)",
                margin: 0,
              }}
            >
              {cfdiInstructions}
            </pre>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <ButtonNew variant="primary" onClick={() => setShowInstructions(false)}>
                Entendido
              </ButtonNew>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
