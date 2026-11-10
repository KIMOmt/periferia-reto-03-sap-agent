import * as fs from "node:fs";
import * as path from "node:path";
import {
  leer_paquete,
  validar,
  generar_evidencia,
  construir_payload,
  crear
} from "./src/tools/oc.js";
import { Paquete, ResultadoValidacion, OrdenCompra, ExcepcionOC } from "./src/types/oc.js";
import { SapMockAdapter } from "./src/sap/mock.js";

async function runDemo(): Promise<void> {
  const rootDir = process.cwd();
  const ctx = { directory: rootDir, sessionId: "demo-session" };

  console.log("\n================================================================================");
  console.log(" 🚀 INICIANDO DEMO DETERMINISTA DE HERRAMIENTAS - SAP ÓRDENES DE COMPRA");
  console.log("================================================================================\n");
  console.log(`Directorio de trabajo: ${rootDir}`);
  console.log("Sin conexión a LLM ni consumo de tokens externos (100% determinista)\n");

  // Limpiar directorio out/ al inicio según RNF de determinismo
  const outDir = path.resolve(rootDir, "out");
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  const casos = [
    { id: "sol-001", nombre: "sol-001 (1ª vez: Flujo estándar)", confirmar: false },
    { id: "sol-001", nombre: "sol-001 (2ª vez: Prueba de Idempotencia)", confirmar: false },
    { id: "sol-002", nombre: "sol-002 (Proveedor inexistente en catálogo)", confirmar: false },
    { id: "sol-003", nombre: "sol-003 (Aprobador no autorizado para el centro)", confirmar: false },
    { id: "sol-004", nombre: "sol-004 (Desvío 6% > 2% - Sin confirmación previa)", confirmar: false },
    { id: "sol-004", nombre: "sol-004 (Desvío 6% > 2% - Con confirmación explícita)", confirmar: true },
    { id: "sol-005", nombre: "sol-005 (Compra retroactiva: Factura anterior a solicitud)", confirmar: true },
    { id: "sol-006", nombre: "sol-006 (IVA y condiciones de pago derivadas)", confirmar: true }
  ];

  const resultadosReporte: Array<{
    caso: string;
    apta: boolean;
    bloqueos: number;
    confirmaciones: number;
    retroactiva: boolean;
    resultado: string;
  }> = [];

  for (const c of casos) {
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`▶ PROCESANDO: ${c.nombre}`);
    console.log(`--------------------------------------------------------------------------------`);

    // 1. Leer paquete
    const resLeerStr = await leer_paquete.execute({ caso: c.id }, ctx);
    const resLeer = JSON.parse(resLeerStr);
    if (!resLeer.ok) {
      console.error(`❌ Error leyendo paquete: ${resLeer.error}`);
      resultadosReporte.push({
        caso: c.nombre,
        apta: false,
        bloqueos: 1,
        confirmaciones: 0,
        retroactiva: false,
        resultado: `ERROR_LECTURA: ${resLeer.error}`
      });
      continue;
    }
    const paquete: Paquete = resLeer.data;
    console.log(`  [1/4] Paquete leído: Solicitud ${paquete.solicitud.solicitud_id} | Prov: ${paquete.solicitud.proveedor_nombre} | Total: $${paquete.solicitud.valor_total.toLocaleString()} ${paquete.solicitud.moneda}`);

    // 2. Validar contra maestros y RC1-RC10
    const resValStr = await validar.execute({ caso: c.id, paquete }, ctx);
    const resVal = JSON.parse(resValStr);
    if (!resVal.ok) {
      console.error(`❌ Error validando: ${resVal.error}`);
      continue;
    }
    const val: ResultadoValidacion = resVal.data;
    console.log(`  [2/4] Validación: Apta=${val.apta} | Bloqueos=${val.bloqueos.length} | Confirmaciones=${val.confirmaciones.length} | Retroactiva=${val.retroactiva}`);

    if (val.bloqueos.length > 0) {
      val.bloqueos.forEach((b) => console.log(`       ⛔ BLOQUEO: ${b}`));
      // Registrar bloqueo en control.csv
      const sapMock = new SapMockAdapter(rootDir);
      sapMock.registrarControl(
        paquete.solicitud.solicitud_id,
        "BLOQUEADA",
        "",
        val.retroactiva,
        val.bloqueos.join(";"),
        val.confirmaciones.join(";")
      );
      resultadosReporte.push({
        caso: c.nombre,
        apta: val.apta,
        bloqueos: val.bloqueos.length,
        confirmaciones: val.confirmaciones.length,
        retroactiva: val.retroactiva,
        resultado: `BLOQUEADA (${val.bloqueos[0].substring(0, 35)}...)`
      });
      console.log(`       ℹ️ Acción sugerida: Corregir datos con el solicitante antes de reintentar.\n`);
      continue;
    }

    if (val.confirmaciones.length > 0) {
      val.confirmaciones.forEach((conf) => console.log(`       ⚠️ CONFIRMACIÓN: ${conf}`));
    }

    // 3. Generar evidencia de aprobación
    const resEvStr = await generar_evidencia.execute({ caso: c.id }, ctx);
    const resEv = JSON.parse(resEvStr);
    let shaEvidencia = "0000000000000000000000000000000000000000000000000000000000000000";
    if (resEv.ok) {
      shaEvidencia = resEv.data.sha256;
      console.log(`  [3/4] Evidencia generada: ${resEv.data.ruta} (SHA-256: ${shaEvidencia.substring(0, 16)}...)`);
    }

    // 4. Construir payload de la OC
    const excepciones: ExcepcionOC[] = [];
    if (val.confirmaciones.length > 0 && c.confirmar) {
      if (val.retroactiva) {
        excepciones.push({ codigo: "RC8", detalle: "Compra retroactiva confirmada", confirmado_por: "humano_analista" });
      }
      if (val.confirmaciones.some((x) => x.includes("RC5"))) {
        excepciones.push({ codigo: "RC5", detalle: "Desvío de cotización confirmado", confirmado_por: "humano_analista" });
      }
      if (val.confirmaciones.some((x) => x.includes("RC6"))) {
        excepciones.push({ codigo: "RC6", detalle: "IVA derivado confirmado", confirmado_por: "humano_analista" });
      }
    }

    const resPayStr = await construir_payload.execute(
      {
        caso: c.id,
        paquete,
        derivados: val.derivados,
        excepciones
      },
      ctx
    );
    const resPay = JSON.parse(resPayStr);
    if (!resPay.ok) {
      console.error(`❌ Error construyendo payload: ${resPay.error}`);
      continue;
    }
    const orden: OrdenCompra = resPay.data.payload;

    // 5. Crear la orden en SAP
    console.log(`  [4/4] Enviando creación a SAP mock (confirmado=${c.confirmar})...`);
    const resCrearStr = await crear.execute(
      {
        caso: c.id,
        payload: orden,
        confirmado: c.confirmar
      },
      ctx
    );
    const resCrear = JSON.parse(resCrearStr);

    if (resCrear.ok) {
      const { numero_oc, idempotente } = resCrear.data;
      const estadoIdem = idempotente ? "♻️ IDEMPOTENTE (Ya existía)" : "✅ CREADA EXITOSA";
      console.log(`       ${estadoIdem} -> Orden de Compra SAP No: ${numero_oc}\n`);
      resultadosReporte.push({
        caso: c.nombre,
        apta: val.apta,
        bloqueos: val.bloqueos.length,
        confirmaciones: val.confirmaciones.length,
        retroactiva: val.retroactiva,
        resultado: idempotente ? `OC ${numero_oc} (IDEMPOTENTE)` : `OC ${numero_oc} (NUEVA)`
      });
    } else {
      console.log(`       ⚠️ NO CREADA: ${resCrear.error}\n`);
      resultadosReporte.push({
        caso: c.nombre,
        apta: val.apta,
        bloqueos: val.bloqueos.length,
        confirmaciones: val.confirmaciones.length,
        retroactiva: val.retroactiva,
        resultado: `PENDIENTE_CONFIRMACION`
      });
    }
  }

  console.log("================================================================================");
  console.log(" 📊 TABLA RESUMEN DE RESULTADOS DE PRUEBA");
  console.log("================================================================================");
  console.table(resultadosReporte);

  // Validaciones finales de out/
  const controlCsvPath = path.resolve(rootDir, "out", "control.csv");
  const ordenesJsonlPath = path.resolve(rootDir, "out", "sap", "ordenes.jsonl");

  console.log("\n📁 Verificación de archivos generados en out/:");
  if (fs.existsSync(controlCsvPath)) {
    const filasCsv = fs.readFileSync(controlCsvPath, "utf-8").trim().split("\n");
    console.log(`  ✓ out/control.csv generado (${filasCsv.length - 1} filas registradas)`);
  } else {
    console.error("  ❌ out/control.csv no fue generado.");
  }

  if (fs.existsSync(ordenesJsonlPath)) {
    const filasOrdenes = fs.readFileSync(ordenesJsonlPath, "utf-8").trim().split("\n");
    console.log(`  ✓ out/sap/ordenes.jsonl generado (${filasOrdenes.length} órdenes únicas en SAP)`);
  } else {
    console.error("  ❌ out/sap/ordenes.jsonl no fue generado.");
  }

  console.log("\n✨ DEMO COMPLETADA EXITOSAMENTE.\n");
}

runDemo().catch((err) => {
  console.error("Error fatal ejecutando demo:", err);
  process.exit(1);
});

