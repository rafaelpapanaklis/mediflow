"use client";

import { useState } from "react";
import { Shield, Mail, CreditCard, Building, Globe } from "lucide-react";
import toast from "react-hot-toast";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";

const BANK_INFO = {
  nombre: "Efthymios Rafail Papanaklis",
  clabe:  "012910015008025244",
  banco:  "BBVA",
};

const PLANS_CONFIG = [
  { id: "BASIC",  name: "Básico",        price: 49,  features: "1 profesional · 200 pacientes · Agenda · Facturación" },
  { id: "PRO",    name: "Profesional",   price: 99,  features: "3 profesionales · Ilimitado · Expedientes · Reportes · WhatsApp" },
  { id: "CLINIC", name: "Clínica",       price: 249, features: "Todo ilimitado · Multi-sucursal · API · Manager de cuenta" },
];

interface EnvStatus {
  ADMIN_PASSWORD: boolean;
  ADMIN_SECRET_TOKEN: boolean;
  ADMIN_TOTP_SECRET: boolean;
  SUPABASE_URL: boolean;
  SUPABASE_ANON_KEY: boolean;
  DATABASE_URL: boolean;
  DIRECT_URL: boolean;
  STRIPE_SECRET_KEY: boolean;
  STRIPE_WEBHOOK_SECRET: boolean;
  RESEND_API_KEY: boolean;
  WHATSAPP_TOKEN: boolean;
  WHATSAPP_PHONE_ID: boolean;
}

