# Feature Specification: Agente Conversacional Órdenes de Compra SAP

**Feature Branch**: `001-ordenes-compra-sap`  
**Created**: 2026-11-09  
**Status**: Ready for Planning  
**Input**: User description: "Crea la especificación base completa leyendo el archivo PRD.md y los fixtures en fixtures/reto-03/. Debe incluir: Los esquemas Zod de Paquete y OrdenCompra (sección 7.4); Las 10 reglas de control (RC1 a RC10) clasificadas en Bloqueos (RC1, RC2, RC3, RC4, RC10), Confirmaciones (RC5, RC8, RC9), y Derivados (RC6, RC7); La tabla de resultados esperados de los 6 casos de prueba (sol-001 a sol-006), incluyendo el caso retroactivo (sol-005) y la prueba de idempotencia de sol-001; Contrato determinista de las herramientas para que demo.ts corra sin LLM."

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Lectura y Normalización de Paquetes de Solicitud (Priority: P1)

Como analista administrativa, quiero que el sistema ingeste de forma unificada las piezas de la solicitud (correo, solicitud de compra, cotización, aprobación y factura opcional) para contar con un paquete estructurado y validado sin tener que revisar manualmente cada archivo.

**Why this priority**: Es la puerta de entrada indispensable del agente. Si los datos no se leen y normalizan con precisión, ninguna validación ni creación subsecuente es posible.

**Independent Test**: Ejecutar `oc_leer_paquete` con el identificador de caso `sol-001` y verificar que devuelva un objeto estructurado con `correo`, `solicitud`, `cotizacion` y `aprobacion` correctamente tipados sin requerir conexión a un LLM ni a SAP.

**Acceptance Scenarios**:
1. **Given** un caso válido como `sol-001`, **When** se invoca la lectura del paquete, **Then** el sistema retorna `{ ok: true, data: { correo, solicitud, cotizacion, aprobacion, factura: null } }`.
2. **Given** un caso donde falte un adjunto o el identificador no exista, **When** se procesa la lectura, **Then** el sistema reporta el campo ausente como `null` y retorna `{ ok: false, error }` legible sin lanzar excepciones.

---

### User Story 2 - Validación Determinista contra Maestros y Reglas de Control (Priority: P1)

Como analista administrativa, quiero que el sistema valide automáticamente el paquete contra los catálogos maestros (proveedores, centros de costo, indicadores de IVA, condiciones de pago) aplicando las 10 reglas de control (RC1 a RC10) para asegurar la conformidad antes de cualquier intento de registro en SAP.

**Why this priority**: Representa el núcleo de control y auditoría. Evita la creación de órdenes de compra con proveedores inexistentes, montos desbordados o centros de costos erróneos.

**Independent Test**: Ejecutar `oc_validar` sobre `sol-002` (proveedor inexistente) y comprobar que retorne `apta: false` con bloqueo RC1; y sobre `sol-003` (aprobador no autorizado) verificando bloqueo RC2 y RC3.

**Acceptance Scenarios**:
1. **Given** una solicitud con proveedor no registrado en maestros (`sol-002`), **When** se ejecuta la validación, **Then** el sistema determina `apta: false` e incluye en `bloqueos` la violación de RC1 con mensaje explicativo.
2. **Given** una solicitud aprobada por un correo ajeno al centro de costo (`sol-003`), **When** se ejecuta la validación, **Then** el sistema determina `apta: false` e incluye bloqueos RC2 y RC3 impidiendo la creación.
3. **Given** una solicitud conforme (`sol-001`), **When** se ejecuta la validación, **Then** el sistema retorna `apta: true`, `bloqueos: []`, `confirmaciones: []` y `derivados: {}`.

---

### User Story 3 - Gestión de Excepciones, Confirmaciones Humanas y Derivados (Priority: P2)

Como analista administrativa, quiero que el sistema detecte inconsistencias tolerables (diferencias de cotización, IVA ausente, órdenes retroactivas) y solicite mi confirmación explícita antes de proceder, completando automáticamente los valores derivados de los maestros.

