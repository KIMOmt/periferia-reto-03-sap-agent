# SAP Adapter Contract: `src/sap/adapter.ts` & `src/sap/mock.ts`

**Feature**: `specs/001-ordenes-compra-sap`  
**Date**: 2026-11-09  
**Status**: Approved  

---

## 1. Interfaz Requerida (`src/sap/adapter.ts`)

Conforme a la sección 7.4 del PRD, la interfaz del adaptador SAP es estrictamente:

```typescript
import { OrdenCompra } from "../types/oc.js";

export interface SapAdapter {
  consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null>;
  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string; idempotente: boolean }>;
  buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string; fecha: string } | null>;
}
```

---

## 2. Comportamiento del Mock (`src/sap/mock.ts`)

La implementación simulada interactúa con el sistema de archivos:

### 2.1 Archivo de Almacenamiento: `out/sap/ordenes.jsonl`
- Cada orden registrada se añade como una línea JSON independiente:
  ```json
  {"numero_oc":"4500000001","fecha":"2026-11-09T21:00:00Z","orden":{ ... }}
  ```

### 2.2 Secuencia de Numeración
- El consecutivo inicia en `4500000001`.
- Si `out/sap/ordenes.jsonl` ya contiene órdenes, se toma el mayor número existente y se incrementa en 1.

### 2.3 Garantía de Idempotencia (`buscarOrdenPorReferencia`)
- Antes de registrar una nueva orden, el adaptador verifica si en `out/sap/ordenes.jsonl` ya existe una orden con `orden.referencia.solicitud_id == solicitud_id`.
- Si existe:
  - **No** se escribe una nueva línea en el archivo de órdenes.
  - Se retorna el `{ numero_oc, fecha, idempotente: true }` de la orden preexistente.
- Si no existe:
  - Se genera el nuevo número correlativo.
  - Se escribe la orden en `out/sap/ordenes.jsonl`.
  - Se retorna `{ numero_oc, fecha, idempotente: false }`.

### 2.4 Bitácora de Control (`out/control.csv`)
Toda llamada a `crearOrden` (sea nueva o idempotente) o rechazo de creación registra una línea con la estructura:
```csv
solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts
SOL-2026-001,CREADA,4500000001,false,,,2026-11-09T21:00:00.000Z
SOL-2026-001,IDEMPOTENTE,4500000001,false,,,2026-11-09T21:01:00.000Z
SOL-2026-002,BLOQUEADA,,false,RC1,,2026-11-09T21:02:00.000Z
SOL-2026-005,CREADA,4500000003,true,,RC8,2026-11-09T21:03:00.000Z
```

