// Fallback de t() para las superficies PÚBLICAS que reusan estos componentes
// (p. ej. /live/[slug], que NO está bajo el I18nProvider del dashboard).
// Cubre solo las llaves usadas por live-mode.tsx, floor-copy.ts y
// waiting-room.tsx, en español (idioma default del producto). Sin esto,
// useT() lanza fuera del provider y la vista pública muere en el
// ErrorBoundary ("No se pudo dibujar el plano").
//
// ⚠️ Estas llaves EXISTEN en es.json y en en.json — este mapa es solo la
// red por si el componente cae fuera del provider. Si añades una llave a
// una superficie pública, añádela también AQUÍ o se verá la llave cruda.
// Y que no lleve variables `{…}`: este fallback no interpola.
import type { TFunction } from "@/i18n/t";

const FALLBACK_ES: Record<string, string> = {
  "pages.clinicLayout.assignChairsHint":
    "Asigna sillones a los elementos del layout para verlos aquí.",
  "pages.clinicLayout.backToNow": "Volver a ahora",
  "pages.clinicLayout.chairFallbackLabel": "Consultorio",
  "pages.clinicLayout.dayAgenda": "Agenda del día",
  "pages.clinicLayout.legendFree": "Libre",
  "pages.clinicLayout.legendHintPublic":
    "Verde libre, ámbar por empezar, rojo ocupado. La línea de tiempo de abajo mueve la hora.",
  "pages.clinicLayout.legendOccupied": "Ocupado",
  "pages.clinicLayout.legendTitle": "Cómo se lee el piso",
  "pages.clinicLayout.legendUpcoming": "Próximo",
  "pages.clinicLayout.next": "Próxima",
  "pages.clinicLayout.noPendingAppointments": "Sin citas pendientes",
  "pages.clinicLayout.odontogram": "Odontograma",
  "pages.clinicLayout.openRecordOdontogram": "Abrir expediente / odontograma",
  "pages.clinicLayout.statusCountFree": "libres",
  "pages.clinicLayout.statusCountOccupied": "ocupados",
  "pages.clinicLayout.statusCountUpcoming": "por empezar",
  "pages.clinicLayout.statusCountsLabel": "Sillones por estado",
  "pages.clinicLayout.statusDetailFree":
    "Nadie sentado y sin cita en los próximos 30 minutos.",
  "pages.clinicLayout.statusDetailOccupied":
    "Hay una consulta en curso en este sillón.",
  "pages.clinicLayout.statusDetailUpcoming":
    "La siguiente cita empieza en 30 minutos o menos.",
  "pages.clinicLayout.waitingChairFallback": "Sillón",
  "pages.clinicLayout.waitingEmpty": "Sin pacientes esperando.",
  "pages.clinicLayout.waitingNow": "ahora",
  "pages.clinicLayout.waitingRoomTitle": "Sala de espera",
  "pages.clinicLayout.waitingSoundOff": "Sonido del llamado: silenciado",
  "pages.clinicLayout.waitingSoundOn": "Sonido del llamado: activo",
};

export const publicLiveFallbackT: TFunction = ((key: string) =>
  FALLBACK_ES[key] ?? key) as TFunction;
