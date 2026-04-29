"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import type {
  NewPatientFormData,
} from "@/lib/new-patient/types";
import { validateCURP } from "@/lib/validators/curp";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialName?: string;
  initialPhone?: string;
  initialEmail?: string;
  onCreated?: (patient: { id: string; name: string }) => void;
}

const EMPTY: NewPatientFormData = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  dob: "",
  gender: "",
  isChild: false,
  // NOM-024
  curp: "",
  curpStatus: "PENDING",
  passportNo: "",
};

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length <= 1) return { firstName: parts[0] ?? "", lastName: "" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

export function NewPatientDialog({
  isOpen,
  onClose,
  initialName,
  initialPhone,
  initialEmail,
  onCreated,
}: Props) {
  const [form, setForm] = useState<NewPatientFormData>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof NewPatientFormData, string>>>({});

  useEffect(() => {
    if (!isOpen) return;
    const next = { ...EMPTY };
    if (initialName) {
      const { firstName, lastName } = splitName(initialName);
      next.firstName = firstName;
      next.lastName = lastName;
    }
    if (initialPhone) next.phone = initialPhone;
    if (initialEmail) next.email = initialEmail;
    setForm(next);
    setErrors({});
  }, [isOpen, initialName, initialPhone, initialEmail]);

  const update = <K extends keyof NewPatientFormData>(k: K, v: NewPatientFormData[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (!form.firstName.trim()) next.firstName = "Requerido";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      next.email = "Email inválido";
    }
    if (form.phone && !/^[\d\s+\-()]{7,20}$/.test(form.phone)) {
      next.phone = "Teléfono inválido";
    }
    // NOM-024
    if (form.curpStatus === "COMPLETE") {
      if (!form.curp.trim()) next.curp = "Requerido";
      else if (!validateCURP(form.curp)) next.curp = "Formato inválido";
    }
    if (form.curpStatus === "FOREIGN" && !form.passportNo.trim()) {
      next.passportNo = "Requerido";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/patients", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim() || null,
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          dob: form.dob || null,
          gender: form.gender || null,
          isChild: form.isChild,
          curp:        form.curpStatus === "COMPLETE" ? form.curp.toUpperCase() : null,
          curpStatus:  form.curpStatus,
          passportNo:  form.curpStatus === "FOREIGN" ? form.passportNo.trim() : null,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        toast.error(errBody.error ?? "No se pudo crear el paciente");
        setSubmitting(false);
        return;
      }

      // POST /api/patients retorna el patient directo (no wrapped en {patient}).
      const patient = (await res.json()) as { id: string; firstName: string; lastName: string | null };
      const fullName = [patient.firstName, patient.lastName].filter(Boolean).join(" ").trim();
      toast.success("Paciente creado");
      onCreated?.({ id: patient.id, name: fullName });
      onClose();
    } catch (err) {
      console.error(err);
      toast.error("Error de red. Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay style={overlayStyle} />
        <Dialog.Content
          style={dialogStyle}
          onEscapeKeyDown={onClose}
          aria-describedby={undefined}
        >
          <header style={headerStyle}>
            <Dialog.Title style={titleStyle}>Nuevo paciente</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" aria-label="Cerrar" style={closeBtnStyle}>
                <X size={16} />
              </button>
            </Dialog.Close>
          </header>

          <div style={bodyStyle}>
            <div style={gridTwo}>
              <Field label="Nombre*" error={errors.firstName}>
                <input
                  type="text"
                  className="input-new"
                  value={form.firstName}
                  onChange={(e) => update("firstName", e.target.value)}
                  autoFocus
                />
              </Field>
              <Field label="Apellido">
                <input
                  type="text"
                  className="input-new"
                  value={form.lastName}
                  onChange={(e) => update("lastName", e.target.value)}
                />
              </Field>
            </div>

            <div style={gridTwo}>
              <Field label="Teléfono" error={errors.phone}>
                <input
                  type="tel"
                  className="input-new"
                  value={form.phone}
                  onChange={(e) => update("phone", e.target.value)}
                  placeholder="999 123 4567"
                />
              </Field>
              <Field label="Email" error={errors.email}>
                <input
                  type="email"
                  className="input-new"
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                />
              </Field>
            </div>

            <div style={gridTwo}>
              <Field label="Fecha de nacimiento">
                <input
                  type="date"
                  className="input-new"
                  value={form.dob}
                  onChange={(e) => update("dob", e.target.value)}
                />
              </Field>
              <Field label="Género">
                <select
                  className="input-new"
                  value={form.gender}
                  onChange={(e) => update("gender", e.target.value as NewPatientFormData["gender"])}
                >
                  <option value="">—</option>
                  <option value="F">Femenino</option>
                  <option value="M">Masculino</option>
                  <option value="O">Otro</option>
                </select>
              </Field>
            </div>

            <label style={checkboxRowStyle}>
              <input
                type="checkbox"
                checked={form.isChild}
                onChange={(e) => update("isChild", e.target.checked)}
              />
              <span style={{ fontSize: 12, color: "var(--text-2)" }}>
                Es menor de edad
              </span>
            </label>

            {/* NOM-024 — Identificación oficial */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
              <span style={sectionLabelStyle}>Identificación oficial</span>
              <div style={{ display: "flex", gap: 6 }}>
                {([
                  { id: "COMPLETE", label: "Tengo CURP" },
                  { id: "PENDING",  label: "No la tengo ahora" },
                  { id: "FOREIGN",  label: "Extranjero" },
                ] as const).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => update("curpStatus", opt.id)}
                    aria-pressed={form.curpStatus === opt.id}
                    style={{
                      flex: 1,
                      padding: "8px 10px",
                      fontSize: 12,
                      fontWeight: 600,
                      borderRadius: 8,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      background: form.curpStatus === opt.id ? "var(--brand)" : "var(--bg-elev)",
                      color: form.curpStatus === opt.id ? "#fff" : "var(--text-2)",
                      border: `1px solid ${form.curpStatus === opt.id ? "var(--brand)" : "var(--border-soft)"}`,
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {form.curpStatus === "COMPLETE" && (
                <Field label="CURP*" error={errors.curp}>
                  <input
                    type="text"
                    className="input-new"
                    style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", textTransform: "uppercase", letterSpacing: "0.04em" }}
                    placeholder="GOPA850623HDFRRR03"
                    maxLength={18}
                    value={form.curp}
                    onChange={(e) => update("curp", e.target.value.toUpperCase())}
                  />
                </Field>
              )}
              {form.curpStatus === "FOREIGN" && (
                <Field label="Pasaporte*" error={errors.passportNo}>
                  <input
                    type="text"
                    className="input-new"
                    placeholder="A12345678"
                    maxLength={20}
                    value={form.passportNo}
                    onChange={(e) => update("passportNo", e.target.value.trim())}
                  />
                </Field>
              )}
              {form.curpStatus === "PENDING" && (
                <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                  Marca como pendiente. Recordá pedirle el CURP al paciente en la primera visita.
                </span>
              )}
            </div>
          </div>

          <footer style={footerStyle}>
            <ButtonNew variant="ghost" onClick={onClose} disabled={submitting}>
              Cancelar
            </ButtonNew>
            <ButtonNew variant="primary" onClick={submit} disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Creando...
                </>
              ) : (
                "Crear paciente"
              )}
            </ButtonNew>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--text-3)",
        }}
      >
        {label}
      </span>
      {children}
      {error && (
        <span style={{ fontSize: 11, color: "var(--danger)", marginTop: 2 }}>
          {error}
        </span>
      )}
    </label>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,10,30,0.55)",
  backdropFilter: "blur(4px)",
  zIndex: 80,
};

const dialogStyle: React.CSSProperties = {
  position: "fixed",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: "min(90vw, 560px)",
  maxHeight: "90vh",
  background: "var(--bg-elev)",
  border: "1px solid var(--border-strong)",
  borderRadius: 14,
  boxShadow: "0 24px 60px -12px rgba(15,10,30,0.4)",
  display: "flex",
  flexDirection: "column",
  zIndex: 81,
  fontFamily: "var(--font-sora, 'Sora', sans-serif)",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "16px 20px",
  borderBottom: "1px solid var(--border-soft)",
};

const titleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: "var(--text-1)",
  margin: 0,
};

const closeBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "grid",
  placeItems: "center",
  background: "transparent",
  border: "1px solid transparent",
  borderRadius: 6,
  color: "var(--text-2)",
  cursor: "pointer",
};

const bodyStyle: React.CSSProperties = {
  padding: 20,
  display: "flex",
  flexDirection: "column",
  gap: 14,
  overflowY: "auto",
};

const gridTwo: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 12,
};

const checkboxRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  cursor: "pointer",
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--text-3)",
};

const footerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  padding: "14px 20px",
  borderTop: "1px solid var(--border-soft)",
};
