"use client";

import { useState } from "react";
import { SectionHeader } from "@/components/shared/section-header";
import { cn } from "@/lib/utils";

const specialties = [
  {
    id: "dental",
    icon: "🦷",
    label: "Odontólogos",
    color: "text-brand-600",
    activeBg: "bg-brand-50 border-brand-200",
    features: [
      "Odontograma interactivo con 32 dientes",
      "Presupuestos por tratamiento en segundos",
      "Control de ortodoncia y aparatología",
      "Esterilización y mantenimiento de equipos",
      "Fotografías intraorales adjuntas al expediente",
      "Receta digital con QR verificable",
    ],
    preview: {
      title: "Odontograma — Ana García",
      content: "🦷 32 dientes · 3 con caries · 2 coronas · Vista adulto/temporal",
      subItems: [
        { tooth: "17", state: "Caries mesial",  color: "bg-rose-100 text-rose-700"    },
        { tooth: "16", state: "Corona cerámica",color: "bg-brand-100 text-brand-700"  },
        { tooth: "14", state: "Obturado resina",color: "bg-violet-100 text-violet-700"},
      ],
    },
  },
  {
    id: "medicine",
    icon: "🩺",
    label: "Médicos",
    color: "text-emerald-600",
    activeBg: "bg-emerald-50 border-emerald-200",
    features: [
      "Notas SOAP estructuradas con IA",
      "Diagnósticos con CIE-10 integrado",
      "Recetas digitales firmadas con QR",
      "Signos vitales y evolución gráfica",
      "Historial de medicamentos y alergias",
      "Órdenes de laboratorio digitales",
    ],
    preview: {
      title: "Nota clínica — Roberto Sánchez",
      content: "📋 SOAP estructurado · CIE-10 K02.1 · Receta digital",
      subItems: [
        { tooth: "S",  state: "Dolor molar derecho 8/10",  color: "bg-amber-100 text-amber-700"   },
        { tooth: "O",  state: "Caries prof. diente 17",    color: "bg-brand-100 text-brand-700"   },
        { tooth: "P",  state: "Extracción + antibiótico",  color: "bg-emerald-100 text-emerald-700"},
      ],
    },
  },
  {
    id: "nutrition",
    icon: "🥗",
    label: "Nutriólogos",
    color: "text-amber-600",
    activeBg: "bg-amber-50 border-amber-200",
    features: [
      "Medidas antropométricas y evolución",
      "Gráfica de peso, IMC y grasa corporal",
      "Planes de alimentación personalizados",
      "Cálculo automático de macronutrientes",
      "Seguimiento de metas y adherencia",
      "Recordatorios de pesa y control",
    ],
    preview: {
      title: "Seguimiento — María Rodríguez",
      content: "📊 28 años · 65kg → 58kg · Meta: 55kg",
      subItems: [
        { tooth: "IMC",  state: "24.1 → 21.8",      color: "bg-emerald-100 text-emerald-700" },
        { tooth: "Peso", state: "−7kg en 3 meses",  color: "bg-brand-100 text-brand-700"    },
        { tooth: "Meta", state: "3kg restantes",    color: "bg-amber-100 text-amber-700"    },
      ],
    },
  },
  {
    id: "psychology",
    icon: "🧠",
    label: "Psicólogos",
    color: "text-violet-600",
    activeBg: "bg-violet-50 border-violet-200",
    features: [
      "Notas de sesión privadas (solo el terapeuta)",
      "Escalas psicológicas PHQ-9, GAD-7, Beck",
      "Metas terapéuticas con barra de progreso",
      "Historial de sesiones cronológico",
      "Consentimientos informados digitales",
      "Recordatorios de tarea terapéutica",
    ],
    preview: {
      title: "Sesión #12 — Carlos Mendoza",
      content: "🔒 Nota privada · PHQ-9: 8 → 4 · Progreso: 65%",
      subItems: [
        { tooth: "PHQ-9", state: "Mejora significativa",   color: "bg-emerald-100 text-emerald-700" },
        { tooth: "Meta",  state: "Manejo de ansiedad",    color: "bg-violet-100 text-violet-700"  },
        { tooth: "Tarea", state: "Diario de emociones",   color: "bg-brand-100 text-brand-700"    },
      ],
    },
  },
  {
    id: "dermatology",
    icon: "✨",
    label: "Dermatólogos",
    color: "text-pink-600",
    activeBg: "bg-pink-50 border-pink-200",
    features: [
      "Galería antes/después con comparativa",
      "Mapeo de lesiones en silueta corporal",
      "Seguimiento de procedimientos estéticos",
      "Control de aplicación de toxina botulínica",
      "Historial fotográfico cronológico",
      "Protocolos de tratamiento personalizados",
    ],
    preview: {
      title: "Procedimiento — Sofía Torres",
      content: "✨ Blanqueamiento · 3 sesiones · Resultado: Excelente",
      subItems: [
        { tooth: "Pre",  state: "Tono A3 inicial",      color: "bg-amber-100 text-amber-700"    },
        { tooth: "Post", state: "Tono A1 alcanzado",    color: "bg-emerald-100 text-emerald-700"},
        { tooth: "Sig.", state: "Mantenimiento 6 meses",color: "bg-brand-100 text-brand-700"    },
      ],
    },
  },
];

export function Specialties() {
  const [active, setActive] = useState(specialties[0].id);
  const current = specialties.find((s) => s.id === active)!;

  return (
    <section id="specialties" className="section-pad bg-slate-50">
      <div className="container-tight">
        <SectionHeader
          eyebrow="Por especialidad"
          title="Adaptado a tu práctica clínica"
          subtitle="MediFlow se personaliza según tu especialidad. Cada módulo diseñado con flujos de trabajo específicos para ti."
          centered
          className="mb-12"
        />

        {/* Specialty tabs */}
        <div className="flex flex-wrap justify-center gap-2 mb-10">
          {specialties.map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-all duration-200",
                active === s.id
                  ? s.activeBg + " shadow-sm"
                  : "bg-white border-border text-muted-foreground hover:border-brand-200 hover:bg-brand-50/50"
              )}
            >
              <span className="text-base">{s.icon}</span>
              <span className={active === s.id ? s.color : ""}>{s.label}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="grid lg:grid-cols-2 gap-8 items-center">
          {/* Features list */}
          <div>
            <h3 className="text-xl font-bold text-foreground mb-6">
              {current.icon} Para {current.label}
            </h3>
            <ul className="space-y-3">
              {current.features.map((f) => (
                <li key={f} className="flex items-start gap-3">
                  <div className="mt-0.5 w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-emerald-600 text-xs font-bold">✓</span>
                  </div>
                  <span className="text-sm text-foreground leading-relaxed">{f}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Preview card */}
          <div className="rounded-2xl border border-border bg-white shadow-card-md overflow-hidden">
            <div className="bg-muted/50 border-b border-border px-5 py-3.5">
              <div className="text-sm font-semibold text-foreground">{current.preview.title}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{current.preview.content}</div>
            </div>
            <div className="p-5 space-y-3">
              {current.preview.subItems.map((item) => (
                <div
                  key={item.tooth}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border"
                >
                  <div className={cn("text-xs font-bold px-2 py-1 rounded-md flex-shrink-0", item.color)}>
                    {item.tooth}
                  </div>
                  <span className="text-sm text-foreground">{item.state}</span>
                </div>
              ))}
              <div className="pt-2">
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-brand-600 to-violet-600 rounded-full transition-all duration-500"
                    style={{ width: "65%" }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-1.5">
                  <span>Progreso del tratamiento</span>
                  <span className="font-semibold text-brand-600">65%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
