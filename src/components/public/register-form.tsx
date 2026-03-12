"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import toast from "react-hot-toast";

const SPECIALTIES = [
  { id: "dental",      icon: "🦷", label: "Odontología"      },
  { id: "medicine",    icon: "🩺", label: "Medicina General" },
  { id: "nutrition",   icon: "🥗", label: "Nutrición"        },
  { id: "psychology",  icon: "🧠", label: "Psicología"       },
  { id: "dermatology", icon: "✨", label: "Dermatología"     },
  { id: "other",       icon: "🏥", label: "Otra"             },
];

const PLANS = [
  { id: "BASIC",  name: "Básico",        price: "$49/mes",  desc: "1 profesional · 200 pacientes"           },
  { id: "PRO",    name: "Profesional ⭐", price: "$99/mes",  desc: "3 profesionales · Ilimitado · WhatsApp"  },
  { id: "CLINIC", name: "Clínica",       price: "$249/mes", desc: "Ilimitado · IA · Telemedicina"           },
];

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex gap-2 mb-6">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className={cn(
          "h-1.5 rounded-full transition-all duration-300",
          i < current ? "bg-emerald-500 w-5" : i === current ? "bg-brand-600 w-5" : "bg-border w-5"
        )} />
      ))}
    </div>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [specialty, setSpecialty] = useState("dental");
  const [plan, setPlan] = useState("PRO");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", password: "", password2: "",
    clinicName: "", country: "México", city: "", phone: "",
  });

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const next = () => { setError(""); setStep(s => Math.min(s+1, 4)); };
  const back = () => { setError(""); setStep(s => Math.max(s-1, 0)); };

  function validateStep() {
    if (step === 0) {
      if (!form.firstName || !form.lastName) { setError("Nombre y apellido son requeridos"); return false; }
      if (!form.email) { setError("El email es requerido"); return false; }
      if (form.password.length < 8) { setError("La contraseña debe tener mínimo 8 caracteres"); return false; }
      if (form.password !== form.password2) { setError("Las contraseñas no coinciden"); return false; }
    }
    if (step === 1) {
      if (!form.clinicName) { setError("El nombre de la clínica es requerido"); return false; }
    }
    return true;
  }

  function handleNext() {
    if (validateStep()) next();
  }

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
          clinicName: form.clinicName, specialty, country: form.country,
          city: form.city, phone: form.phone, plan,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al registrarse");
      toast.success("¡Cuenta creada! Revisa tu correo para confirmar.");
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-[420px]">
      <div className="flex items-center gap-2 font-extrabold text-[19px] text-brand-600 mb-7">
        <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center text-white text-xs font-extrabold">M</div>
        MediFlow
      </div>
      <StepDots current={step} total={5} />

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-4 py-3 mb-4">
          {error}
        </div>
      )}

      {/* STEP 0 */}
      {step === 0 && (
        <div className="animate-fade-up">
          <h1 className="text-2xl font-extrabold mb-1">Crea tu cuenta</h1>
          <p className="text-sm text-muted-foreground mb-6">Paso 1 de 5</p>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Nombre *</Label>
                <Input placeholder="Ana" value={form.firstName} onChange={e => set("firstName", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Apellido *</Label>
                <Input placeholder="García" value={form.lastName} onChange={e => set("lastName", e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Correo electrónico *</Label>
              <Input type="email" placeholder="ana@miclinica.com" value={form.email} onChange={e => set("email", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Contraseña * (mínimo 8 caracteres)</Label>
              <Input type="password" placeholder="••••••••" value={form.password} onChange={e => set("password", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Confirmar contraseña *</Label>
              <Input type="password" placeholder="••••••••" value={form.password2} onChange={e => set("password2", e.target.value)} />
            </div>
          </div>
          <Button className="w-full mt-5" size="lg" onClick={handleNext}>Continuar →</Button>
          <p className="text-center text-sm text-muted-foreground mt-4">
            ¿Ya tienes cuenta?{" "}
            <Link href="/login" className="text-brand-600 font-semibold hover:underline">Inicia sesión</Link>
          </p>
        </div>
      )}

      {/* STEP 1 */}
      {step === 1 && (
        <div className="animate-fade-up">
          <h1 className="text-2xl font-extrabold mb-1">Tu clínica</h1>
          <p className="text-sm text-muted-foreground mb-6">Paso 2 de 5</p>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nombre de tu clínica *</Label>
              <Input placeholder="Clínica Dental García" value={form.clinicName} onChange={e => set("clinicName", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>País</Label>
              <select className="flex h-10 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600"
                value={form.country} onChange={e => set("country", e.target.value)}>
                {["México","Colombia","Argentina","Chile","España","Perú","Ecuador","Otro"].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Ciudad</Label>
                <Input placeholder="Ciudad de México" value={form.city} onChange={e => set("city", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Teléfono</Label>
                <Input placeholder="+52 55..." value={form.phone} onChange={e => set("phone", e.target.value)} />
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-5">
            <Button variant="outline" onClick={back} className="px-5">← Atrás</Button>
            <Button className="flex-1" size="lg" onClick={handleNext}>Continuar →</Button>
          </div>
        </div>
      )}

      {/* STEP 2 */}
      {step === 2 && (
        <div className="animate-fade-up">
          <h1 className="text-2xl font-extrabold mb-1">Tu especialidad</h1>
          <p className="text-sm text-muted-foreground mb-6">Paso 3 de 5</p>
          <div className="grid grid-cols-2 gap-2 mb-5">
            {SPECIALTIES.map(s => (
              <button key={s.id} onClick={() => setSpecialty(s.id)}
                className={cn(
                  "flex items-center gap-2.5 p-3.5 rounded-xl border text-sm font-semibold text-left transition-all",
                  specialty === s.id ? "border-brand-300 bg-brand-50 text-brand-700 shadow-sm" : "border-border bg-white text-muted-foreground hover:border-brand-200"
                )}>
                <span className="text-lg">{s.icon}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={back} className="px-5">← Atrás</Button>
            <Button className="flex-1" size="lg" onClick={next}>Continuar →</Button>
          </div>
        </div>
      )}

      {/* STEP 3 */}
      {step === 3 && (
        <div className="animate-fade-up">
          <h1 className="text-2xl font-extrabold mb-1">Horarios de atención</h1>
          <p className="text-sm text-muted-foreground mb-5">Paso 4 de 5 · Puedes cambiarlos después</p>
          <div className="rounded-xl border border-border overflow-hidden mb-5">
            <div className="grid grid-cols-3 bg-muted/50 px-4 py-2.5 text-xs font-bold text-muted-foreground uppercase tracking-wide">
              <span>Día</span><span>Apertura</span><span>Cierre</span>
            </div>
            {["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"].map((day, i) => (
              <div key={day} className="grid grid-cols-3 items-center px-4 py-2 border-t border-border gap-2">
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                  <input type="checkbox" defaultChecked={i < 5} className="w-4 h-4 rounded accent-brand-600" />
                  {day}
                </label>
                <select className="text-xs rounded-md border border-border px-2 py-1.5" defaultValue="09:00">
                  {["08:00","09:00","10:00"].map(t => <option key={t}>{t}</option>)}
                </select>
                <select className="text-xs rounded-md border border-border px-2 py-1.5" defaultValue="18:00">
                  {["14:00","17:00","18:00","19:00","20:00"].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={back} className="px-5">← Atrás</Button>
            <Button className="flex-1" size="lg" onClick={next}>Continuar →</Button>
          </div>
        </div>
      )}

      {/* STEP 4 */}
      {step === 4 && (
        <div className="animate-fade-up">
          <h1 className="text-2xl font-extrabold mb-1">Elige tu plan</h1>
          <p className="text-sm text-muted-foreground mb-5">Paso 5 de 5 · 14 días gratis, sin tarjeta</p>
          <div className="space-y-2.5 mb-4">
            {PLANS.map(p => (
              <button key={p.id} onClick={() => setPlan(p.id)}
                className={cn(
                  "w-full flex items-center gap-3 p-4 rounded-xl border text-left transition-all",
                  plan === p.id ? "border-brand-300 bg-brand-50 shadow-sm" : "border-border bg-white hover:border-brand-200"
                )}>
                <div className={cn("w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center", plan === p.id ? "border-brand-600 bg-brand-600" : "border-muted-foreground/40")}>
                  {plan === p.id && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold">{p.name} — {p.price}</div>
                  <div className="text-xs text-muted-foreground">{p.desc}</div>
                </div>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={back} className="px-5">← Atrás</Button>
            <Button className="flex-1" size="lg" disabled={loading} onClick={handleSubmit}>
              {loading ? "Creando tu clínica..." : "Crear mi clínica ✦"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
