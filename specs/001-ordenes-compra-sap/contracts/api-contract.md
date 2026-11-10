# API Contract: `src/server.ts`

**Feature**: `specs/001-ordenes-compra-sap`  
**Date**: 2026-11-09  
**Status**: Approved  

---

## 1. Endpoints HTTP del Backend

### 1.1 `POST /api/chat`
Envía un mensaje del usuario a la sesión activa del agente conversacional.

- **Request Headers**:
  `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "sessionId": "ses-abc-123",
    "message": "Procesa la solicitud sol-001"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "reply": "He procesado la solicitud SOL-2026-001 exitosamente. Se ha creado la Orden de Compra No. 4500000001 en SAP.",
    "toolCalls": [
      {
        "name": "oc_leer_paquete",
        "args": { "caso": "sol-001" },
        "result": { "ok": true, "data": { "solicitud_id": "SOL-2026-001" } }
      },
      {
        "name": "oc_validar",
        "args": { "caso": "sol-001" },
        "result": { "ok": true, "data": { "apta": true, "bloqueos": [] } }
      },
      {
        "name": "oc_construir_payload",
        "args": { "caso": "sol-001" },
        "result": { "ok": true, "data": { "sociedad": "1000" } }
      },
      {
        "name": "oc_generar_evidencia",
        "args": { "caso": "sol-001" },
        "result": { "ok": true, "data": { "sha256": "..." } }
      },
      {
        "name": "oc_crear",
        "args": { "caso": "sol-001" },
        "result": { "ok": true, "data": { "numero_oc": "4500000001", "idempotente": false } }
      }
    ],
    "needsConfirmation": false
  }
  ```
- **Respuesta cuando requiere confirmación (ej. `sol-004`)**:
  ```json
  {
    "reply": "La solicitud sol-004 presenta una diferencia entre la cotización (COP 26.500.000) y la solicitud (COP 25.000.000) de un 6%, superando el umbral del 2%. ¿Deseas confirmar la creación de la orden con el monto de la cotización?",
    "toolCalls": [ ... ],
    "needsConfirmation": true
  }
  ```

---

### 1.2 `GET /api/sessions/:id`
Obtiene el historial completo de mensajes y tool calls de una sesión.

- **Response `200 OK`**:
  ```json
  {
    "sessionId": "ses-abc-123",
    "messages": [
      { "role": "user", "content": "Procesa la solicitud sol-001" },
      { "role": "assistant", "content": "...", "toolCalls": [ ... ] }
    ]
  }
  ```

---

### 1.3 `GET /api/health`
Verificación de estado de la API y modelo configurado (sin exponer credenciales).

- **Response `200 OK`**:
  ```json
  {
    "ok": true,
    "provider": "google-gemini",
    "model": "gemini-2.5-flash",
    "status": "ready"
  }
  ```

---

### 1.4 Servir Archivos Estáticos del Frontend (`GET /`)
El backend sirve la interfaz de usuario contenida en la carpeta `web/` (`web/index.html`, estilos y scripts) de forma autónoma.

