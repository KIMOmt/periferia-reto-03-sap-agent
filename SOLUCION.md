# SOLUCION.md — Agente Conversacional Órdenes de Compra SAP

**Proceso de Selección · Equipo Perxia 2.0 · Periferia IT Group**  
**Candidato**: Mateo Gutiérrez Suárez  
**Fecha**: 2026-11-10  

---

## 1. Problema en una frase y a quién le duele

> La digitación manual y desarticulada de solicitudes de compra en SAP GUI consume tiempo valioso de la **analista administrativa**, introduce costosos errores contables en los centros de costo y priva a la **dirección financiera y de auditoría** de control sistemático sobre compras retroactivas y límites de aprobación.

---

## 2. Arquitectura del Sistema

El sistema implementa una arquitectura desacoplada en cuatro capas fundamentales con estricta separación de responsabilidades:

```
┌──────────────────┐               ┌────────────────────────────────────────────────────────┐
│  FRONTEND (Web)  │  HTTP / REST  │  BACKEND (Node 20+ / Bun)                              │
│  - web/index.html│ ────────────▶ │  - src/server.ts (API /api/chat, /api/health)          │
│  - web/style.css │ ◀──────────── │  - src/agent/runner.ts (Orquestador conversacional)    │
│  - web/app.js    │               │  - src/llm/adapter.ts & provider.ts (Inferencia LLM)   │
└──────────────────┘               └──────────┬─────────────────────────────┬───────────────┘
                                              │                             │
                                  LECTURA MAESTROS/CASOS           ESCRITURA DE AUDITORÍA
                                              ▼                             ▼
                                   fixtures/reto-03/                     out/
                                   ├── maestros/                         ├── control.csv
                                   └── solicitudes/                      ├── sap/ordenes.jsonl
                                                                         └── <caso>/aprobacion.txt
```

### Ubicación de los Componentes Cardinales:
- **Comportamiento (Prompt de Sistema)**: Reside exclusivamente en `agent/prompt.md`. Modificar el tono, las políticas de interacción humana o los protocolos de confirmación no requiere recompilar ni alterar el servidor.
- **Conocimiento (Reglas de Negocio)**: Centralizado en `src/knowledge/ordenes-compra.md`. Contiene la base documental con los catálogos de proveedores, centros de costos, topes de autorización e indicadores de IVA.
- **Ejecución (Capa Determinista)**: Implementada en `src/tools/oc.ts` y `src/sap/{adapter.ts, mock.ts}`. Son funciones tipadas con Zod que nunca lanzan excepciones no controladas y constituyen la **única fuente de verdad** que el modelo puede afirmar.
- **Modularidad Reutilizable**: Empaquetado en la carpeta `modulo/` (`modulo/agent.md`, `modulo/tools/oc.ts`, `modulo/skill/ordenes-compra/SKILL.md`) para cumplir el bonus de integración con plataformas externas de agentes sin acoplamiento al servidor HTTP.

---

## 3. Ciclo del Agente

El ciclo conversacional se gestiona en `src/agent/runner.ts` siguiendo las reglas del PRD:

1. **Bucle de Ejecución con Límite de Iteraciones (Regla CA1)**:
   - Cada turno de conversación ejecuta un bucle iterativo: `Historial → Modelo LLM → Extracción de Tool Calls → Ejecución en src/tools/oc.ts → Retorno estructurado al Historial → Modelo LLM`.
   - Se impone un **tope estricto de 25 iteraciones** por turno para evitar bucles infinitos o consumo descontrolado de tokens. Si se alcanza el límite, el agente resume el estado alcanzado y las acciones pendientes.
2. **Prohibición de Alucinación (Regla CA2)**:
   - El system prompt prohíbe taxativamente al modelo afirmar montos, proveedores o números de orden que no provengan de la salida de una herramienta.
3. **Protocolo de Confirmación Humana (Regla CA3)**:
   - Cuando `oc_validar` detecta desvíos permitidos (`RC5` desvío de cotización > 2%, `RC6` IVA derivado, `RC8` factura previa/retroactiva), el runner activa el estado `needsConfirmation = true`.
   - El agente interrumpe de inmediato la invocación de `oc_crear`, resume la anomalía detectada en el chat y finaliza su turno preguntando explícitamente a la analista: *¿Deseas confirmar la excepción para proceder con la creación de la orden de compra?*
   - La orden solo se envía a SAP cuando el usuario emite una confirmación afirmativa en el turno siguiente.
