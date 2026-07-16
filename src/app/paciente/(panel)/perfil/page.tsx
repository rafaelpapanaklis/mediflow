"use client";

// Perfil del paciente. Implementa A9.
// Datos: usePacienteData<PacientePerfil>("/api/paciente/profile").
// · Form editable: nombre, teléfono (email solo lectura con nota "El correo es
//   tu identidad y no se puede cambiar"). PATCH /api/paciente/profile → toast/
//   mensaje de éxito + mutate().
// · Bloque "Cambiar contraseña" (opcional, colapsable): contraseña actual +
//   nueva (≥8) + confirmar → PATCH con {currentPassword, newPassword}.
// · Bloque "Mis clínicas": lista de clinics (nombre, ciudad, nº de expediente
//   patientNumber) — solo informativo.
// · Responsive, dark, español con tú.
import { useEffect, useRef, useState } from "react";
import { usePacienteData } from "@/lib/patient-portal/use-paciente";
import type { PacientePerfil, UpdateProfileBody } from "@/lib/patient-portal/types";
import { PacienteCard, PacienteEmptyState, formatFecha } from "@/components/paciente/ui";

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10,
  padding: 12,
  color: "#f5f5f7",
  fontSize: 14,
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 500,
  color: "#a1a1aa",
  marginBottom: 6,
};

