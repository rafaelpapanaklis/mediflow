export type OnboardingStep = {
  id:    string;
  label: string;
  desc:  string;
  href:  string;
  emoji: string;
};

export const STEPS: OnboardingStep[] = [
  { id: "doctor",      label: "Agrega un doctor",      desc: "Ve a Equipo → Nuevo usuario",         href: "/dashboard/team",                  emoji: "👨‍⚕️" },
  { id: "schedule",    label: "Configura tu horario",  desc: "Configuración → tab Horarios",        href: "/dashboard/settings?tab=horarios", emoji: "🕐" },
  { id: "patient",     label: "Registra un paciente",  desc: "Ve a Pacientes → Nuevo paciente",     href: "/dashboard/patients",              emoji: "👤" },
  { id: "appointment", label: "Agenda una cita",       desc: "Ve a Agenda → Nueva cita",            href: "/dashboard/appointments",          emoji: "📅" },
  { id: "record",      label: "Registra una consulta", desc: "Ve a Expedientes → abre un paciente", href: "/dashboard/clinical",              emoji: "📋" },
  { id: "invoice",     label: "Crea una factura",      desc: "Ve a Facturación → Nueva factura",    href: "/dashboard/billing",               emoji: "💳" },
  { id: "whatsapp",    label: "Conecta WhatsApp",      desc: "Ve a WhatsApp → Configurar API",      href: "/dashboard/whatsapp",              emoji: "💬" },
];