export function AdminSettingsClient({ envStatus }: { envStatus: EnvStatus }) {
  const [tab, setTab]   = useState("empresa");
  const [saving, setSaving] = useState(false);

  const TABS = [
    { id: "empresa",   label: "Empresa",     icon: Building   },
    { id: "precios",   label: "Precios",     icon: CreditCard },
    { id: "banco",     label: "Datos banco", icon: CreditCard },
    { id: "seguridad", label: "Seguridad",   icon: Shield     },
    { id: "correos",   label: "Correos",     icon: Mail       },
    { id: "sistema",   label: "Sistema",     icon: Globe      },
  ];

  function save() {
    setSaving(true);
    setTimeout(() => { setSaving(false); toast.success("Configuración guardada"); }, 600);
  }

  const envVars = [
    { key: "ADMIN_PASSWORD",                   desc: "Contraseña maestra para entrar al panel admin",   set: envStatus.ADMIN_PASSWORD },
    { key: "ADMIN_SECRET_TOKEN",               desc: "Token de sesión del admin (cookie)",              set: envStatus.ADMIN_SECRET_TOKEN },
    { key: "ADMIN_TOTP_SECRET",                desc: "Secret de Google Authenticator para 2FA",         set: envStatus.ADMIN_TOTP_SECRET },
    { key: "NEXT_PUBLIC_SUPABASE_URL",         desc: "URL de tu proyecto Supabase",                     set: envStatus.SUPABASE_URL },
    { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",    desc: "Clave pública de Supabase",                       set: envStatus.SUPABASE_ANON_KEY },
    { key: "DATABASE_URL",                     desc: "URL de conexión PostgreSQL (pooler)",             set: envStatus.DATABASE_URL },
    { key: "DIRECT_URL",                       desc: "URL directa PostgreSQL (para migraciones)",       set: envStatus.DIRECT_URL },
    { key: "STRIPE_SECRET_KEY",                desc: "Clave secreta de Stripe",                         set: envStatus.STRIPE_SECRET_KEY },
    { key: "STRIPE_WEBHOOK_SECRET",            desc: "Secret del webhook de Stripe",                    set: envStatus.STRIPE_WEBHOOK_SECRET },
    { key: "STRIPE_PRICE_ID_BASIC/PRO/CLINIC", desc: "IDs de precio por plan en Stripe",                set: Boolean(envStatus.STRIPE_SECRET_KEY) },
    { key: "RESEND_API_KEY",                   desc: "API key de Resend para emails admin",             set: envStatus.RESEND_API_KEY },
    { key: "MEDIFLOW_WHATSAPP_TOKEN",          desc: "Token WhatsApp Business (envíos admin)",          set: envStatus.WHATSAPP_TOKEN },
    { key: "MEDIFLOW_WHATSAPP_PHONE_ID",       desc: "Phone Number ID de Meta WhatsApp",                set: envStatus.WHATSAPP_PHONE_ID },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>
      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
          Configuración del sistema
        </h1>
        <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, margin: 0 }}>
          Administra todos los parámetros de tu plataforma MediFlow
        </p>
      </div>

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        {/* Vertical nav */}
        <aside style={{ width: 200, flexShrink: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {TABS.map(t => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`vnav-item ${active ? "vnav-item--active" : ""}`}
                >
                  <Icon size={14} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </aside>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* EMPRESA */}
          {tab === "empresa" && (
            <>
              <CardNew title="Datos de tu empresa" sub="Información básica y contactos públicos">
                <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 520 }}>
                  {[
                    { label: "Nombre de la empresa", placeholder: "MediFlow", defaultValue: "MediFlow" },
                    { label: "Email de soporte", placeholder: "soporte@mediflow.app", defaultValue: "soporte@mediflow.app" },
                    { label: "WhatsApp de soporte", placeholder: "+52 999 123 4567", defaultValue: "" },
                    { label: "Sitio web", placeholder: "https://mediflow.app", defaultValue: "https://mediflow.app" },
                    { label: "Dominio de subdominos", placeholder: "mediflow.app", defaultValue: "mediflow.app" },
                  ].map(f => (
                    <div key={f.label} className="field-new">
                      <label className="field-new__label">{f.label}</label>
                      <input className="input-new" defaultValue={f.defaultValue} placeholder={f.placeholder} />
                    </div>
                  ))}
                  <div>
                    <ButtonNew variant="primary" onClick={save} disabled={saving}>
                      {saving ? "Guardando…" : "Guardar cambios"}
                    </ButtonNew>
                  </div>
                </div>
              </CardNew>
            </>
          )}

          {/* PRECIOS */}
          {tab === "precios" && (
            <>
              <CardNew title="Planes y precios" sub="Estos son los precios que ven tus clientes al registrarse">
                <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 640 }}>
                  {PLANS_CONFIG.map(plan => (
                    <div
                      key={plan.id}
                      style={{
                        padding: "14px 16px",
                        background: "var(--bg-elev-2)",
                        border: "1px solid var(--border-soft)",
                        borderRadius: 12,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 13 }}>{plan.name}</div>
                        <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 2 }}>{plan.features}</div>
                        <div className="mono" style={{ color: "var(--text-3)", fontSize: 10, marginTop: 4 }}>ID: {plan.id}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                        <span style={{ color: "var(--text-3)", fontSize: 13 }}>$</span>
                        <input
                          defaultValue={plan.price}
                          type="number"
                          className="input-new mono"
                          style={{ width: 80, textAlign: "center", fontWeight: 600 }}
                        />
                        <span style={{ color: "var(--text-3)", fontSize: 12 }}>/mes</span>
                      </div>
                    </div>
                  ))}
                  <div
                    style={{
                      padding: "10px 14px",
                      background: "rgba(245,158,11,0.08)",
                      border: "1px solid rgba(245,158,11,0.25)",
                      borderRadius: 10,
                      fontSize: 12,
                      color: "var(--warning)",
                    }}
                  >
                    Para que los cambios de precio apliquen en el formulario de registro, también actualiza los valores en el archivo{" "}
                    <code className="mono" style={{ background: "var(--bg-elev-2)", padding: "1px 5px", borderRadius: 4 }}>register-form.tsx</code>.
                  </div>
                  <div>
                    <ButtonNew variant="primary" onClick={save} disabled={saving}>
                      {saving ? "Guardando…" : "Guardar precios"}
                    </ButtonNew>
                  </div>
                </div>
              </CardNew>

              <CardNew title="Período de prueba">
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <input
                    defaultValue="14"
                    type="number"
                    className="input-new mono"
                    style={{ width: 80, textAlign: "center", fontWeight: 600 }}
                  />
                  <span style={{ color: "var(--text-3)", fontSize: 13 }}>días de prueba gratuita para nuevas clínicas</span>
                </div>
              </CardNew>
            </>
          )}

          {/* BANCO */}
          {tab === "banco" && (
            <CardNew title="Datos bancarios SPEI" sub="Aparecen en el registro, en la página de pago expirado y en el panel de pagos del admin">
              <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 520 }}>
                {[
                  { label: "Nombre del beneficiario", value: BANK_INFO.nombre },
                  { label: "CLABE interbancaria",     value: BANK_INFO.clabe  },
                  { label: "Banco",                   value: BANK_INFO.banco  },
                ].map(f => (
                  <div key={f.label} className="field-new">
                    <label className="field-new__label">{f.label}</label>
                    <input className="input-new mono" defaultValue={f.value} />
                  </div>
                ))}
                <div
                  style={{
                    padding: "10px 14px",
                    background: "rgba(245,158,11,0.08)",
                    border: "1px solid rgba(245,158,11,0.25)",
                    borderRadius: 10,
                    fontSize: 12,
                    color: "var(--warning)",
                  }}
                >
                  Para que los cambios apliquen en el código, actualiza la constante{" "}
                  <code className="mono" style={{ background: "var(--bg-elev-2)", padding: "1px 5px", borderRadius: 4 }}>BANK_INFO</code>{" "}
                  en los archivos{" "}
                  <code className="mono" style={{ background: "var(--bg-elev-2)", padding: "1px 5px", borderRadius: 4 }}>register-form.tsx</code>,{" "}
                  <code className="mono" style={{ background: "var(--bg-elev-2)", padding: "1px 5px", borderRadius: 4 }}>payments-client.tsx</code>{" "}
                  y{" "}
                  <code className="mono" style={{ background: "var(--bg-elev-2)", padding: "1px 5px", borderRadius: 4 }}>suspended/page.tsx</code>.
                </div>
              </div>
            </CardNew>
          )}

          {/* SEGURIDAD */}
          {tab === "seguridad" && (
            <>
              <CardNew title="Variables de seguridad" sub="Se configuran en Vercel → Settings → Environment Variables">
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {envVars.map(v => (
                    <div
                      key={v.key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 14px",
                        background: "var(--bg-elev-2)",
                        border: "1px solid var(--border-soft)",
                        borderRadius: 10,
                        gap: 12,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div className="mono" style={{ fontSize: 12, color: "var(--text-1)", fontWeight: 500 }}>{v.key}</div>
                        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{v.desc}</div>
                      </div>
                      <BadgeNew tone={v.set ? "success" : "warning"} dot>
                        {v.set ? "Configurada" : "Pendiente"}
                      </BadgeNew>
                    </div>
                  ))}
                </div>
                <a
                  href="https://vercel.com/dashboard"
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    marginTop: 14,
                    fontSize: 12,
                    color: "var(--brand)",
                    fontWeight: 500,
                    textDecoration: "none",
                  }}
                >
                  Ir a Vercel Environment Variables →
                </a>
              </CardNew>

              <CardNew title="2FA Admin" sub="Cómo rotar el código de Google Authenticator">
                <ol style={{ display: "flex", flexDirection: "column", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
                  {[
                    <>Genera un nuevo secret en <a href="https://2fa.live" target="_blank" rel="noreferrer" style={{ color: "var(--brand)" }}>2fa.live</a></>,
                    <>Actualiza <code className="mono" style={{ background: "var(--bg-elev-2)", padding: "1px 5px", borderRadius: 4 }}>ADMIN_TOTP_SECRET</code> en Vercel</>,
                    <>En Google Authenticator, elimina la entrada anterior</>,
                    <>Agrega nueva cuenta con el nuevo secret</>,
                  ].map((text, i) => (
                    <li key={i} style={{ display: "flex", gap: 10, fontSize: 12, color: "var(--text-2)" }}>
                      <span style={{ color: "var(--brand)", fontWeight: 600 }}>{i + 1}.</span>
                      <span>{text}</span>
                    </li>
                  ))}
                </ol>
              </CardNew>
            </>
          )}

          {/* CORREOS */}
          {tab === "correos" && (
            <>
              <CardNew title="Configuración de correos" sub="Por defecto Supabase envía los correos pero tiene límites. Para producción configura un SMTP propio">
                <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 520 }}>
                  {[
                    { label: "Proveedor SMTP", placeholder: "smtp.sendgrid.net", type: "text" },
                    { label: "Puerto",         placeholder: "587",                type: "number" },
                    { label: "Usuario SMTP",   placeholder: "apikey",             type: "text" },
                    { label: "Contraseña SMTP", placeholder: "SG.xxx...",         type: "password" },
                    { label: "Email remitente", placeholder: "hola@mediflow.app", type: "email" },
                    { label: "Nombre remitente", placeholder: "MediFlow",         type: "text" },
                  ].map(f => (
                    <div key={f.label} className="field-new">
                      <label className="field-new__label">{f.label}</label>
                      <input type={f.type} placeholder={f.placeholder} className="input-new" />
                    </div>
                  ))}
                  <div
                    style={{
                      padding: "10px 14px",
                      background: "var(--brand-soft)",
                      border: "1px solid rgba(124,58,237,0.25)",
                      borderRadius: 10,
                      fontSize: 12,
                      color: "var(--text-2)",
                    }}
                  >
                    <strong style={{ color: "var(--text-1)" }}>Recomendado:</strong>{" "}
                    usa <a href="https://resend.com" target="_blank" rel="noreferrer" style={{ color: "var(--brand)", textDecoration: "underline" }}>Resend.com</a> — 3,000 emails/mes gratis, fácil de configurar con Supabase.
                    <br /><br />
                    Instrucciones: Supabase → Authentication → Email → SMTP Settings → pega tus credenciales.
                  </div>
                  <div>
                    <ButtonNew variant="primary" onClick={save} disabled={saving}>
                      {saving ? "Guardando…" : "Guardar configuración SMTP"}
                    </ButtonNew>
                  </div>
                </div>
              </CardNew>

              <CardNew title="Plantillas de correo activas">
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[
                    { name: "Confirmación de registro",   ok: true,  note: "Activo (Supabase)" },
                    { name: "Recuperación de contraseña", ok: true,  note: "Activo (Supabase)" },
                    { name: "Recordatorio de cita",       ok: false, note: "Pendiente" },
                    { name: "Bienvenida al plan",         ok: false, note: "Pendiente" },
                    { name: "Plan por vencer",            ok: false, note: "Pendiente" },
                  ].map(t => (
                    <div
                      key={t.name}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 12px",
                        background: "var(--bg-elev-2)",
                        border: "1px solid var(--border-soft)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    >
                      <span style={{ color: "var(--text-2)" }}>{t.name}</span>
                      <BadgeNew tone={t.ok ? "success" : "warning"} dot>{t.note}</BadgeNew>
                    </div>
                  ))}
                </div>
              </CardNew>
            </>
          )}

          {/* SISTEMA */}
          {tab === "sistema" && (
            <>
              <CardNew title="Información del sistema">
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {[
                    { label: "Versión",       value: "MediFlow v1.0.0" },
                    { label: "Framework",     value: "Next.js 14.2.5" },
                    { label: "Base de datos", value: "Supabase PostgreSQL" },
                    { label: "ORM",           value: "Prisma 5.17.0" },
                    { label: "Deployment",    value: "Vercel" },
                    { label: "Repositorio",   value: "github.com/rafaelpapanaklis/mediflow" },
                  ].map((r, i, arr) => (
                    <div
                      key={r.label}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "10px 0",
                        borderBottom: i === arr.length - 1 ? "none" : "1px solid var(--border-soft)",
                      }}
                    >
                      <span style={{ color: "var(--text-3)", fontSize: 12 }}>{r.label}</span>
                      <span className="mono" style={{ color: "var(--text-2)", fontSize: 12 }}>{r.value}</span>
                    </div>
                  ))}
                </div>
              </CardNew>

              <CardNew title="Próximas funciones a implementar">
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[
                    "Stripe — cobro automático mensual",
                    "Subdominios dinámicos (requiere dominio propio)",
                    "Correos automáticos de recordatorio de cita",
                    "Portal del paciente (acceso a sus registros)",
                    "App móvil (React Native)",
                    "Impresión de recetas médicas en PDF",
                    "Exportar expediente completo en PDF",
                    "Telemedicina / videollamada integrada",
                    "Estadísticas avanzadas con IA",
                  ].map(item => (
                    <div key={item} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-3)" }}>
                      <span style={{ color: "var(--brand)" }}>◦</span> {item}
                    </div>
                  ))}
                </div>
              </CardNew>

              <CardNew title="Zona de peligro">
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <ButtonNew
                    variant="danger"
                    onClick={() => toast.error("Función deshabilitada en esta versión por seguridad")}
                  >
                    Exportar todos los datos
                  </ButtonNew>
                  <ButtonNew
                    variant="danger"
                    onClick={() => toast.error("Función deshabilitada en esta versión por seguridad")}
                  >
                    Limpiar base de datos de prueba
                  </ButtonNew>
                </div>
              </CardNew>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
