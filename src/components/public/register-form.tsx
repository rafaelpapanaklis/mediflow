"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, X, Loader2, Stethoscope, Heart, Apple, Brain, Scan, Activity, Footprints, Sparkles, Scissors, Star, Eye, Hand, Zap, Leaf, Palette, Waves } from "lucide-react";
import { cn } from "@/lib/utils";
import toast from "react-hot-toast";

const CATEGORIES = [
  { group: "Salud", items: [
    { id: "DENTAL", label: "Odontología", icon: Stethoscope },
    { id: "MEDICINE", label: "Medicina General", icon: Heart },
    { id: "NUTRITION", label: "Nutrición", icon: Apple },
    { id: "PSYCHOLOGY", label: "Psicología", icon: Brain },
    { id: "DERMATOLOGY", label: "Dermatología", icon: Scan },
    { id: "PHYSIOTHERAPY", label: "Fisioterapia", icon: Activity },
    { id: "PODIATRY", label: "Podología", icon: Footprints },
  ]},
  { group: "Medicina Estética", items: [
    { id: "AESTHETIC_MEDICINE", label: "Medicina Estética", icon: Sparkles },
    { id: "HAIR_RESTORATION", label: "Clínicas Capilares", icon: Scissors },
  ]},
  { group: "Belleza y Bienestar", items: [
    { id: "BEAUTY_CENTER", label: "Centros de Estética", icon: Star },
    { id: "BROW_LASH", label: "Cejas y Pestañas", icon: Eye },
    { id: "MASSAGE", label: "Masajes", icon: Hand },
    { id: "LASER_HAIR_REMOVAL", label: "Depilación Láser", icon: Zap },
    { id: "HAIR_SALON", label: "Peluquerías y Barberías", icon: Scissors },
    { id: "ALTERNATIVE_MEDICINE", label: "Medicina Alternativa", icon: Leaf },
    { id: "NAIL_SALON", label: "Uñas", icon: Palette },
    { id: "SPA", label: "Spas", icon: Waves },
  ]},
];
const ALL_CATEGORIES = CATEGORIES.flatMap(g => g.items);

const PLANS = [
  { id: "BASIC",  name: "Básico",        price: "$49",  per: "mes", desc: "1 profesional · 200 pacientes",                          features: ["Agenda y citas","Pacientes básico","Facturación","Soporte email"] },
  { id: "PRO",    name: "Profesional ⭐", price: "$99",  per: "mes", desc: "3 profesionales · Ilimitado",                           features: ["Todo Básico","Expedientes clínicos","Reportes avanzados","WhatsApp","Soporte prioritario"] },
  { id: "CLINIC", name: "Clínica",       price: "$249", per: "mes", desc: "Ilimitado todo",                                         features: ["Todo Pro","Múltiples sucursales","API access","Manager de cuenta"] },
];

