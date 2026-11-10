# Implementation Plan: Agente Conversacional Órdenes de Compra SAP

**Branch**: `001-ordenes-compra-sap` | **Date**: 2026-11-09 | **Spec**: [specs/001-ordenes-compra-sap/spec.md](file:///c:/Users/Mateo/Escritorio/retos-ia-periferia-it-group/reto-03/specs/001-ordenes-compra-sap/spec.md)

**Input**: Feature specification from `specs/001-ordenes-compra-sap/spec.md`

---

## Summary

Construcción integral de un agente conversacional independiente y autónomo para la preparación, validación, auditoría y creación de órdenes de compra en un SAP simulado, basado en los requerimientos del PRD y los 6 casos de prueba (`sol-001` a `sol-006`).

La solución adopta una arquitectura desacoplada en cuatro capas fundamentales:
1. **Comportamiento**: Prompt del sistema en `agent/prompt.md` con reglas de interacción y confirmación humana.
2. **Conocimiento**: Reglas maestras y lógica de negocio en `src/knowledge/ordenes-compra.md`.
3. **Ejecución**: Herramientas deterministas tipadas con Zod en `src/tools/oc.ts` y adaptador SAP simulado en `src/sap/{adapter.ts,mock.ts}`.
4. **Modularidad**: Empaquetado reutilizable en `modulo/` (`agent.md`, `tools/oc.ts`, `skill/ordenes-compra/SKILL.md`) para bonus (+10 pts).

El sistema incluye además el script `demo.ts` para ejecutar y verificar el 100% de las herramientas sin dependencias de LLM, el servidor HTTP en `src/server.ts`, el frontend web de chat en `web/index.html` y los entregables `SOLUCION.md` (12 secciones) y `README.md`.

---

## Technical Context

**Language/Version**: TypeScript 5.x estricto (`strict: true`, sin uso de `any`) sobre Node.js 20+ o Bun runtime.

**Primary Dependencies**:
- `zod`: Validación de esquemas y contratos de herramientas.
- `pdf-lib`: Generación ligera de PDF para evidencia de aprobación (P1).
- `@google/genai` (o `openai`): Adaptador de proveedor LLM para inferencia.
- Framework HTTP ligero para API REST y servicio de estáticos (`src/server.ts`).

**Storage**: Archivos locales en directorio `out/` (`out/sap/ordenes.jsonl`, `out/control.csv`, `out/<caso>/trazabilidad.json`, `out/<caso>/aprobacion.txt`).

**Testing**: Script determinista `demo.ts` para validación directa de herramientas y casos `sol-001` a `sol-006`, cubriendo idempotencia y órdenes retroactivas sin LLM.

**Target Platform**: Servidores Linux, macOS y Windows, compatible con Bun y Node 20+.

**Project Type**: Agente conversacional fullstack (Frontend web chat + Backend API + Herramientas de ejecución + Módulo reutilizable).

**Performance Goals**:
- Ejecución de herramientas deterministas en < 50ms por llamada.
- Respuesta conversacional completa del agente en < 3s.
- Verificación completa de `demo.ts` en < 2s.

**Constraints**:
- **Prohibición de rutas absolutas**: Todas las rutas resueltas dinámicamente con `ctx.directory`.
- **Prohibición de `any`**: TypeScript rigurosamente tipado.
- **Herramientas a prueba de fallos**: `src/tools/oc.ts` jamás lanza excepciones no controladas; retorna siempre string JSON `{ ok: true, data }` o `{ ok: false, error }`.
- **Seguridad**: Secretos de LLM exclusivamente en `process.env` del backend.

**Scale/Scope**: 6 casos canónicos de prueba (`sol-001` a `sol-006`), 10 reglas de control (RC1 a RC10), 5 herramientas core P0, frontend de chat interactivo y módulo independiente.

---

## Constitution Check

*GATE: Verificación obligatoria contra los 5 principios no negociables de la Constitución.*

| Principio Constitucional | Requerimiento | Estado | Evidencia en el Diseño |
|---|---|---|---|
| **I. TypeScript Estricto (Node 20+ / Bun)** | Prohibición de `any`, TypeScript estricto habilitado en `tsconfig.json`. | **PASS** | `tsconfig.json` configurado con `strict: true`, `noImplicitAny: true`. Tipos inferidos de Zod y DTOs estrictos. |
| **II. Rutas Dinámicas Contextuales** | Prohibidas rutas absolutas hardcodeadas. Todo relativo a `ctx.directory`. | **PASS** | Todas las herramientas reciben `ctx: { directory: string }` y usan `path.resolve(ctx.directory, ...)`. |
| **III. Aislamiento de Secretos** | Secretos solo en `process.env` del backend, jamás en frontend, logs ni git. | **PASS** | `src/llm/provider.ts` lee variables de entorno en el servidor; el frontend solo consume `/api/chat`. Gitignore previene subida de `.env`. |
| **IV. Herramientas Resilientes Zod** | No lanzar excepciones; retornar strings JSON `{ ok: true, data }` o `{ ok: false, error }`. | **PASS** | Cada export en `src/tools/oc.ts` implementa captura de excepciones `try...catch` universal y serializa retornos JSON uniformes. |
| **V. Separación de Responsabilidades** | Separación entre prompt (`agent/prompt.md`), conocimiento (`src/knowledge/`), herramientas (`src/tools/`) y módulo (`modulo/`). | **PASS** | Estructura física desacoplada sin mezcla de código en prompts ni de conocimiento en herramientas. |

---

## Project Structure

### Documentation & Specifications (`specs/001-ordenes-compra-sap/`)

```text
specs/001-ordenes-compra-sap/
├── spec.md              # Especificación funcional aprobada
├── checklists/
│   └── requirements.md  # Checklist de calidad de requisitos
├── plan.md              # Este plan de implementación técnica
├── research.md          # Decisiones de arquitectura y alternativas (Fase 0)
├── data-model.md        # Modelo de datos, esquemas y máquina de estados (Fase 1)
├── quickstart.md        # Guía rápida de ejecución y validación (Fase 1)
└── contracts/           # Contratos de interfaces del sistema (Fase 1)
    ├── tools-contract.md
    ├── api-contract.md
    └── sap-adapter-contract.md
```

### Source Code (`reto-03/`)

```text
reto-03/
├── agent/
│   └── prompt.md                        # Comportamiento y System Prompt del agente
├── src/
│   ├── types/
│   │   └── oc.ts                        # Tipos e interfaces TypeScript del dominio
│   ├── schemas/
│   │   └── oc.ts                        # Esquemas Zod (Paquete, Solicitud, OrdenCompra)
│   ├── sap/
│   │   ├── adapter.ts                   # Interfaz SapAdapter requerida en 7.4
│   │   └── mock.ts                      # Implementación simulada de SAP sobre archivos
│   ├── tools/
│   │   └── oc.ts                        # Herramientas tipadas exportadas (oc_<nombre>)
│   ├── llm/
│   │   ├── adapter.ts                   # Interfaz agnóstica de proveedor LLM
│   │   └── provider.ts                  # Implementación con Gemini / OpenAI / etc.
│   ├── agent/
│   │   └── runner.ts                    # Ciclo conversacional del agente y control de iteraciones
│   ├── knowledge/
│   │   └── ordenes-compra.md            # Conocimiento del proceso y reglas maestras
│   └── server.ts                        # API HTTP (POST /api/chat, GET /api/health) y estáticos
├── web/
│   ├── index.html                       # Frontend de chat (historial, tool calls, confirmaciones)
│   ├── style.css                        # Estilos responsivos de la interfaz de usuario
│   └── app.ts                           # Lógica cliente del chat y render de herramientas
├── modulo/                              # BONUS (+10): Agente empaquetado como módulo reutilizable
│   ├── agent.md                         # Definición primaria del agente sin permisos bash/edit
│   ├── tools/
│   │   └── oc.ts                        # Mismas herramientas importables sin servidor
│   └── skill/
│       └── ordenes-compra/
│           └── SKILL.md                 # Mismo conocimiento empaquetado para plataformas de agentes
├── fixtures/reto-03/                    # Datos maestros y solicitudes de prueba (solo lectura)
├── out/                                 # Directorio generado en tiempo de ejecución (gitignored)
├── demo.ts                              # Script determinista para correr herramientas sin modelo
├── package.json                         # Dependencias y scripts de compilación/ejecución
├── tsconfig.json                        # Configuración TypeScript estricta
├── .env.example                         # Plantilla de variables de entorno requeridas
├── README.md                            # Guía de levantamiento, link y explicación de demo.ts
└── SOLUCION.md                          # Documento de solución con las 12 secciones obligatorias
```

---

## Structure Decision

Se adopta una estructura monolítica limpia, organizada por capas de responsabilidad para cumplir estrictamente con:
1. La sección 6.5 del PRD (`agent/prompt.md`, `src/tools/oc.ts`, `src/sap/{adapter.ts,mock.ts}`, `src/llm/`, `src/server.ts`, `web/`, `demo.ts`).
2. El bonus de modularidad de la sección 9.4 (`modulo/agent.md`, `modulo/tools/oc.ts`, `modulo/skill/ordenes-compra/SKILL.md`).
3. El estándar de entrega con `SOLUCION.md` (12 secciones obligatorias) y `README.md`.

---

## Complexity Tracking

No se identifican violaciones ni desvíos frente a los principios de la Constitución. El diseño mantiene la complejidad mínima indispensable para satisfacer el 100% de los criterios de evaluación del PRD.
