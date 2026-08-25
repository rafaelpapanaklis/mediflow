# Adaptadores de portal — DaleControl Inmuebles

**Para qué existe esta carpeta:** para que enchufar un portal nuevo sea
*agregar un archivo*, no rehacer el módulo. Todo lo que sabe leer la base de
datos, decidir qué inmueble es publicable y quitarle los datos privados vive
en `src/lib/realty/feed.ts` y `src/lib/realty/portals.ts`. Un adaptador solo
sabe una cosa: **cómo se escribe un inmueble en el formato de ese destino.**

---

## Lo primero, porque cambia el diseño entero

**No existe "una API de portales inmobiliarios".** Los tres grandes de
México —Inmuebles24, Lamudi y Casas y Terrenos— **no publican una API
abierta**: se entra por convenio comercial, y esa gestión todavía no está
hecha. Por eso aquí **no hay conectores a esos portales** y aparecen en el
catálogo como *no disponibles*, con el motivo escrito.

Lo que sí funciona hoy, sin permiso de nadie, es el **feed propio**: una URL
pública con tus inmuebles que el portal jala cada tanto. Eso es lo que
construye `generic-xml.ts`, y es lo que aceptan los agregadores de LIFULL
(Trovit, Mitula, Nuroa, Nestoria, iCasas) y los portales chicos.

---

## Las tres capas

```
  Postgres
     │  select EXPLÍCITO de columnas seguras  ← feed.ts
     ▼
  RealtyPublishableProperty          ← types.ts  (LA REJA DE PRIVACIDAD)
     │  build(properties, account, options)
     ▼
  generic-xml.ts / meta-catalog.ts / google-listing.ts
```

**La reja está en la capa de en medio, no en cada adaptador.** El tipo
`RealtyPublishableProperty` no tiene un campo donde quepan las notas
internas, el porcentaje de comisión, el nombre o el teléfono del propietario,
los documentos ni los datos del asesor. Un adaptador no puede filtrar lo que
nunca recibió, ni aunque su autor se distraiga. Esa es toda la idea.

Y `address`, `lat` y `lng` llegan en `null` cuando el inmueble tiene
`showExactAddress` apagado. **Las coordenadas son la dirección exacta con
otro nombre**: publicarlas con siete decimales mientras se oculta la calle es
la misma fuga disfrazada.

---

## Agregar un adaptador nuevo

### 1. El archivo

Crea `mi-portal.ts` en esta carpeta y exporta un `RealtyPortalAdapter`:

```ts
import {
  cdata, flattenText, feedNumber,
  type RealtyPortalAdapter,
} from "@/lib/realty/portal-adapters/types";

export const miPortalAdapter: RealtyPortalAdapter = {
  key: "mi-portal",
  label: "Mi Portal",
  transport: "feed",                                // "feed" | "push"
  contentType: "application/xml; charset=utf-8",
  filename: "mi-portal.xml",                        // URL pública del feed
  build(properties, account, options) {
    // properties ya viene FILTRADO, SANEADO y ORDENADO. No consultes nada.
    return "…";
  },
};
```

Reglas del `build`:

- **Puro.** Sin `prisma`, sin `fetch`, sin `Date.now()`. La fecha entra por
  `options.generatedAt` — así el mismo insumo da siempre la misma salida y se
  puede probar con un objeto escrito a mano.
- **Nunca lanza.** Con cero inmuebles devuelve un documento vacío *válido*
  (encabezado y raíz). Un portal que recibe un 500 o un XML partido marca la
  fuente como rota y a veces deja de intentarlo.
- **Escapa.** `cdata()` para texto dentro de CDATA (parte los `]]>`),
  `xmlEscape()` para atributos, `csv`: entrecomilla y duplica comillas. Todos
  pasan por `stripXmlControlChars`, porque una descripción pegada desde Word
  trae caracteres de control que un XML 1.0 no admite **ni escapados**, y un
  solo byte de esos vuelve ilegible el feed completo.
- **Respeta `options.maxPhotos`.**

### 2. Registrarlo

En `index.ts`, tres líneas:

```ts
import { miPortalAdapter } from "@/lib/realty/portal-adapters/mi-portal";
// …en REALTY_PORTAL_ADAPTERS:   [miPortalAdapter.key]: miPortalAdapter,
// …en REALTY_FEED_FILES:        [miPortalAdapter.filename]: miPortalAdapter,
```

