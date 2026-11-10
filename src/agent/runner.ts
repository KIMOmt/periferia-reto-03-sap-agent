import * as fs from "node:fs";
import * as path from "node:path";
import { LlmAdapter, ChatMessage, ToolDefinitionSchema } from "../llm/adapter.js";
import { detectarCaso } from "../llm/provider.js";
import {
  leer_paquete,
  validar,
  generar_evidencia,
  construir_payload,
  crear,
  leer_excel
} from "../tools/oc.js";
import { ToolExecutionContext, Paquete, OrdenCompra, ResultadoValidacion, ExcepcionOC } from "../types/oc.js";

export interface AgentStepResult {
  reply: string;
  toolCalls: Array<{
    name: string;
    args: Record<string, unknown>;
    result: Record<string, unknown>;
  }>;
  needsConfirmation: boolean;
}

export class AgentRunner {
  private baseDir: string;
  private llm: LlmAdapter;
  private systemPrompt: string;
  private sessions: Map<string, ChatMessage[]>;
  private lastCasoBySession: Map<string, string>;
  private logPath: string;

  constructor(baseDir: string, llm: LlmAdapter) {
    this.baseDir = baseDir;
    this.llm = llm;
    this.sessions = new Map();
    this.lastCasoBySession = new Map();
    this.logPath = path.resolve(this.baseDir, "out", "log.jsonl");

    // Cargar system prompt
    const promptPath = path.resolve(this.baseDir, "agent", "prompt.md");
    if (fs.existsSync(promptPath)) {
      this.systemPrompt = fs.readFileSync(promptPath, "utf-8");
    } else {
      this.systemPrompt = "Eres un asistente de órdenes de compra SAP para Periferia IT Group.";
    }

    // Asegurar directorio out
    const outDir = path.resolve(this.baseDir, "out");
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
  }

