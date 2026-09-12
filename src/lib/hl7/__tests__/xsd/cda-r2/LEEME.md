# XSD oficial de HL7 CDA Release 2

Lo usa `../../cda-esquema.test.ts` (`npm run test:cda-esquema`) para validar el CDA que
exporta `src/lib/hl7/cda.ts`. **No se edita a mano**: si el CDA no valida, se arregla el
generador, no el esquema.

- Origen: repo oficial de HL7, https://github.com/HL7/CDA-core-2.0
  → `schema/normative/cda_r2_normativewebedition2010.zip` (descargado el 12-sep-2026).
- Copiados tal cual, con la misma estructura de carpetas que en el zip (los `include`
  de `POCD_MT000040.xsd` apuntan a `../../processable/coreschemas/`).
- Licencia: la de HL7 que va dentro de cada archivo (redistribución permitida
  conservando el aviso). Por eso no se tocan.

sha256 de cada archivo, idénticos a los del zip:

```
eedb18548c905534233252144dbc86d5aa64e22ff77aa8d25cc78e8d2a31afac  infrastructure/cda/CDA.xsd
4d48e080d23d10ab25c3c9f66a2ecca47378ab888ac25e334921432083d14be2  infrastructure/cda/POCD_MT000040.xsd
0c7dd69c07d41e18b02ece1aaf8a7a49d7f41bf1c2fa2b09e0932dd9446a3826  processable/coreschemas/datatypes-base.xsd
e3ced45f77a48478e7db3b50cb753b50eb0f39fd2c3228e2faebde1945f6045f  processable/coreschemas/datatypes.xsd
8f02813bd43e0e1f383543dc22da1880ab8d93868116ee511888241cb8ebdfac  processable/coreschemas/NarrativeBlock.xsd
22970695278df249ead5aacced0cdf9a77b731bd249d7f2234dd3f79511e4b6b  processable/coreschemas/voc.xsd
```

La validación la hace libxml2 vía `python3` + `lxml` (en Debian: `apt install python3-lxml`).