4. **Visibilidad y Trazabilidad (Reglas CA4 y CA5)**:
   - Cada llamada a herramienta se registra en `out/log.jsonl` con timestamp, argumentos y resultado.
   - En el frontend web, cada herramienta invocada se renderiza como una tarjeta interactiva con su estado (`OK` / `ERROR`).

---

## 4. Elección del Modelo y Costos

- **Proveedor y Modelo Elegido**: Google Gemini API (`gemini-2.5-flash`).
- **Justificación**:
  - Excelente capacidad de seguimiento de instrucciones complejas (*Function Calling / Tool Calling* determinista).
  - Ventana de contexto amplia para asimilar paquetes documentales extensos.
  - Latencia reducida (< 1 segundo en tiempo de inferencia) y alta estabilidad de respuesta.
- **Aislamiento de Credenciales**:
  - La clave de API vive exclusivamente en `process.env.GEMINI_API_KEY` en el backend. Jamás se expone al navegador ni en los logs.
  - Para asegurar la operatividad offline y pruebas sin tokens, el adaptador incluye un modo heurístico determinista que permite utilizar la interfaz de chat al 100% incluso en ausencia de clave.
- **Estimación de Costos**:
  - Promedio de tokens de entrada por caso: ~1.200 tokens (prompt del sistema + paquete + esquema de tools).
  - Promedio de tokens de salida por caso: ~250 tokens (tool calls + respuesta final estructurada).
  - Costo por caso procesado con Gemini 2.5 Flash: **~$0.00015 USD** (fracción ínfima de centavo), haciendo la solución masivamente escalable y económica para procesar miles de facturas mensuales.

---

## 5. Matriz de Controles (RC1 – RC10)

| Control | Tipo | Implementación en `src/tools/oc.ts` |
|---|---|---|
| **RC1** | Bloqueo | Búsqueda por NIT normalizado (sin caracteres especiales). Si no hay NIT, coincidencia exacta insensible a mayúsculas sobre `proveedor_nombre`. Se valida que `activo === true`. |
| **RC2** | Bloqueo | Verificación de existencia de `aprobacion.json`, presencia de la palabra "Aprobado" (case-insensitive) y validación de que el remitente coincida con la lista `aprobadores` del centro de costos. |
| **RC3** | Bloqueo | Comparación matemática: `solicitud.valor_total <= aprobador.tope` del centro de costos. |
| **RC4** | Bloqueo | Validación de que `solicitud.subarea` esté contenida en `centro_costo.subareas`. |
| **RC5** | Confirmación | Si no hay cotización, se exige confirmación. Si existe, se evalúa si `abs(cotizacion.total - solicitud.valor_total) / solicitud.valor_total > 0.02`. Si supera el 2%, se añade a `confirmaciones`. |
| **RC6** | Confirmación + Derivado | Si `solicitud.indicador_iva` no viene informado, se adopta `proveedor.indicador_iva_default` (ej. `C1`) y se agrega a `confirmaciones` para validación humana. |
| **RC7** | Derivado | Si `solicitud.condiciones_pago` no viene informado, se adopta `proveedor.condiciones_pago_default` (ej. `Z030`). Se informa sin requerir confirmación explícita. |
| **RC8** | Confirmación | Si existe `factura` y `factura.fecha < solicitud.fecha_solicitud`, se fija `retroactiva = true`, se exige confirmación y se asienta en `out/control.csv`. |
| **RC9** | Confirmación | Si la fecha de la aprobación es anterior a la fecha de la solicitud, se añade a `confirmaciones`. |
| **RC10** | Bloqueo | Validación de cálculo: `abs((cantidad * valor_unitario) - valor_total) <= 1.0` tolerando desfases por redondeo monetario. |

### Control más desafiante:
El control más complejo fue **RC5 combinado con RC8**: el parsing de documentos no estructurados en texto (`cotizacion.txt` y `factura.txt`) requiere extraer montos y fechas tolerando variaciones sintácticas ("COP 11.400.000", "TOTAL (IVA incluido)", formatos de fechas `YYYY-MM-DD`), preservando la exactitud de los decimales para que el desvío matemático no genere falsos positivos ni falsos negativos.