const primaryBtnStyle: React.CSSProperties = {
  background: "linear-gradient(135deg, #8b5cf6, #7c3aed)",
  color: "#ffffff",
  border: "none",
  borderRadius: 10,
  padding: "12px 20px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const ghostBtnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  color: "#f5f5f7",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10,
  padding: "10px 16px",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

const okBoxStyle: React.CSSProperties = {
  background: "rgba(34,197,94,0.12)",
  border: "1px solid rgba(34,197,94,0.35)",
  color: "#4ade80",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 13,
};

const errorBoxStyle: React.CSSProperties = {
  background: "rgba(248,113,113,0.1)",
  border: "1px solid rgba(248,113,113,0.35)",
  color: "#f87171",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 13,
};

const fieldGroupStyle: React.CSSProperties = { display: "grid", gap: 14 };

async function patchPerfil(body: UpdateProfileBody): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/paciente/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    let json: { error?: string } = {};
    try {
      json = await res.json();
    } catch {
      /* respuesta sin body */
    }
    if (!res.ok) {
      return { ok: false, error: json?.error || "No se pudieron guardar los cambios. Intenta de nuevo." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Error de conexión. Revisa tu internet e intenta de nuevo." };
  }
}

export default function PacientePerfilPage() {
  const { data, error, isLoading, mutate } = usePacienteData<PacientePerfil>("/api/paciente/profile");

  // ── Datos de contacto ──
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [contactSaved, setContactSaved] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Cambiar contraseña ──
  const [pwdOpen, setPwdOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdOk, setPwdOk] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);

  // Hidratar el formulario UNA sola vez (el refresh de SWR no debe pisar lo que escribes).
  useEffect(() => {
    if (data && !hydrated) {
      setName(data.name || "");
      setPhone(data.phone || "");
      setHydrated(true);
    }
  }, [data, hydrated]);

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  async function guardarContacto(e: React.FormEvent) {
    e.preventDefault();
    if (savingContact) return;
    setContactError(null);
    setContactSaved(false);

    const body: UpdateProfileBody = { name: name.trim() };
    const tel = phone.trim();
    if (tel) body.phone = tel;

    setSavingContact(true);
    const result = await patchPerfil(body);
    setSavingContact(false);

    if (!result.ok) {
      setContactError(result.error || "No se pudieron guardar los cambios.");
      return;
    }
    setContactSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setContactSaved(false), 3000);
    mutate();
  }

  async function cambiarPassword(e: React.FormEvent) {
    e.preventDefault();
    if (savingPwd) return;
    setPwdError(null);
    setPwdOk(false);

    if (!currentPassword) {
      setPwdError("Escribe tu contraseña actual.");
      return;
    }
    if (newPassword.length < 8) {
      setPwdError("La nueva contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdError("Las contraseñas no coinciden.");
      return;
    }

    setSavingPwd(true);
    const result = await patchPerfil({ currentPassword, newPassword });
    setSavingPwd(false);

    if (!result.ok) {
      setPwdError(result.error || "No se pudo actualizar la contraseña.");
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPwdOk(true);
  }

  function togglePwd() {
    setPwdOpen((open) => {
      if (open) {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setPwdError(null);
        setPwdOk(false);
      }
      return !open;
    });
  }

  if (isLoading && !data) {
    return (
      <div style={{ width: "100%", maxWidth: 640 }}>
        <h1 style={{ margin: "0 0 16px", fontSize: 22, fontWeight: 700, color: "#f5f5f7" }}>
          Tu perfil
        </h1>
        <p style={{ color: "#a1a1aa", fontSize: 14 }}>Cargando tu perfil…</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div style={{ width: "100%", maxWidth: 640 }}>
        <h1 style={{ margin: "0 0 16px", fontSize: 22, fontWeight: 700, color: "#f5f5f7" }}>
          Tu perfil
        </h1>
        <div style={errorBoxStyle}>No pudimos cargar tu perfil. Intenta de nuevo en unos segundos.</div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div style={{ width: "100%", maxWidth: 640, display: "grid", gap: 16 }}>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#f5f5f7" }}>Tu perfil</h1>

      {/* ── Datos de contacto ── */}
      <PacienteCard title="Datos de contacto" style={{ width: "100%" }}>
        <form onSubmit={guardarContacto} style={fieldGroupStyle}>
          <div>
            <label htmlFor="perfil-nombre" style={labelStyle}>
              Nombre
            </label>
            <input
              id="perfil-nombre"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tu nombre completo"
              autoComplete="name"
              maxLength={120}
              style={inputStyle}
              className="focus-visible:[box-shadow:var(--ring)]"
            />
          </div>

          <div>
            <label htmlFor="perfil-telefono" style={labelStyle}>
              Teléfono
            </label>
            <input
              id="perfil-telefono"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="10 dígitos"
              autoComplete="tel"
              style={inputStyle}
              className="focus-visible:[box-shadow:var(--ring)]"
            />
          </div>

          <div>
            <label htmlFor="perfil-email" style={labelStyle}>
              Correo electrónico
            </label>
            <input
              id="perfil-email"
              type="email"
              value={data.email}
              disabled
              autoComplete="email"
              style={{ ...inputStyle, opacity: 0.55, cursor: "not-allowed" }}
            />
            <p style={{ margin: "6px 0 0", fontSize: 11, color: "#a1a1aa" }}>
              El correo es tu identidad y no se puede cambiar
            </p>
          </div>

          {contactSaved && <div style={okBoxStyle}>Cambios guardados</div>}
          {contactError && <div style={errorBoxStyle}>{contactError}</div>}

          <div>
            <button
              type="submit"
              disabled={savingContact}
              style={{ ...primaryBtnStyle, opacity: savingContact ? 0.6 : 1 }}
            >
              {savingContact ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </form>
      </PacienteCard>

      {/* ── Cambiar contraseña (colapsable) ── */}
      <PacienteCard title="Cambiar contraseña" style={{ width: "100%" }}>
        <div style={{ display: "grid", gap: 14 }}>
          <div>
            <button type="button" onClick={togglePwd} style={ghostBtnStyle}>
              {pwdOpen ? "Ocultar" : "Cambiar mi contraseña"}
            </button>
          </div>

          {pwdOk && !pwdOpen && <div style={okBoxStyle}>Contraseña actualizada</div>}

          {pwdOpen && (
            <form onSubmit={cambiarPassword} style={fieldGroupStyle}>
              <div>
                <label htmlFor="perfil-pwd-actual" style={labelStyle}>
                  Contraseña actual
                </label>
                <input
                  id="perfil-pwd-actual"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  style={inputStyle}
                  className="focus-visible:[box-shadow:var(--ring)]"
                />
              </div>

              <div>
                <label htmlFor="perfil-pwd-nueva" style={labelStyle}>
                  Nueva contraseña (mínimo 8 caracteres)
                </label>
                <input
                  id="perfil-pwd-nueva"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  style={inputStyle}
                  className="focus-visible:[box-shadow:var(--ring)]"
                />
              </div>

              <div>
                <label htmlFor="perfil-pwd-confirmar" style={labelStyle}>
                  Confirmar nueva contraseña
                </label>
                <input
                  id="perfil-pwd-confirmar"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  style={inputStyle}
                  className="focus-visible:[box-shadow:var(--ring)]"
                />
              </div>

              {pwdOk && <div style={okBoxStyle}>Contraseña actualizada</div>}
              {pwdError && <div style={errorBoxStyle}>{pwdError}</div>}

              <div>
                <button
                  type="submit"
                  disabled={savingPwd}
                  style={{ ...primaryBtnStyle, opacity: savingPwd ? 0.6 : 1 }}
                >
                  {savingPwd ? "Actualizando…" : "Actualizar contraseña"}
                </button>
              </div>
            </form>
          )}
        </div>
      </PacienteCard>

      {/* ── Tus clínicas ── */}
      <PacienteCard title="Tus clínicas" style={{ width: "100%" }}>
        {data.clinics.length === 0 ? (
          <PacienteEmptyState message="Aún no estás vinculado a ninguna clínica. Reserva una cita para vincularte." />
        ) : (
          <div style={{ display: "grid", gap: 0 }}>
            {data.clinics.map((clinic, i) => (
              <div
                key={clinic.patientId}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "12px 0",
                  borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#f5f5f7" }}>
                    {clinic.clinicName}
                  </div>
                  {clinic.city && (
                    <div style={{ fontSize: 12, color: "#a1a1aa", marginTop: 2 }}>
                      {clinic.city}
                    </div>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "#a1a1aa",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 999,
                    padding: "4px 10px",
                    whiteSpace: "nowrap",
                  }}
                >
                  Expediente {clinic.patientNumber}
                </div>
              </div>
            ))}
          </div>
        )}
        <p style={{ margin: "12px 0 0", fontSize: 12, color: "#a1a1aa" }}>
          Cuenta creada el {formatFecha(data.createdAt)}
        </p>
      </PacienteCard>
    </div>
  );
}