**Why this priority**: O3 y O4 del PRD. Transforma errores silenciosos o suposiciones opacas en decisiones humanas informadas y registra el desvío operativo para auditoría.

**Independent Test**: Ejecutar `oc_validar` sobre `sol-004` (desvío de cotización > 2%) comprobando la solicitud de confirmación RC5; y sobre `sol-005` comprobando la marca `retroactiva = true` (RC8).

**Acceptance Scenarios**:
1. **Given** una cotización cuyo monto difiere más del 2% respecto a la solicitud (`sol-004`), **When** se ejecuta la validación, **Then** el sistema añade una advertencia a `confirmaciones` con ambos montos y exige confirmación humana antes de crear la OC.
2. **Given** un paquete que contiene una factura con fecha anterior a la fecha de la solicitud (`sol-005`), **When** se valida el paquete, **Then** el sistema marca `retroactiva: true`, agrega la advertencia a `confirmaciones` y exige confirmación previa.
3. **Given** una solicitud que omite el indicador de IVA (`sol-006`), **When** se ejecuta la validación, **Then** el sistema deriva el valor por defecto del proveedor (`indicador_iva_default`), lo agrega a `derivados` y añade solicitud de confirmación (RC6).

---

### User Story 4 - Generación de Evidencia de Aprobación y Trazabilidad (Priority: P2)

Como auditor interno, quiero que cada orden procesada cuente con un archivo de evidencia del correo de aprobación con su hash criptográfico SHA-256 y un mapa de trazabilidad de datos, para sustentar documentalmente la autorización del gasto.

**Why this priority**: Requisito HU-4 y principio de auditoría corporativa. Garantiza que toda orden creada en SAP tenga respaldo inmutable de aprobación.

**Independent Test**: Ejecutar `oc_generar_evidencia` para el caso `sol-001` y verificar la creación del archivo de evidencia en `out/sol-001/aprobacion.txt` (o `.pdf`) junto con su hash SHA-256 no vacío.

**Acceptance Scenarios**:
1. **Given** un caso con correo de aprobación válido, **When** se genera la evidencia, **Then** el sistema produce el archivo de texto/PDF con encabezados normalizados, cuerpo del mensaje y hash SHA-256 correspondiente.
2. **Given** la construcción del payload de la OC, **When** se genera el payload, **Then** el sistema almacena en `out/<caso>/trazabilidad.json` la fuente de cada campo (solicitud, cotización, maestro o derivado).

---

### User Story 5 - Creación de la Orden en SAP Simulado, Idempotencia y Registro de Control (Priority: P1)

Como analista administrativa, quiero crear la orden de compra en el adaptador simulado de SAP y recibir el número de orden asignado, garantizando que reintentos sobre la misma solicitud no generen órdenes duplicadas y que cada intento se audite en `out/control.csv`.

**Why this priority**: Es el objetivo final del flujo (HU-5). Garantiza la integridad del ERP simulado y la trazabilidad de auditoría.

**Independent Test**: Ejecutar `oc_crear` para `sol-001`, verificar que devuelva número de orden secuencial `4500000001` e `idempotente: false`; invocar nuevamente sobre `sol-001` y comprobar que retorne el mismo número con `idempotente: true` sin añadir un segundo registro en SAP.

**Acceptance Scenarios**:
1. **Given** un payload válido y validaciones superadas (`apta: true`), **When** se invoca `oc_crear`, **Then** el sistema genera una nueva orden numerada a partir de `4500000001`, la guarda en `out/sap/ordenes.jsonl` y registra la fila en `out/control.csv`.
2. **Given** una solicitud ya procesada previamente, **When** se invoca `oc_crear` con el mismo `solicitud_id`, **Then** el sistema retorna el número de orden existente con indicador `idempotente: true` sin duplicar la orden en SAP.
3. **Given** un intento de creación sobre un caso con bloqueos o confirmaciones pendientes no confirmadas, **When** se intenta crear, **Then** el sistema rechaza la operación retornando `{ ok: false, error }` y registra el resultado en `out/control.csv`.

