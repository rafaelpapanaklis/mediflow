"use client";
// Orthodontics — PDF viewer dynamic. SPEC §6.10.
// Carga react-pdf solo en cliente para no romper SSR.

import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Worker (CDN) — react-pdf v10 acepta versión específica.
if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
}

export interface PdfViewerProps {
  url: string;
  onClose?: () => void;
}

export default function PdfViewer({ url, onClose }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--text-2)" }}>
          {numPages ? `Página ${page} de ${numPages}` : "Cargando..."}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            style={btnSecondary}
          >
            ←
          </button>
          <button
            type="button"
            disabled={!!numPages && page >= numPages}
            onClick={() => setPage((p) => p + 1)}
            style={btnSecondary}
          >
            →
          </button>
          {onClose ? (
            <button type="button" onClick={onClose} style={btnSecondary}>
              Cerrar
            </button>
          ) : null}
        </div>
      </header>
      <div
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          maxHeight: "75vh",
          overflowY: "auto",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <Document file={url} onLoadSuccess={({ numPages: n }) => setNumPages(n)}>
          <Page pageNumber={page} width={720} />
        </Document>
      </div>
    </div>
  );
}

const btnSecondary: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 4,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-1)",
  fontSize: 11,
  cursor: "pointer",
};
