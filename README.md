# Reto Técnico 03 — Agente Conversacional "Órdenes de Compra SAP"

> **Equipo Perxia 2.0 · Periferia IT Group**  
> Solución completa, determinista e independiente para la preparación, validación, auditoría y creación de órdenes de compra en SAP simulado.


## 🌐 Enlaces de Despliegue en Vivo

- **Aplicación Web Pública**: [https://periferia-reto-03-sap-agent.onrender.com](https://periferia-reto-03-sap-agent.onrender.com)
- **Repositorio GitHub**: [https://github.com/KIMOmt/periferia-reto-03-sap-agent](https://github.com/KIMOmt/periferia-reto-03-sap-agent)

---

## 1. Características Principales

- **TypeScript Estricto**: Desarrollado con Node 20+ y Bun runtime sin uso de `any`.
- **Rutas Dinámicas Relativas**: Sin rutas absolutas hardcodeadas, todas resueltas con `ctx.directory`.
- **Aislamiento Total de Secretos**: Variables de entorno de LLM leídas únicamente en `process.env` del servidor, jamás expuestas en frontend ni logs.
- **Herramientas Resilientes Zod**: Contrato uniforme en `src/tools/oc.ts` que nunca lanza excepciones y retorna siempre strings JSON `{ ok: true, data }` o `{ ok: false, error }`.
- **Separación Arquitectónica en 4 Capas**:
  - `agent/prompt.md`: Comportamiento y directivas de interacción.
  - `src/knowledge/ordenes-compra.md`: Reglas maestras y catálogos de negocio.
  - `src/tools/oc.ts`: Capa de ejecución determinista.
  - `modulo/`: Bonus de modularidad (+10 pts) con empaquetado para plataformas de agentes.
- **Frontend Interactivo de Chat**: Visualización en tiempo real de cada llamada a herramienta y banner de confirmación humana para excepciones (RC5, RC8, RC6).

---

## 2. Puesta en Marcha Rápida (Un Solo Comando)

### Requisitos Previos
- **Bun** (recomendado, versión 1.2+) o **Node.js** (versión 20+).

### Instalación y Ejecución del Servidor
```bash
# 1. Instalar dependencias
bun install
# o con npm:
npm install

# 2. Configurar variables de entorno (opcional para el chat con LLM)
cp .env.example .env

# 3. Iniciar el servidor local
bun run dev
# o con npm:
npm run dev
```

El servidor web quedará disponible en:
- **Interfaz de Chat**: [http://localhost:3000](http://localhost:3000)
- **API Chat**: `POST http://localhost:3000/api/chat`
- **Health Check**: `GET http://localhost:3000/api/health`

---

## 3. Verificación Determinista sin Modelo (`demo.ts`)

La prueba fundamental de evaluación técnica corre de forma 100% determinista **sin claves de API, sin modelos externos y sin consumo de tokens**:

```bash
bun run demo.ts
# o con tsx / node:
npx tsx demo.ts
```

### Qué valida `demo.ts`:
1. **`sol-001` (1ª vez)**: Flujo feliz completo. Valida maestros, genera evidencia `out/sol-001/aprobacion.txt` (con hash SHA-256) y crea la OC No. `4500000001`.
2. **`sol-001` (2ª vez)**: **Prueba de Idempotencia**. Detecta la solicitud ya existente en SAP y retorna la misma orden `4500000001` con `idempotente: true` sin duplicar filas en `out/sap/ordenes.jsonl`.
3. **`sol-002`**: **Bloqueo RC1**. Proveedor `Soluciones Digitales del Norte S.A.S.` inexistente en catálogo maestro.
4. **`sol-003`**: **Bloqueo RC2 y RC3**. Aprobador ajeno al centro de costo `CC-2020` y monto ($74.000.000) fuera de límite de autorización.
5. **`sol-004`**: **Confirmación RC5**. Desvío de cotización del 6% frente a la solicitud (supera umbral del 2%).
6. **`sol-005`**: **Confirmación RC8**. Compra retroactiva: Factura con fecha anterior a la solicitud. Queda marcada `retroactiva = true` en `out/control.csv`.
7. **`sol-006`**: **Derivación RC6 y RC7**. Solicitud sin indicador de IVA ni condiciones de pago; se derivan automáticamente desde el maestro del proveedor.

---

## 4. Estructura del Repositorio

```text
reto-03/
├── agent/
│   └── prompt.md                        # Comportamiento y system prompt
├── src/
│   ├── server.ts                        # API HTTP y servicio web
│   ├── llm/
│   │   ├── adapter.ts                   # Interfaz agnóstica de LLM
│   │   └── provider.ts                  # Adaptador con fallback heurístico
│   ├── agent/
│   │   └── runner.ts                    # Ciclo conversacional y orquestador
│   ├── tools/
│   │   └── oc.ts                        # Herramientas Zod deterministas
│   ├── sap/
│   │   ├── adapter.ts                   # Interfaz SapAdapter (Sección 7.4)
│   │   └── mock.ts                      # Implementación simulada sobre archivos
│   ├── knowledge/
│   │   └── ordenes-compra.md            # Conocimiento del negocio y catálogos
│   ├── types/
│   │   └── oc.ts                        # Tipos e interfaces TypeScript
│   └── schemas/
│       └── oc.ts                        # Esquemas Zod (Paquete, OrdenCompra)
├── web/                                 # Frontend de chat
│   ├── index.html                       # Vista principal
│   ├── style.css                        # Estilos responsivos
│   └── app.js                           # Cliente de chat y render de herramientas
├── modulo/                              # BONUS (+10): Módulo reutilizable
│   ├── agent.md                         # Definición primaria del agente
│   ├── tools/oc.ts                      # Herramientas exportadas
│   └── skill/ordenes-compra/SKILL.md   # Skill del proceso empaquetada
├── fixtures/reto-03/                    # Datos entregados por Periferia
├── out/                                 # Directorio generado en tiempo de ejecución
├── demo.ts                              # Verificación sin LLM
├── SOLUCION.md                          # Planteamiento formal (12 secciones)
├── package.json
└── tsconfig.json
```

---

## 5. Documentación de la Solución

El análisis detallado, decisiones de arquitectura, diseño del adaptador SAP real y lectura estratégica para la dirección se encuentran en el archivo [SOLUCION.md](./SOLUCION.md).

