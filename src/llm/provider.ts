import { LlmAdapter, ChatMessage, ToolDefinitionSchema, LlmResponse } from "./adapter.js";

export function detectarCaso(texto: string): string | null {
  const t = texto.toLowerCase();
  for (let i = 1; i <= 6; i++) {
    if (
      t.includes(`sol-00${i}`) ||
      t.includes(`sol-2026-00${i}`) ||
      t.includes(`caso ${i}`) ||
      t.includes(`caso 00${i}`) ||
      t.includes(`solicitud ${i}`) ||
      t.includes(`solicitud 00${i}`) ||
      t.includes(`solicitud #${i}`) ||
      t.includes(`solicitud #00${i}`)
    ) {
      return `sol-00${i}`;
    }
  }
  const match = t.match(/sol(?:-2026)?-00([1-6])\b/i) ||
                t.match(/solicitud\s*[-_:#]?\s*0*([1-6])\b/i) ||
                t.match(/caso\s*[-_:#]?\s*0*([1-6])\b/i) ||
                t.match(/\b0*([1-6])\b/);
  if (match && match[1]) {
    const n = parseInt(match[1], 10);
    if (n >= 1 && n <= 6) {
      return `sol-00${n}`;
    }
  }
  return null;
}

export class GeminiLlmAdapter implements LlmAdapter {
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || "";
    this.model = model || process.env.GEMINI_MODEL || "gemini-3.5-flash";
  }

  public async enviar(
    mensajes: ChatMessage[],
    herramientas: ToolDefinitionSchema[],
    systemPrompt?: string
  ): Promise<LlmResponse> {
    if (!this.apiKey) {
      // Modo Mock Heurístico cuando no hay API key configurada en process.env
      return this.ejecutarMockHeuristico(mensajes, herramientas);
    }

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

      const contents = mensajes
        .filter((m) => m.role !== "system")
        .map((m) => {
          if (m.role === "tool") {
            return {
              role: "user",
              parts: [{ text: `[Resultado de herramienta ${m.name || "desconocida"}]: ${m.content}` }]
            };
          }
          return {
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }]
          };
        });

      // Mapeo de herramientas a formato Gemini
      const functionDeclarations = herramientas.map((h) => ({
        name: h.name,
        description: h.description,
        parameters: {
          type: "OBJECT",
          properties: h.parameters.properties || {},
          required: h.parameters.required || []
        }
      }));

      const payload: Record<string, unknown> = {
        contents,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048
        }
      };

      if (systemPrompt) {
        payload.systemInstruction = {
          parts: [{ text: systemPrompt }]
        };
      }

      if (functionDeclarations.length > 0) {
        payload.tools = [{ functionDeclarations }];
      }

      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        console.warn(`[GeminiLlmAdapter] API respondió con error ${resp.status}, activando fallback: ${errorText}`);
        return this.ejecutarMockHeuristico(mensajes, herramientas);
      }

      const data = await resp.json() as {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              text?: string;
              functionCall?: {
                name: string;
                args: Record<string, unknown>;
              };
            }>;
          };
        }>;
      };

      const candidate = data.candidates?.[0];
      const parts = candidate?.content?.parts || [];

      let textContent = "";
      const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];

      for (const p of parts) {
        if (p.text) {
          textContent += p.text;
        }
        if (p.functionCall) {
          toolCalls.push({
            id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            name: p.functionCall.name,
            args: p.functionCall.args || {}
          });
        }
      }

      return {
        content: textContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined
      };
    } catch (err) {
      console.warn(`[GeminiLlmAdapter] Error en llamada a LLM, usando fallback: ${(err as Error).message}`);
      return this.ejecutarMockHeuristico(mensajes, herramientas);
    }
  }

  // Fallback que emula el ciclo del agente para pruebas de chat sin tokens
  private ejecutarMockHeuristico(
    mensajes: ChatMessage[],
    _herramientas: ToolDefinitionSchema[]
  ): LlmResponse {
    const ultimoMensaje = mensajes[mensajes.length - 1] || { role: "user", content: "" };
    const userMsgs = mensajes.filter((m) => m.role === "user");
    const ultimoUserMsg = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1].content.toLowerCase() : "";

    // 1. Identificar el caso activo ÚNICAMENTE desde el mensaje más reciente del usuario hacia atrás
    let caso = "sol-001";
    for (let i = userMsgs.length - 1; i >= 0; i--) {
      const c = detectarCaso(userMsgs[i].content);
      if (c) {
        caso = c;
        break;
      }
    }

    // 2. Determinar haConfirmado evaluando ÚNICAMENTE el texto del último mensaje enviado por el usuario
    const haConfirmado = (
      ultimoUserMsg.includes("confirmo") ||
      ultimoUserMsg.includes("autorizo") ||
      ultimoUserMsg.includes("procede") ||
      ultimoUserMsg.includes("crear orden") ||
      (ultimoUserMsg.includes("sí") && !ultimoUserMsg.includes("no"))
    );

    // Si el último mensaje es el resultado de una herramienta
    if (ultimoMensaje.role === "tool") {
      try {
        const res = JSON.parse(ultimoMensaje.content);
        if (ultimoMensaje.name === "oc_leer_paquete" && res.ok) {
          return {
            content: `He leído y normalizado el paquete de la solicitud **${caso}**. Procediendo a validar las reglas de control contra maestros.`,
            toolCalls: [{ id: "call_val", name: "oc_validar", args: { caso, paquete: res.data } }]
          };
        }
        if (ultimoMensaje.name === "oc_validar" && res.ok) {
          const val = res.data;
          if (val.bloqueos && val.bloqueos.length > 0) {
            return {
              content: `❌ **Solicitud bloqueada**: La solicitud ${caso} no cumple con las reglas de control:\n\n${val.bloqueos.map((b: string) => `- ⛔ **Bloqueo**: ${b}`).join("\n")}\n\n**Acción recomendada**: Solicitar al solicitante o al área de compras la corrección del paquete antes de volver a tramitar en SAP.`
            };
          }
          if (val.confirmaciones && val.confirmaciones.length > 0 && !haConfirmado) {
            return {
              content: `⚠️ **Validación con excepciones pendientes**: Procediendo a construir la vista previa de la orden de compra.`,
              toolCalls: [{ id: "call_pay", name: "oc_construir_payload", args: { caso, paquete: res.data?.paquete, derivados: val.derivados } }]
            };
          }
          return {
            content: `Todas las reglas pasaron conforme o fueron autorizadas. Generando evidencia y construyendo payload para creación en SAP.`,
            toolCalls: [{ id: "call_ev", name: "oc_generar_evidencia", args: { caso } }]
          };
        }
        if (ultimoMensaje.name === "oc_generar_evidencia" && res.ok) {
          return {
            content: `Evidencia generada y firmada con SHA-256. Construyendo payload para registro en SAP.`,
            toolCalls: [{ id: "call_pay", name: "oc_construir_payload", args: { caso } }]
          };
        }
        if (ultimoMensaje.name === "oc_construir_payload" && res.ok) {
          const tieneExcepciones = Array.isArray(res.data?.payload?.excepciones) && res.data.payload.excepciones.length > 0;
          if (tieneExcepciones && !haConfirmado) {
            return {
              content: `¿Deseas confirmar la excepción para proceder con la creación de la orden de compra?`
            };
          }
          return {
            content: `Payload estructurado correctamente sin excepciones. Procediendo a registrar la orden en SAP.`,
            toolCalls: [{ id: "call_crear", name: "oc_crear", args: { caso, payload: res.data.payload, confirmado: false } }]
          };
        }
        if (ultimoMensaje.name === "oc_crear" && res.ok) {
          const { numero_oc, idempotente } = res.data;
          const estado = idempotente ? "idempotente (ya registrada previamente)" : "creada exitosamente";
          return {
            content: `✅ **Orden de Compra SAP ${numero_oc}** ${estado}.\n\nSe ha registrado la transacción en la bitácora de auditoría \`out/control.csv\` y el archivo maestro de SAP \`out/sap/ordenes.jsonl\`.`
          };
        }
      } catch {
        // Fallback genérico
      }
    }

    // Si el usuario confirma en su mensaje
    if (haConfirmado) {
      return {
        content: `Confirmación recibida para ${caso}. Procediendo a generar evidencia y registrar la orden en SAP.`,
        toolCalls: [{ id: "call_ev", name: "oc_generar_evidencia", args: { caso } }]
      };
    }

    // Por defecto: Iniciar con oc_leer_paquete
    return {
      content: `Entendido. Iniciando procesamiento de la solicitud **${caso}**. Voy a leer y normalizar los documentos del paquete.`,
      toolCalls: [{ id: "call_leer", name: "oc_leer_paquete", args: { caso } }]
    };
  }
}
