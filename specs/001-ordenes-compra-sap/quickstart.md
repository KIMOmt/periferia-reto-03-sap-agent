# Quickstart & Validation Guide: Agente Órdenes de Compra SAP

**Feature**: `specs/001-ordenes-compra-sap`  
**Date**: 2026-11-09  
**Status**: Ready  

---

## 1. Requisitos Previos

- **Runtime**: Node.js 20+ o Bun (recomendado).
- **Entorno**: Copiar archivo `.env.example` a `.env` (solo requerido para el servidor de chat con LLM; `demo.ts` corre 100% sin credenciales).

```bash
# Instalación de dependencias
bun install
# o con npm:
npm install
```

---

## 2. Validación Determinista sin Modelo (`demo.ts`)

La prueba de fuego de las herramientas no requiere conexión a ningún LLM:

```bash
bun run demo.ts
# o con Node.js 20+:
npx tsx demo.ts
```

### Resultados Esperados en Consola:
1. **sol-001 (1ª ejecución)**:
   - Estado: `apta = true`
   - Bloqueos: `ninguno`
   - Confirmaciones: `ninguna`
   - Retroactiva: `false`
   - Resultado: Orden creada No. `4500000001` (`idempotente: false`).
2. **sol-001 (2ª ejecución - Idempotencia)**:
   - Estado: `apta = true`
   - Resultado: Retorna Orden existente No. `4500000001` (`idempotente: true`).
3. **sol-002**:
   - Estado: `apta = false`
   - Bloqueos: `[RC1: Proveedor 'Soluciones Digitales del Norte S.A.S.' (NIT: 901999000) no existe en catálogo de maestros]`
   - Resultado: No crea orden.
4. **sol-003**:
   - Estado: `apta = false`
   - Bloqueos: `[RC2: Aprobador 'fvargas@periferia-ficticia.com' no pertenece al centro CC-2020], [RC3: Monto 74.000.000 excede tope autorizado]`
   - Resultado: No crea orden.
5. **sol-004**:
   - Estado: `apta = true (con confirmación)`
   - Confirmaciones: `[RC5: Monto cotización COP 26.500.000 difiere 6% de solicitud COP 25.000.000]`
   - Con `confirmado = true`: Orden creada No. `4500000002`.
6. **sol-005**:
   - Estado: `apta = true (con confirmación)`
   - Confirmaciones: `[RC8: Factura emitida el 2026-08-10 anterior a solicitud 2026-08-27]`
   - Retroactiva: `true`
   - Con `confirmado = true`: Orden creada No. `4500000003` marcada `retroactiva: true` en `out/control.csv`.
7. **sol-006**:
   - Estado: `apta = true (con confirmación)`
   - Derivados: `indicador_iva = C1`, `condiciones_pago = Z030`
   - Confirmaciones: `[RC6: IVA no informado, derivado C1 desde proveedor]`
   - Con `confirmado = true`: Orden creada No. `4500000004`.

---

## 3. Validación de Artefactos de Salida (`out/`)

Verificar que la ejecución genera:
- `out/control.csv`: Contiene el log de auditoría con las columnas requeridas y la marca de `retroactiva = true` para `sol-005`.
- `out/sap/ordenes.jsonl`: Contiene exactamente 4 órdenes (números 4500000001, 4500000002, 4500000003, 4500000004).
- `out/sol-001/aprobacion.txt` y `out/sol-001/trazabilidad.json`: Archivo de evidencia con hash SHA-256 no nulo y trazabilidad de campos.

---

## 4. Ejecución del Agente Conversacional Completo

```bash
# Configurar API Key en .env
echo "GEMINI_API_KEY=tu_api_key" > .env

# Iniciar servidor
bun run dev
# o con npm:
npm run dev
```

Abrir navegador en `http://localhost:3000`:
1. Enviar mensaje de prueba:
   `"Procesa la solicitud sol-004. Muéstrame la OC como quedaría en SAP, qué validaciones pasó y cuáles no, y no la crees hasta que yo lo confirme."`
2. Verificar que el chat:
   - Despliegue las llamadas a herramientas (`oc_leer_paquete`, `oc_validar`, `oc_construir_payload`).
   - Muestre la discrepancia de montos (6% > 2%).
   - Se detenga solicitando confirmación explícita con botón o texto.
   - Tras responder `"Confirmo"`, proceda a invocar `oc_crear` y retorne el número de OC.