### 3. El destino que ve el cliente

También en `index.ts`, una fila en `REALTY_PORTAL_DESTINATIONS`:

```ts
{
  key: "mi-portal",              // ⚠️ SE GUARDA EN LA BASE. No se renombra.
  label: "Mi Portal",            // esto sí se puede cambiar cuando quieras
  group: "otros",
  adapter: "mi-portal",
  available: true,
  paidBySubscriber: true,        // ¿el portal le cobra al cliente? casi siempre sí
  help: "Una línea que el asesor entienda.",
}
```

`key` viaja a `realty_portal_accounts.portal` y
`realty_portal_listings.portal`. **Cambiarla huérfana todas las filas
existentes.** Si el portal se cambia de nombre, cambia `label`.

Eso es todo. La pantalla de Portales, los cupos, la matriz de estado, la cola
y la despublicación automática lo recogen solos.

---

## Si el portal SÍ tiene API (`transport: "push"`)

El día que exista un convenio y credenciales de verdad, implementa además
`push()`:

```ts
async push(property, account, credentials) {
  try {
    const res = await fetch("https://api.portal.mx/listings", {
      method: "POST",
      headers: { authorization: `Bearer ${credentials.apiKey ?? ""}` },
      body: JSON.stringify({ /* … */ }),
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `HTTP ${res.status}`,
        // 5xx y 429 se reintentan; un 401 o un 422 NO — reintentar una
        // credencial mala cada 15 minutos no la arregla y llena el log.
        retryable: res.status >= 500 || res.status === 429,
      };
    }
    const data = await res.json();
    return { ok: true, externalId: String(data.id) };
  } catch (e) {
    // Red caída: sí se reintenta.
    return { ok: false, error: e instanceof Error ? e.message : "error de red", retryable: true };
  }
}
```

**`push` nunca lanza: siempre resuelve.** La cola de `portals.ts` lee `ok` y
`retryable` y decide sola si programa otro intento con espera creciente. No
hay nada más que tocar.

---

## Cómo funciona la publicación hoy (destinos de tipo `feed`)

No hay nada que "enviar": el inmueble entra o no entra en la URL del feed.
Entonces, ¿qué hace la cola?

1. **Valida.** Si el inmueble no tiene título, precio o ubicación mínima, el
   portal lo va a rechazar. Se marca `ERROR` con el motivo en español, y el
   asesor lo ve en la matriz. Eso es lo que sustituye al "error del portal".
2. **Reconcilia.** Compara lo que hay en la base contra lo que debería estar
   publicado, y corrige la diferencia. De aquí sale la **despublicación
   automática**: al marcar un inmueble como VENDIDO o RENTADO deja de cumplir
   la condición y sale del feed en la siguiente lectura del portal, sin que
   nadie se acuerde de bajarlo. Es la queja número uno de los portales y se
   resuelve por construcción, no por disciplina.
3. **Empuja**, solo para adaptadores `push`, con reintentos y espera
   creciente.

---

## Probar un adaptador sin base de datos

`build()` es puro, así que las pruebas no necesitan Postgres, ni sesión, ni
red. Corren en un segundo:

```bash
npx tsx --test src/lib/realty/portal-adapters/__tests__/adapters.test.ts
```

Copia el helper `inmueble()` de ese archivo: arma un
`RealtyPublishableProperty` completo y acepta un `Partial` para cambiar solo
lo que te interese (`inmueble({ operation: "RENTA", rentPrice: 18000 })`).

Y **parsea la salida de verdad** en vez de comparar cadenas. El repo ya trae
`xmlbuilder2`:

```ts
import { create } from "xmlbuilder2";
const doc = create(miXml).end({ format: "object" }); // lanza si está roto
```

Ojo con un detalle del parser: un CDATA llega como `{ $: "..." }`, y **dos
CDATA seguidos** —que es justo lo que produce partir un `]]>`— llegan como
`{ $1: "...", $2: "..." }`. El helper `txt()` de la prueba los concatena.

⚠️ No agregues un script `test:` a `package.json`: ese archivo está fuera del
vertical y la guardia (`node scripts/realty-guard.cjs`) da exit 1. Los
verticales corren sus pruebas con `npx tsx --test <ruta>` a pelo.
