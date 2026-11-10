<!--
SYNC IMPACT REPORT
- Version Change: Uninitialized (0.0.0) -> 1.0.0
- Bump Rationale: Initial adoption of project constitution establishing the 5 non-negotiable core principles, architecture separation, tool protocols, and security rules.
- Modified Principles:
  - PRINCIPLE_1: "I. Strict TypeScript & Modern Runtime" (Initialized)
  - PRINCIPLE_2: "II. Dynamic Context-Relative Paths" (Initialized)
  - PRINCIPLE_3: "III. Strict Secret Isolation & Security" (Initialized)
  - PRINCIPLE_4: "IV. Resilient Zod-Typed Tools & Uniform JSON Protocol" (Initialized)
  - PRINCIPLE_5: "V. Architectural Separation of Concerns & Modularity" (Initialized)
- Added Sections:
  - Core Principles
  - Technology & Quality Standards
  - Development Workflow & Verification Gates
  - Governance
- Removed Sections: None
- Follow-up TODOs: None
-->

# Agente Órdenes de Compra SAP Constitution

## Core Principles

### I. Strict TypeScript & Modern Runtime (Node 20+ / Bun)
El backend y las herramientas del agente MUST estar desarrollados en TypeScript estricto con la configuración `strict: true` habilitada.
- Queda estrictamente prohibido el uso de `any` en cualquier archivo del proyecto; se MUST usar tipos explícitos, tipos utilitarios de TypeScript o `unknown` con validación y estrechamiento de tipos.
- El entorno de ejecución MUST ser Node.js en versión 20 o superior (Node 20+) o Bun runtime.
- **Razón**: Prevenir errores de tipado en tiempo de ejecución, asegurar contratos de datos predecibles para el agente y garantizar consistencia en la manipulación de documentos y payloads de SAP.

### II. Dynamic Context-Relative Paths (No Absolute Paths)
Todas las rutas del sistema para acceder a fixtures, esquemas, documentos de conocimiento, plantillas y carpetas de salida (`out/`) MUST resolverse de forma dinámica y estrictamente relativa a `ctx.directory` (o el contexto de ejecución inyectado).
- Quedan terminantemente prohibidas las rutas absolutas hardcodeadas (tales como `C:\...` o `/home/...`) en cualquier archivo de código o configuración del proyecto.
- **Razón**: Garantizar la portabilidad total del proyecto entre diversos entornos de ejecución (Windows, macOS, Linux, contenedores y pipelines de CI/CD) sin acoplamiento al sistema de archivos local.

### III. Strict Secret Isolation & Security
Todas las claves de API, credenciales de proveedores de modelos de lenguaje (OpenAI, Anthropic, Google Gemini, etc.) y variables sensibles MUST gestionarse exclusivamente a través de variables de entorno en el backend (`process.env`).
- Queda estrictamente prohibido registrar o imprimir secretos en archivos de log, respuestas hacia el frontend, artefactos temporales o el repositorio Git (los archivos `.env` o credenciales jamás deben commitearse).
- El frontend MUST comunicarse únicamente con el backend sin acceder ni poseer conocimiento de los tokens de autenticación de los LLMs.
- **Razón**: Salvaguardar la seguridad de las claves de acceso, prevenir fugas de credenciales en repositorios compartidos y mitigar riesgos de seguridad corporativos.

### IV. Resilient Zod-Typed Tools & Uniform JSON Protocol
Todas las herramientas del agente ubicadas en `src/tools/oc.ts` MUST tipar exhaustivamente sus entradas y salidas utilizando esquemas declarativos de Zod.
- Las herramientas nunca MUST lanzar excepciones no controladas hacia el runtime del agente; cualquier error de validación, I/O o lógica de negocio MUST ser capturado internamente.
- Las herramientas MUST retornar siempre una cadena JSON serializada (`string`) con la siguiente estructura uniforme:
  - `{ "ok": true, "data": <payload> }` cuando la operación concluye con éxito.
  - `{ "ok": false, "error": "<mensaje explicativo>" }` ante fallos, datos faltantes o violaciones de validación.
