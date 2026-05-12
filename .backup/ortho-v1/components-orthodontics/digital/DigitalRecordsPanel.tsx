"use client";
// Orthodontics — panel de cefalometrías PDF + STL con dynamic viewers. SPEC §6.10.

import dynamic from "next/dynamic";
import { useState } from "react";
import { Eye, Plus } from "lucide-react";
import type { OrthodonticDigitalRecordRow } from "@/lib/types/orthodontics";

const PdfViewer = dynamic(() => import("./PdfViewer"), {
  ssr: false,
  loading: () => <Loading text="Cargando visor PDF..." />,
});
const STLViewer3D = dynamic(() => import("./STLViewer3D"), {
  ssr: false,
  loading: () => <Loading text="Cargando visor 3D..." />,
});

export interface DigitalRecordsPanelProps {
  records: OrthodonticDigitalRecordRow[];
  resolveUrl: (fileId: string) => string;
  onAdd?: () => void;
}

export function DigitalRecordsPanel(props: DigitalRecordsPanelProps) {
  const [active, setActive] = useState<OrthodonticDigitalRecordRow | null>(null);
  const cephs = props.records.filter((r) => r.recordType === "CEPH_ANALYSIS_PDF");
  const stls = props.records.filter((r) => r.recordType === "SCAN_STL");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: 16, color: "var(--text-1)" }}>
          Archivos digitales ({props.records.length})
        </h3>
        {props.onAdd ? (
          <button
            type="button"
            onClick={props.onAdd}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 12px",
              borderRadius: 4,
              border: "1px solid var(--brand, #6366f1)",
              background: "var(--brand, #6366f1)",
              color: "white",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            <Plus size={12} aria-hidden /> Importar archivo
          </button>
        ) : null}
      </header>

      {active ? (
        active.recordType === "CEPH_ANALYSIS_PDF" ? (
          <PdfViewer
            url={props.resolveUrl(active.fileId)}
            onClose={() => setActive(null)}
          />
        ) : (
          <STLViewer3D
            url={props.resolveUrl(active.fileId)}
            onClose={() => setActive(null)}
          />
        )
      ) : null}

      <Section title={`Cefalometrías (${cephs.length})`}>
        <List records={cephs} onView={setActive} />
      </Section>
      <Section title={`Modelos 3D STL (${stls.length})`}>
        <List records={stls} onView={setActive} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        padding: 14,
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: 8,
      }}
    >
      <h4 style={{ margin: "0 0 8px", fontSize: 11, textTransform: "uppercase", color: "var(--text-2)" }}>
        {title}
      </h4>
      {children}
    </section>
  );
}

function List(props: {
  records: OrthodonticDigitalRecordRow[];
  onView: (r: OrthodonticDigitalRecordRow) => void;
}) {
  if (props.records.length === 0) {
    return <span style={{ fontSize: 12, color: "var(--text-3)" }}>Sin archivos importados.</span>;
  }
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
      {props.records.map((r) => (
        <li
          key={r.id}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "6px 8px",
            background: "var(--bg)",
            borderRadius: 4,
          }}
        >
          <span style={{ fontSize: 12, color: "var(--text-1)" }}>
            {new Date(r.capturedAt).toLocaleDateString("es-MX")}
            {r.notes ? ` · ${r.notes}` : ""}
          </span>
          <button
            type="button"
            onClick={() => props.onView(r)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 10px",
              borderRadius: 4,
              border: "1px solid var(--brand, #6366f1)",
              background: "transparent",
              color: "var(--brand, #6366f1)",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            <Eye size={12} aria-hidden /> Ver
          </button>
        </li>
      ))}
    </ul>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: 24,
        textAlign: "center",
        color: "var(--text-3)",
        fontSize: 12,
      }}
    >
      {text}
    </div>
  );
}