---

### User Story 6 - Ejecución Determinista sin Modelo (`demo.ts`) (Priority: P1)

Como evaluador técnico, quiero ejecutar un script independiente `demo.ts` mediante línea de comandos sin dependencias de modelos LLM ni claves de API, para validar los 6 casos de prueba, sus bloqueos, confirmaciones, detección retroactiva e idempotencia de forma determinista.

**Why this priority**: Requisito fundamental de evaluación técnica (Sección 6.6 del PRD). Demuestra la robustez y autonomía de la capa de herramientas.

**Independent Test**: Ejecutar `bun run demo.ts` (o `npx tsx demo.ts`) en consola limpia y comprobar que recorra `sol-001` a `sol-006`, ejecutando `sol-001` dos veces para verificar idempotencia y resolviendo `sol-004` con confirmación explícita.

**Acceptance Scenarios**:
1. **Given** un entorno sin variables de entorno de LLM configuradas, **When** se ejecuta `demo.ts`, **Then** el proceso concluye con éxito (exit code 0), imprime en consola el resumen de cada caso y genera los archivos correspondientes en `out/`.

---

### Edge Cases

- **Ausencia de cotización**: Si el paquete carece de cotización, no se calcula porcentaje de desvío; en su lugar, se solicita confirmación explícita al usuario indicando la ausencia de cotización formal.
- **Valores no numéricos o cantidades cero/negativas**: La validación de esquema Zod intercepta de inmediato tipos inválidos o montos no positivos retornando un error `{ ok: false, error }` descriptivo.
- **Aprobador inexistente en el catálogo de centros de costos**: Se categoriza como violación estricta de RC2 (bloqueo), detallando los correos autorizados para el centro de costos respectivo.
- **Diferencia de redondeo en posición**: La regla RC10 permite una tolerancia de ±1 unidad monetaria para tolerar redondeos estándar entre cantidad × valor unitario y el valor total.
- **Reintento concurrente de creación**: El adaptador simulado de SAP debe verificar la existencia del `solicitud_id` antes de asignar un nuevo correlativo de orden.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema MUST leer los archivos del paquete (`correo.json`, `solicitud.json`, `cotizacion.txt`, `aprobacion.json`, `factura.txt`) desde rutas relativas a `ctx.directory` sin utilizar rutas absolutas hardcodeadas.
- **FR-002**: El sistema MUST normalizar y validar el paquete completo contra el esquema Zod `PaqueteSchema`.
- **FR-003**: El sistema MUST ejecutar la validación integral aplicando las 10 reglas de control (RC1 a RC10) sin omitir ninguna regla y devolver un objeto estructurado `{ apta: boolean, bloqueos: string[], confirmaciones: string[], derivados: Record<string, unknown>, retroactiva: boolean }`.
- **FR-004**: El sistema MUST clasificar las reglas de control en tres categorías estrictas: Bloqueos (impiden creación), Confirmaciones (requieren `confirmado = true`) y Derivados (completan valores ausentes desde los maestros).
- **FR-005**: El sistema MUST construir el payload de la orden de compra validado estrictamente contra el esquema Zod `OrdenCompraSchema`.
- **FR-006**: El sistema MUST limitar la descripción de las posiciones en el payload de la orden de compra a un máximo estricto de 40 caracteres (restricción estándar SAP).
- **FR-007**: El sistema MUST generar la evidencia de aprobación en archivo de texto plano (`out/<caso>/aprobacion.txt`) y opcionalmente PDF (`aprobacion.pdf`), calculando su hash criptográfico SHA-256.
- **FR-008**: El sistema MUST registrar el mapa de trazabilidad de cada campo del payload en `out/<caso>/trazabilidad.json`.
- **FR-009**: El sistema MUST implementar la interfaz `SapAdapter` mediante un adaptador simulado en `src/sap/mock.ts` que almacene las órdenes en `out/sap/ordenes.jsonl`.
- **FR-010**: El sistema MUST asignar numeración secuencial a las órdenes de compra comenzando desde `4500000001`.
- **FR-011**: El adaptador SAP MUST implementar idempotencia: si se intenta registrar una orden con un `solicitud_id` ya existente, debe retornar el número ya asignado con `idempotente: true` sin duplicar el registro en el archivo de órdenes.
- **FR-012**: El sistema MUST registrar cada intento de procesamiento en `out/control.csv` con la estructura: `solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts`.
- **FR-013**: Todas las herramientas en `src/tools/oc.ts` MUST validar sus argumentos con Zod, MUST capturar todas las excepciones internas y MUST retornar strings JSON estructurados `{ ok: true, data }` o `{ ok: false, error }`.
- **FR-014**: El sistema MUST proveer el script `demo.ts` ejecutable que procese los 6 casos de prueba (`sol-001` a `sol-006`), pruebe la idempotencia de `sol-001` y la confirmación de `sol-004`, sin requerir ningún modelo de lenguaje ni variable de entorno de LLM.
- **FR-015**: El backend MUST gestionar los secretos de LLM exclusivamente en `process.env`, sin exponerlos en logs, respuestas de red, interfaz frontend ni control de versiones Git.