  public getSession(sessionId: string): ChatMessage[] {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, []);
    }
    return this.sessions.get(sessionId)!;
  }

  public async processMessage(sessionId: string, userMessage: string): Promise<AgentStepResult> {
    const history = this.getSession(sessionId);
    history.push({ role: "user", content: userMessage });

    const ctx: ToolExecutionContext = {
      directory: this.baseDir,
      sessionId
    };

    const toolsSchema = this.getToolsSchema();
    const executedToolCalls: Array<{
      name: string;
      args: Record<string, unknown>;
      result: Record<string, unknown>;
    }> = [];

    // 1. Identificar caso buscando ÚNICAMENTE desde el mensaje más reciente del usuario hacia atrás
    let casoActivo = this.lastCasoBySession.get(sessionId) || "sol-001";
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === "user") {
        const c = detectarCaso(history[i].content);
        if (c) {
          casoActivo = c;
          break;
        }
      }
    }
    this.lastCasoBySession.set(sessionId, casoActivo);

    // 2. Determinar confirmación evaluando ÚNICAMENTE el texto del mensaje actual del usuario
    const userText = userMessage.toLowerCase();
    const isUserConfirming = (
      userText.includes("confirmo") ||
      userText.includes("autorizo") ||
      userText.includes("procede") ||
      userText.includes("crear orden") ||
      (userText.includes("sí") && !userText.includes("no"))
    );
    const isUserRejecting = (
      userText.includes("no autorizo") ||
      userText.includes("cancela") ||
      userText.includes("rechazar") ||
      userText.includes("no confirmo")
    );

    let finalReply = "";
    let needsConfirmation = false;

    // Cache local de datos del caso procesado en este turno para construir payloads seguros
    let paqueteCache: Paquete | null = null;
    let derivadosCache: Record<string, unknown> = {};

    // Si el usuario rechaza explícitamente
    if (isUserRejecting) {
      finalReply = `❌ Operación cancelada para la solicitud **${casoActivo}**. No se creará la orden de compra en SAP.`;
      history.push({ role: "assistant", content: finalReply });
      return {
        reply: finalReply,
        toolCalls: executedToolCalls,
        needsConfirmation: false
      };
    }

    // Si el usuario confirma en este turno ("Confirmo la excepción...")
    if (isUserConfirming) {
      // 1. Leer paquete si no está en cache
      let paquete: Paquete | null = paqueteCache;
      if (!paquete) {
        const rStr = await leer_paquete.execute({ caso: casoActivo }, ctx);
        const r = JSON.parse(rStr) as { ok: boolean; data?: Paquete };
        if (r.ok && r.data) {
          paquete = r.data;
          paqueteCache = paquete;
          executedToolCalls.push({ name: "oc_leer_paquete", args: { caso: casoActivo }, result: r as Record<string, unknown> });
          this.logToolCall(sessionId, "oc_leer_paquete", { caso: casoActivo }, r as Record<string, unknown>);
        }
      }
      if (!paquete) {
        finalReply = `❌ Error: No se pudo recuperar el paquete de compra para ${casoActivo}.`;
        history.push({ role: "assistant", content: finalReply });
        return { reply: finalReply, toolCalls: executedToolCalls, needsConfirmation: false };
      }

      // 2. Validar para derivar y extraer excepciones
      const valStr = await validar.execute({ caso: casoActivo, paquete }, ctx);
      const valRes = JSON.parse(valStr) as { ok: boolean; data?: ResultadoValidacion };
      const val = valRes.data;
      executedToolCalls.push({ name: "oc_validar", args: { caso: casoActivo, paquete: paquete as unknown as Record<string, unknown> }, result: valRes as Record<string, unknown> });
      this.logToolCall(sessionId, "oc_validar", { caso: casoActivo }, valRes as Record<string, unknown>);

      // 3. Generar evidencia
      const evStr = await generar_evidencia.execute({ caso: casoActivo }, ctx);
      const evRes = JSON.parse(evStr) as { ok: boolean; data?: { sha256: string; ruta: string } };
      executedToolCalls.push({ name: "oc_generar_evidencia", args: { caso: casoActivo }, result: evRes as Record<string, unknown> });
      this.logToolCall(sessionId, "oc_generar_evidencia", { caso: casoActivo }, evRes as Record<string, unknown>);

      // 4. Construir payload con las excepciones confirmadas
      const excepciones: ExcepcionOC[] = [];
      if (val && val.confirmaciones) {
        for (const conf of val.confirmaciones) {
          let cod = "RC_GEN";
          if (conf.includes("RC5")) cod = "RC5";
          else if (conf.includes("RC6")) cod = "RC6";
          else if (conf.includes("RC8")) cod = "RC8";
          else if (conf.includes("RC9")) cod = "RC9";
          excepciones.push({
            codigo: cod,
            detalle: conf,
            confirmado_por: "humano_analista"
          });
        }
      }

      const payStr = await construir_payload.execute({
        caso: casoActivo,
        paquete,
        derivados: val?.derivados || {},
        excepciones
      }, ctx);
      const payRes = JSON.parse(payStr) as { ok: boolean; data?: { payload: OrdenCompra }; error?: string };
      executedToolCalls.push({ name: "oc_construir_payload", args: { caso: casoActivo }, result: payRes as Record<string, unknown> });
      this.logToolCall(sessionId, "oc_construir_payload", { caso: casoActivo }, payRes as Record<string, unknown>);

      if (!payRes.ok || !payRes.data) {
        finalReply = `❌ Error construyendo el payload de la orden: ${payRes.error || "Desconocido"}`;
        history.push({ role: "assistant", content: finalReply });
        return { reply: finalReply, toolCalls: executedToolCalls, needsConfirmation: false };
      }

      // 5. Crear orden en SAP con confirmado: true
      const orden = payRes.data.payload;
      const crearStr = await crear.execute({ caso: casoActivo, payload: orden, confirmado: true }, ctx);
      const crearRes = JSON.parse(crearStr) as { ok: boolean; data?: { numero_oc: string; idempotente: boolean }; error?: string };
      executedToolCalls.push({ name: "oc_crear", args: { caso: casoActivo, confirmado: true }, result: crearRes as Record<string, unknown> });
      this.logToolCall(sessionId, "oc_crear", { caso: casoActivo, confirmado: true }, crearRes as Record<string, unknown>);

      if (crearRes.ok && crearRes.data) {
        const { numero_oc, idempotente } = crearRes.data;
        const estado = idempotente ? "idempotente (ya registrada previamente)" : "creada exitosamente";
        finalReply = `✅ **Orden de Compra SAP ${numero_oc}** ${estado}.\n\nSe ha confirmado la excepción y la orden ha sido registrada en SAP con trazabilidad completa en \`out/control.csv\` y \`out/sap/ordenes.jsonl\`.`;
      } else {
        finalReply = `❌ No se pudo crear la orden en SAP: ${crearRes.error}`;
      }

      history.push({ role: "assistant", content: finalReply });
      return {
        reply: finalReply,
        toolCalls: executedToolCalls,
        needsConfirmation: false
      };
    }

    // Si NO está confirmando: ejecutar ciclo regular con control estricto de bloqueos y confirmaciones
    let iterations = 0;
    const MAX_ITERATIONS = 25; // Regla CA1

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const resp = await this.llm.enviar(history, toolsSchema, this.systemPrompt);

      if (resp.content) {
        finalReply = resp.content;
      }

      // Si no hay llamadas a herramientas, termina el turno
      if (!resp.toolCalls || resp.toolCalls.length === 0) {
        history.push({ role: "assistant", content: finalReply });
        break;
      }

      let detenidoPorValidacion = false;

      // Procesar cada llamada a herramienta
      for (const call of resp.toolCalls) {
        const toolResultStr = await this.executeTool(
          call.name,
          call.args,
          ctx,
          paqueteCache,
          derivadosCache,
          casoActivo,
          isUserConfirming
        );
        let parsedResult: Record<string, unknown> = {};
        try {
          parsedResult = JSON.parse(toolResultStr);
        } catch {
          parsedResult = { ok: false, error: toolResultStr };
        }

        // Cachear datos si fue lectura o validación
        if (call.name === "oc_leer_paquete" && parsedResult.ok && parsedResult.data) {
          paqueteCache = parsedResult.data as unknown as Paquete;
        }

        if (call.name === "oc_validar" && parsedResult.ok && parsedResult.data) {
          const v = parsedResult.data as unknown as ResultadoValidacion;
          if (v.derivados) {
            derivadosCache = v.derivados as Record<string, unknown>;
          }

          // Caso Bloqueos: Detener inmediatamente
          if (Array.isArray(v.bloqueos) && v.bloqueos.length > 0) {
            needsConfirmation = false;
            finalReply = `❌ **Solicitud bloqueada para creación en SAP**\n\n` +
              `La solicitud **${casoActivo}** no cumple con las reglas de control obligatorias:\n\n` +
              v.bloqueos.map((b) => `- ⛔ **Bloqueo**: ${b}`).join("\n") +
              `\n\n**Acción recomendada**: Solicitar al solicitante o al departamento de compras la corrección del paquete antes de volver a tramitar la solicitud en SAP.`;

            executedToolCalls.push({ name: call.name, args: call.args, result: parsedResult });
            this.logToolCall(sessionId, call.name, call.args, parsedResult);
            history.push({ role: "tool", name: call.name, content: toolResultStr });
            history.push({ role: "assistant", content: finalReply });
            detenidoPorValidacion = true;
            break; // Detener bucle inmediatamente
          }

          // Caso Confirmaciones: Detener inmediatamente y pedir confirmación
          if (Array.isArray(v.confirmaciones) && v.confirmaciones.length > 0) {
            needsConfirmation = true;

            let paquete = paqueteCache;
            if (!paquete) {
              const rStr = await leer_paquete.execute({ caso: casoActivo }, ctx);
              const r = JSON.parse(rStr) as { ok: boolean; data?: Paquete };
              if (r.ok && r.data) paquete = r.data;
            }

            executedToolCalls.push({ name: call.name, args: call.args, result: parsedResult });
            this.logToolCall(sessionId, call.name, call.args, parsedResult);
            history.push({ role: "tool", name: call.name, content: toolResultStr });

            if (paquete) {
              const payStr = await construir_payload.execute({
                caso: casoActivo,
                paquete,
                derivados: v.derivados || {},
                excepciones: []
              }, ctx);
              const payRes = JSON.parse(payStr) as { ok: boolean; data?: { payload: OrdenCompra } };

              executedToolCalls.push({
                name: "oc_construir_payload",
                args: { caso: casoActivo },
                result: payRes as Record<string, unknown>
              });
              this.logToolCall(sessionId, "oc_construir_payload", { caso: casoActivo }, payRes as Record<string, unknown>);
              history.push({ role: "tool", name: "oc_construir_payload", content: payStr });

              const p = payRes.data?.payload;
              const totalSol = paquete.solicitud.valor_total;
              const totalCot = paquete.cotizacion?.total ?? totalSol;

              finalReply = `⚠️ **Validación con Excepciones — Confirmación Requerida**\n\n` +
                `### a) Resumen de cómo quedaría la OC en SAP:\n` +
                `- **Proveedor**: ${p?.proveedor.nombre || paquete.solicitud.proveedor_nombre} (Código SAP: \`${p?.proveedor.codigo_sap || "100000"}\`)\n` +
                `- **NIT**: ${p?.proveedor.nit || paquete.solicitud.proveedor_nit}\n` +
                `- **Centro de Costo**: ${p?.posiciones[0]?.centro_costo || paquete.solicitud.centro_costo}\n` +
                `- **Total Solicitud**: $${totalSol.toLocaleString()} ${paquete.solicitud.moneda}\n` +
                `- **Total Cotización**: $${totalCot.toLocaleString()} ${paquete.solicitud.moneda}\n` +
                `- **Indicador IVA**: \`${p?.posiciones[0]?.indicador_iva || "C1"}\`\n` +
                `- **Condiciones de Pago**: \`${p?.condiciones_pago || "Z030"}\`\n\n` +
                `### b) Excepciones Detectadas:\n` +
                v.confirmaciones.map((c) => `- ⚠️ ${c}`).join("\n") +
                `\n\n### c) Confirmación:\n` +
                `¿Deseas confirmar la excepción para proceder con la creación de la orden de compra?`;

              history.push({ role: "assistant", content: finalReply });
              detenidoPorValidacion = true;
              break; // Detener bucle inmediatamente
            }
          }

          // Caso Limpio (apta === true, bloqueos.length === 0, confirmaciones.length === 0):
          // En ese mismo primer turno el flujo ejecuta automáticamente oc_generar_evidencia, oc_construir_payload y oc_crear(confirmado: false) sin detenerse
          if (v.apta && v.bloqueos.length === 0 && v.confirmaciones.length === 0) {
            needsConfirmation = false;
            let paquete = paqueteCache;
            if (!paquete) {
              const rStr = await leer_paquete.execute({ caso: casoActivo }, ctx);
              const r = JSON.parse(rStr) as { ok: boolean; data?: Paquete };
              if (r.ok && r.data) paquete = r.data;
            }

            executedToolCalls.push({ name: call.name, args: call.args, result: parsedResult });
            this.logToolCall(sessionId, call.name, call.args, parsedResult);
            history.push({ role: "tool", name: call.name, content: toolResultStr });

            if (paquete) {
              // 1. Generar evidencia
              const evStr = await generar_evidencia.execute({ caso: casoActivo }, ctx);
              const evRes = JSON.parse(evStr) as { ok: boolean; data?: { sha256: string; ruta: string } };
              executedToolCalls.push({ name: "oc_generar_evidencia", args: { caso: casoActivo }, result: evRes as Record<string, unknown> });
              this.logToolCall(sessionId, "oc_generar_evidencia", { caso: casoActivo }, evRes as Record<string, unknown>);
              history.push({ role: "tool", name: "oc_generar_evidencia", content: evStr });

              // 2. Construir payload
              const payStr = await construir_payload.execute({
                caso: casoActivo,
                paquete,
                derivados: v.derivados || {},
                excepciones: []
              }, ctx);
              const payRes = JSON.parse(payStr) as { ok: boolean; data?: { payload: OrdenCompra } };
              executedToolCalls.push({ name: "oc_construir_payload", args: { caso: casoActivo }, result: payRes as Record<string, unknown> });
              this.logToolCall(sessionId, "oc_construir_payload", { caso: casoActivo }, payRes as Record<string, unknown>);
              history.push({ role: "tool", name: "oc_construir_payload", content: payStr });

              if (payRes.ok && payRes.data) {
                const orden = payRes.data.payload;
                // 3. Crear orden en SAP con confirmado = false
                const crearStr = await crear.execute({ caso: casoActivo, payload: orden, confirmado: false }, ctx);
                const crearRes = JSON.parse(crearStr) as { ok: boolean; data?: { numero_oc: string; idempotente: boolean }; error?: string };
                executedToolCalls.push({ name: "oc_crear", args: { caso: casoActivo, confirmado: false }, result: crearRes as Record<string, unknown> });
                this.logToolCall(sessionId, "oc_crear", { caso: casoActivo, confirmado: false }, crearRes as Record<string, unknown>);
                history.push({ role: "tool", name: "oc_crear", content: crearStr });

                if (crearRes.ok && crearRes.data) {
                  const { numero_oc, idempotente } = crearRes.data;
                  const estado = idempotente ? "idempotente (ya existía previamente)" : "creada exitosamente";
                  finalReply = `✅ **Orden de Compra SAP ${numero_oc}** ${estado}.\n\n` +
                    `La solicitud **${casoActivo}** es 100% conforme a las reglas de control y maestros. ` +
                    `Se ha generado la evidencia de auditoría y registrado en \`out/control.csv\` y \`out/sap/ordenes.jsonl\`.\n\n` +
                    `- **Proveedor**: ${orden.proveedor.nombre} (NIT: ${orden.proveedor.nit})\n` +
                    `- **Centro de Costo**: ${orden.posiciones[0]?.centro_costo}\n` +
                    `- **Total**: $${paquete.solicitud.valor_total.toLocaleString()} ${paquete.solicitud.moneda}\n` +
                    `- **Indicador IVA**: ${orden.posiciones[0]?.indicador_iva} | **Condiciones Pago**: ${orden.condiciones_pago}`;
                } else {
                  finalReply = `❌ No se pudo crear la orden en SAP: ${crearRes.error}`;
                }

                history.push({ role: "assistant", content: finalReply });
                detenidoPorValidacion = true;
                break; // Turno completado exitosamente sin detenerse a pedir confirmación
              }
            }
          }
        }

        executedToolCalls.push({
          name: call.name,
          args: call.args,
          result: parsedResult
        });

        // Registrar en out/log.jsonl (Regla CA4)
        this.logToolCall(sessionId, call.name, call.args, parsedResult);

        // Añadir resultado al historial para el modelo
        history.push({
          role: "tool",
          name: call.name,
          content: toolResultStr
        });
      }

      if (detenidoPorValidacion || needsConfirmation || finalReply.startsWith("❌ **Solicitud bloqueada")) {
        break;
      }

      // Si la herramienta indicó confirmación requerida y el modelo respondió pidiendo confirmación, detener
      if (needsConfirmation && finalReply.toLowerCase().includes("confirm")) {
        history.push({ role: "assistant", content: finalReply });
        break;
      }
    }

    if (iterations >= MAX_ITERATIONS && !finalReply) {
      finalReply = "Se alcanzó el tope máximo de iteraciones (25) para este turno. Por favor revisa el estado actual o confirma las acciones pendientes.";
    }

    return {
      reply: finalReply,
      toolCalls: executedToolCalls,
      needsConfirmation
    };
  }

  private async executeTool(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
    paqueteCache: Paquete | null,
    derivadosCache: Record<string, unknown>,
    casoActivo: string,
    isUserConfirming: boolean
  ): Promise<string> {
    try {
      switch (name) {
        case "oc_leer_paquete": {
          const caso = (args.caso || casoActivo) as string;
          return await leer_paquete.execute({ caso }, ctx);
        }
        case "oc_validar": {
          const caso = (args.caso || casoActivo) as string;
          let paquete: Paquete | null = (args.paquete as unknown as Paquete) || paqueteCache;
          if (!paquete || Object.keys(paquete).length === 0) {
            const readRes = JSON.parse(await leer_paquete.execute({ caso }, ctx)) as { ok: boolean; data?: Paquete };
            if (readRes.ok && readRes.data) {
              paquete = readRes.data;
              paqueteCache = paquete;
            }
          }
          if (!paquete) {
            return JSON.stringify({ ok: false, error: "No se pudo obtener el paquete para validar." });
          }
          return await validar.execute({ caso, paquete }, ctx);
        }
        case "oc_generar_evidencia": {
          const caso = (args.caso || casoActivo) as string;
          return await generar_evidencia.execute({ caso }, ctx);
        }
        case "oc_construir_payload": {
          const caso = (args.caso || casoActivo) as string;
          let paquete: Paquete | null = (args.paquete as unknown as Paquete) || paqueteCache;
          if (!paquete || Object.keys(paquete).length === 0) {
            const readRes = JSON.parse(await leer_paquete.execute({ caso }, ctx)) as { ok: boolean; data?: Paquete };
            if (readRes.ok && readRes.data) {
              paquete = readRes.data;
              paqueteCache = paquete;
            }
          }
          if (!paquete) {
            return JSON.stringify({ ok: false, error: "No se pudo obtener el paquete para construir payload." });
          }
          const derivados = (args.derivados && Object.keys(args.derivados).length > 0
            ? args.derivados
            : derivadosCache) as Record<string, unknown>;
          return await construir_payload.execute({ caso, paquete, derivados }, ctx);
        }
        case "oc_crear": {
          const caso = (args.caso || casoActivo) as string;
          let payload: OrdenCompra | null = (args.payload as unknown as OrdenCompra) || null;
          if (!payload || Object.keys(payload).length === 0) {
            let paquete: Paquete | null = paqueteCache;
            if (!paquete || Object.keys(paquete).length === 0) {
              const readRes = JSON.parse(await leer_paquete.execute({ caso }, ctx)) as { ok: boolean; data?: Paquete };
              if (readRes.ok && readRes.data) paquete = readRes.data;
            }
            if (!paquete) {
              return JSON.stringify({ ok: false, error: "No se pudo obtener el paquete para crear la orden." });
            }
            const payRes = JSON.parse(
              await construir_payload.execute({ caso, paquete, derivados: derivadosCache }, ctx)
            ) as { ok: boolean; data?: { payload: OrdenCompra } };
            if (payRes.ok && payRes.data) {
              payload = payRes.data.payload;
            }
          }
          if (!payload) {
            return JSON.stringify({ ok: false, error: "No se pudo estructurar el payload para crear la orden." });
          }
          const confirmado = Boolean(args.confirmado || isUserConfirming);
          return await crear.execute({ caso, payload, confirmado }, ctx);
        }
        case "oc_leer_excel": {
          const ruta = (args.ruta || "") as string;
          return await leer_excel.execute({ ruta }, ctx);
        }
        default:
          return JSON.stringify({ ok: false, error: `Herramienta desconocida: ${name}` });
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: (err as Error).message });
    }
  }

  private logToolCall(
    sessionId: string,
    toolName: string,
    args: Record<string, unknown>,
    result: Record<string, unknown>
  ): void {
    const entry = {
      sessionId,
      toolName,
      args,
      result,
      timestamp: new Date().toISOString()
    };
    try {
      fs.appendFileSync(this.logPath, JSON.stringify(entry) + "\n", "utf-8");
    } catch {
      // Ignorar fallos de logging de bajo nivel
    }
  }

  private getToolsSchema(): ToolDefinitionSchema[] {
    return [
      {
        name: "oc_leer_paquete",
        description: leer_paquete.description,
        parameters: {
          type: "object",
          properties: {
            caso: { type: "string", description: "Nombre de la carpeta del caso en fixtures (ej. sol-001)" }
          },
          required: ["caso"]
        }
      },
      {
        name: "oc_validar",
        description: validar.description,
        parameters: {
          type: "object",
          properties: {
            caso: { type: "string", description: "Nombre del caso" },
            paquete: { type: "object", description: "Paquete normalizado retornado por oc_leer_paquete" }
          },
          required: ["caso"]
        }
      },
      {
        name: "oc_generar_evidencia",
        description: generar_evidencia.description,
        parameters: {
          type: "object",
          properties: {
            caso: { type: "string", description: "Nombre del caso (ej. sol-001)" }
          },
          required: ["caso"]
        }
      },
      {
        name: "oc_construir_payload",
        description: construir_payload.description,
        parameters: {
          type: "object",
          properties: {
            caso: { type: "string", description: "Nombre del caso" },
            paquete: { type: "object", description: "Paquete validado" },
            derivados: { type: "object", description: "Valores derivados de maestros" }
          },
          required: ["caso"]
        }
      },
      {
        name: "oc_crear",
        description: crear.description,
        parameters: {
          type: "object",
          properties: {
            caso: { type: "string", description: "Nombre del caso" },
            payload: { type: "object", description: "Payload estructurado de la OrdenCompra" },
            confirmado: { type: "boolean", description: "Si el humano otorgó confirmación explícita" }
          },
          required: ["caso", "payload"]
        }
      }
    ];
  }
}
