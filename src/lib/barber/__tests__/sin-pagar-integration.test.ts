// SIN PAGAR NO SE SUBE NI SE PUBLICA (G4 de la auditoría ws6-t8), con las
// rutas REALES y Postgres local.
//
// 🔴 Crea y borra barberías: solo corre con DATABASE_URL local. Ver _wa-arnes.ts.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/sin-pagar-integration.test.ts
//
// Qué es real y qué no:
//   · REAL → las rutas (logo, slug, adjuntos de soporte), su puerta de
//     sesión y de pago, sharp, la validación de bytes y la base.
//   · DOBLE → la sesión de Supabase (quién está logueado) y el Storage de
//     Supabase (se apunta qué se sube y qué se quita; nada sale a la red).
//
// Los dobles se ponen con un parche de Module._load ANTES de cargar las
// rutas (por eso las rutas se cargan con import() dentro de before()).
import "./_sin-server-only";
import Module from "node:module";
import path from "node:path";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { borrarTodo, crearTienda, prisma, skip, BASE_LOCAL, type Tienda } from "./_wa-arnes";

/* ═══════════════ Dobles ═══════════════ */

let sesion: string | null = null; // supabaseId del usuario "logueado"
const storage = {
  subidos: [] as { bucket: string; path: string }[],
  quitados: [] as { bucket: string; paths: string[] }[],
};

const SUPABASE_URL = "https://proyecto-de-prueba.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = "llave-de-prueba";

const supabaseServerDoble = {
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: sesion ? { id: sesion } : null } }) },
  }),
};

