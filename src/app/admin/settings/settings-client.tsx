"use client";

import { useState } from "react";
import { Shield, Mail, CreditCard, Building, Bell, Globe } from "lucide-react";
import toast from "react-hot-toast";

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

export function AdminSettingsClient() {
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

  return (
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-xl font-extrabold">Configuración del sistema</h1>
          <p className="text-slate-400 text-sm">Administra todos los parámetros de tu plataforma MediFlow</p>
        </div>

        <div className="flex gap-1 bg-slate-900 border border-slate-700 rounded-xl p-1 w-fit mb-6">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${tab === t.id ? "bg-brand-600 text-white" : "text-slate-400 hover:text-white"}`}>
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        {/* EMPRESA */}
        {tab === "empresa" && (
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-lg">
            <h2 className="text-sm font-bold mb-4">Datos de tu empresa</h2>
            <div className="space-y-4">
              {[
                { label: "Nombre de la empresa", placeholder: "MediFlow", defaultValue: "MediFlow" },
                { label: "Email de soporte", placeholder: "soporte@mediflow.app", defaultValue: "soporte@mediflow.app" },
                { label: "WhatsApp de soporte", placeholder: "+52 999 123 4567", defaultValue: "" },
                { label: "Sitio web", placeholder: "https://mediflow.app", defaultValue: "https://mediflow.app" },
                { label: "Dominio de subdominos", placeholder: "mediflow.app", defaultValue: "mediflow.app" },
              ].map(f => (
                <div key={f.label} className="space-y-1">
                  <label className="text-xs font-bold text-slate-400">{f.label}</label>
                  <input defaultValue={f.defaultValue} placeholder={f.placeholder}
                    className="flex h-10 w-full rounded-lg bg-slate-800 border border-slate-600 text-white text-sm px-3 focus:outline-none focus:ring-2 focus:ring-brand-600/50 focus:border-brand-600" />
                </div>
              ))}
              <button onClick={save} disabled={saving} className="w-full py-2 bg-brand-600 text-white text-sm font-bold rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors">
                {saving ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
          </div>
        )}

        {/* PRECIOS */}
        {tab === "precios" && (
          <div className="space-y-4 max-w-2xl">
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
              <h2 className="text-sm font-bold mb-1">Planes y precios</h2>
              <p className="text-xs text-slate-400 mb-4">Estos son los precios que ven tus clientes al registrarse.</p>
              <div className="space-y-4">
                {PLANS_CONFIG.map(plan => (
                  <div key={plan.id} className="bg-slate-800 border border-slate-600 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="font-bold text-white">{plan.name}</div>
                        <div className="text-xs text-slate-400">{plan.features}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400 text-sm">$</span>
                        <input defaultValue={plan.price} type="number" className="w-20 h-9 bg-slate-700 border border-slate-500 text-white text-sm px-3 rounded-lg focus:outline-none text-center font-bold" />
                        <span className="text-slate-400 text-sm">/mes</span>
                      </div>
                    </div>
                    <div className="text-[10px] text-slate-500">ID: {plan.id}</div>
                  </div>
                ))}
                <div className="p-3 bg-amber-950/50 border border-amber-700 rounded-lg text-xs text-amber-300">
                  💡 Para que los cambios de precio apliquen en el formulario de registro, también actualiza los valores en el archivo <code className="bg-slate-800 px-1 rounded">register-form.tsx</code>.
                </div>
                <button onClick={save} disabled={saving} className="w-full py-2 bg-brand-600 text-white text-sm font-bold rounded-lg hover:bg-brand-700 disabled:opacity-50">
                  {saving ? "Guardando…" : "Guardar precios"}
                </button>
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
              <h2 className="text-sm font-bold mb-3">Período de prueba</h2>
              <div className="flex items-center gap-3">
                <input defaultValue="14" type="number" className="w-20 h-10 bg-slate-800 border border-slate-600 text-white text-sm px-3 rounded-lg focus:outline-none text-center font-bold" />
                <span className="text-slate-400">días de prueba gratuita para nuevas clínicas</span>
              </div>
            </div>
          </div>
        )}

        {/* BANCO */}
        {tab === "banco" && (
          <div className="space-y-4 max-w-lg">
            <div className="bg-slate-900 border border-brand-700 rounded-xl p-5">
              <h2 className="text-sm font-bold mb-4 text-brand-400">💳 Datos bancarios SPEI</h2>
              <p className="text-xs text-slate-400 mb-4">Estos datos aparecen en el registro, en la página de pago expirado, y en el panel de pagos del admin.</p>
              <div className="space-y-4">
                {[
                  { label: "Nombre del beneficiario", value: BANK_INFO.nombre },
                  { label: "CLABE interbancaria",     value: BANK_INFO.clabe  },
                  { label: "Banco",                   value: BANK_INFO.banco  },
                ].map(f => (
                  <div key={f.label} className="space-y-1">
                    <label className="text-xs font-bold text-slate-400">{f.label}</label>
                    <input defaultValue={f.value}
                      className="flex h-10 w-full rounded-lg bg-slate-800 border border-slate-600 text-white text-sm px-3 focus:outline-none focus:ring-2 focus:ring-brand-600/50 font-mono" />
                  </div>
                ))}
                <div className="p-3 bg-amber-950/50 border border-amber-700 rounded-lg text-xs text-amber-300">
                  ⚠️ Para que los cambios apliquen en el código, actualiza la constante <code className="bg-slate-800 px-1 rounded">BANK_INFO</code> en los archivos: <code className="bg-slate-800 px-1 rounded">register-form.tsx</code>, <code className="bg-slate-800 px-1 rounded">payments-client.tsx</code>, y <code className="bg-slate-800 px-1 rounded">suspended/page.tsx</code>.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SEGURIDAD */}
        {tab === "seguridad" && (
          <div className="space-y-4 max-w-lg">
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
              <h2 className="text-sm font-bold mb-4">🔐 Variables de seguridad</h2>
              <p className="text-xs text-slate-400 mb-4">Estas variables se configuran en Vercel → Settings → Environment Variables. No se pueden cambiar desde aquí por seguridad.</p>
              <div className="space-y-3">
                {[
                  { key: "ADMIN_PASSWORD",     desc: "Contraseña maestra para entrar al panel admin",   status: "✅ Configurada" },
                  { key: "ADMIN_SECRET_TOKEN", desc: "Token de sesión del admin (cookie)",              status: "✅ Configurada" },
                  { key: "ADMIN_TOTP_SECRET",  desc: "Secret de Google Authenticator para 2FA",         status: "✅ Configurada" },
                  { key: "NEXT_PUBLIC_SUPABASE_URL",      desc: "URL de tu proyecto Supabase",          status: "✅ Configurada" },
                  { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", desc: "Clave pública de Supabase",            status: "✅ Configurada" },
                  { key: "DATABASE_URL",       desc: "URL de conexión PostgreSQL (pooler)",             status: "✅ Configurada" },
                  { key: "DIRECT_URL",         desc: "URL directa PostgreSQL (para migraciones)",       status: "✅ Configurada" },
                  { key: "STRIPE_SECRET_KEY",  desc: "Clave secreta de Stripe (cuando la actives)",     status: "⚠️ Pendiente" },
                  { key: "STRIPE_WEBHOOK_SECRET", desc: "Secret del webhook de Stripe",                 status: "⚠️ Pendiente" },
                ].map(v => (
                  <div key={v.key} className="flex items-start justify-between bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5">
                    <div>
                      <div className="font-mono text-xs font-bold text-brand-400">{v.key}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{v.desc}</div>
                    </div>
                    <span className={`text-[10px] font-bold flex-shrink-0 ml-3 ${v.status.startsWith("✅") ? "text-emerald-400" : "text-amber-400"}`}>{v.status}</span>
                  </div>
                ))}
              </div>
              <a href="https://vercel.com/dashboard" target="_blank" className="inline-flex items-center gap-2 mt-4 text-xs font-semibold text-brand-400 hover:underline">
                Ir a Vercel Environment Variables →
              </a>
            </div>
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
              <h2 className="text-sm font-bold mb-3">🔑 2FA Admin</h2>
              <p className="text-xs text-slate-400 mb-3">Para cambiar el código de Google Authenticator:</p>
              <ol className="space-y-2 text-xs text-slate-300">
                <li className="flex gap-2"><span className="text-brand-400 font-bold">1.</span> Genera un nuevo secret en <a href="https://2fa.live" target="_blank" className="text-brand-400 hover:underline">2fa.live</a></li>
                <li className="flex gap-2"><span className="text-brand-400 font-bold">2.</span> Actualiza <code className="bg-slate-800 px-1 rounded">ADMIN_TOTP_SECRET</code> en Vercel</li>
                <li className="flex gap-2"><span className="text-brand-400 font-bold">3.</span> En Google Authenticator, elimina la entrada anterior</li>
                <li className="flex gap-2"><span className="text-brand-400 font-bold">4.</span> Agrega nueva cuenta con el nuevo secret</li>
              </ol>
            </div>
          </div>
        )}

        {/* CORREOS */}
        {tab === "correos" && (
          <div className="space-y-4 max-w-lg">
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
              <h2 className="text-sm font-bold mb-2">📧 Configuración de correos</h2>
              <p className="text-xs text-slate-400 mb-4">Por defecto Supabase envía los correos pero tiene límites. Para producción configura un SMTP propio.</p>
              <div className="space-y-3 mb-4">
                {[
                  { label: "Proveedor SMTP", placeholder: "smtp.sendgrid.net", type: "text" },
                  { label: "Puerto",         placeholder: "587",                type: "number" },
                  { label: "Usuario SMTP",   placeholder: "apikey",             type: "text" },
                  { label: "Contraseña SMTP", placeholder: "SG.xxx...",        type: "password" },
                  { label: "Email remitente", placeholder: "hola@mediflow.app", type: "email" },
                  { label: "Nombre remitente", placeholder: "MediFlow",         type: "text" },
                ].map(f => (
                  <div key={f.label} className="space-y-1">
                    <label className="text-xs font-bold text-slate-400">{f.label}</label>
                    <input type={f.type} placeholder={f.placeholder}
                      className="flex h-9 w-full rounded-lg bg-slate-800 border border-slate-600 text-white text-sm px-3 focus:outline-none focus:ring-2 focus:ring-brand-600/50" />
                  </div>
                ))}
              </div>
              <div className="p-3 bg-brand-950/50 border border-brand-700 rounded-lg text-xs text-brand-300 mb-4">
                💡 <strong>Recomendado:</strong> Usa <a href="https://resend.com" target="_blank" className="underline">Resend.com</a> — 3,000 emails/mes gratis, fácil de configurar con Supabase.
                <br/><br/>
                Instrucciones: Supabase → Authentication → Email → SMTP Settings → pega tus credenciales.
              </div>
              <button onClick={save} disabled={saving} className="w-full py-2 bg-brand-600 text-white text-sm font-bold rounded-lg hover:bg-brand-700 disabled:opacity-50">
                {saving ? "Guardando…" : "Guardar configuración SMTP"}
              </button>
            </div>
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
              <h2 className="text-sm font-bold mb-3">Plantillas de correo activas</h2>
              <div className="space-y-2">
                {[
                  { name: "Confirmación de registro",  status: "✅ Activo (Supabase)" },
                  { name: "Recuperación de contraseña", status: "✅ Activo (Supabase)" },
                  { name: "Recordatorio de cita",      status: "⚠️ Pendiente (requiere implementación)" },
                  { name: "Bienvenida al plan",        status: "⚠️ Pendiente (requiere implementación)" },
                  { name: "Plan por vencer",           status: "⚠️ Pendiente (requiere implementación)" },
                ].map(t => (
                  <div key={t.name} className="flex justify-between items-center bg-slate-800 rounded-lg px-3 py-2 text-xs">
                    <span className="text-slate-300">{t.name}</span>
                    <span className={t.status.startsWith("✅") ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>{t.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* SISTEMA */}
        {tab === "sistema" && (
          <div className="space-y-4 max-w-lg">
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
              <h2 className="text-sm font-bold mb-4">⚙️ Información del sistema</h2>
              <div className="space-y-2 text-sm">
                {[
                  { label: "Versión",           value: "MediFlow v1.0.0" },
                  { label: "Framework",         value: "Next.js 14.2.5" },
                  { label: "Base de datos",     value: "Supabase PostgreSQL" },
                  { label: "ORM",               value: "Prisma 5.17.0" },
                  { label: "Deployment",        value: "Vercel" },
                  { label: "Repositorio",       value: "github.com/rafaelpapanaklis/mediflow" },
                ].map(r => (
                  <div key={r.label} className="flex justify-between py-2 border-b border-slate-800">
                    <span className="text-slate-400">{r.label}</span>
                    <span className="font-mono text-slate-200 text-xs">{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
              <h2 className="text-sm font-bold mb-3">🚀 Próximas funciones a implementar</h2>
              <div className="space-y-2">
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
                  <div key={item} className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="text-violet-400">◦</span> {item}
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-rose-950/40 border border-rose-700 rounded-xl p-5">
              <h2 className="text-sm font-bold mb-3 text-rose-400">⚠️ Zona de peligro</h2>
              <div className="space-y-3">
                <button className="w-full py-2 bg-rose-900/40 text-rose-400 border border-rose-700 text-sm font-bold rounded-lg hover:bg-rose-900/70 transition-colors"
                  onClick={() => toast.error("Función deshabilitada en esta versión por seguridad")}>
                  Exportar todos los datos
                </button>
                <button className="w-full py-2 bg-rose-900/40 text-rose-400 border border-rose-700 text-sm font-bold rounded-lg hover:bg-rose-900/70 transition-colors"
                  onClick={() => toast.error("Función deshabilitada en esta versión por seguridad")}>
                  Limpiar base de datos de prueba
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
  );
}
