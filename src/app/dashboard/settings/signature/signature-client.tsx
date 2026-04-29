"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ShieldCheck, Upload, AlertTriangle, Check } from "lucide-react";

interface CertInfo {
  id: string;
  cerSerial: string;
  cerIssuer: string;
  validFrom: string;
  validUntil: string;
  rfc: string;
  isActive: boolean;
  createdAt: string;
}

interface Props {
  cert: CertInfo | null;
}

const DAYS_WARN = 30;

export function SignatureClient({ cert }: Props) {
  const router = useRouter();
  const [cerFile, setCerFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [keyPassword, setKeyPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const cerInputRef = useRef<HTMLInputElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);

  const expired = cert ? new Date(cert.validUntil) < new Date() : false;
  const daysToExpiry = cert
    ? Math.floor((new Date(cert.validUntil).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const expiringSoon = daysToExpiry !== null && daysToExpiry > 0 && daysToExpiry <= DAYS_WARN;

  async function fileToBase64(file: File): Promise<string> {
    const buf = await file.arrayBuffer();
    return Buffer.from(new Uint8Array(buf)).toString("base64");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!cerFile || !keyFile || !keyPassword) {
      toast.error("Selecciona .cer + .key e ingresa la contraseña");
      return;
    }
    setSubmitting(true);
    try {
      const [cerBase64, keyBase64] = await Promise.all([
        fileToBase64(cerFile),
        fileToBase64(keyFile),
      ]);
      const res = await fetch("/api/signature/cert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cerBase64, keyBase64, keyPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Error al cargar certificado");
        setSubmitting(false);
        return;
      }
      toast.success("Certificado FIEL registrado");
      setCerFile(null); setKeyFile(null); setKeyPassword("");
      if (cerInputRef.current) cerInputRef.current.value = "";
      if (keyInputRef.current) keyInputRef.current.value = "";
      router.refresh();
    } catch (err) {
      toast.error(`Error: ${String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ padding: "clamp(14px, 1.6vw, 28px)", maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4, display: "inline-flex", alignItems: "center", gap: 10 }}>
        <ShieldCheck size={20} aria-hidden style={{ color: "var(--brand, #2563eb)" }} />
        Firma electrónica FIEL/SAT
      </h1>
      <p style={{ fontSize: 13, color: "var(--text-3, #64748b)", marginBottom: 24 }}>
        Carga tu e.firma del SAT (.cer + .key + contraseña) para firmar digitalmente recetas y notas
        clínicas con validez legal según LFEA.
      </p>

      {cert && (
        <div
          style={{
            padding: 16,
            marginBottom: 20,
            background: expired ? "rgba(220, 38, 38, 0.08)" : expiringSoon ? "rgba(217, 119, 6, 0.08)" : "rgba(16, 185, 129, 0.08)",
            border: `1px solid ${expired ? "rgba(220, 38, 38, 0.30)" : expiringSoon ? "rgba(217, 119, 6, 0.30)" : "rgba(16, 185, 129, 0.30)"}`,
            borderRadius: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700, fontSize: 14, marginBottom: 10, color: expired ? "#b91c1c" : expiringSoon ? "#92400e" : "#065f46" }}>
            {expired ? <AlertTriangle size={16} aria-hidden /> : <Check size={16} aria-hidden />}
            {expired
              ? "Certificado vencido"
              : expiringSoon
                ? `Vence en ${daysToExpiry} días — renovar pronto`
                : "Certificado activo"}
          </div>
          <Row label="Serial" value={cert.cerSerial} mono />
          <Row label="Emisor" value={cert.cerIssuer} />
          <Row label="RFC titular" value={cert.rfc} mono />
          <Row label="Válido desde" value={new Date(cert.validFrom).toLocaleDateString("es-MX")} />
          <Row label="Válido hasta" value={new Date(cert.validUntil).toLocaleDateString("es-MX")} />
        </div>
      )}

      <form onSubmit={submit} style={{ background: "var(--bg-elev, #fff)", border: "1px solid var(--border-soft, #e2e8f0)", borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>
          {cert ? "Reemplazar certificado" : "Cargar certificado"}
        </h2>

        <Field label=".cer (certificado público SAT, formato DER)" required>
          <input
            ref={cerInputRef}
            type="file"
            accept=".cer,application/x-x509-ca-cert,application/octet-stream"
            onChange={(e) => setCerFile(e.target.files?.[0] ?? null)}
            style={{ fontFamily: "inherit", fontSize: 13 }}
          />
        </Field>

        <Field label=".key (llave privada SAT, formato DER PKCS#8)" required>
          <input
            ref={keyInputRef}
            type="file"
            accept=".key,application/octet-stream"
            onChange={(e) => setKeyFile(e.target.files?.[0] ?? null)}
            style={{ fontFamily: "inherit", fontSize: 13 }}
          />
        </Field>

        <Field label="Contraseña de la llave privada" required>
          <input
            type="password"
            value={keyPassword}
            onChange={(e) => setKeyPassword(e.target.value)}
            autoComplete="off"
            placeholder="Tu contraseña SAT"
            style={{
              padding: "10px 12px",
              border: "1px solid var(--border-soft, #cbd5e1)",
              borderRadius: 8,
              fontFamily: "inherit",
              fontSize: 13,
            }}
          />
        </Field>

        <div style={{ fontSize: 11, color: "var(--text-3, #64748b)", lineHeight: 1.5 }}>
          La contraseña NO se guarda en MediFlow. La .key se cifra con AES-256-GCM
          usando una clave maestra que vive solo en variables de entorno de Vercel.
          Cada vez que firmes un documento, se te pedirá la contraseña.
        </div>

        <button
          type="submit"
          disabled={submitting || !cerFile || !keyFile || !keyPassword}
          style={{
            padding: "10px 16px",
            fontSize: 13,
            fontWeight: 700,
            background: "var(--brand, #2563eb)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            cursor: submitting ? "wait" : "pointer",
            fontFamily: "inherit",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            alignSelf: "flex-start",
          }}
        >
          <Upload size={14} aria-hidden />
          {submitting ? "Cargando…" : (cert ? "Reemplazar certificado" : "Cargar certificado")}
        </button>
      </form>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 10, fontSize: 12, padding: "3px 0" }}>
      <span style={{ color: "var(--text-3, #64748b)", fontWeight: 600 }}>{label}</span>
      <span style={{
        color: "var(--text-1, #0f172a)",
        fontFamily: mono ? "var(--font-jetbrains-mono, monospace)" : "inherit",
        wordBreak: "break-all",
      }}>{value}</span>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2, #475569)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label} {required && <span style={{ color: "#dc2626" }}>*</span>}
      </span>
      {children}
    </label>
  );
}
