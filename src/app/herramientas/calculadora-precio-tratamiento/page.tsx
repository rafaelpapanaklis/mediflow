import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo";
import type { BlogFaqItem } from "@/lib/blog/types";
import { getHerramientaBySlug } from "@/lib/herramientas/data";
import { toolOgUrl } from "@/lib/herramientas/json-ld";
import { ToolPageShell } from "@/components/herramientas/page-shell";
import { TreatmentPriceTool } from "./tool";

// ─────────────────────────────────────────────────────────────────────────────
// /herramientas/calculadora-precio-tratamiento
//
// Página estática (data en el repo). El único cliente es <TreatmentPriceTool />.
// ─────────────────────────────────────────────────────────────────────────────

const tool = getHerramientaBySlug("calculadora-precio-tratamiento")!;

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
    q: "¿Cómo calculo el costo de mi hora de sillón?",
    a: "Divide tus gastos fijos mensuales entre las horas productivas que trabajas al mes. Productivas significa horas de sillón con paciente, no horas que pasas en el consultorio: si abres 160 horas al mes pero tu agenda real ocupa 75, el divisor es 75. Con 45,000 pesos de gastos fijos, eso da 600 pesos por hora. Ojo con inflar el divisor: si usas las horas que quisieras trabajar en lugar de las que trabajas, el costo por hora sale artificialmente bajo y todos tus precios quedan cortos.",
  },
  {
    q: "¿El margen se calcula sobre el costo o sobre el precio?",
    a: "Esta calculadora usa margen sobre el precio de venta, que es como se usa la palabra en un consultorio: con 40% de margen, de cada 100 pesos que cobras, 40 son ganancia. La fórmula es precio = costo ÷ (1 − margen). No es lo mismo que sumar 40% al costo: con un costo de 850 pesos, un markup del 40% daría 1,190, mientras que un margen del 40% da 1,417. Confundir los dos es una de las razones más comunes por las que un consultorio trabaja mucho y gana poco.",
  },
  {
    q: "¿Y si mi precio sugerido queda muy arriba de lo que cobra la clínica de al lado?",
    a: "Primero revisa que el costo esté bien armado: el error más frecuente es subestimar los minutos de sillón, olvidar el tiempo de preparación y limpieza, o no contar la comisión de la terminal. Si el costo está bien y el precio sigue arriba del mercado, tienes tres caminos: reducir el tiempo o el costo del procedimiento, sostener el precio y trabajar la percepción de valor (lo que el paciente recibe alrededor del tratamiento), o aceptar un margen menor en ese servicio concreto y compensar con otros. Lo que no conviene es bajar el precio sin saber que quedó por debajo del costo, porque entonces cada paciente nuevo te acerca al rojo.",
  },
];

const FEATURES = [
  "Calcula el costo total del tratamiento con insumos, sillón y laboratorio",
  "Sugiere el precio según el margen deseado",
  "Muestra la ganancia en pesos por tratamiento",
  "Compara escenarios con 30, 40 y 50% de margen",
];

export default function CalculadoraPrecioTratamientoPage() {
  return (
    <ToolPageShell
      tool={tool}
      lede="Suma insumos, minutos de sillón y laboratorio, elige el margen que quieres y esta calculadora te da el precio sugerido del tratamiento, la ganancia en pesos y una comparativa con tres márgenes distintos."
      faq={FAQ}
      featureList={FEATURES}
      ctaTitle="Cobra, registra y factura sin salirte del expediente"
      ctaText="Tarifas por tratamiento, cobros parciales, saldos por paciente y facturación desde la misma consulta. Cuando el precio está definido en un solo lugar, deja de negociarse en el mostrador."
    >
      <div className="blog-prose">
        <p>
          Saber <strong>cuánto cobrar por un tratamiento</strong> dental no es una cuestión de
          intuición ni de copiar la lista de precios del consultorio de al lado. Esta calculadora
          arma el precio desde tus propios números: lo que gastas en insumos, el tiempo de sillón
          que ocupa el procedimiento, el laboratorio si aplica y el margen que quieres dejar. El
          resultado se actualiza mientras tecleas.
        </p>
        <p>
          La pieza que casi nadie mete en la cuenta es el tiempo. Los insumos son fáciles de ver
          —están en la factura del proveedor— y el laboratorio también. Pero la hora de sillón
          cuesta dinero exista o no un paciente sentado: renta, sueldos, luz, software y equipo se
          pagan igual. Si divides tus gastos fijos mensuales entre las horas de sillón que realmente
          trabajas al mes, obtienes el costo de tu hora, y con eso cada procedimiento empieza a
          costar lo que de verdad cuesta. Un tratamiento de 40 minutos y otro de dos horas dejan de
          parecer comparables.
        </p>
        <p>
          El segundo punto fino es el margen. Aquí se calcula sobre el precio de venta, no como un
          porcentaje sumado al costo, y la diferencia no es menor: con un costo de 850 pesos, sumarle
          40% da 1,190, mientras que dejar un margen del 40% exige cobrar 1,417. Los dos números
          suenan al mismo &quot;40%&quot; y hay casi 230 pesos por tratamiento entre uno y otro.
          Multiplícalo por los tratamientos de un año y esa confusión explica buena parte de los
          consultorios que trabajan a tope y no ven el dinero.
        </p>
        <p>
          Un último criterio: el margen no tiene que ser igual para todo. Es razonable dejar menos
          en un servicio de entrada, como una limpieza que trae pacientes nuevos, y más en
          procedimientos que exigen especialización o riesgo. Lo que no se puede es cobrar por debajo
          del costo sin saberlo. Si quieres cerrar el círculo, calcula también tu{" "}
          <Link href="/herramientas/calculadora-punto-equilibrio">punto de equilibrio</Link>: te
          dice cuántos de estos tratamientos necesitas al mes para que la cuenta cierre.
        </p>
      </div>

      <div style={{ marginTop: 26 }}>
        <TreatmentPriceTool />
      </div>
    </ToolPageShell>
  );
}
