"use client";

import { QRCodeSVG } from "qrcode.react";
import { ShieldCheck, Printer } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";

interface Medication {
  name: string;
  dose: string;
  frequency: string;
  duration?: string;
  notes?: string;
}

interface PrescriptionQRProps {
  prescriptionId: string;
  verifyUrl: string;
  doctor: string;
  clinic: string;
  patient: string;
  medications: Medication[];
  indications?: string;
  issuedAt: string | Date;
  expiresAt?: string | Date | null;
  cofeprisGroup?: string | null;
  cofeprisFolio?: string | null;
  onPrint?: () => void;
}

export function PrescriptionQR({
  prescriptionId,
  verifyUrl,
  doctor,
  clinic,
  patient,
  medications,
  indications,
  issuedAt,
  expiresAt,
  cofeprisGroup,
  cofeprisFolio,
  onPrint,
}: PrescriptionQRProps) {
  const t = useT();
  const issued = new Date(issuedAt);
  const expires = expiresAt ? new Date(expiresAt) : null;

  return (
    <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-sans, system-ui, sans-serif)", fontWeight: 600, fontSize: 15, color: "var(--text-1)" }}>
            {t("clinical.prescriptionQr.title")}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-2)", fontFamily: "ui-monospace, monospace", marginTop: 4 }}>
            {clinic} · {doctor}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 2 }}>{t("clinical.prescriptionQr.patient", { patient })}</div>
          <div style={{ fontSize: 10, color: "var(--text-2)", fontFamily: "ui-monospace, monospace", marginTop: 6 }}>
            {t("clinical.prescriptionQr.issued", { date: issued.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" }) })}
            {expires && ` ${t("clinical.prescriptionQr.expires", { date: expires.toLocaleDateString("es-MX", { day: "numeric", month: "short" }) })}`}
          </div>
          {(cofeprisGroup || cofeprisFolio) && (
            <div style={{ fontSize: 10, color: "var(--text-2)", fontFamily: "ui-monospace, monospace", marginTop: 4 }}>
              COFEPRIS {cofeprisGroup && `· ${t("clinical.prescriptionQr.group", { group: cofeprisGroup })}`}{cofeprisFolio && ` · ${t("clinical.prescriptionQr.folio", { folio: cofeprisFolio })}`}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <div style={{ background: "#fff", padding: 8, borderRadius: 8 }}>
            <QRCodeSVG value={verifyUrl} size={110} level="M" includeMargin={false} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#34d399", fontFamily: "ui-monospace, monospace" }}>
            <ShieldCheck size={11} />
            {t("clinical.prescriptionQr.verifiable")}
          </div>
        </div>
      </div>

      <div style={{ height: 1, background: "var(--border)" }} />

      <div>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-2)", fontFamily: "ui-monospace, monospace", marginBottom: 8 }}>
          {t("clinical.prescriptionQr.medications")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {medications.map((m, i) => (
            <div key={i} style={{ padding: "8px 12px", background: "rgba(124,58,237,0.06)", border: "1px solid rgba(124,58,237,0.2)", borderRadius: 8 }}>
              <div style={{ fontWeight: 500, fontSize: 13, color: "var(--text-1)" }}>{m.name}</div>
              <div style={{ fontSize: 11, color: "var(--text-2)", fontFamily: "ui-monospace, monospace", marginTop: 2 }}>
                {m.dose} · {m.frequency}
                {m.duration && ` · ${m.duration}`}
              </div>
              {m.notes && <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 4, fontStyle: "italic" }}>{m.notes}</div>}
            </div>
          ))}
        </div>
      </div>

      {indications && (
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-2)", fontFamily: "ui-monospace, monospace", marginBottom: 6 }}>
            {t("clinical.prescriptionQr.indications")}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-1)", whiteSpace: "pre-wrap" }}>{indications}</div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
        <div style={{ fontSize: 10, color: "var(--text-2)", fontFamily: "ui-monospace, monospace" }}>
          {t("clinical.prescriptionQr.id", { id: prescriptionId.slice(-12) })}
        </div>
        {onPrint && (
          <button className="btn-new" onClick={onPrint} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <Printer size={13} />
            {t("common.print")}
          </button>
        )}
      </div>
    </div>
  );
}
