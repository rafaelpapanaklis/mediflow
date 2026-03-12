"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/* ── Step indicator ── */
function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex gap-2 mb-6">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "h-1.5 rounded-full transition-all duration-300",
            i < current
              ? "bg-emerald-500 w-5"
              : i === current
              ? "bg-brand-600 w-5"
              : "bg-border w-5"
          )}
        />
      ))}
    </div>
  );
}

/* ── Specialty card ── */
const specialties = [
  { id: "dental",      icon: "🦷", label: "Odontología"       },
  { id: "medicine",    icon: "🩺", label: "Medicina General"  },
  { id: "nutrition",   icon: "🥗", label: "Nutrición"         },
  { id: "psychology",  icon: "🧠", label: "Psicología"        },
  { id: "dermatology", icon: "✨", label: "Dermatología"      },
  { id: "other",       icon: "🏥", label: "Otra especialidad" },
];

const plans = [
  {
    id: "basic",
    name: "Básico",
    price: "$49/mes",
    desc: "1 profesional · 200 pacientes",
    badge: null,
  },
  {
    id: "pro",
    name: "Profesional ⭐",
    price: "$99/mes",
    desc: "3 profesionales · Ilimitado · WhatsApp",
    badge: "Más popular",
  },
  {
    id: "clinic",
    name: "Clínica",
    price: "$249/mes",
    desc: "Ilimitado · IA · Telemedicina",
    badge: null,
  },
];

const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const DEFAULT_HOURS = { enabled: true, open: "09:00", close: "18:00" };
const WEEKEND_HOURS = { enabled: false, open: "09:00", close: "14:00" };