---

## 6. Diseño del Adaptador SAP Real (Sección 7.5 del PRD)

### 6.1 Opción de Integración Elegida
- **Opción seleccionada**: **OData v2/v4 mediante el servicio estándar `API_PURCHASEORDER_PROCESS_SRV`** (vía SAP Cloud Integration / SAP Integration Suite).
- **Justificación frente a una viabilidad no confirmada**:
  - Frente a RFC directo (`BAPI_PO_CREATE1`), OData ofrece una superficie moderna basada en REST/JSON sobre HTTPS, eliminando la necesidad de dependencias nativas del SAP NetWeaver RFC SDK en el runtime de Node.js.
  - SAP Integration Suite actúa como fachada de desacoplamiento: autentica con OAuth 2.0 (mTLS), valida esquemas y traduce el JSON moderno del agente en el payload requerido por SAP S/4HANA o ECC.

### 6.2 Mapeo de Payload
- `OrdenCompra.sociedad` (1000) $\rightarrow$ `CompanyCode`.
- `OrdenCompra.organizacion_compras` (1000) $\rightarrow$ `PurchasingOrganization`.
- `OrdenCompra.proveedor.codigo_sap` $\rightarrow$ `Supplier`.
- `OrdenCompra.referencia.solicitud_id` $\rightarrow$ `PurchaseOrderUserStatus` / `RequisitionerName` (garantiza trazabilidad).
- `OrdenCompra.posiciones[i]` $\rightarrow$ `PurchaseOrderItem`:
  - `posicion.numero` $\rightarrow$ `PurchaseOrderItem` (10, 20...).
  - `posicion.descripcion` (<= 40 chars) $\rightarrow$ `PurchaseOrderItemText`.
  - `posicion.centro_costo` $\rightarrow$ `CostCenter`.
  - `posicion.indicador_iva` $\rightarrow$ `TaxCode`.
- Archivo de evidencia de aprobación $\rightarrow$ Adjuntado vía GOS (Generic Object Services) mediante el endpoint OData de Content Repositories con el hash SHA-256 en los metadatos.

### 6.3 Seguridad y Gestión de Credenciales
- Las credenciales de SAP (OAuth Client ID, Secret, Certificado mTLS o Basic Auth técnico) **nunca** residen en el cliente, en el prompt del agente ni en el repositorio.
- Residen en un gestor de secretos empresarial (GCP Secret Manager, AWS Secrets Manager o Azure Key Vault) inyectados como variables de entorno seguras en el servidor de integración.

### 6.4 Idempotencia y Manejo de Errores Parciales
- Antes de emitir el `POST` de creación, el adaptador ejecuta un `GET` a `/A_PurchaseOrder?$filter=RequisitionerName eq 'SOL-2026-00X'`. Si la orden ya existe, retorna el ID sin reenviar.
- En caso de fallas transitorias de red o respuestas 500 ambiguas de SAP, el adaptador consulta por la referencia externa antes de reintentar para prevenir órdenes duplicadas.

### 6.5 Plan B si la conexión no es viable
Si la conectividad con SAP queda descartada:
1. El agente genera un archivo CSV/BAPI de carga masiva en `out/sap/carga_masiva.csv` estructurado con la plantilla oficial de la transacción `LSMW` o `BAPI_PO_CREATE1`.
2. El agente genera en el chat un bloque formateado listo para copiar y pegar en la transacción `ME21N` de SAP GUI, ahorrando el 90% del tiempo de digitación de la analista.

---

## 7. Lectura del Proceso: Informe Ejecutivo sobre Órdenes Retroactivas

**Para**: Dirección Financiera y de Operaciones  
**De**: Equipo de Arquitectura e Inteligencia Artificial  
**Asunto**: Hallazgo operativo en compras y propuesta de optimización de proceso  

