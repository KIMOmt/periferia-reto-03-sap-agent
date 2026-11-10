import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { z } from "zod";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  Paquete,
  Solicitud,
  Cotizacion,
  Aprobacion,
  Factura,
  Correo,
  OrdenCompra,
  ResultadoValidacion,
  MaestroProveedor,
  MaestroCentroCosto,
  ToolExecutionContext,
  ExcepcionOC
} from "../types/oc.js";
import {
  PaqueteSchema,
  OrdenCompraSchema,
  ExcepcionOrdenCompraSchema
} from "../schemas/oc.js";
import { SapMockAdapter } from "../sap/mock.js";

// Helper para limpiar NITs
function cleanNit(nit: string | null | undefined): string {
  if (!nit) return "";
  return nit.replace(/\D/g, "");
}

// Helper para normalizar nombres
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

// Parser de cotización en texto plano
function parseCotizacionText(text: string): Cotizacion {
  let proveedor = "";
  let nit: string | null = null;
  let total = 0;
  let moneda = "COP";
  let validez_hasta: string | null = null;
  let codigo: string | null = null;

  const lines = text.split("\n");
  if (lines.length > 0) {
    const firstLine = lines[0].trim();
    const matchCod = firstLine.match(/cotizaci[oó]n\s+([A-Za-z0-9-]+)/i);
    if (matchCod) {
      codigo = matchCod[1].trim();
    }
  }

  for (const line of lines) {
    const l = line.trim();
    if (l.toLowerCase().startsWith("proveedor:")) {
      proveedor = l.substring("proveedor:".length).trim();
    } else if (l.toLowerCase().startsWith("nit:")) {
      const match = l.match(/nit:\s*([0-9.-]+)/i);
      if (match) nit = cleanNit(match[1]);
    } else if (l.toLowerCase().includes("total") && (l.includes("COP") || l.includes("$") || l.includes("USD"))) {
      const numMatch = l.match(/([0-9]+[0-9.,]*)/g);
      if (numMatch && numMatch.length > 0) {
        const lastNum = numMatch[numMatch.length - 1].replace(/\./g, "").replace(/,/g, ".");
        const val = parseFloat(lastNum);
        if (!isNaN(val) && val > 0) total = val;
      }
      if (l.includes("USD")) moneda = "USD";
    } else if (l.toLowerCase().startsWith("validez")) {
      validez_hasta = l.substring("validez".length).replace(/^[:\s]+/, "").trim();
    }
  }

  return {
    proveedor: proveedor || "Proveedor Cotización",
    nit,
    total,
    moneda,
    validez_hasta,
    texto: text,
    codigo
  };
}