export function RegisterForm() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [selectedSpecialty, setSelectedSpecialty] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState("pro");
  const [schedule] = useState(
    DAYS.map((d, i) => ({ day: d, ...(i < 5 ? DEFAULT_HOURS : WEEKEND_HOURS) }))
  );

  const next = () => setStep((s) => Math.min(s + 1, 4));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <div className="w-full max-w-[420px]">
      {/* Logo */}
      <div className="flex items-center gap-2 font-extrabold text-[19px] text-brand-600 tracking-tight mb-7">
        <span className="w-2 h-2 rounded-full bg-brand-600" />
        MediFlow
      </div>

      <StepDots current={step} total={5} />

      {/* ── STEP 0: Account ── */}
      {step === 0 && (
        <div className="animate-fade-up">
          <h1 className="text-2xl font-extrabold tracking-tight mb-1">Crea tu cuenta</h1>
          <p className="text-sm text-muted-foreground mb-6">Paso 1 de 5 · Comencemos con tus datos</p>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="space-y-1.5">
              <Label htmlFor="reg-first">Nombre</Label>
              <Input id="reg-first" placeholder="Ana" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-last">Apellido</Label>
              <Input id="reg-last" placeholder="García" />
            </div>
          </div>
          <div className="space-y-1.5 mb-3">
            <Label htmlFor="reg-email">Correo electrónico</Label>
            <Input id="reg-email" type="email" placeholder="ana@miclinica.com" />
          </div>
          <div className="space-y-1.5 mb-3">
            <Label htmlFor="reg-pass">Contraseña</Label>
            <Input id="reg-pass" type="password" placeholder="Mínimo 8 caracteres" />
          </div>
          <div className="space-y-1.5 mb-5">
            <Label htmlFor="reg-pass2">Confirmar contraseña</Label>
            <Input id="reg-pass2" type="password" placeholder="Repite tu contraseña" />
          </div>

          <Button className="w-full" size="lg" onClick={next}>Continuar →</Button>
          <p className="text-center text-sm text-muted-foreground mt-4">
            ¿Ya tienes cuenta?{" "}
            <Link href="/login" className="text-brand-600 font-semibold hover:underline">Inicia sesión</Link>
          </p>
        </div>
      )}

      {/* ── STEP 1: Clinic ── */}
      {step === 1 && (
        <div className="animate-fade-up">
          <h1 className="text-2xl font-extrabold tracking-tight mb-1">Tu clínica</h1>
          <p className="text-sm text-muted-foreground mb-6">Paso 2 de 5 · Cuéntanos sobre tu consultorio</p>

          <div className="space-y-3 mb-5">
            <div className="space-y-1.5">
              <Label>Nombre de tu clínica o consultorio</Label>
              <Input placeholder="Ej: Clínica Dental García, Consultorio Dr. López" />
            </div>
            <div className="space-y-1.5">
              <Label>País</Label>
              <select className="flex h-10 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 transition-all">
                <option>México</option>
                <option>Colombia</option>
                <option>Argentina</option>
                <option>Chile</option>
                <option>España</option>
                <option>Perú</option>
                <option>Ecuador</option>
                <option>Otro</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Ciudad</Label>
                <Input placeholder="Ciudad de México" />
              </div>
              <div className="space-y-1.5">
                <Label>Teléfono</Label>
                <Input placeholder="+52 55 1234 5678" />
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={back} className="px-5">← Atrás</Button>
            <Button className="flex-1" size="lg" onClick={next}>Continuar →</Button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Specialty ── */}
      {step === 2 && (
        <div className="animate-fade-up">
          <h1 className="text-2xl font-extrabold tracking-tight mb-1">Tu especialidad</h1>
          <p className="text-sm text-muted-foreground mb-6">Paso 3 de 5 · Así personalizamos tu panel</p>

          <div className="grid grid-cols-2 gap-2 mb-4">
            {specialties.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedSpecialty(s.id)}
                className={cn(
                  "flex items-center gap-2.5 p-3.5 rounded-xl border text-sm font-semibold text-left transition-all",
                  selectedSpecialty === s.id
                    ? "border-brand-300 bg-brand-50 text-brand-700 shadow-sm"
                    : "border-border bg-white text-muted-foreground hover:border-brand-200 hover:bg-brand-50/50"
                )}
              >
                <span className="text-lg">{s.icon}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </div>

          <div className="space-y-1.5 mb-5">
            <Label>¿Cuántos profesionales trabajan contigo?</Label>
            <select className="flex h-10 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 transition-all">
              <option>Solo yo</option>
              <option>2-3 profesionales</option>
              <option>4-10 profesionales</option>
              <option>Más de 10</option>
            </select>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={back} className="px-5">← Atrás</Button>
            <Button className="flex-1" size="lg" onClick={next}>Continuar →</Button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Schedule ── */}
      {step === 3 && (
        <div className="animate-fade-up">
          <h1 className="text-2xl font-extrabold tracking-tight mb-1">Horarios de atención</h1>
          <p className="text-sm text-muted-foreground mb-5">Paso 4 de 5 · Configura tu disponibilidad</p>

          <div className="rounded-xl border border-border overflow-hidden mb-5">
            <div className="grid grid-cols-3 bg-muted/50 px-4 py-2.5 text-xs font-bold text-muted-foreground uppercase tracking-wide">
              <span>Día</span><span>Apertura</span><span>Cierre</span>
            </div>
            {schedule.map((row) => (
              <div key={row.day} className="grid grid-cols-3 items-center px-4 py-2 border-t border-border gap-2">
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    defaultChecked={row.enabled}
                    className="w-4 h-4 rounded accent-brand-600"
                  />
                  {row.day.slice(0, 3)}
                </label>
                <select
                  className={cn(
                    "text-xs rounded-md border border-border px-2 py-1.5",
                    !row.enabled && "opacity-40"
                  )}
                  defaultValue={row.open}
                  disabled={!row.enabled}
                >
                  {["08:00","09:00","10:00"].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                <select
                  className={cn(
                    "text-xs rounded-md border border-border px-2 py-1.5",
                    !row.enabled && "opacity-40"
                  )}
                  defaultValue={row.close}
                  disabled={!row.enabled}
                >
                  {["14:00","17:00","18:00","19:00","20:00"].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
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

      {/* ── STEP 4: Plan ── */}
      {step === 4 && (
        <div className="animate-fade-up">
          <h1 className="text-2xl font-extrabold tracking-tight mb-1">Elige tu plan</h1>
          <p className="text-sm text-muted-foreground mb-5">Paso 5 de 5 · Prueba gratis 14 días, sin tarjeta</p>

          <div className="space-y-2.5 mb-4">
            {plans.map((plan) => (
              <button
                key={plan.id}
                onClick={() => setSelectedPlan(plan.id)}
                className={cn(
                  "w-full flex items-center gap-3 p-4 rounded-xl border text-left transition-all",
                  selectedPlan === plan.id
                    ? "border-brand-300 bg-brand-50 shadow-sm"
                    : "border-border bg-white hover:border-brand-200"
                )}
              >
                <div className={cn(
                  "w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center",
                  selectedPlan === plan.id
                    ? "border-brand-600 bg-brand-600"
                    : "border-muted-foreground/40"
                )}>
                  {selectedPlan === plan.id && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold text-foreground">{plan.name} — {plan.price}</div>
                  <div className="text-xs text-muted-foreground">{plan.desc}</div>
                </div>
                <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex-shrink-0">
                  14 días gratis
                </span>
              </button>
            ))}
          </div>

          <div className="flex items-start gap-2.5 bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 mb-5">
            <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-emerald-800 leading-relaxed">
              <strong>Sin tarjeta de crédito requerida.</strong> Tienes 14 días para explorar todo.
              Al terminar, te preguntaremos si deseas continuar.
            </p>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={back} className="px-5">← Atrás</Button>
            <Button
              className="flex-1"
              size="lg"
              onClick={() => router.push("/dashboard")}
            >
              Crear mi clínica ✦
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