> ### Diagnóstico de la Situación Actual
> Durante la automatización del proceso de órdenes de compra, se constató un desvío operativo recurrente de alto impacto: **un volumen considerable de órdenes de compra se tramitan con posterioridad a la recepción de la factura del proveedor** (como se evidencia en el caso `sol-005`, donde la factura `FC-88231` fue emitida el 10 de agosto y la solicitud formal de compra se radicó el 27 de agosto).
>
> Este fenómeno, denominado compra retroactiva, anula el propósito fundamental de la orden de compra como instrumento preventivo de control de gasto:
> 1. **Pérdida de Gobernanza Presupuestal**: El gasto ya fue ejecutado y comprometido con el proveedor antes de que el líder del centro de costo evalúe si existe presupuesto disponible.
> 2. **Riesgo Fiscal y Tributario**: Desfases en el calendario de causación contable del IVA y retenciones en la fuente, generando inconsistencias entre fechas de emisión de facturación electrónica de la DIAN y el periodo de contabilización de SAP.
> 3. **Distorsión en Negociaciones Comerciales**: Se prescinde sistemáticamente de la cotización formal y los plazos pactados, debilitando el poder de negociación de compras corporativas.
>
> ### Propuesta de Rediseño de Proceso (To-Be)
> 1. **Bloqueo Gradual con Ventanas de Tolerancia**: Clasificar las compras retroactivas en el sistema con un indicador formal (`retroactiva = true`). Establecer una ventana de transición de 60 días donde solo se aprueben si cuentan con el aval explícito de la Gerencia Financiera.
> 2. **Canal de Recepción Automatizado con IA**: Dotar al solicitante de un canal conversacional inmediato para que radique la cotización y obtenga la aprobación de su líder en minutos, eliminando la excusa del "trámite administrativo lento" que incentiva saltarse el proceso regular.
> 3. **Auditoría Continua basada en `control.csv`**: Integrar el archivo de auditoría del agente con un tablero de control gerencial para visibilizar qué áreas presentan la mayor tasa de retroactividad y asociar este indicador al desempeño operativo de los líderes de área.

---

## 8. Decisiones y Trade-offs de Arquitectura

1. **Uso de Zod para contratos de datos vs. Validación ad-hoc o TypeBox**:
   - *Alternativa descartada*: Validaciones manuales con `if/else` o TypeBox.
   - *Razón de la elección*: Zod permite inferencia estricta de tipos de TypeScript (`z.infer`), esquemas declarativos autocontenidos con `.describe()` directamente consumibles por los esquemas de herramientas de LLM, y validaciones precisas en tiempo de ejecución (`safeParse`).
2. **Generación determinista de herramientas (`demo.ts`) desacoplada del LLM**:
   - *Alternativa descartada*: Acoplar la suite de pruebas a mocks de respuestas de OpenAI/Gemini.
   - *Razón de la elección*: La evaluación técnica exige determinismo absoluto. `demo.ts` demuestra que el 100% de la lógica de negocio, validaciones RC1-RC10, detección de retroactividad, evidencia criptográfica y simulador SAP operan de forma perfecta e idéntica en cualquier máquina sin necesidad de configurar claves ni gastar créditos.
3. **Persistencia del simulador en JSONL + CSV vs. SQLite**:
   - *Alternativa descartada*: Incorporar una base de datos embebida como SQLite o DuckDB.
   - *Razón de la elección*: El PRD estipula en la sección 7.4 y 6.1 que el almacenamiento en archivos planos (`out/sap/ordenes.jsonl` y `out/control.csv`) es el estándar esperado. Evita dependencias nativas de compilación C++ en Windows/Linux y permite auditar los resultados abriendo directamente los archivos en Excel o editores de texto.

---

## 9. Supuestos Asumidos

1. **Integridad de los Maestros**: Se asume que los catálogos en `fixtures/reto-03/maestros/` reflejan la totalidad de proveedores, centros de costos, tasas impositivas y plazos comerciales vigentes para las pruebas.
2. **Normalización de Nombres de Proveedores**: Cuando una solicitud omite el NIT (`sol-006`), se asume que la coincidencia exacta insensible a mayúsculas y acentos sobre la razón social es criterio suficiente para enlazar al proveedor maestro.
3. **Suficiencia de Evidencia**: El archivo de texto plano estructurado con el hash criptográfico SHA-256 satisface los requerimientos de auditoría P0, complementado con el archivo PDF generado en P1.
4. **Consecutivo Inicial SAP**: La numeración de órdenes arranca en `4500000001` y se incrementa secuencialmente por cada nueva orden única creada.

---

## 10. Matriz de Cobertura de Historias de Usuario