---

### Esquemas Zod y Contratos de Datos

#### 1. Esquema Zod de Solicitud y Paquete Normalizado

```typescript
import { z } from "zod";

export const SolicitudSchema = z.object({
  solicitud_id: z.string().describe("Identificador único de la solicitud, ej. SOL-2026-001"),
  solicitante: z.string().describe("Nombre de la persona solicitante"),
  proveedor_nombre: z.string().describe("Nombre o razón social del proveedor"),
  proveedor_nit: z.string().optional().describe("NIT del proveedor si fue suministrado"),
  descripcion: z.string().describe("Descripción detallada del bien o servicio"),
  centro_costo: z.string().describe("Código del centro de costo, ej. CC-1010"),
  subarea: z.string().describe("Subárea asignada al gasto"),
  cantidad: z.number().positive().describe("Cantidad de ítems o unidades solicitadas"),
  valor_unitario: z.number().nonnegative().describe("Valor unitario sin o con IVA según cotización"),
  valor_total: z.number().positive().describe("Valor total calculado de la solicitud"),
  moneda: z.enum(["COP", "USD"]).describe("Moneda de la transacción"),
  indicador_iva: z.string().optional().describe("Código de IVA, ej. C1"),
  condiciones_pago: z.string().optional().describe("Código de condiciones de pago, ej. Z030"),
  fecha_solicitud: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Fecha en formato YYYY-MM-DD")
});

export const CotizacionSchema = z.object({
  proveedor: z.string(),
  nit: z.string().nullable(),
  total: z.number(),
  moneda: z.string(),
  validez_hasta: z.string().nullable(),
  texto: z.string()
});

export const AprobacionSchema = z.object({
  de: z.string().email(),
  fecha: z.string(),
  aprobado: z.boolean(),
  texto: z.string()
});

export const FacturaSchema = z.object({
  numero: z.string(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  total: z.number()
});

export const PaqueteSchema = z.object({
  correo: z.object({
    id: z.string(),
    de: z.string(),
    asunto: z.string(),
    fecha: z.string()
  }),
  solicitud: SolicitudSchema,
  cotizacion: CotizacionSchema.nullable(),
  aprobacion: AprobacionSchema.nullable(),
  factura: FacturaSchema.nullable()
});
```

#### 2. Esquema Zod de Orden de Compra (Sección 7.4 del PRD)

