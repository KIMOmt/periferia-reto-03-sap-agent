# Tools Contract: `src/tools/oc.ts`

**Feature**: `specs/001-ordenes-compra-sap`  
**Date**: 2026-11-09  
**Status**: Approved  

---

## 1. Protocolo Universal de Herramientas

Cada herramienta expuesta por `src/tools/oc.ts` sigue el estándar:

```typescript
export interface ToolDefinition<TArgs extends z.ZodRawShape> {
  description: string;
  args: TArgs;
  execute: (
    args: z.infer<z.ZodObject<TArgs>>,
    ctx: { directory: string; sessionId: string }
  ) => Promise<string>;
}
```

### Reglas de Ejecución:
- **Resiliencia Total**: `execute` nunca lanza excepciones hacia el bucle del agente.
- **Formato de Retorno**: Cadena JSON serializada (`string`) con la forma:
  - Éxito: `{ "ok": true, "data": T }`
  - Error: `{ "ok": false, "error": string }`
- **Rutas Relativas**: Toda ruta de archivo se resuelve a partir de `ctx.directory`.

---

## 2. Catálogo de Herramientas

### 2.1 `oc_leer_paquete` (`leer_paquete`)
- **Descripción**: "Lee y normaliza los documentos de una solicitud (correo, solicitud, cotización, aprobación y factura) desde la carpeta del caso en fixtures/reto-03/solicitudes/."
- **Args**:
  - `caso`: `z.string().describe("Nombre de la carpeta del caso, ej: sol-001")`
- **Retorno (`data`)**:
  ```json
  {
    "correo": { "id": "msg-001", "de": "...", "asunto": "...", "fecha": "..." },
    "solicitud": { "solicitud_id": "SOL-2026-001", "valor_total": 11400000, "...": "..." },
    "cotizacion": { "proveedor": "...", "total": 11400000, "...": "..." },
    "aprobacion": { "de": "...", "aprobado": true, "...": "..." },
    "factura": null
  }
  ```

---

### 2.2 `oc_validar` (`validar`)
- **Descripción**: "Valida el paquete contra maestros de SAP aplicando las 10 reglas de control (RC1-RC10). Devuelve bloqueos, confirmaciones requeridas, derivados calculados y retroactividad."
- **Args**:
  - `caso`: `z.string()`
  - `paquete`: `PaqueteSchema`
- **Retorno (`data`)**:
  ```json
  {
    "apta": true,
    "bloqueos": [],
    "confirmaciones": ["RC5: Cotización difiere en 6% de la solicitud"],
    "derivados": { "indicador_iva": "C1", "condiciones_pago": "Z030" },
    "retroactiva": false
  }
  ```

---

### 2.3 `oc_construir_payload` (`construir_payload`)
- **Descripción**: "Construye el payload validado de la Orden de Compra para SAP según la sección 7.4 del PRD y genera el mapa de trazabilidad de cada campo."
- **Args**:
  - `caso`: `z.string()`
  - `paquete`: `PaqueteSchema`
  - `derivados`: `z.record(z.unknown())`
  - `excepciones`: `z.array(ExcepcionOrdenCompraSchema).optional()`
- **Retorno (`data`)**:
  ```json
  {
    "payload": {
      "referencia": { "solicitud_id": "SOL-2026-001", "correo_id": "...", "cotizacion_ref": "..." },
      "sociedad": "1000",
      "organizacion_compras": "1000",
      "proveedor": { "codigo_sap": "100234", "nit": "900555111", "nombre": "..." },
      "moneda": "COP",
      "condiciones_pago": "Z030",
      "aprobador": { "email": "...", "fecha_aprobacion": "...", "evidencia_sha256": "..." },
      "posiciones": [{ "numero": 10, "descripcion": "...", "cantidad": 120, "unidad": "UN", "precio_unitario": 95000, "centro_costo": "CC-1010", "subarea": "Infraestructura", "indicador_iva": "C1" }],
      "excepciones": []
    },
    "ruta_trazabilidad": "out/sol-001/trazabilidad.json"
  }
  ```

---

### 2.4 `oc_generar_evidencia` (`generar_evidencia`)
- **Descripción**: "Genera el archivo de evidencia de aprobación del correo con encabezados, cuerpo y cálculo de hash criptográfico SHA-256."
- **Args**:
  - `caso`: `z.string()`
- **Retorno (`data`)**:
  ```json
  {
    "ruta": "out/sol-001/aprobacion.txt",
    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "tipo": "txt"
  }
  ```

---

### 2.5 `oc_crear` (`crear`)
- **Descripción**: "Crea la orden de compra en el SAP simulado respetando idempotencia, validaciones de aptitud y confirmaciones explícitas, registrando en out/control.csv."
- **Args**:
  - `caso`: `z.string()`
  - `payload`: `OrdenCompraSchema`
  - `confirmado`: `z.boolean().optional().default(false)`
- **Retorno (`data`)**:
  ```json
  {
    "numero_oc": "4500000001",
    "fecha": "2026-11-09T21:00:00Z",
    "idempotente": false
  }
  ```
- **Retorno (`error`)**: En caso de no confirmación o solicitud no apta:
  ```json
  {
    "ok": false,
    "error": "No se puede crear la orden: la solicitud requiere confirmación explícita (RC5) y confirmado es false."
  }
  ```

---

### 2.6 `oc_leer_excel` (`leer_excel`) [P1 Opcional]
- **Descripción**: "Lee y parsea un archivo de hoja de cálculo XLSX convirtiendo sus filas en objetos JSON."
- **Args**:
  - `ruta`: `z.string().describe("Ruta relativa a ctx.directory del archivo xlsx")`
- **Retorno (`data`)**:
  ```json
  {
    "filas": [{ "columna1": "valor", "columna2": 123 }]
  }
  ```

