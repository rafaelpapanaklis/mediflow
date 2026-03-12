import type { Metadata } from "next";
import { RegisterForm } from "@/components/public/register-form";

export const metadata: Metadata = {
  title: "Crear cuenta — MediFlow",
};

const STEPS_OVERVIEW = [
  "Crea tu cuenta en 2 minutos",
  "Configura tu clínica y horarios",
  "Importa o crea tus primeros pacientes",
  "¡Tu clínica digital está funcionando!",
];

export default function RegisterPage() {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)]">
      {/* Left: wizard form */}
      <div className="flex-1 flex items-start justify-center px-6 py-10 overflow-y-auto">
        <RegisterForm />
      </div>

      {/* Right: brand panel */}
      <div className="hidden lg:flex flex-1 items-center justify-center bg-gradient-to-br from-brand-600 via-brand-700 to-violet-700 px-12">
        <div className="text-white max-w-xs text-center">
          <div className="text-5xl mb-6">✦</div>
          <h2 className="text-2xl font-extrabold leading-tight mb-3">
            Tu clínica digital lista en minutos
          </h2>
          <p className="text-white/70 text-sm leading-relaxed mb-8">
            Sin configuraciones complicadas. Sin IT. Sin cursos.
          </p>
          <div className="space-y-3 text-left">
            {STEPS_OVERVIEW.map((step, i) => (
              <div key={step} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-white/15 flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {i + 1}
                </div>
                <span className="text-sm text-white/80">{step}</span>
              </div>
            ))}
          </div>
          <div className="mt-8 p-4 bg-white/10 rounded-xl text-left">
            <div className="flex gap-1 mb-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <span key={i} className="text-amber-400 text-sm">★</span>
              ))}
            </div>
            <p className="text-xs text-white/80 leading-relaxed italic">
              &ldquo;Setup en menos de 10 minutos. Mis pacientes ya reciben recordatorios por WhatsApp automáticamente.&rdquo;
            </p>
            <div className="mt-2 text-xs text-white/60">— Dra. Ana Martínez, Dentista CDMX</div>
          </div>
        </div>
      </div>
    </div>
  );
}
