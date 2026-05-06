"use client";
// Clinical-shared — gestión de contactos de doctores externos.

import { useEffect, useState } from "react";
import { Pencil, Trash2, Plus } from "lucide-react";
import {
  createDoctorContact,
  deleteDoctorContact,
  listDoctorContacts,
  updateDoctorContact,
} from "@/app/actions/clinical-shared/referrals";
import { isFailure } from "@/lib/clinical-shared/result";

interface ContactRow {
  id: string;
  fullName: string;
  specialty: string | null;
  cedula: string | null;
  phone: string | null;
  email: string | null;
  clinicName: string | null;
}

interface DraftContact {
  id?: string;
  fullName: string;
  specialty: string;
  cedula: string;
  phone: string;
  email: string;
  clinicName: string;
}

const EMPTY: DraftContact = {
  fullName: "",
  specialty: "",
  cedula: "",
  phone: "",
  email: "",
  clinicName: "",
};

export function DoctorContactsManager() {
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [draft, setDraft] = useState<DraftContact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    const res = await listDoctorContacts();
    if (isFailure(res)) setError(res.error);
    else setRows(res.data);
    setLoading(false);
  };

  useEffect(() => {
    void reload();
  }, []);

  const onSave = async () => {
    if (!draft) return;
    const payload = {
      fullName: draft.fullName,
      specialty: draft.specialty || null,
      cedula: draft.cedula || null,
      phone: draft.phone || null,
      email: draft.email || null,
      clinicName: draft.clinicName || null,
    };
    setError(null);
    const res = draft.id
      ? await updateDoctorContact({ id: draft.id, ...payload })
      : await createDoctorContact(payload);
    if (isFailure(res)) {
      setError(res.error);
      return;
    }
    setDraft(null);
    await reload();
  };

  const onDelete = async (id: string) => {
    const ok = window.confirm("¿Eliminar este contacto?");
    if (!ok) return;
    const res = await deleteDoctorContact({ id });
    if (isFailure(res)) {
      setError(res.error);
      return;
    }
    await reload();
  };

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: 14, color: "var(--text-1)" }}>
          Contactos de doctores ({rows.length})
        </h3>
        <button
          type="button"
          onClick={() => setDraft({ ...EMPTY })}
          style={btnPrimary}
        >
          <Plus size={13} aria-hidden /> Nuevo contacto
        </button>
      </header>

      {error ? (
        <div
          role="alert"
          style={{
            padding: 8,
            background: "var(--danger-surface, #fee2e2)",
            color: "var(--danger, #b91c1c)",
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <div style={{ fontSize: 12, color: "var(--text-2)" }}>Cargando…</div>
      ) : rows.length === 0 ? (
        <div
          style={{
            padding: 24,
            textAlign: "center",
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--text-2)",
            fontSize: 13,
          }}
        >
          No hay contactos registrados.
        </div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map((c) => (
            <li
              key={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "var(--surface-1)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "8px 12px",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column" }}>
                <strong style={{ fontSize: 13, color: "var(--text-1)" }}>{c.fullName}</strong>
                <span style={{ fontSize: 11, color: "var(--text-2)" }}>
                  {[c.specialty, c.clinicName, c.phone, c.email].filter(Boolean).join(" · ") || "—"}
                  {c.cedula ? ` · Céd. ${c.cedula}` : ""}
                </span>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  type="button"
                  aria-label="Editar"
                  onClick={() =>
                    setDraft({
                      id: c.id,
                      fullName: c.fullName,
                      specialty: c.specialty ?? "",
                      cedula: c.cedula ?? "",
                      phone: c.phone ?? "",
                      email: c.email ?? "",
                      clinicName: c.clinicName ?? "",
                    })
                  }
                  style={iconBtn}
                >
                  <Pencil size={13} aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="Eliminar"
                  onClick={() => void onDelete(c.id)}
                  style={iconBtn}
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {draft ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Contacto de doctor"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 220,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => setDraft(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(520px, 100%)",
              background: "var(--surface-1)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <h4 style={{ margin: 0, fontSize: 14, color: "var(--text-1)" }}>
              {draft.id ? "Editar contacto" : "Nuevo contacto"}
            </h4>
            <Field label="Nombre completo">
              <input
                type="text"
                value={draft.fullName}
                onChange={(e) => setDraft({ ...draft, fullName: e.target.value })}
                style={inputStyle}
              />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Field label="Especialidad">
                <input
                  type="text"
                  value={draft.specialty}
                  onChange={(e) => setDraft({ ...draft, specialty: e.target.value })}
                  style={inputStyle}
                />
              </Field>
              <Field label="Cédula profesional">
                <input
                  type="text"
                  value={draft.cedula}
                  onChange={(e) => setDraft({ ...draft, cedula: e.target.value })}
                  style={inputStyle}
                />
              </Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Field label="Teléfono">
                <input
                  type="text"
                  value={draft.phone}
                  onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                  style={inputStyle}
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  value={draft.email}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                  style={inputStyle}
                />
              </Field>
            </div>
            <Field label="Clínica/consultorio">
              <input
                type="text"
                value={draft.clinicName}
                onChange={(e) => setDraft({ ...draft, clinicName: e.target.value })}
                style={inputStyle}
              />
            </Field>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
              <button type="button" onClick={() => setDraft(null)} style={btnSecondary}>
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void onSave()}
                disabled={!draft.fullName.trim()}
                style={btnPrimary}
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, color: "var(--text-2)" }}>{props.label}</label>
      {props.children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-1)",
  fontSize: 13,
  padding: "6px 8px",
};

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

const iconBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--text-2)",
  cursor: "pointer",
  padding: 4,
  borderRadius: 4,
};
