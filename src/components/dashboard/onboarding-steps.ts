export type OnboardingStep = {
  id:    string;
  /** Spanish source label (fallback). Resolve the visible text via t(labelKey). */
  label: string;
  /** Spanish source description (fallback). Resolve the visible text via t(descKey). */
  desc:  string;
  /** i18n key for the visible label — call t(labelKey) at render time. */
  labelKey: string;
  /** i18n key for the visible description — call t(descKey) at render time. */
  descKey:  string;
  href:  string;
  emoji: string;
};

export const STEPS: OnboardingStep[] = [
  { id: "doctor",      label: "Agrega un doctor",      desc: "Ve a Equipo → Nuevo usuario",         labelKey: "shell.onboardingSteps.doctorLabel",      descKey: "shell.onboardingSteps.doctorDesc",      href: "/dashboard/team",                  emoji: "👨‍⚕️" },
  { id: "schedule",    label: "Configura tu horario",  desc: "Configuración → tab Horarios",        labelKey: "shell.onboardingSteps.scheduleLabel",    descKey: "shell.onboardingSteps.scheduleDesc",    href: "/dashboard/settings?tab=horarios", emoji: "🕐" },
  { id: "patient",     label: "Registra un paciente",  desc: "Ve a Pacientes → Nuevo paciente",     labelKey: "shell.onboardingSteps.patientLabel",     descKey: "shell.onboardingSteps.patientDesc",     href: "/dashboard/patients",              emoji: "👤" },
  { id: "appointment", label: "Agenda una cita",       desc: "Ve a Agenda → Nueva cita",            labelKey: "shell.onboardingSteps.appointmentLabel", descKey: "shell.onboardingSteps.appointmentDesc", href: "/dashboard/appointments",          emoji: "📅" },
  { id: "invoice",     label: "Crea una factura",      desc: "Ve a Facturación → Nueva factura",    labelKey: "shell.onboardingSteps.invoiceLabel",     descKey: "shell.onboardingSteps.invoiceDesc",     href: "/dashboard/billing",               emoji: "💳" },
  { id: "whatsapp",    label: "Conecta WhatsApp",      desc: "Ve a WhatsApp → Configurar API",      labelKey: "shell.onboardingSteps.whatsappLabel",    descKey: "shell.onboardingSteps.whatsappDesc",    href: "/dashboard/whatsapp",              emoji: "💬" },
];