// -------------------------------------------------------------
// Herramienta 1: oc_leer_paquete
// -------------------------------------------------------------
export const leer_paquete = {
  description: "Lee y normaliza los documentos de una solicitud (correo, solicitud, cotización, aprobación y factura) desde la carpeta del caso en fixtures/reto-03/solicitudes/.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/ (ej. sol-001)")
  },
  async execute(args: { caso: string }, ctx: ToolExecutionContext): Promise<string> {
    try {
      const casoDir = path.resolve(ctx.directory, "fixtures", "reto-03", "solicitudes", args.caso);
      if (!fs.existsSync(casoDir)) {
        return JSON.stringify({
          ok: false,
          error: `No se encontró la carpeta del caso en la ruta: fixtures/reto-03/solicitudes/${args.caso}`
        });
      }

      // 1. Correo
      const correoPath = path.resolve(casoDir, "correo.json");
      if (!fs.existsSync(correoPath)) {
        return JSON.stringify({ ok: false, error: "Archivo obligatorio correo.json no encontrado." });
      }
      const correoRaw = JSON.parse(fs.readFileSync(correoPath, "utf-8"));
      const correo: Correo = {
        id: correoRaw.id || `mail-${args.caso}`,
        de: correoRaw.de || "",
        asunto: correoRaw.asunto || "",
        fecha: correoRaw.fecha || ""
      };

      // 2. Solicitud
      const solicitudPath = path.resolve(casoDir, "solicitud.json");
      if (!fs.existsSync(solicitudPath)) {
        return JSON.stringify({ ok: false, error: "Archivo obligatorio solicitud.json no encontrado." });
      }
      const solicitud: Solicitud = JSON.parse(fs.readFileSync(solicitudPath, "utf-8"));

      // 3. Cotización
      let cotizacion: Cotizacion | null = null;
      const cotizacionPath = path.resolve(casoDir, "cotizacion.txt");
      if (fs.existsSync(cotizacionPath)) {
        const text = fs.readFileSync(cotizacionPath, "utf-8");
        cotizacion = parseCotizacionText(text);
      }

      // 4. Aprobación
      let aprobacion: Aprobacion | null = null;
      const aprobacionPath = path.resolve(casoDir, "aprobacion.json");
      if (fs.existsSync(aprobacionPath)) {
        const aprobRaw = JSON.parse(fs.readFileSync(aprobacionPath, "utf-8"));
        const cuerpoStr = (aprobRaw.cuerpo || "").toString();
        const aprobado = cuerpoStr.toLowerCase().includes("aprobado");
        aprobacion = {
          de: aprobRaw.de || "",
          fecha: aprobRaw.fecha || "",
          aprobado,
          texto: cuerpoStr
        };
      }

      // 5. Factura (opcional, caso retroactivo)
      let factura: Factura | null = null;
      const facturaPath = path.resolve(casoDir, "factura.txt");
      if (fs.existsSync(facturaPath)) {
        const fText = fs.readFileSync(facturaPath, "utf-8");
        const lines = fText.split("\n");
        let numero = "FC-DESCONOCIDA";
        let fecha = "1970-01-01";
        let total = 0;

        for (const l of lines) {
          if (l.toLowerCase().includes("no.") || l.toLowerCase().includes("factura")) {
            const m = l.match(/(?:No\.?|factura)\s*[:#]?\s*([A-Za-z0-9-]+)/i);
            if (m) numero = m[1].trim();
          }
          if (l.toLowerCase().includes("fecha")) {
            const m = l.match(/(\d{4}-\d{2}-\d{2})/);
            if (m) fecha = m[1];
          }
          if (l.toLowerCase().includes("total")) {
            const numMatch = l.match(/([0-9]+[0-9.,]*)/g);
            if (numMatch && numMatch.length > 0) {
              const val = parseFloat(numMatch[numMatch.length - 1].replace(/\./g, "").replace(/,/g, "."));
              if (!isNaN(val)) total = val;
            }
          }
        }
        factura = { numero, fecha, total };
      }

      const paquete: Paquete = {
        correo,
        solicitud,
        cotizacion,
        aprobacion,
        factura
      };

      const parsed = PaqueteSchema.safeParse(paquete);
      if (!parsed.success) {
        return JSON.stringify({
          ok: false,
          error: `Error de validación del paquete: ${parsed.error.issues.map((i) => i.message).join(", ")}`
        });
      }

      return JSON.stringify({ ok: true, data: paquete });
    } catch (err) {
      return JSON.stringify({ ok: false, error: (err as Error).message });
    }
  }
};

// -------------------------------------------------------------
// Herramienta 2: oc_validar
// -------------------------------------------------------------
export const validar = {
  description: "Valida el paquete contra maestros de SAP aplicando las 10 reglas de control (RC1-RC10). Devuelve bloqueos, confirmaciones requeridas, derivados calculados y retroactividad.",
  args: {
    caso: z.string().describe("Nombre del caso (ej. sol-001)"),
    paquete: PaqueteSchema.describe("Objeto del paquete de compra normalizado")
  },
  async execute(args: { caso: string; paquete: Paquete }, ctx: ToolExecutionContext): Promise<string> {
    try {
      const maestrosDir = path.resolve(ctx.directory, "fixtures", "reto-03", "maestros");
      const proveedoresPath = path.resolve(maestrosDir, "proveedores.json");
      const centrosPath = path.resolve(maestrosDir, "centros-costo.json");

      if (!fs.existsSync(proveedoresPath) || !fs.existsSync(centrosPath)) {
        return JSON.stringify({ ok: false, error: "Catálogos maestros no encontrados en fixtures/reto-03/maestros/." });
      }

      const proveedores: MaestroProveedor[] = JSON.parse(fs.readFileSync(proveedoresPath, "utf-8"));
      const centrosCosto: MaestroCentroCosto[] = JSON.parse(fs.readFileSync(centrosPath, "utf-8"));

      const bloqueos: string[] = [];
      const confirmaciones: string[] = [];
      const derivados: Record<string, unknown> = {};
      let retroactiva = false;

      const sol = args.paquete.solicitud;
      const cot = args.paquete.cotizacion;
      const aprob = args.paquete.aprobacion;
      const fact = args.paquete.factura;

      // ---------------------------------------------------------
      // RC1: Proveedor en maestros y activo (Bloqueo)
      // ---------------------------------------------------------
      const nitSol = cleanNit(sol.proveedor_nit);
      let provEncontrado: MaestroProveedor | undefined;

      if (nitSol) {
        provEncontrado = proveedores.find((p) => cleanNit(p.nit) === nitSol);
      }
      if (!provEncontrado && sol.proveedor_nombre) {
        const normName = normalizeName(sol.proveedor_nombre);
        provEncontrado = proveedores.find((p) => normalizeName(p.nombre) === normName);
      }

      if (!provEncontrado) {
        bloqueos.push(`RC1: El proveedor '${sol.proveedor_nombre}' (NIT: ${sol.proveedor_nit || "no informado"}) no existe en el catálogo maestro.`);
      } else if (!provEncontrado.activo) {
        bloqueos.push(`RC1: El proveedor '${provEncontrado.nombre}' (${provEncontrado.codigo_sap}) se encuentra inactivo en el sistema.`);
      }

      // ---------------------------------------------------------
      // Centro de Costo de la Solicitud
      // ---------------------------------------------------------
      const centroEncontrado = centrosCosto.find((c) => c.centro_costo === sol.centro_costo);

      // ---------------------------------------------------------
      // RC2: Aprobación existe, dice "Aprobado" y remitente es aprobador del centro (Bloqueo)
      // ---------------------------------------------------------
      if (!aprob) {
        bloqueos.push("RC2: No se adjuntó correo de aprobación.");
      } else if (!aprob.aprobado) {
        bloqueos.push("RC2: El correo de aprobación no contiene la confirmación 'Aprobado'.");
      } else if (!centroEncontrado) {
        bloqueos.push(`RC2: El centro de costo '${sol.centro_costo}' no existe en maestros.`);
      } else {
        const aprobadorRegistrado = centroEncontrado.aprobadores.find(
          (a) => a.email.toLowerCase() === aprob.de.toLowerCase()
        );
        if (!aprobadorRegistrado) {
          bloqueos.push(`RC2: El aprobador '${aprob.de}' no está facultado para autorizar gastos en el centro de costos ${sol.centro_costo}.`);
        } else {
          // ---------------------------------------------------------
          // RC3: valor_total <= tope del aprobador (Bloqueo)
          // ---------------------------------------------------------
          if (sol.valor_total > aprobadorRegistrado.tope) {
            bloqueos.push(`RC3: El monto de la solicitud ($${sol.valor_total.toLocaleString()}) supera el tope de autorización del aprobador '${aprobadorRegistrado.nombre}' ($${aprobadorRegistrado.tope.toLocaleString()}).`);
          }
        }
      }

      // ---------------------------------------------------------
      // RC4: subarea pertenece al centro_costo (Bloqueo)
      // ---------------------------------------------------------
      if (centroEncontrado) {
        const subareaValida = centroEncontrado.subareas.some(
          (s) => s.toLowerCase() === sol.subarea.toLowerCase()
        );
        if (!subareaValida) {
          bloqueos.push(`RC4: La subárea '${sol.subarea}' no pertenece al centro de costo ${sol.centro_costo}. Subáreas válidas: ${centroEncontrado.subareas.join(", ")}.`);
        }
      }

      // ---------------------------------------------------------
      // RC10: cantidad * valor_unitario == valor_total (±1) (Bloqueo)
      // ---------------------------------------------------------
      const calculoTotal = sol.cantidad * sol.valor_unitario;
      if (Math.abs(calculoTotal - sol.valor_total) > 1.0) {
        bloqueos.push(`RC10: Inconsistencia matemática en solicitud: ${sol.cantidad} × $${sol.valor_unitario} = $${calculoTotal}, pero se reporta valor_total $${sol.valor_total}.`);
      }

      // ---------------------------------------------------------
      // RC5: abs(cotizacion.total - solicitud.valor_total) / solicitud.valor_total <= 2% (Confirmación)
      // ---------------------------------------------------------
      if (!cot) {
        confirmaciones.push("RC5: No se adjuntó cotización formal del proveedor. Se requiere confirmación para proceder con el monto de la solicitud.");
      } else {
        const desvio = Math.abs(cot.total - sol.valor_total) / sol.valor_total;
        if (desvio > 0.02) {
          const pct = (desvio * 100).toFixed(1);
          confirmaciones.push(`RC5: El monto de la cotización ($${cot.total.toLocaleString()} ${cot.moneda}) difiere en un ${pct}% del monto de la solicitud ($${sol.valor_total.toLocaleString()} ${sol.moneda}). Requiere confirmación.`);
        }
      }

      // ---------------------------------------------------------
      // RC6: indicador_iva ausente -> derivado del proveedor + confirmación
      // ---------------------------------------------------------
      if (!sol.indicador_iva) {
        const ivaDefault = provEncontrado?.indicador_iva_default || "C1";
        derivados["indicador_iva"] = ivaDefault;
        confirmaciones.push(`RC6: La solicitud no especifica indicador de IVA. Se derivó el código '${ivaDefault}' por defecto del proveedor. Requiere confirmación.`);
      }

      // ---------------------------------------------------------
      // RC7: condiciones_pago ausente -> derivado del proveedor (informativo)
      // ---------------------------------------------------------
      if (!sol.condiciones_pago) {
        const pagoDefault = provEncontrado?.condiciones_pago_default || "Z030";
        derivados["condiciones_pago"] = pagoDefault;
      }

      // ---------------------------------------------------------
      // RC8: factura con fecha < fecha_solicitud -> retroactiva = true (Confirmación)
      // ---------------------------------------------------------
      if (fact) {
        if (fact.fecha < sol.fecha_solicitud) {
          retroactiva = true;
          confirmaciones.push(`RC8: Factura ${fact.numero} emitida el ${fact.fecha} con fecha anterior a la solicitud (${sol.fecha_solicitud}). Operación clasificada como compra retroactiva. Requiere confirmación.`);
        }
      }

      // ---------------------------------------------------------
      // RC9: fecha aprobación >= fecha_solicitud (Confirmación)
      // ---------------------------------------------------------
      if (aprob && aprob.fecha) {
        const fechaAprobSolo = aprob.fecha.substring(0, 10);
        if (fechaAprobSolo < sol.fecha_solicitud) {
          confirmaciones.push(`RC9: La fecha del correo de aprobación (${fechaAprobSolo}) es anterior a la fecha de la solicitud (${sol.fecha_solicitud}). Requiere confirmación.`);
        }
      }

      const apta = bloqueos.length === 0;

      const resultado: ResultadoValidacion = {
        apta,
        bloqueos,
        confirmaciones,
        derivados,
        retroactiva
      };

      return JSON.stringify({ ok: true, data: resultado });
    } catch (err) {
      return JSON.stringify({ ok: false, error: (err as Error).message });
    }
  }
};

// -------------------------------------------------------------
// Herramienta 3: oc_generar_evidencia
// -------------------------------------------------------------
export const generar_evidencia = {
  description: "Genera el archivo de evidencia de aprobación del correo con encabezados, cuerpo y cálculo de hash criptográfico SHA-256.",
  args: {
    caso: z.string().describe("Nombre del caso (ej. sol-001)")
  },
  async execute(args: { caso: string }, ctx: ToolExecutionContext): Promise<string> {
    try {
      const casoDir = path.resolve(ctx.directory, "fixtures", "reto-03", "solicitudes", args.caso);
      const outCasoDir = path.resolve(ctx.directory, "out", args.caso);
      if (!fs.existsSync(outCasoDir)) {
        fs.mkdirSync(outCasoDir, { recursive: true });
      }

      const aprobPath = path.resolve(casoDir, "aprobacion.json");
      if (!fs.existsSync(aprobPath)) {
        return JSON.stringify({ ok: false, error: "Archivo aprobacion.json no encontrado en el caso." });
      }

      const aprobRaw = JSON.parse(fs.readFileSync(aprobPath, "utf-8"));
      const cuerpo = aprobRaw.cuerpo || "";

      // 1. Generar contenido textual normalizado
      const textoEvidencia = [
        "==================================================",
        "EVIDENCIA DE APROBACIÓN DE GASTO - AUDITORÍA SAP",
        "==================================================",
        `Caso: ${args.caso}`,
        `De: ${aprobRaw.de || ""}`,
        `Para: ${aprobRaw.para || ""}`,
        `CC: ${Array.isArray(aprobRaw.cc) ? aprobRaw.cc.join(", ") : ""}`,
        `Fecha: ${aprobRaw.fecha || ""}`,
        `Asunto: ${aprobRaw.asunto || ""}`,
        "--------------------------------------------------",
        "CUERPO DEL MENSAJE:",
        cuerpo,
        "=================================================="
      ].join("\n");

      // 2. Calcular SHA-256
      const sha256 = crypto.createHash("sha256").update(textoEvidencia, "utf-8").digest("hex");
      const textoFinal = `${textoEvidencia}\nSHA-256: ${sha256}\n`;

      const txtPath = path.resolve(outCasoDir, "aprobacion.txt");
      fs.writeFileSync(txtPath, textoFinal, "utf-8");

      // 3. Generar PDF (P1)
      try {
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([595.28, 841.89]); // A4
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        let y = 800;
        page.drawText("EVIDENCIA DE APROBACIÓN - PERIFERIA IT GROUP", {
          x: 50,
          y,
          size: 14,
          font: fontBold,
          color: rgb(0.1, 0.2, 0.5)
        });
        y -= 25;

        page.drawText(`Caso: ${args.caso} | Asunto: ${aprobRaw.asunto || ""}`, {
          x: 50,
          y,
          size: 10,
          font: fontBold
        });
        y -= 18;

        page.drawText(`De: ${aprobRaw.de || ""} | Fecha: ${aprobRaw.fecha || ""}`, {
          x: 50,
          y,
          size: 9,
          font
        });
        y -= 25;

        page.drawText("Mensaje de aprobación:", { x: 50, y, size: 10, font: fontBold });
        y -= 15;

        const bodyLines = cuerpo.split("\n");
        for (const line of bodyLines) {
          page.drawText(line.substring(0, 80), { x: 50, y, size: 9, font });
          y -= 14;
        }

        y -= 20;
        page.drawText(`Hash de Integridad SHA-256: ${sha256}`, {
          x: 50,
          y,
          size: 8,
          font: fontBold,
          color: rgb(0.3, 0.3, 0.3)
        });

        const pdfBytes = await pdfDoc.save();
        const pdfPath = path.resolve(outCasoDir, "aprobacion.pdf");
        fs.writeFileSync(pdfPath, pdfBytes);
      } catch {
        // PDF es opcional P1; si falla pdf-lib el txt respalda P0
      }

      return JSON.stringify({
        ok: true,
        data: {
          ruta: path.relative(ctx.directory, txtPath).replace(/\\/g, "/"),
          sha256,
          tipo: "txt"
        }
      });
    } catch (err) {
      return JSON.stringify({ ok: false, error: (err as Error).message });
    }
  }
};

// -------------------------------------------------------------
// Herramienta 4: oc_construir_payload
// -------------------------------------------------------------
export const construir_payload = {
  description: "Construye el payload validado de la Orden de Compra para SAP según la sección 7.4 del PRD y genera el mapa de trazabilidad de cada campo.",
  args: {
    caso: z.string().describe("Nombre del caso (ej. sol-001)"),
    paquete: PaqueteSchema.describe("Paquete validado"),
    derivados: z.record(z.unknown()).describe("Valores derivados de maestros"),
    excepciones: z.array(ExcepcionOrdenCompraSchema).optional().describe("Excepciones confirmadas")
  },
  async execute(
    args: { caso: string; paquete: Paquete; derivados: Record<string, unknown>; excepciones?: ExcepcionOC[] },
    ctx: ToolExecutionContext
  ): Promise<string> {
    try {
      const maestrosDir = path.resolve(ctx.directory, "fixtures", "reto-03", "maestros");
      const proveedores: MaestroProveedor[] = JSON.parse(
        fs.readFileSync(path.resolve(maestrosDir, "proveedores.json"), "utf-8")
      );

      const sol = args.paquete.solicitud;
      const nitSol = cleanNit(sol.proveedor_nit);
      let prov = proveedores.find((p) => cleanNit(p.nit) === nitSol);
      if (!prov && sol.proveedor_nombre) {
        prov = proveedores.find((p) => normalizeName(p.nombre) === normalizeName(sol.proveedor_nombre));
      }

      const codigoSap = prov ? prov.codigo_sap : "100000";
      const proveedorNombre = prov ? prov.nombre : sol.proveedor_nombre;
      const proveedorNit = prov ? prov.nit : (sol.proveedor_nit || "000000000");

      const condicionesPago = (sol.condiciones_pago || args.derivados["condiciones_pago"] || prov?.condiciones_pago_default || "Z030") as string;
      const indicadorIva = (sol.indicador_iva || args.derivados["indicador_iva"] || prov?.indicador_iva_default || "C1") as string;

      // Calcular o reutilizar hash de evidencia
      let sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
      const outTxtPath = path.resolve(ctx.directory, "out", args.caso, "aprobacion.txt");
      if (fs.existsSync(outTxtPath)) {
        const txtContent = fs.readFileSync(outTxtPath, "utf-8");
        const match = txtContent.match(/SHA-256:\s*([a-f0-9]{64})/i);
        if (match) sha256 = match[1];
      }

      // Máximo 40 caracteres en descripción según SAP
      const descCorta = sol.descripcion.length > 40 ? sol.descripcion.substring(0, 37) + "..." : sol.descripcion;

      // Unidad de medida
      let unidad: "UN" | "H" | "MES" = "UN";
      const descLower = sol.descripcion.toLowerCase();
      if (descLower.includes("hora")) unidad = "H";
      else if (descLower.includes("mes") || descLower.includes("vigencia 12 meses")) unidad = "UN";

      // Extraer código de cotización de la primera línea para referencia.cotizacion_ref
      let cotizacionRef: string | null = null;
      if (args.paquete.cotizacion) {
        cotizacionRef = args.paquete.cotizacion.codigo || null;
        if (!cotizacionRef && args.paquete.cotizacion.texto) {
          const firstLine = args.paquete.cotizacion.texto.split("\n")[0] || "";
          const matchCod = firstLine.match(/cotizaci[oó]n\s+([A-Za-z0-9-]+)/i);
          if (matchCod) cotizacionRef = matchCod[1].trim();
        }
      }

      const orden: OrdenCompra = {
        referencia: {
          solicitud_id: sol.solicitud_id,
          correo_id: args.paquete.correo.id,
          cotizacion_ref: cotizacionRef
        },
        sociedad: "1000",
        organizacion_compras: "1000",
        proveedor: {
          codigo_sap: codigoSap,
          nit: proveedorNit,
          nombre: proveedorNombre
        },
        moneda: sol.moneda,
        condiciones_pago: condicionesPago,
        aprobador: {
          email: args.paquete.aprobacion?.de || "sin_aprobador@periferia.com",
          fecha_aprobacion: args.paquete.aprobacion?.fecha || new Date().toISOString(),
          evidencia_sha256: sha256
        },
        posiciones: [
          {
            numero: 10,
            descripcion: descCorta,
            cantidad: sol.cantidad,
            unidad,
            precio_unitario: sol.valor_unitario,
            centro_costo: sol.centro_costo,
            subarea: sol.subarea,
            indicador_iva: indicadorIva
          }
        ],
        excepciones: args.excepciones || []
      };

      const validado = OrdenCompraSchema.safeParse(orden);
      if (!validado.success) {
        return JSON.stringify({
          ok: false,
          error: `Error validando OrdenCompra contra esquema Zod: ${validado.error.issues.map((i) => i.message).join(", ")}`
        });
      }

      // Persistir mapa de trazabilidad
      const trazabilidad = {
        solicitud_id: sol.solicitud_id,
        fuentes: {
          "proveedor.codigo_sap": `maestro.proveedores (nit: ${proveedorNit})`,
          "proveedor.nit": sol.proveedor_nit ? "solicitud" : "maestro.proveedores",
          "proveedor.nombre": prov ? "maestro.proveedores" : "solicitud",
          "condiciones_pago": sol.condiciones_pago ? "solicitud" : "derivado.proveedor",
          "posiciones[0].indicador_iva": sol.indicador_iva ? "solicitud" : "derivado.proveedor",
          "posiciones[0].precio_unitario": "solicitud",
          "posiciones[0].cantidad": "solicitud",
          "aprobador.email": "aprobacion",
          "aprobador.evidencia_sha256": "out/<caso>/aprobacion.txt"
        },
        timestamp: new Date().toISOString()
      };

      const outCasoDir = path.resolve(ctx.directory, "out", args.caso);
      if (!fs.existsSync(outCasoDir)) fs.mkdirSync(outCasoDir, { recursive: true });

      const trazPath = path.resolve(outCasoDir, "trazabilidad.json");
      fs.writeFileSync(trazPath, JSON.stringify(trazabilidad, null, 2), "utf-8");

      return JSON.stringify({
        ok: true,
        data: {
          payload: orden,
          ruta_trazabilidad: path.relative(ctx.directory, trazPath).replace(/\\/g, "/")
        }
      });
    } catch (err) {
      return JSON.stringify({ ok: false, error: (err as Error).message });
    }
  }
};

// -------------------------------------------------------------
// Herramienta 5: oc_crear
// -------------------------------------------------------------
export const crear = {
  description: "Crea la orden de compra en el SAP simulado respetando idempotencia, validaciones de aptitud y confirmaciones explícitas, registrando en out/control.csv.",
  args: {
    caso: z.string().describe("Nombre del caso (ej. sol-001)"),
    payload: OrdenCompraSchema.describe("Payload de la orden de compra validado"),
    confirmado: z.boolean().optional().default(false).describe("Indica si el humano confirmó excepciones pendientes")
  },
  async execute(
    args: { caso: string; payload: OrdenCompra; confirmado?: boolean },
    ctx: ToolExecutionContext
  ): Promise<string> {
    try {
      const sapMock = new SapMockAdapter(ctx.directory);
      const solicitudId = args.payload.referencia.solicitud_id;

      // 1. Ejecutar internamente leer_paquete y validar para el caso
      const paqueteStr = await leer_paquete.execute({ caso: args.caso }, ctx);
      const paqueteRes = JSON.parse(paqueteStr) as { ok: boolean; data?: Paquete; error?: string };
      if (!paqueteRes.ok || !paqueteRes.data) {
        return JSON.stringify({ ok: false, error: `Error leyendo paquete del caso: ${paqueteRes.error}` });
      }

      const valStr = await validar.execute({ caso: args.caso, paquete: paqueteRes.data }, ctx);
      const valRes = JSON.parse(valStr) as { ok: boolean; data?: ResultadoValidacion; error?: string };
      if (!valRes.ok || !valRes.data) {
        return JSON.stringify({ ok: false, error: `Error validando caso: ${valRes.error}` });
      }
      const val = valRes.data;

      // • Si !val.apta (val.bloqueos.length > 0)
      if (!val.apta || val.bloqueos.length > 0) {
        sapMock.registrarControl(
          solicitudId,
          "BLOQUEADA",
          "",
          val.retroactiva,
          val.bloqueos.join(";"),
          val.confirmaciones.join(";")
        );
        return JSON.stringify({
          ok: false,
          error: `No se puede crear la orden: la solicitud está bloqueada por incumplimiento de controles: ${val.bloqueos.join(" | ")}`
        });
      }

      // • Si val.confirmaciones.length > 0 && !args.confirmado
      if (val.confirmaciones.length > 0 && !args.confirmado) {
        sapMock.registrarControl(
          solicitudId,
          "PENDIENTE_CONFIRMACION",
          "",
          val.retroactiva,
          "",
          val.confirmaciones.join(";")
        );
        return JSON.stringify({
          ok: false,
          error: "No se puede crear la orden: la solicitud presenta desviaciones que requieren confirmación humana explícita (confirmado = false)."
        });
      }

      // • Si val.confirmaciones.length > 0 && args.confirmado y args.payload.excepciones.length === 0
      if (val.confirmaciones.length > 0 && args.confirmado) {
        if (!args.payload.excepciones || args.payload.excepciones.length === 0) {
          args.payload.excepciones = [];
          for (const conf of val.confirmaciones) {
            let codigo = "RC_GEN";
            if (conf.includes("RC5")) codigo = "RC5";
            else if (conf.includes("RC6")) codigo = "RC6";
            else if (conf.includes("RC8")) codigo = "RC8";
            else if (conf.includes("RC9")) codigo = "RC9";

            args.payload.excepciones.push({
              codigo,
              detalle: conf,
              confirmado_por: "humano_analista"
            });
          }
        }
      }

      const res = await sapMock.crearOrden(args.payload);

      return JSON.stringify({
        ok: true,
        data: {
          numero_oc: res.numero_oc,
          fecha: res.fecha,
          idempotente: res.idempotente
        }
      });
    } catch (err) {
      return JSON.stringify({ ok: false, error: (err as Error).message });
    }
  }
};

// -------------------------------------------------------------
// Herramienta 6: oc_leer_excel (P1 Opcional)
// -------------------------------------------------------------
export const leer_excel = {
  description: "Lee un archivo Excel XLSX o emula su lectura desde el JSON de la solicitud entregado en los fixtures.",
  args: {
    ruta: z.string().describe("Ruta relativa del archivo a leer")
  },
  async execute(args: { ruta: string }, ctx: ToolExecutionContext): Promise<string> {
    try {
      const fullPath = path.resolve(ctx.directory, args.ruta);
      if (!fs.existsSync(fullPath)) {
        return JSON.stringify({ ok: false, error: `Archivo no encontrado en ${args.ruta}` });
      }
      if (fullPath.endsWith(".json")) {
        const content = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
        return JSON.stringify({ ok: true, data: { filas: [content] } });
      }
      return JSON.stringify({ ok: true, data: { filas: [] } });
    } catch (err) {
      return JSON.stringify({ ok: false, error: (err as Error).message });
    }
  }
};

