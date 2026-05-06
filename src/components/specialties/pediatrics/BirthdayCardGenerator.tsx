"use client";
// Pediatrics — generador de tarjeta de cumpleaños como SVG. Personaliza
// con datos del menor y de la clínica. Trigger 7 días antes vía
// ClinicalReminder ped_cumpleanos_paciente; este componente además
// permite generación on-demand desde la ficha del paciente.

import { useMemo, useState } from "react";
import { Cake, Download, Share2 } from "lucide-react";
import {
  buildBirthdayCardSvg,
  type BirthdayCardData,
} from "@/lib/clinical-shared/birthday/card-svg";
import { nextBirthday, ageOnBirthday } from "@/lib/clinical-shared/reminders/birthday";

export interface BirthdayCardGeneratorProps {
  childName: string;
  patientDob: string | Date;
  clinicName: string;
  clinicLogoUrl?: string | null;
  primaryColor?: string;
  accentColor?: string;
  /** Si se pasa, usa esta fecha en vez de calcular el próximo cumpleaños. */
  forceBirthdayDate?: string;
}

export function BirthdayCardGenerator(props: BirthdayCardGeneratorProps) {
  const dob = useMemo(
    () => (props.patientDob instanceof Date ? props.patientDob : new Date(props.patientDob)),
    [props.patientDob],
  );

  const next = useMemo(() => {
    if (props.forceBirthdayDate) return new Date(props.forceBirthdayDate);
    return nextBirthday(dob, new Date());
  }, [dob, props.forceBirthdayDate]);

  const ageTurning = useMemo(() => ageOnBirthday(dob, next), [dob, next]);

  const data: BirthdayCardData = useMemo(
    () => ({
      childName: props.childName,
      ageTurning,
      clinicName: props.clinicName,
      clinicLogoUrl: props.clinicLogoUrl ?? null,
      birthdayDate: next.toISOString(),
      primaryColor: props.primaryColor,
      accentColor: props.accentColor,
    }),
    [props, next, ageTurning],
  );

  const svg = useMemo(() => buildBirthdayCardSvg(data), [data]);
  const dataUrl = useMemo(() => svgToDataUrl(svg), [svg]);
  const [copied, setCopied] = useState(false);

  const onDownload = () => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `cumple-${slugify(props.childName)}-${ageTurning}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const onCopyDataUrl = async () => {
    try {
      await navigator.clipboard.writeText(dataUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Cake size={16} aria-hidden style={{ color: "var(--text-2)" }} />
        <h3 style={{ margin: 0, fontSize: 14, color: "var(--text-1)" }}>
          Tarjeta de cumpleaños
        </h3>
      </header>

      <div
        style={{
          background: "var(--surface-1)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 8,
        }}
      >
        <div
          style={{ width: "100%", aspectRatio: "8 / 5", overflow: "hidden", borderRadius: 6 }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          fontSize: 12,
          color: "var(--text-2)",
        }}
      >
        <span>
          {ageTurning} años · {next.toLocaleDateString("es-MX")}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" onClick={() => void onCopyDataUrl()} style={btnSecondary}>
            <Share2 size={13} aria-hidden /> {copied ? "Copiado" : "Copiar imagen"}
          </button>
          <button type="button" onClick={onDownload} style={btnPrimary}>
            <Download size={13} aria-hidden /> Descargar SVG
          </button>
        </div>
      </div>
    </section>
  );
}

function svgToDataUrl(svg: string): string {
  const b64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(svg, "utf8").toString("base64")
      : btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${b64}`;
}

function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const btnPrimary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "5px 10px",
  fontSize: 12,
  background: "var(--accent)",
  color: "var(--text-on-accent, #fff)",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "5px 10px",
  fontSize: 12,
  background: "var(--surface-2)",
  color: "var(--text-1)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  cursor: "pointer",
};
