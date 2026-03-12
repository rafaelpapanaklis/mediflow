/* ── Patient ── */
export interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  initials: string;
  avatarColor: string;
  age: number;
  gender: "F" | "M" | "X";
  bloodType: string;
  phone: string;
  email: string;
  dob: string;
  address?: string;
  insuranceProvider?: string;
  insurancePolicy?: string;
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
  tags: string[];
  status: "active" | "inactive";
  balance: number;
  totalPaid: number;
  totalAppointments: number;
  lastVisit: string;
  nextAppointment?: string;
  patientNumber: string;
  createdAt: string;
}

/* ── Appointment ── */
export type AppointmentStatus =
  | "confirmed"
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

export interface Appointment {
  id: string;
  patientId: string;
  patientName: string;
  patientInitials: string;
  patientAvatarColor: string;
  doctorId: string;
  doctorName: string;
  type: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  room: string;
  status: AppointmentStatus;
  notes?: string;
  reminderSent: boolean;
}

/* ── Invoice ── */
export type InvoiceStatus = "paid" | "pending" | "partial" | "overdue";

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  patientId: string;
  patientName: string;
  patientInitials: string;
  patientAvatarColor: string;
  items: InvoiceItem[];
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  balance: number;
  status: InvoiceStatus;
  paymentMethod?: string;
  date: string;
  dueDate?: string;
}

/* ── Staff ── */
export type StaffRole = "super_admin" | "doctor" | "receptionist" | "readonly";

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  specialty?: string;
  initials: string;
  avatarColor: string;
  lastAccess: string;
  status: "active" | "invited" | "inactive";
  modules: string[];
}

/* ── KPI ── */
export interface KPICard {
  label: string;
  value: string;
  trend: string;
  trendUp: boolean;
  sub: string;
  icon: string;
  iconBg: string;
}

/* ── Nav link ── */
export interface NavLink {
  label: string;
  href: string;
  badge?: number;
  icon?: string;
}