```typescript
export const PosicionOrdenCompraSchema = z.object({
  numero: z.number().int().positive().describe("Número correlativo de posición: 10, 20, 30..."),
  descripcion: z.string().max(40, "La descripción breve no debe superar los 40 caracteres (límite SAP)"),
  cantidad: z.number().positive(),
  unidad: z.enum(["UN", "H", "MES"]),
  precio_unitario: z.number().nonnegative(),
  centro_costo: z.string(),
  subarea: z.string(),
  indicador_iva: z.string().describe("Código SAP, ej. C1")
});

export const ExcepcionOrdenCompraSchema = z.object({
  codigo: z.string().describe("Código de la regla o excepción, ej. RC5, RC8"),
  detalle: z.string().describe("Detalle explicativo de la desviación"),
  confirmado_por: z.string().nullable().describe("Usuario o canal que otorgó la confirmación")
});

export const OrdenCompraSchema = z.object({
  referencia: z.object({
    solicitud_id: z.string(),
    correo_id: z.string(),
    cotizacion_ref: z.string().nullable()
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({
    codigo_sap: z.string(),
    nit: z.string(),
    nombre: z.string()
  }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string().describe("Código SAP de condiciones de pago, ej. Z030"),
  aprobador: z.object({
    email: z.string().email(),
    fecha_aprobacion: z.string(),
    evidencia_sha256: z.string()
  }),
  posiciones: z.array(PosicionOrdenCompraSchema).min(1),
  excepciones: z.array(ExcepcionOrdenCompraSchema)
});

export type OrdenCompra = z.infer<typeof OrdenCompraSchema>;
export type Paquete = z.infer<typeof PaqueteSchema>;
```

---

### Matriz de Reglas de Control (RC1 - RC10)

| # Regla | Clasificación | Condición Lógica | Comportamiento del Agente |
|---|---|---|---|
| **RC1** | **Bloqueo** | Proveedor debe existir en `proveedores.json` (por NIT; si falta NIT, por nombre normalizado) y tener `activo == true`. | Si no existe o `activo == false`, se agrega a `bloqueos`. Impide crear la OC. |
| **RC2** | **Bloqueo** | La aprobación debe existir, contener la palabra "Aprobado" (case-insensitive) y provenir de un correo listado en los aprobadores del `centro_costo`. | Si no hay aprobación, no contiene "Aprobado" o el remitente no es aprobador del centro, se agrega a `bloqueos`. |
| **RC3** | **Bloqueo** | `solicitud.valor_total <= aprobador.tope` definido en el centro de costo. | Si el valor total excede el tope de autorización del aprobador, se agrega a `bloqueos`. |
| **RC4** | **Bloqueo** | `solicitud.subarea` debe estar en la lista `subareas` de `centros-costo.json` para ese centro. | Si la subárea no pertenece al centro de costos, se agrega a `bloqueos`. |
| **RC5** | **Confirmación** | `abs(cotizacion.total − solicitud.valor_total) / solicitud.valor_total <= 0.02`. Si no hay cotización, se requiere confirmación. | Si el desvío supera el 2% o no hay cotización, se añade a `confirmaciones` con ambos montos y el desvío porcentual. |
| **RC6** | **Confirmación + Derivado** | `solicitud.indicador_iva` ausente. | Se deriva desde `proveedor.indicador_iva_default`, se añade a `derivados` y se incluye en `confirmaciones`. |
| **RC7** | **Derivado** | `solicitud.condiciones_pago` ausente. | Se deriva desde `proveedor.condiciones_pago_default` y se añade a `derivados`. Se informa al usuario sin requerir confirmación explícita. |
| **RC8** | **Confirmación** | Existe `factura` adjunta con `fecha < solicitud.fecha_solicitud`. | Se marca `retroactiva = true`, se agrega a `confirmaciones` y se registra en `out/control.csv`. |
| **RC9** | **Confirmación** | `aprobacion.fecha >= solicitud.fecha_solicitud` (comparación de fecha calendario). | Si la fecha de aprobación es anterior a la solicitud, se agrega a `confirmaciones`. |
| **RC10** | **Bloqueo** | `abs((cantidad × valor_unitario) − valor_total) <= 1.0` (tolerancia de 1 unidad monetaria). | Si el producto no coincide con el total reportado, se agrega a `bloqueos`. |

---

### Contrato Determinista de Herramientas (`src/tools/oc.ts`)

Todas las herramientas implementan la firma:
```typescript
execute(args: ArgsType, ctx: { directory: string; sessionId: string }): Promise<string>
```
Retornando invariablemente cadenas JSON con formato `{ ok: true, data: T }` o `{ ok: false, error: string }`.

