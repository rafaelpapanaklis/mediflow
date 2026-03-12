import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const metadata: Metadata = {
  title: "Iniciar sesión — MediFlow",
};

const TRUST_ITEMS = [
  { icon: "⚡", title: "Setup en 5 minutos",     sub: "Sin instalaciones, sin configuración técnica" },
  { icon: "🔒", title: "Datos cifrados y seguros", sub: "Cumple con normativas médicas locales"        },
  { icon: "💬", title: "Soporte en español",       sub: "Chat, email y videollamadas"                  },
];

export default function LoginPage() {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)]">
      {/* Left: Form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[380px]">
          {/* Logo */}
          <div className="flex items-center gap-2 font-extrabold text-[19px] text-brand-600 tracking-tight mb-8">
            <span className="w-2 h-2 rounded-full bg-brand-600" />
            MediFlow
          </div>

          <h1 className="text-2xl font-extrabold text-foreground tracking-tight mb-1">
            Bienvenido de vuelta
          </h1>
          <p className="text-sm text-muted-foreground mb-7">
            Ingresa a tu panel de control
          </p>

          <form className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="login-email">Correo electrónico</Label>
              <Input
                id="login-email"
                type="email"
                placeholder="doctor@miclinica.com"
                autoComplete="email"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="login-password">Contraseña</Label>
                <Link href="#" className="text-xs font-semibold text-brand-600 hover:underline">
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>
              <Input
                id="login-password"
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="remember"
                className="w-4 h-4 rounded accent-brand-600"
              />
              <label htmlFor="remember" className="text-xs text-muted-foreground cursor-pointer">
                Recordarme por 30 días
              </label>
            </div>

            <Button className="w-full" size="lg" asChild>
              <Link href="/dashboard">Iniciar sesión →</Link>
            </Button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">o continúa con</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Google */}
          <Button variant="outline" className="w-full" size="lg">
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continuar con Google
          </Button>

          <p className="text-center text-sm text-muted-foreground mt-6">
            ¿No tienes cuenta?{" "}
            <Link href="/register" className="text-brand-600 font-semibold hover:underline">
              Créala gratis →
            </Link>
          </p>
          <p className="text-center text-xs text-muted-foreground mt-2">
            ¿Eres paciente?{" "}
            <a href="#" className="hover:underline">Accede al portal del paciente</a>
          </p>
        </div>
      </div>

      {/* Right: Brand panel */}
      <div className="hidden lg:flex flex-1 items-center justify-center bg-gradient-to-br from-brand-600 via-brand-700 to-violet-700 px-12">
        <div className="text-white max-w-xs text-center">
          <div className="text-5xl mb-6">🏥</div>
          <h2 className="text-2xl font-extrabold leading-tight mb-3">
            +2,400 clínicas confían en MediFlow
          </h2>
          <p className="text-white/70 text-sm leading-relaxed mb-8">
            Gestiona todo tu consultorio desde un solo panel. Pacientes, citas, expedientes y facturación.
          </p>
          <div className="space-y-3 text-left">
            {TRUST_ITEMS.map((item) => (
              <div
                key={item.title}
                className="flex items-start gap-3 bg-white/10 rounded-xl p-3.5"
              >
                <div className="text-xl flex-shrink-0">{item.icon}</div>
                <div>
                  <div className="text-sm font-bold">{item.title}</div>
                  <div className="text-xs text-white/60 mt-0.5">{item.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