- **Razón**: Asegurar la resiliencia del ciclo del agente conversacional evitando caídas catastróficas, y proporcionar al modelo de lenguaje respuestas estructuradas y deterministas que pueda interpretar para confirmar excepciones con el usuario.

### V. Architectural Separation of Concerns & Modularity
El diseño arquitectónico del sistema MUST mantener una clara y estricta separación de responsabilidades entre sus componentes:
1. **Comportamiento del agente (`agent/prompt.md`)**: Define exclusivamente el prompt de sistema, instrucciones de personalidad, flujo conversacional, heurísticas de clasificación y políticas de interacción humana.
2. **Base de conocimiento (`src/knowledge/ordenes-compra.md`)**: Contiene las reglas de negocio, información de referencia y esquemas maestros (proveedores, centros de costo, matrices de aprobación, IVA, condiciones de pago).
3. **Ejecución y herramientas (`src/tools/oc.ts`)**: Implementa la lógica determinista ejecutable (lectura de paquetes, validaciones, generación de PDF de evidencia y simulador de SAP).
4. **Modularidad y reusabilidad (`modulo/`)**: Aloja el empaquetado del agente como un módulo desacoplado e independiente (bonus de modularidad), listo para ser consumido por otras aplicaciones o servicios.
- Ninguna capa MUST absorber o duplicar las responsabilidades de otra capa.
- **Razón**: Promover la mantenibilidad, facilitar pruebas independientes de prompts y herramientas, y permitir la reutilización modular del agente en diversos entornos de producción.

## Technology & Quality Standards
- **Tipado y Validación**: Zod es la biblioteca estándar para validación de datos en tiempo de ejecución tanto en DTOs como en herramientas del agente.
- **Frontend desacoplado**: La interfaz de usuario (React, Svelte, Vue o HTML plano) se comunica con el backend mediante API HTTP o WebSockets, manteniendo completa independencia tecnológica.
- **Fixtures como Fuente de Verdad**: Los fixtures provistos en `fixtures/` definen los escenarios canónicos de prueba (casos `sol-001` a `sol-006`) para validar tanto el flujo feliz como las excepciones de negocio.
- **Trazabilidad y Auditoría**: El sistema MUST registrar el resultado de cada procesamiento en `out/control.csv`, identificando claramente las órdenes retroactivas (`retroactiva = true`).

## Development Workflow & Verification Gates
- **Ejecución independiente sin modelo (`demo.ts`)**: El repositorio MUST incluir un archivo `demo.ts` ejecutable que valide y demuestre el correcto funcionamiento de las herramientas de `src/tools/oc.ts` contra los fixtures sin invocar modelos de lenguaje ni requerir claves de API.
- **Quality Gates obligatorios**:
  1. Verificación estricta de TypeScript: ausencia total de errores de compilación y cero ocurrencias de `any`.
  2. Pruebas de resiliencia de herramientas asegurando que los fallos retornen `{ ok: false, error }` sin lanzar excepciones.
  3. Verificación de aislamiento de credenciales y ausencia de secretos en el código fuente.
- **Documentación de Solución**: Todo el enfoque de solución, asistentes de IA utilizados y decisiones de arquitectura MUST quedar documentados en `SOLUCION.md`.

## Governance
- **Supremacía Constitucional**: Esta constitución prevalece sobre cualquier otra práctica, convención informal o atajo de implementación en el proyecto.
- **Procedimiento de Enmienda**: Toda enmienda a los principios o estándares requiere:
  1. Propuesta y justificación del cambio evaluando el impacto arquitectónico.
  2. Actualización de `.specify/memory/constitution.md` manteniendo el formato estricto.
  3. Incremento semántico de la versión:
     - **MAJOR**: Modificación, eliminación o redefinición incompatible de principios fundamentales.
     - **MINOR**: Incorporación de nuevos principios, secciones o expansión sustancial de directrices.
     - **PATCH**: Correcciones ortográficas, clarificaciones de redacción o refinamientos menores.
- **Revisión de Cumplimiento**: Cada PR, commit y revisión de código MUST verificar la alineación con los principios establecidos en esta constitución.

**Version**: 1.0.0 | **Ratified**: 2026-11-09 | **Last Amended**: 2026-11-09
