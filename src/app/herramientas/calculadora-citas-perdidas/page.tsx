import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo";
import type { BlogFaqItem } from "@/lib/blog/types";
import { getHerramientaBySlug } from "@/lib/herramientas/data";
import { toolOgUrl } from "@/lib/herramientas/json-ld";
import { ToolPageShell } from "@/components/herramientas/page-shell";
import { LostAppointmentsTool } from "./tool";

// ─────────────────────────────────────────────────────────────────────────────
// /herramientas/calculadora-citas-perdidas
//
// Página estática: la data vive en el repo, así que se prerenderiza en build sin
// DATABASE_URL. El único cliente es <LostAppointmentsTool /> (tool.tsx).
// ─────────────────────────────────────────────────────────────────────────────

const tool = getHerramientaBySlug("calculadora-citas-perdidas")!;

export const revalidate = 3600;

export const metadata: Metadata = buildMetadata({
  title: tool.metaTitle,
  description: tool.metaDescription,
  path: `/herramientas/${tool.slug}`,
  ogImage: toolOgUrl(tool.headline),
  keywords: tool.keywords,
});

const FAQ: BlogFaqItem[] = [
  {
    q: "¿Qué porcentaje de citas perdidas es normal en un consultorio dental?",
    a: "En consultorios que no confirman de forma sistemática, lo habitual es moverse entre 10% y 20% de las citas agendadas; en clínicas con primera visita gratuita o campañas de promoción puede subir bastante más, porque el paciente no ha invertido nada todavía. Cuando hay confirmación con tiempo suficiente y seguimiento de los reincidentes, es realista bajar a un dígito. El número que importa, de todos modos, es el tuyo: cuenta durante un mes las citas que se cayeron sin aviso y divídelas entre las que agendaste.",
  },
  {
    q: "¿Cómo calculo mi ticket promedio por cita?",
    a: "Toma los ingresos cobrados de un mes normal y divídelos entre el número de citas que se cumplieron en ese mes. Ojo con la diferencia: es por cita, no por paciente ni por tratamiento; un tratamiento de conductos con corona son varias citas. Si tu mezcla es muy dispar (limpiezas de 600 pesos junto a implantes de 20 mil), calcula el promedio sin los dos o tres casos extremos: el resultado de la calculadora será más creíble y más útil para decidir.",
  },
  {
    q: "¿Los recordatorios por WhatsApp de verdad reducen las citas perdidas?",
    a: "Ayudan cuando llegan con tiempo para reaccionar y piden una respuesta. Un recordatorio la mañana de la cita evita olvidos, pero ya no te deja revender el espacio; uno a 48 o 24 horas te da margen para ofrecer el hueco a alguien de la lista de espera. Lo que mueve la aguja es la combinación: recordatorio con confirmación, lista de espera para llenar los huecos y una política clara para los pacientes que ya faltaron dos veces.",
  },
];

const FEATURES = [
  "Calcula citas perdidas al mes y al año",
  "Estima el dinero perdido por inasistencia",
  "Compara el ingreso potencial contra el real",
  "Proyecta el ahorro de reducir la inasistencia a la mitad",
];

export default function CalculadoraCitasPerdidasPage() {
  return (
    <ToolPageShell
      tool={tool}
      lede="Pon las citas que agendas por semana, tu porcentaje de inasistencia y tu ticket promedio: la calculadora te dice cuánto dinero se te va al mes y al año, y cuánto recuperarías si bajaras las faltas a la mitad."
      faq={FAQ}
      featureList={FEATURES}
      ctaTitle="Que la agenda confirme por ti"
      ctaText="Recordatorios automáticos por WhatsApp, confirmación del paciente y lista de espera para llenar los huecos que se liberan. Todo desde la misma agenda, sin hojas de cálculo aparte."
    >
      <div className="blog-prose">
        <p>
          Esta <strong>calculadora de citas perdidas</strong> te dice, en pesos y sin rodeos,
          cuánto le cuesta a tu consultorio dental cada paciente que agenda y no llega. Pones
          cuatro datos que ya conoces —cuántas citas agendas por semana, qué porcentaje no se
          presenta, cuánto deja en caja una cita promedio y cuántas semanas trabajas al año— y el
          resultado se actualiza mientras tecleas.
        </p>
        <p>
          Casi ninguna clínica tiene ese número a la mano, y ahí está el problema: una cita perdida
          no aparece en ningún reporte. No hay una salida de dinero que revisar, ni un gasto que
          justificar, ni una factura que reclamar. Simplemente el sillón se queda vacío cuarenta
          minutos y el día sigue. Cuando eso pasa dos o tres veces al día, el hueco del año se
          parece más a un sueldo completo que a un detalle operativo.
        </p>
        <p>
          Por eso conviene verlo de golpe. Con 60 citas a la semana, 15% de inasistencia y un
          ticket de 900 pesos, la cuenta ronda los 32 mil pesos al mes: el equivalente a regalar
          una semana de trabajo cada mes. Y es una estimación conservadora, porque sólo cuenta el
          ingreso directo de la cita. No incluye el tratamiento que no se cerró porque el paciente
          nunca volvió, ni el tiempo del equipo preparando el sillón dos veces, ni el desgaste de
          reagendar por teléfono.
        </p>
        <p>
          Dos advertencias para leer bien el resultado. La primera: si nunca has medido tu
          inasistencia, no la adivines a la baja. Cuenta un mes completo y usa ese dato; casi
          siempre es más alto de lo que uno recuerda. La segunda: el objetivo realista no es cero.
          Siempre habrá urgencias, tráfico y pacientes que se arrepienten. Lo alcanzable es bajar
          a la mitad, y eso pasa por tres cosas concretas: confirmar con antelación suficiente para
          poder revender el espacio, tener una{" "}
          <Link href="/blog/lista-espera-pacientes-dental">lista de espera</Link> a la que llamar
          cuando se libere un hueco, y tratar distinto a quien ya faltó dos veces —depósito,
          horario menos cotizado o confirmación obligatoria—.
        </p>
        <p>
          Abajo tienes la calculadora. Después, las preguntas que nos hacen más seguido sobre cómo
          interpretar estos números y qué hacer con ellos.
        </p>
      </div>

      <div style={{ marginTop: 26 }}>
        <LostAppointmentsTool />
      </div>
    </ToolPageShell>
  );
}