const supabaseJsDoble = {
  createClient: () => ({
    storage: {
      from: (bucket: string) => ({
        upload: async (p: string) => {
          storage.subidos.push({ bucket, path: p });
          return { data: { path: p }, error: null };
        },
        getPublicUrl: (p: string) => ({
          data: { publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${p}` },
        }),
        remove: async (paths: string[]) => {
          storage.quitados.push({ bucket, paths });
          return { data: paths, error: null };
        },
      }),
    },
  }),
};

const SRC = path.resolve(__dirname, "../../..");
const dobles = new Map<string, unknown>([
  [path.join(SRC, "lib/supabase/server.ts"), supabaseServerDoble],
]);
const M = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (request: string, parent: unknown, isMain: boolean) => string;
};
const cargaOriginal = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "@supabase/supabase-js") return supabaseJsDoble;
  try {
    const resuelto = M._resolveFilename(request, parent, isMain);
    if (dobles.has(resuelto)) return dobles.get(resuelto);
  } catch {
    // no resoluble aquí: que lo intente el cargador normal
  }
  return cargaOriginal.call(this, request, parent, isMain);
};

/* ═══════════════ Rutas bajo prueba ═══════════════ */

let logoPOST: typeof import("@/app/api/barber/settings/logo/route")["POST"];
let slugPATCH: typeof import("@/app/api/barber/settings/slug/route")["PATCH"];
let adjuntoPOST: typeof import("@/app/api/barber/support/attachments/route")["POST"];
let cargarBarberWeb: typeof import("@/app/b/[slug]/_shared/shop-data")["cargarBarberWeb"];
let barberiaNuncaPagada: typeof import("@/app/b/[slug]/_shared/shop-data")["barberiaNuncaPagada"];

let png: Buffer;
let n = 0;

/** Una barbería con su dueño logueable. */
async function barberiaConDueno(status: string): Promise<{ t: Tienda; supabaseId: string; slug: string }> {
  const t = await crearTienda({ conectada: false });
  await prisma.barbershop.update({ where: { id: t.id }, data: { subscriptionStatus: status } });
  const supabaseId = `sb-sin-pagar-${Date.now()}-${++n}`;
  await prisma.barberUser.create({
    data: {
      barbershopId: t.id,
      supabaseId,
      email: `dueno${n}@prueba.local`,
      firstName: "Dueño",
      lastName: "Prueba",
      role: "OWNER",
    },
  });
  const slug = (await prisma.barbershop.findUnique({ where: { id: t.id }, select: { slug: true } }))!.slug;
  return { t, supabaseId, slug };
}

function formConImagen(campo = "file"): FormData {
  const fd = new FormData();
  fd.append(campo, new File([new Uint8Array(png)], "logo.png", { type: "image/png" }));
  return fd;
}

async function subirLogo() {
  const req = new NextRequest("http://localhost/api/barber/settings/logo", {
    method: "POST",
    body: formConImagen(),
  });
  const res = await logoPOST(req);
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

before(async () => {
  if (!BASE_LOCAL) return;
  png = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 200, g: 30, b: 30 } },
  })
    .png()
    .toBuffer();
  ({ POST: logoPOST } = await import("@/app/api/barber/settings/logo/route"));
  ({ PATCH: slugPATCH } = await import("@/app/api/barber/settings/slug/route"));
  ({ POST: adjuntoPOST } = await import("@/app/api/barber/support/attachments/route"));
  ({ cargarBarberWeb, barberiaNuncaPagada } = await import("@/app/b/[slug]/_shared/shop-data"));
});

after(async () => {
  M._load = cargaOriginal;
  if (BASE_LOCAL) await borrarTodo();
});

/* ═══════════════ Logo ═══════════════ */

test("logo: sin pagar → 402 y NADA llega al bucket", { skip }, async () => {
  const { supabaseId, t } = await barberiaConDueno("pending_payment");
  sesion = supabaseId;
  storage.subidos = [];
  const r = await subirLogo();
  assert.equal(r.status, 402);
  assert.equal(r.json.code, "SUBSCRIPTION_INACTIVE");
  assert.equal(storage.subidos.length, 0);
  const row = await prisma.barbershop.findUnique({ where: { id: t.id }, select: { logoUrl: true } });
  assert.equal(row!.logoUrl, null);
});

test("logo: pagada → sube, y el logo anterior sale del bucket", { skip }, async () => {
  const { supabaseId, t } = await barberiaConDueno("active");
  sesion = supabaseId;
  storage.subidos = [];
  storage.quitados = [];

  const r1 = await subirLogo();
  assert.equal(r1.status, 200);
  assert.equal(storage.quitados.length, 0, "el primero no tiene a quién reemplazar");

  const r2 = await subirLogo();
  assert.equal(r2.status, 200);
  assert.notEqual(r2.json.logoUrl, r1.json.logoUrl);
  assert.equal(storage.subidos.length, 2);
  assert.deepEqual(storage.quitados, [{ bucket: "clinic-public", paths: [storage.subidos[0].path] }]);
  assert.ok(storage.subidos[0].path.startsWith(`barber/${t.id}/logo/`));
});

test("logo: el anterior NO se quita si otra sede usa la misma liga", { skip }, async () => {
  const { supabaseId, t } = await barberiaConDueno("active");
  sesion = supabaseId;
  storage.subidos = [];
  storage.quitados = [];
  const r1 = await subirLogo();
  // Al crear una sede se le copia el logo de la matriz (branches.ts).
  const sede = await crearTienda({ conectada: false });
  await prisma.barbershop.update({ where: { id: sede.id }, data: { logoUrl: r1.json.logoUrl } });

  const r2 = await subirLogo();
  assert.equal(r2.status, 200);
  assert.equal(storage.quitados.length, 0, "la sede se quedaría sin logo");
  void t;
});

test("logo: una liga ajena a nuestra carpeta no se toca", { skip }, async () => {
  const { supabaseId, t } = await barberiaConDueno("active");
  await prisma.barbershop.update({
    where: { id: t.id },
    data: { logoUrl: `${SUPABASE_URL}/storage/v1/object/public/clinic-public/barber/OTRA/logo/x.png` },
  });
  sesion = supabaseId;
  storage.quitados = [];
  const r = await subirLogo();
  assert.equal(r.status, 200);
  assert.equal(storage.quitados.length, 0);
});

/* ═══════════════ Slug ═══════════════ */

test("slug: sin pagar no se cambia (402); pagada sí", { skip }, async () => {
  const impaga = await barberiaConDueno("pending_payment");
  sesion = impaga.supabaseId;
  const nuevo = `${impaga.slug}-nuevo`;
  const req = new Request("http://localhost/api/barber/settings/slug", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slug: nuevo, confirm: true }),
  });
  const res = await slugPATCH(req);
  assert.equal(res.status, 402);
  const row = await prisma.barbershop.findUnique({ where: { id: impaga.t.id }, select: { slug: true } });
  assert.equal(row!.slug, impaga.slug);

  const pagada = await barberiaConDueno("active");
  sesion = pagada.supabaseId;
  const nuevo2 = `${pagada.slug}-nuevo`;
  const res2 = await slugPATCH(
    new Request("http://localhost/api/barber/settings/slug", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: nuevo2, confirm: true }),
    }),
  );
  assert.equal(res2.status, 200);
  const row2 = await prisma.barbershop.findUnique({ where: { id: pagada.t.id }, select: { slug: true } });
  assert.equal(row2!.slug, nuevo2);
});

/* ═══════════════ Adjuntos de soporte ═══════════════ */

test("adjuntos de soporte: sin pagar → 402 y no sube; pagada → sube", { skip }, async () => {
  const impaga = await barberiaConDueno("pending_payment");
  sesion = impaga.supabaseId;
  storage.subidos = [];
  const res = await adjuntoPOST(
    new NextRequest("http://localhost/api/barber/support/attachments", { method: "POST", body: formConImagen() }),
  );
  assert.equal(res.status, 402);
  const body = (await res.json()) as Record<string, string>;
  assert.match(body.error, /sin adjuntos/);
  assert.equal(storage.subidos.length, 0);

  const pagada = await barberiaConDueno("active");
  sesion = pagada.supabaseId;
  const res2 = await adjuntoPOST(
    new NextRequest("http://localhost/api/barber/support/attachments", { method: "POST", body: formConImagen() }),
  );
  assert.equal(res2.status, 200);
  assert.equal(storage.subidos.length, 1);
});

/* ═══════════════ /b/<slug> ═══════════════ */

test("/b/<slug>: nunca pagó → «no encontrada»; vencida o cancelada se queda como estaba", () => {
  for (const s of ["pending_payment", "incomplete", "incomplete_expired"]) {
    assert.equal(barberiaNuncaPagada({ subscriptionStatus: s }), true, s);
  }
  for (const s of ["active", "trialing", "paid", "past_due", "unpaid", "canceled", "cancelled", null]) {
    assert.equal(barberiaNuncaPagada({ subscriptionStatus: s }), false, String(s));
  }
});

test("/b/<slug>: la carga marca nuncaPagada y la página responde notFound", { skip }, async () => {
  const impaga = await barberiaConDueno("pending_payment");
  const pagada = await barberiaConDueno("past_due");
  assert.equal((await cargarBarberWeb(impaga.slug))!.nuncaPagada, true);
  assert.equal((await cargarBarberWeb(pagada.slug))!.nuncaPagada, false);

  // La página: lo único que cambió es esta línea, y la prueba la exige.
  const fs = await import("node:fs");
  const page = fs.readFileSync(path.join(SRC, "app/b/[slug]/page.tsx"), "utf8");
  assert.match(page, /if \(carga\.nuncaPagada\) notFound\(\);/);
});