const BANK_INFO = {
  nombre: "Efthymios Rafail Papanaklis",
  clabe:  "012910015008025244",
  banco:  "BBVA",
};

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex gap-1.5 mb-6">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className={cn("h-1.5 rounded-full transition-all duration-300 w-6",
          i < current ? "bg-emerald-500" : i === current ? "bg-brand-600" : "bg-border"
        )} />
      ))}
    </div>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const [step, setStep]         = useState(0);
  const [loading, setLoading]   = useState(false);
  const [checkingSlug, setCheckingSlug] = useState(false);
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [category, setCategory] = useState("DENTAL");
  const [plan, setPlan]           = useState("PRO");
  const [payMethod, setPayMethod] = useState<"stripe" | "transfer">("transfer");
  const [error, setError]         = useState("");
  const [registered, setRegistered] = useState(false);

  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", password: "", password2: "",
    clinicName: "", slug: "", country: "México", city: "", phone: "",
  });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  function slugify(text: string) {
    return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 30);
  }

  function handleClinicNameChange(name: string) {
    set("clinicName", name);
    const newSlug = slugify(name);
    set("slug", newSlug);
    if (newSlug.length >= 3) checkSlugAvailability(newSlug);
  }

  async function checkSlugAvailability(slug: string) {
    if (slug.length < 3) { setSlugAvailable(null); return; }
    setCheckingSlug(true);
    try {
      const res = await fetch(`/api/check-slug?slug=${slug}`);
      const data = await res.json();
      setSlugAvailable(data.available);
    } catch {
      setSlugAvailable(null);
    } finally {
      setCheckingSlug(false);
    }
  }

  async function validateStep(): Promise<boolean> {
    if (step === 0) {
      if (!form.firstName || !form.lastName) { setError("Nombre y apellido son requeridos"); return false; }
      if (!form.email) { setError("El email es requerido"); return false; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) { setError("El formato de email no es válido"); return false; }
      if (form.password.length < 8) { setError("La contraseña debe tener mínimo 8 caracteres"); return false; }
      if (form.password !== form.password2) { setError("Las contraseñas no coinciden"); return false; }
      // Check if email already exists
      try {
        const res = await fetch(`/api/auth/check-email?email=${encodeURIComponent(form.email)}`);
        const data = await res.json();
        if (data.exists) { setError("EMAIL_EXISTS"); return false; }
      } catch { /* if check fails, let registration handle it */ }
    }
    if (step === 1) {
      if (!form.clinicName) { setError("El nombre de la clínica es requerido"); return false; }
      if (!form.slug || form.slug.length < 3) { setError("El subdominio debe tener mínimo 3 caracteres"); return false; }
      if (slugAvailable === false) { setError("Ese subdominio ya está en uso"); return false; }
    }
    return true;
  }

  async function next() { setLoading(true); const valid = await validateStep(); setLoading(false); if (valid) { setError(""); setStep(s => s + 1); } }
  function back() { setError(""); setStep(s => s - 1); }

  async function handleSubmit() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName, lastName: form.lastName,
          email: form.email, password: form.password,
          clinicName: form.clinicName, slug: form.slug,
          category, country: form.country, city: form.city,
          phone: form.phone, plan, paymentMethod: payMethod,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al registrarse");

      if (payMethod === "transfer") {
        setRegistered(true);
      } else {
        // Stripe - redirect to checkout
        if (data.checkoutUrl) {
          window.location.href = data.checkoutUrl;
        } else {
          router.push("/dashboard");
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Success screen for transfer payment
  if (registered && payMethod === "transfer") {
    return (
      <div className="w-full max-w-[440px] animate-fade-up">
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center text-3xl mx-auto mb-4">✅</div>
          <h1 className="text-2xl font-extrabold mb-2">¡Cuenta creada!</h1>
          <p className="text-sm text-muted-foreground">Tu clínica está lista. Solo falta activar tu plan.</p>
        </div>

        <div className="rounded-xl border border-border bg-white dark:bg-slate-900 p-5 mb-4">
          <div className="text-sm font-bold mb-3">💳 Realiza tu pago por transferencia SPEI</div>
          <div className="space-y-2.5 text-sm">
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted-foreground">Nombre</span>
              <span className="font-semibold">{BANK_INFO.nombre}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted-foreground">CLABE</span>
              <span className="font-mono font-extrabold text-brand-700 text-base tracking-wider">{BANK_INFO.clabe}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted-foreground">Banco</span>
              <span className="font-semibold">{BANK_INFO.banco}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Monto</span>
              <span className="font-extrabold text-brand-700">{PLANS.find(p => p.id === plan)?.price}/mes</span>
            </div>
          </div>
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
            <strong>Importante:</strong> En el concepto de la transferencia escribe el nombre de tu clínica: <strong>{form.clinicName}</strong>. Tu plan se activará en máximo 24 horas hábiles.
          </div>
        </div>

        <div className="rounded-xl border border-border bg-white dark:bg-slate-900 p-4 mb-4 text-sm">
          <div className="font-bold mb-1">Mientras tanto puedes acceder con 14 días de prueba gratuita</div>
          <p className="text-xs text-muted-foreground">Tu cuenta ya está creada. Puedes ingresar ahora y empezar a usar el sistema.</p>
        </div>

        <Link href="/login" className="block w-full text-center bg-brand-600 text-white font-bold py-3 rounded-xl hover:bg-brand-700 transition-colors">
          Ir al panel de control →
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[440px]">
      <div className="flex items-center gap-2 font-extrabold text-[19px] text-brand-600 mb-7">
        <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center text-white text-xs font-extrabold">M</div>
        MediFlow
      </div>
      <StepDots current={step} total={6} />

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-4 py-3 mb-4">
          {error === "EMAIL_EXISTS" ? (
            <>Este correo electrónico ya está registrado. ¿Ya tienes cuenta? <Link href="/login" className="font-bold underline hover:text-rose-900">Inicia sesión →</Link></>
          ) : error}
        </div>
      )}

      {/* STEP 0 - Personal info */}
      {step === 0 && (
        <div className="animate-fade-up">
          <h1 className="text-2xl font-extrabold mb-1">Crea tu cuenta</h1>
          <p className="text-sm text-muted-foreground mb-6">Paso 1 de 6</p>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Nombre *</label>
                <input className="flex h-10 w-full rounded-lg border border-border bg-white dark:bg-slate-900 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder="Ana" value={form.firstName} onChange={e => set("firstName", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Apellido *</label>
                <input className="flex h-10 w-full rounded-lg border border-border bg-white dark:bg-slate-900 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder="García" value={form.lastName} onChange={e => set("lastName", e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Correo electrónico *</label>
              <input type="email" className="flex h-10 w-full rounded-lg border border-border bg-white dark:bg-slate-900 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder="ana@miclinica.com" value={form.email} onChange={e => set("email", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Contraseña * (mínimo 8 caracteres)</label>
              <input type="password" className="flex h-10 w-full rounded-lg border border-border bg-white dark:bg-slate-900 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder="••••••••" value={form.password} onChange={e => set("password", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Confirmar contraseña *</label>
              <input type="password" className="flex h-10 w-full rounded-lg border border-border bg-white dark:bg-slate-900 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder="••••••••" value={form.password2} onChange={e => set("password2", e.target.value)} />
            </div>
          </div>
          <button onClick={next} disabled={loading} className="w-full mt-5 h-11 bg-brand-600 text-white font-bold rounded-xl hover:bg-brand-700 disabled:opacity-50 transition-colors">
            {loading ? "Verificando…" : "Continuar →"}
          </button>
          <p className="text-center text-sm text-muted-foreground mt-4">
            ¿Ya tienes cuenta? <Link href="/login" className="text-brand-600 font-semibold hover:underline">Inicia sesión</Link>
          </p>
        </div>
      )}

      {/* STEP 1 - Clinic info + subdomain */}
      {step === 1 && (
        <div className="animate-fade-up">
          <h1 className="text-2xl font-extrabold mb-1">Tu clínica</h1>
          <p className="text-sm text-muted-foreground mb-6">Paso 2 de 6</p>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Nombre de tu clínica *</label>
              <input className="flex h-10 w-full rounded-lg border border-border bg-white dark:bg-slate-900 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder="Clínica Dental García" value={form.clinicName}
                onChange={e => handleClinicNameChange(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Tu URL / subdominio *</label>
              <div className="relative">
                <div className="flex items-center h-10 rounded-lg border border-border bg-white dark:bg-slate-900 overflow-hidden focus-within:ring-2 focus-within:ring-brand-600/20 focus-within:border-brand-600">
                  <input className="flex-1 px-3 text-sm focus:outline-none bg-transparent"
                    placeholder="mi-clinica"
                    value={form.slug}
                    onChange={e => {
                      const v = slugify(e.target.value);
                      set("slug", v);
                      checkSlugAvailability(v);
                    }}
                  />
                  <div className="px-3 bg-muted border-l border-border text-xs text-muted-foreground font-mono h-full flex items-center flex-shrink-0">
                    .mediflow.app
                  </div>
                </div>
                <div className="absolute right-[105px] top-1/2 -translate-y-1/2">
                  {checkingSlug && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                  {!checkingSlug && slugAvailable === true  && <Check className="w-3.5 h-3.5 text-emerald-500" />}
                  {!checkingSlug && slugAvailable === false && <X    className="w-3.5 h-3.5 text-rose-500"    />}
                </div>
              </div>
              {slugAvailable === true  && <p className="text-xs text-emerald-600 font-semibold">✓ Disponible — {form.slug}.mediflow.app</p>}
              {slugAvailable === false && <p className="text-xs text-rose-600 font-semibold">✗ No disponible, elige otro nombre</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">País</label>
                <select className="flex h-10 w-full rounded-lg border border-border bg-white dark:bg-slate-900 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  value={form.country} onChange={e => set("country", e.target.value)}>
                  {["México","Colombia","Argentina","Chile","España","Perú","Ecuador","Otro"].map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Ciudad</label>
                <input className="flex h-10 w-full rounded-lg border border-border bg-white dark:bg-slate-900 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder="CDMX" value={form.city} onChange={e => set("city", e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Teléfono</label>
              <input className="flex h-10 w-full rounded-lg border border-border bg-white dark:bg-slate-900 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder="+52 55..." value={form.phone} onChange={e => set("phone", e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2 mt-5">
            <button onClick={back} className="px-5 h-11 border border-border rounded-xl text-sm font-semibold hover:bg-muted transition-colors">← Atrás</button>
            <button onClick={next} className="flex-1 h-11 bg-brand-600 text-white font-bold rounded-xl hover:bg-brand-700 transition-colors">Continuar →</button>
          </div>
        </div>
      )}

      {/* STEP 2 - Category */}
      {step === 2 && (
        <div className="animate-fade-up">
          <h1 className="text-2xl font-extrabold mb-1">Tu especialidad</h1>
          <p className="text-sm text-muted-foreground mb-6">Paso 3 de 6</p>
          <div className="space-y-4 mb-5 max-h-[50vh] overflow-y-auto pr-1">
            {CATEGORIES.map(group => (
              <div key={group.group}>
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">{group.group}</h3>
                <div className="grid grid-cols-2 gap-2">
                  {group.items.map(item => {
                    const Icon = item.icon;
                    return (
                      <button key={item.id} onClick={() => setCategory(item.id)}
                        className={cn("flex items-center gap-2.5 p-3 rounded-xl border text-sm font-semibold text-left transition-all",
                          category === item.id ? "border-brand-300 bg-brand-50 text-brand-700 shadow-sm" : "border-border bg-white text-muted-foreground hover:border-brand-200"
                        )}>
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        <span className="text-xs">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={back} className="px-5 h-11 border border-border rounded-xl text-sm font-semibold hover:bg-muted transition-colors">← Atrás</button>
            <button onClick={next} className="flex-1 h-11 bg-brand-600 text-white font-bold rounded-xl hover:bg-brand-700 transition-colors">Continuar →</button>
          </div>
        </div>
      )}

      {/* STEP 3 - Plan */}
      {step === 3 && (
        <div className="animate-fade-up">
          <h1 className="text-2xl font-extrabold mb-1">Elige tu plan</h1>
          <p className="text-sm text-muted-foreground mb-5">Paso 4 de 6 · 14 días gratis, sin tarjeta</p>
          <div className="space-y-2.5 mb-4">
            {PLANS.map(p => (
              <button key={p.id} onClick={() => setPlan(p.id)}
                className={cn("w-full p-4 rounded-xl border text-left transition-all",
                  plan === p.id ? "border-brand-300 bg-brand-50 dark:bg-brand-950/30 shadow-sm" : "border-border bg-white dark:bg-slate-900 hover:border-brand-200"
                )}>
                <div className="flex items-center gap-3 mb-2">
                  <div className={cn("w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center",
                    plan === p.id ? "border-brand-600 bg-brand-600" : "border-muted-foreground/40")}>
                    {plan === p.id && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                  <div className="flex-1">
                    <span className="text-sm font-bold">{p.name}</span>
                    <span className="ml-2 text-brand-700 font-extrabold">{p.price}/{p.per}</span>
                  </div>
                </div>
                <div className="pl-7 grid grid-cols-2 gap-0.5">
                  {p.features.map(f => <div key={f} className="text-xs text-muted-foreground flex items-center gap-1"><span className="text-emerald-500">✓</span>{f}</div>)}
                </div>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={back} className="px-5 h-11 border border-border rounded-xl text-sm font-semibold hover:bg-muted transition-colors">← Atrás</button>
            <button onClick={next} className="flex-1 h-11 bg-brand-600 text-white font-bold rounded-xl hover:bg-brand-700 transition-colors">Continuar →</button>
          </div>
        </div>
      )}

      {/* STEP 4 - Payment method */}
      {step === 4 && (
        <div className="animate-fade-up">
          <h1 className="text-2xl font-extrabold mb-1">Método de pago</h1>
          <p className="text-sm text-muted-foreground mb-5">Paso 5 de 6</p>

          <div className="space-y-3 mb-5">
            {/* Stripe */}
            <button onClick={() => setPayMethod("stripe")}
              className={cn("w-full p-4 rounded-xl border text-left transition-all",
                payMethod === "stripe" ? "border-brand-300 bg-brand-50 dark:bg-brand-950/30 shadow-sm" : "border-border bg-white dark:bg-slate-900 hover:border-brand-200")}>
              <div className="flex items-center gap-3">
                <div className={cn("w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center",
                  payMethod === "stripe" ? "border-brand-600 bg-brand-600" : "border-muted-foreground/40")}>
                  {payMethod === "stripe" && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold flex items-center gap-2">
                    💳 Tarjeta de crédito / débito
                    <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">Activación inmediata</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">Visa, Mastercard, AMEX · Procesado por Stripe</div>
                </div>
              </div>
            </button>

            {/* Transfer */}
            <button onClick={() => setPayMethod("transfer")}
              className={cn("w-full p-4 rounded-xl border text-left transition-all",
                payMethod === "transfer" ? "border-brand-300 bg-brand-50 dark:bg-brand-950/30 shadow-sm" : "border-border bg-white dark:bg-slate-900 hover:border-brand-200")}>
              <div className="flex items-center gap-3">
                <div className={cn("w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center",
                  payMethod === "transfer" ? "border-brand-600 bg-brand-600" : "border-muted-foreground/40")}>
                  {payMethod === "transfer" && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold flex items-center gap-2">
                    🏦 Transferencia SPEI / CLABE
                    <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">Activación en 24h</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">Transferencia bancaria a cuenta BBVA</div>
                  {payMethod === "transfer" && (
                    <div className="mt-2 p-2.5 bg-slate-50 dark:bg-slate-800 border border-border rounded-lg text-xs space-y-1">
                      <div className="flex justify-between"><span className="text-muted-foreground">Nombre</span><span className="font-semibold">{BANK_INFO.nombre}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">CLABE</span><span className="font-mono font-bold text-brand-700">{BANK_INFO.clabe}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Banco</span><span className="font-semibold">{BANK_INFO.banco}</span></div>
                    </div>
                  )}
                </div>
              </div>
            </button>
          </div>

          <div className="flex gap-2">
            <button onClick={back} className="px-5 h-11 border border-border rounded-xl text-sm font-semibold hover:bg-muted transition-colors">← Atrás</button>
            <button onClick={next} className="flex-1 h-11 bg-brand-600 text-white font-bold rounded-xl hover:bg-brand-700 transition-colors">Continuar →</button>
          </div>
        </div>
      )}

      {/* STEP 5 - Confirm */}
      {step === 5 && (
        <div className="animate-fade-up">
          <h1 className="text-2xl font-extrabold mb-1">Confirmar y crear</h1>
          <p className="text-sm text-muted-foreground mb-5">Paso 6 de 6 · Revisa tu información</p>

          <div className="rounded-xl border border-border bg-white dark:bg-slate-900 divide-y divide-border mb-5">
            {[
              { label: "Nombre",       val: `${form.firstName} ${form.lastName}` },
              { label: "Email",        val: form.email                            },
              { label: "Clínica",      val: form.clinicName                       },
              { label: "URL",          val: `${form.slug}.mediflow.app`            },
              { label: "Especialidad", val: ALL_CATEGORIES.find(s => s.id === category)?.label ?? category },
              { label: "Plan",         val: `${PLANS.find(p => p.id === plan)?.name} · ${PLANS.find(p => p.id === plan)?.price}/mes` },
              { label: "Pago",         val: payMethod === "stripe" ? "Tarjeta de crédito" : "Transferencia SPEI" },
            ].map(r => (
              <div key={r.label} className="flex justify-between items-center px-4 py-3 text-sm">
                <span className="text-muted-foreground">{r.label}</span>
                <span className="font-semibold">{r.val}</span>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button onClick={back} className="px-5 h-11 border border-border rounded-xl text-sm font-semibold hover:bg-muted transition-colors">← Atrás</button>
            <button onClick={handleSubmit} disabled={loading} className="flex-1 h-11 bg-brand-600 text-white font-bold rounded-xl hover:bg-brand-700 disabled:opacity-50 transition-colors">
              {loading ? "Creando tu clínica…" : payMethod === "stripe" ? "Pagar y crear clínica →" : "Crear clínica y ver datos de pago →"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
