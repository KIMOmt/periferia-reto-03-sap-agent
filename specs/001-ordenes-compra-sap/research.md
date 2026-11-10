# Research & Architecture Decisions: Agente Órdenes de Compra SAP

**Feature**: `specs/001-ordenes-compra-sap`  
**Date**: 2026-11-09  
**Status**: Completed  

---

## Decision 1: Runtime, Gestor de Paquetes y Tipado Estricto

- **Decisión**: Utilizar TypeScript con `strict: true`, `noImplicitAny: true` y soporte nativo dual para Node.js (20+) mediante `tsx` y Bun.
- **Razón**: 
  - Cumple directamente con el **Principio I de la Constitución**.
  - Permite ejecutar tanto en entornos que dispongan de Bun (`bun run demo.ts`, `bun run dev`) como en entornos corporativos estándar con Node.js 20+ (`npx tsx demo.ts`, `npm run dev`).
  - La prohibición absoluta de `any` previene desajustes de tipos en tiempo de ejecución al interactuar con payloads de SAP y maestros JSON.
- **Alternativas consideradas**:
  - *JavaScript puro*: Descartado por violar la constitución y el PRD.
  - *TypeScript con tipos relajados (`any`)*: Descartado por violar la constitución.

---

## Decision 2: Arquitectura del Ciclo del Agente y Adaptador LLM

- **Decisión**: Implementar un bucle de orquestación determinista con una interfaz desacoplada `LlmAdapter` en `src/llm/adapter.ts`.
- **Razón**:
  - Separación limpia entre el ciclo del agente (manejo de historial, control de iteraciones máximo 25, detección de llamadas a herramientas, solicitud de confirmación humana) y el proveedor de inferencia.
  - El agente no puede inventar valores: el prompt de sistema (`agent/prompt.md`) y el ciclo garantizan que los montos, códigos SAP y estados provengan exclusivamente de los retornos de las herramientas (`src/tools/oc.ts`).
  - Permite intercambiar el modelo (OpenAI, Anthropic, Gemini, Mistral) sin modificar la lógica del agente.
- **Alternativas consideradas**:
  - *Frameworks monolíticos pesados (LangChain / AutoGen)*: Descartados porque ofuscan el ciclo del agente, introducen abstracciones innecesarias y dificultan correr `demo.ts` sin dependencias externas.

---

## Decision 3: Contrato de Herramientas y Resiliencia Zod (`src/tools/oc.ts`)

- **Decisión**: Implementar cada herramienta con un objeto declarativo `{ description, args, execute(args, ctx) }` validado por Zod, capturando todas las excepciones internas en bloques `try...catch` universales y retornando `JSON.stringify({ ok: true, data })` o `JSON.stringify({ ok: false, error })`.
- **Razón**:
  - Cumple con el **Principio IV de la Constitución** y la sección 6.2 del PRD.
  - Garantiza que el ciclo del agente jamás colapse por fallos de I/O, formatos de archivo o validaciones.
  - Permite que `demo.ts` importe y ejecute directamente las herramientas sin necesidad de inicializar un servidor web ni conectar con un LLM.
- **Alternativas consideradas**:
  - *Herramientas que lanzan excepciones (`throw new Error(...)`)*: Descartadas categóricamente por la constitución.
  - *Retorno de objetos crudos*: Descartado; el contrato exige retorno serializado como `string` JSON para estandarizar el consumo de agentes.

---

## Decision 4: Resolución Dinámica de Rutas y Aislamiento de Entorno

- **Decisión**: Todas las funciones y herramientas reciben un objeto de contexto `ctx: { directory: string; sessionId: string }` y resuelven rutas relativas mediante `path.resolve(ctx.directory, ...)`.
- **Razón**:
  - Cumple con el **Principio II de la Constitución**.
  - Evita fallos de portabilidad en Windows, macOS, Linux, contenedores Docker y runners de CI/CD.
  - Las credenciales sensibles de LLM residen únicamente en `process.env` del backend (cumpliendo el **Principio III**).
- **Alternativas consideradas**:
  - *Rutas absolutas o relativas al CWD (`process.cwd()`)*: Descartadas por fragilidad cuando el proceso se ejecuta desde subdirectorios o como módulo importado.

---

## Decision 5: Adaptador SAP Simulado e Idempotencia (`src/sap/mock.ts`)

- **Decisión**: Implementar la interfaz `SapAdapter` contra almacenamiento en sistema de archivos local (`out/sap/ordenes.jsonl` y `out/control.csv`).
- **Razón**:
  - Cumple con los requisitos HU-5 y 7.4 del PRD.
  - Mantiene un consecutivo determinista a partir de `4500000001`.
  - Verifica si `solicitud_id` ya fue procesado: si existe, devuelve el número existente con `{ numero_oc, fecha, idempotente: true }` sin añadir una nueva línea a `ordenes.jsonl`.
  - Audita cada intento en `out/control.csv` con columnas: `solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts`.
- **Alternativas consideradas**:
  - *Base de datos SQLite*: Descartada para mantener alineación con el PRD que estipula no requerir motores de bases de datos adicionales.

---

## Decision 6: Generación de Evidencia de Aprobación (P0 y P1)

- **Decisión**: 
  - **P0**: Generador en texto plano (`out/<caso>/aprobacion.txt`) que normaliza encabezados (De, Para, CC, Fecha, Asunto), incluye el cuerpo y calcula el hash criptográfico SHA-256 sobre el contenido.
  - **P1**: Generación de PDF complementario (`out/<caso>/aprobacion.pdf`) utilizando una biblioteca ligera y sin dependencias de sistema nativas (`pdf-lib`), calculando igualmente el SHA-256.
- **Razón**:
  - Asegura cumplimiento total de HU-4 y la sección 7.4 (donde el hash SHA-256 se inyecta en el campo `aprobador.evidencia_sha256` del payload de la OC).
- **Alternativas consideradas**:
  - *Puppeteer / Chrome headless*: Descartado por sobrecarga de dependencias pesadas innecesarias para un comprobante de auditoría.

---

## Decision 7: Frontend Desacoplado y Experiencia de Usuario

- **Decisión**: Frontend web ligero (HTML5 + CSS + TypeScript/JavaScript o componente React montado con Vite) servido por el backend o como SPA independiente.
- **Razón**:
  - Muestra el historial completo de la conversación.
  - Muestra cada llamada a herramienta con sus argumentos y resumen del resultado.
  - Resalta visualmente cuando el agente se detiene requiriendo confirmación humana antes de proceder.
  - No tiene acceso a ninguna credencial de backend ni secretos de LLM.
- **Alternativas consideradas**:
  - *Interfaz CLI exclusiva*: Descartada porque el PRD exige interfaz de chat con link de prueba web.

---

## Decision 8: Empaquetado Modular Reutilizable (`modulo/`)

- **Decisión**: Estructurar la carpeta `modulo/` como una biblioteca exportable e independiente conteniendo:
  - `agent.md`: frontmatter con `description`, `mode: primary`, `permission: { edit: deny, bash: deny }` y el system prompt idéntico a `agent/prompt.md`.
  - `tools/oc.ts`: las mismas herramientas deterministas exportables sin servidor.
  - `skill/ordenes-compra/SKILL.md`: base de conocimiento del proceso.
- **Razón**:
  - Cumple el **Principio V de la Constitución** y la sección 9.4 del PRD para obtener el bonus de modularidad (+10 puntos).

