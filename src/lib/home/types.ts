// src/lib/home/types.ts

export type AppointmentStatus =
  | "SCHEDULED"
  | "CONFIRMED"
  | "CHECKED_IN"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "NO_SHOW"
  | "CANCELLED";

export interface AppointmentDTO {
  id: string;
  startsAt: string;
  endsAt?: string;
  status: AppointmentStatus;
  patient: { id: string; name: string; avatarSeed?: string };
  doctor?: { id: string; shortName: string };
  reason?: string;
  isTeleconsult?: boolean;
  isWalkIn?: boolean;
  minutesWaiting?: number;
}

export interface HomeActionItem {
  id: string;
  tone: "brand" | "success" | "warning" | "danger" | "info" | "neutral";
  title: string;
  detail?: string;
  cta?: { label: string; href?: string; onClick?: () => void };
}

export interface WaitlistEntry {
  id: string;
  patient: { id: string; name: string };
  reason?: string;
  since: string;
}

export interface HomeReceptionistData {
  todayAppointments: AppointmentDTO[];
  actionItems: HomeActionItem[];
  waitlist: WaitlistEntry[];
  checkedInPatients: AppointmentDTO[];
}

export interface PatientAlerts {
  allergies?: string[];
  medications?: string[];
  conditions?: string[];
}

export interface HomeDoctorData {
  nextAppointment: (AppointmentDTO & {
    patientAge?: number;
    patientGender?: "F" | "M" | "O";
    patientAlerts?: PatientAlerts;
  }) | null;
  todayAppointments: AppointmentDTO[];
  pendingTasks: {
    draftNotes: number;
    unanalyzedXrays: number;
    unsignedConsents: number;
  };
  recentPatients: Array<{
    id: string;
    name: string;
    lastVisitAt: string;
    avatarSeed?: string;
  }>;
  completedToday: number;
}

export type AdminPeriod = "day" | "month" | "quarter" | "year";

export interface HomeAdminKpi {
  label: string;
  value: string;
  delta?: { value: string; direction: "up" | "down"; sub?: string };
}

export interface HomeAdminAlert {
  id: string;
  tone: "warning" | "danger" | "info";
  title: string;
  detail?: string;
  href?: string;
}

export interface HomeAdminTeamRow {
  userId: string;
  doctorName: string;
  appointments: number;
  completionPct: number;
  revenueMXN: number;
}

export interface HomeAdminData {
  period: AdminPeriod;
  kpis: HomeAdminKpi[];
  revenueSeries: Array<{ month: string; value: number }>;
  alerts: HomeAdminAlert[];
  team: HomeAdminTeamRow[];
}

export interface HybridRoleCheck {
  canBeDoctor: boolean;
}