| Nombre Export | Nombre Herramienta | Argumentos Zod | Contenido de `data` en caso exitoso | Prioridad |
|---|---|---|---|---|
| `leer_paquete` | `oc_leer_paquete` | `{ caso: z.string().describe("Carpeta del caso en fixtures/reto-03/solicitudes/") }` | `Paquete` normalizado según `PaqueteSchema`. | P0 |
| `validar` | `oc_validar` | `{ caso: z.string(), paquete: PaqueteSchema }` | `{ apta: boolean, bloqueos: string[], confirmaciones: string[], derivados: Record<string, unknown>, retroactiva: boolean }` | P0 |
| `construir_payload` | `oc_construir_payload` | `{ caso: z.string(), paquete: PaqueteSchema, derivados: z.record(z.unknown()), excepciones?: z.array(ExcepcionOrdenCompraSchema) }` | `{ payload: OrdenCompra, ruta_trazabilidad: string }` | P0 |
| `generar_evidencia` | `oc_generar_evidencia` | `{ caso: z.string() }` | `{ ruta: string, sha256: string, tipo: "txt" \| "pdf" }` | P0 txt · P1 pdf |
| `crear` | `oc_crear` | `{ caso: z.string(), payload: OrdenCompraSchema, confirmado?: z.boolean().default(false) }` | `{ numero_oc: string, fecha: string, idempotente: boolean }` | P0 |
| `leer_excel` | `oc_leer_excel` | `{ ruta: z.string().describe("Ruta relativa a ctx.directory del archivo xlsx") }` | `{ filas: Array<Record<string, unknown>> }` | P1 opcional |

---

### Matriz de Casos de Prueba (`sol-001` a `sol-006`)

| Caso ID | Proveedor / Centro | Condición Clave Evaluada | Reglas Activadas | Resultado `apta` | `retroactiva` | Acción Final / Resultado Esperado |
|---|---|---|---|---|---|---|
| **sol-001** (1ª vez) | TecnoSuministros / CC-1010 | Flujo feliz estándar completo | Todas las reglas conformes | `true` | `false` | Crea OC `4500000001`, `idempotente: false`, genera evidencia `aprobacion.txt` y registro en `out/control.csv`. |
| **sol-001** (2ª vez) | TecnoSuministros / CC-1010 | **Prueba de Idempotencia** | Detección de orden existente | `true` | `false` | Retorna OC `4500000001` con `idempotente: true` sin duplicar en SAP. |
| **sol-002** | Soluciones Digitales / CC-1010 | Proveedor no registrado en catálogo | **RC1 (Bloqueo)** | `false` | `false` | Bloqueado: No crea OC. Informa que el proveedor no existe en maestros y sugiere darlo de alta. |
| **sol-003** | Mobiliario Andino / CC-2020 | Aprobador de otro centro (fvargas es CC-3030) y tope excedido | **RC2 (Bloqueo)**, **RC3 (Bloqueo)** | `false` | `false` | Bloqueado: No crea OC. Informa aprobador no autorizado para CC-2020 y monto fuera de límite. |
| **sol-004** | Cloud Andina / CC-1010 | Cotización (26.5M) ≠ Solicitud (25M), desvío 6% > 2% | **RC5 (Confirmación)** | `true` (con confirmación) | `false` | Requiere confirmación humana explícita. Al confirmar (`confirmado = true`), crea OC `4500000002`. |
| **sol-005** | Papelería Central / CC-2020 | Factura (2026-08-10) anterior a solicitud (2026-08-27) | **RC8 (Confirmación)** | `true` (con confirmación) | `true` | Requiere confirmación. Al confirmar, crea OC `4500000003` marcada con `retroactiva = true` en `out/control.csv`. |
| **sol-006** | TecnoSuministros / CC-1010 | Solicitud sin NIT, sin IVA y sin condiciones de pago | **RC6 (Confirmación)**, **RC7 (Derivado)** | `true` (con confirmación) | `false` | Deriva IVA `C1` y pago `Z030`. Requiere confirmación de IVA derivado. Al confirmar, crea OC `4500000004`. |