| Historia de Usuario | Descripción | Estado | Pendiente para Producción Real |
|---|---|---|---|
| **HU-1** | Lectura y normalización del paquete de compra | **COMPLETO** | Lector nativo de archivos `.xlsx` y OCR para PDFs escaneados complejos. |
| **HU-2** | Validación contra maestros y controles RC1-RC10 | **COMPLETO** | Sincronización en tiempo real de catálogos maestros vía RFC/OData desde SAP. |
| **HU-3** | Construcción del payload de la OC y trazabilidad | **COMPLETO** | Inclusión de textos ampliados de cabecera y múltiples líneas de posición. |
| **HU-4** | Generación de evidencia de aprobación (TXT y PDF) | **COMPLETO** | Integración con servicio corporativo de firma digital PKI (Adobe Sign / DocuSign). |
| **HU-5** | Creación en SAP simulado e idempotencia | **COMPLETO** | Conexión al endpoint OData productivo de SAP S/4HANA según diseño de la sección 7.5. |
| **HU-6** | Manejo de errores tipados `{ ok, data }` / `{ ok, error }` | **COMPLETO** | Integración con alertas a canal de Slack/Teams corporativo ante caídas de servicio. |
| **Bonus** | Módulo reutilizable en carpeta `modulo/` | **COMPLETO** | Publicación del paquete en registro privado npm de Periferia IT Group. |

---

## 11. Declaración de Uso de Asistentes de Inteligencia Artificial

En cumplimiento con la sección 0 y 9.1 del PRD, se declara el uso transparente de asistentes de IA:

- **Asistentes Utilizados**: Google DeepMind Agentic Coding Assistant (Antigravity) con Gemini.
- **Tareas en las que se utilizó**:
  - Generación del andamiaje inicial de la especificación técnica en Spec Kit (`spec.md`, `plan.md`, `tasks.md`).
  - Formateo riguroso de esquemas Zod a partir de la definición de tipos del PRD.
  - Generación de estilos CSS limpios y responsivos para la interfaz de chat en `web/style.css`.
  - Validación cruzada de la lógica matemática de desvíos porcentuales y consistencia de horas/unidades.
- **Propuestas de IA descartadas y motivos**:
  - *Propuesta descartada 1*: Usar LangChain/LangGraph para orquestar el agente. Se descartó porque introducía más de 40 paquetes innecesarios, acoplaba el código a abstracciones opacas y dificultaba ejecutar `demo.ts` de forma puramente determinista sin dependencias externas.
  - *Propuesta descartada 2*: Usar SQLite para almacenar las órdenes creadas. Se descartó para respetar estrictamente la convención de archivos planos `out/sap/ordenes.jsonl` y `out/control.csv` establecida en el PRD.
  - *Propuesta descartada 3*: Lanzar excepciones en las herramientas y capturarlas en el servidor HTTP. Se descartó categóricamente por violar el Principio IV de la Constitución del proyecto.

---

## 12. Riesgos de Llevar a Producción y Mitigaciones

| # | Riesgo Identificado | Impacto | Estrategia de Mitigación Implementada / Propuesta |
|---|---|---|---|
| **R1** | Latencia o indisponibilidad en la conexión a SAP durante cierres contables | Alto | Implementar cola de mensajería asíncrona (RabbitMQ / Cloud Tasks). Si SAP responde con timeout, la orden queda en estado `PENDIENTE_SINCRONIZACION` y se reintenta automáticamente con retroceso exponencial (*exponential backoff*). |
| **R2** | Alucinación del modelo LLM alterando montos o datos maestros | Crítico | **Mitigado por diseño**: El agente no tiene herramientas para modificar precios. Los montos del payload provienen de los archivos leídos y validados por Zod; el modelo únicamente orquesta el flujo conversacional y solicita confirmaciones. |
| **R3** | Fuga de credenciales de API de LLM en entornos compartidos | Alto | Variables de entorno administradas exclusivamente en el servidor (`process.env`). Ninguna clave se transmite al navegador web ni se guarda en el repositorio. |
| **R4** | Reintentos concurrentes de la analista generando órdenes duplicadas | Medio | **Mitigado por diseño**: Mecanismo estricto de idempotencia en `SapAdapter` basado en `solicitud_id`. Cualquier invocación repetida retorna la orden previa sin duplicar registros en SAP. |

