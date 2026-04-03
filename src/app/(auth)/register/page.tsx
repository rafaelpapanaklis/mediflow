import type { Metadata } from "next";
import { RegisterForm } from "@/components/public/register-form";
export const metadata: Metadata = { title: "Crear cuenta — MediFlow" };
export default function RegisterPage() {
  return (
    <div className="flex min-h-screen">
      <div className="flex-1 flex items-center justify-center px-6 py-12"><RegisterForm /></div>
      <div className="hidden lg:flex flex-1 items-center justify-center bg-gradient-to-br from-brand-600 via-brand-700 to-violet-700 px-12">
        <div className="text-white max-w-xs text-center">
          <div className="text-5xl mb-6">✨</div>
          <h2 className="text-2xl font-extrabold mb-3">Empieza gratis hoy</h2>
          <p className="text-white/70 text-sm leading-relaxed mb-8">14 días de prueba sin tarjeta de crédito.</p>
          <div className="space-y-3 text-left">
            {["Setup en 5 minutos","Datos cifrados y seguros","Soporte en español"].map(item => (
              <div key={item} className="flex items-center gap-2.5 bg-white/10 rounded-xl p-3">
                <span className="text-emerald-400">✓</span>
                <span className="text-sm font-medium">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
