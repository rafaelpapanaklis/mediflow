import {
  Calendar, UserPlus, FileText, Stethoscope, Home, Users,
  MessageCircle, CreditCard, FileImage, Sparkles, Settings,
  Moon, HelpCircle, FlaskConical,
} from "lucide-react";
import type { CommandItem } from "./types";

export function buildGlobalActions(): CommandItem[] {
  return [
    // ═══ CREAR ═══════════════════════════════════════════════════
    {
      id: "create:appointment",
      group: "acciones",
      label: "Nueva cita",
      icon: Calendar,
      shortcut: "⌘ N",
      tone: "brand",
      keywords: ["agendar", "reservar", "programar", "cita"],
      run: (ctx) => ctx.push("/dashboard/appointments?new=1"),
    },
    {
      id: "create:patient",
      group: "acciones",
      label: "Nuevo paciente",
      icon: UserPlus,
      shortcut: "⌘ ⇧ P",
      tone: "brand",
      keywords: ["registrar", "agregar", "paciente"],
      run: (ctx) => ctx.push("/dashboard/patients?new=1"),
    },
    {
      id: "create:invoice",
      group: "acciones",
      label: "Nueva factura",
      icon: FileText,
      shortcut: "⌘ ⇧ F",
      tone: "brand",
      keywords: ["facturar", "cobrar", "cfdi"],
      run: (ctx) => ctx.push("/dashboard/billing?new=1"),
    },

    // ═══ IR A ═══════════════════════════════════════════════════
    { id: "go:home", group: "ir-a", label: "Hoy", icon: Home, shortcut: "G H",
      keywords: ["home", "dashboard", "inicio"],
      run: (ctx) => ctx.push("/dashboard") },
    { id: "go:appointments", group: "ir-a", label: "Agenda", icon: Calendar, shortcut: "G A",
      keywords: ["agenda", "calendario", "citas"],
      run: (ctx) => ctx.push("/dashboard/appointments") },
    { id: "go:patients", group: "ir-a", label: "Pacientes", icon: Users, shortcut: "G P",
      run: (ctx) => ctx.push("/dashboard/patients") },
    { id: "go:messages", group: "ir-a", label: "Mensajes", icon: MessageCircle, shortcut: "G M",
      keywords: ["whatsapp", "inbox", "mensajeria"],
      run: (ctx) => ctx.push("/dashboard/whatsapp") },
    { id: "go:billing", group: "ir-a", label: "Facturación", icon: CreditCard, shortcut: "G F",
      keywords: ["facturas", "pagos", "cfdi"],
      run: (ctx) => ctx.push("/dashboard/billing") },
    { id: "go:clinical", group: "ir-a", label: "Expedientes", icon: Stethoscope, shortcut: "G E",
      keywords: ["notas", "soap", "clinico"],
      run: (ctx) => ctx.push("/dashboard/clinical") },
    { id: "go:xrays", group: "ir-a", label: "Radiografías", icon: FileImage, shortcut: "G R",
      keywords: ["rx", "rayos", "imagenes"],
      run: (ctx) => ctx.push("/dashboard/xrays") },
    { id: "go:ai", group: "ir-a", label: "IA Asistente", icon: Sparkles, shortcut: "G I",
      keywords: ["ai", "claude", "asistente", "ia"],
      run: (ctx) => ctx.push("/dashboard/ai-assistant") },
    { id: "go:settings", group: "ir-a", label: "Configuración", icon: Settings, shortcut: "G S",
      keywords: ["config", "ajustes", "preferencias"],
      run: (ctx) => ctx.push("/dashboard/settings") },

    // ═══ SISTEMA ═══════════════════════════════════════════════
    {
      id: "cmd:toggle-theme",
      group: "acciones",
      label: "Cambiar tema (claro / oscuro)",
      icon: Moon,
      shortcut: "⌘ ⇧ D",
      keywords: ["dark", "light", "modo", "tema"],
      run: () => {
        const html = document.documentElement;
        const isDark = html.classList.contains("dark");
        html.classList.toggle("dark");
        try {
          localStorage.setItem("theme", isDark ? "light" : "dark");
        } catch {}
      },
    },
    {
      id: "cmd:help",
      group: "acciones",
      label: "Ver atajos de teclado",
      icon: HelpCircle,
      shortcut: "?",
      keywords: ["shortcuts", "ayuda", "keyboard", "teclas"],
      run: (ctx) => {
        ctx.close();
        window.dispatchEvent(new CustomEvent("mf:open-shortcuts-panel"));
      },
    },
  ];
}

export function buildActiveConsultActions(
  patientId: string,
  patientName?: string,
): CommandItem[] {
  const label = patientName ?? "paciente actual";
  return [
    {
      id: "active:soap",
      group: "paciente-activo",
      label: `Nueva nota SOAP — ${label}`,
      icon: Stethoscope,
      shortcut: "⌘ ⇧ S",
      tone: "brand",
      run: (ctx) => ctx.push(`/dashboard/patients/${patientId}?tab=soap&new=1`),
    },
    {
      id: "active:charge",
      group: "paciente-activo",
      label: `Cobrar consulta — ${label}`,
      icon: CreditCard,
      tone: "success",
      run: (ctx) => ctx.push(`/dashboard/patients/${patientId}?charge=1`),
    },
    {
      id: "active:prescribe",
      group: "paciente-activo",
      label: `Generar receta — ${label}`,
      icon: FlaskConical,
      run: (ctx) => ctx.push(`/dashboard/patients/${patientId}?prescribe=1`),
    },
    {
      id: "active:ai",
      group: "paciente-activo",
      label: `Consultar IA con contexto — ${label}`,
      icon: Sparkles,
      run: (ctx) => ctx.push(`/dashboard/ai-assistant?patient=${patientId}`),
    },
  ];
}