---

### Key Entities

- **Solicitud**: Documento inicial emitido por un colaborador solicitando la compra de bienes o servicios, conteniendo cantidades, precios unitarios, centro de costos y subárea.
- **Paquete de Compra**: Agregación normalizada de todos los insumos documentales vinculados a una transacción de compra: solicitud, correo de origen, cotización comercial, aprobación formal y factura si existiese.
- **Catálogos Maestros**: Fuentes de referencia corporativa autorizadas:
  - *Proveedores*: Códigos SAP, NITs, nombres, condiciones de pago por defecto, indicadores de IVA por defecto y estado activo/inactivo.
  - *Centros de Costo*: Códigos de centro, subáreas válidas y lista de correos de aprobadores con sus respectivos topes monetarios.
  - *Indicadores de IVA*: Códigos tributarios SAP (C0, C1, C2), descripciones y tasas porcentuales.
  - *Condiciones de Pago*: Códigos de crédito SAP (Z000, Z015, Z030, Z060), descripciones y plazos en días.
- **Orden de Compra SAP**: Estructura de payload formal validada según especificación de SAP con cabecera (sociedad, organización, proveedor, condiciones), referencias, aprobador, posiciones y excepciones auditadas.
- **Evidencia de Aprobación**: Documento textual o PDF que certifica el remitente, fecha, destinatarios, asunto y contenido íntegro del visto bueno de la gerencia, respaldado por su hash SHA-256.
- **Log de Control (`out/control.csv`)**: Bitácora inmutable de auditoría donde se asienta cada intento de creación con sus bloqueos, confirmaciones, estado de retroactividad y número de orden resultante.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El script determinista `demo.ts` procesa el 100% de los 6 casos de prueba (`sol-001` a `sol-006`) sin errores de ejecución ni dependencias de conexión a modelos de lenguaje externos.
- **SC-002**: La prueba de idempotencia sobre `sol-001` demuestra que invocar la creación dos veces produce el mismo número de orden (`4500000001`) manteniendo exactamente una sola orden en `out/sap/ordenes.jsonl`.
- **SC-003**: El 100% de las solicitudes con anomalías bloqueantes (`sol-002`, `sol-003`) son rechazadas sin registrar orden en SAP y retornando mensajes de causa raíz accionables para el usuario.
- **SC-004**: El 100% de las solicitudes que requieren confirmación (`sol-004`, `sol-005`, `sol-006`) impiden la creación si `confirmado == false`, y proceden exitosamente cuando el usuario confirma.
- **SC-005**: El 100% de las órdenes retroactivas identificadas (caso `sol-005`) quedan registradas en `out/control.csv` con el flag `retroactiva = true`.
- **SC-006**: Ninguna llamada a herramienta en `src/tools/oc.ts` lanza excepciones no capturadas; el 100% de las respuestas son strings JSON válidos cumpliendo la estructura `{ ok: true, data }` o `{ ok: false, error }`.

---

## Assumptions

- **A-001**: Los archivos ubicados en `fixtures/reto-03/` actúan como fuentes maestras de datos de solo lectura y no deben ser modificados durante la ejecución del sistema.
- **A-002**: El entorno de ejecución local cuenta con Node.js en versión 20 o superior, o con el runtime Bun.
- **A-003**: En caso de ausencia de NIT en la solicitud (`sol-006`), la resolución del proveedor en maestros se realiza mediante normalización de texto y coincidencia exacta insensible a mayúsculas sobre `proveedor_nombre`.
- **A-004**: Para la evidencia de aprobación, el formato texto (`out/<caso>/aprobacion.txt`) es el entregable base P0 con su hash SHA-256, mientras que la generación de PDF (`aprobacion.pdf`) representa el nivel P1 complementario.
- **A-005**: La interfaz del adaptador SAP `SapAdapter` interactúa con el sistema de archivos local (`out/sap/ordenes.jsonl`) para simular la persistencia y consulta del ERP sin requerir conectividad de red externa.

