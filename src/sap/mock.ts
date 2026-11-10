import * as fs from "node:fs";
import * as path from "node:path";
import { SapAdapter } from "./adapter.js";
import { OrdenCompra, MaestroProveedor } from "../types/oc.js";

interface StoredSapOrder {
  numero_oc: string;
  fecha: string;
  orden: OrdenCompra;
}

export class SapMockAdapter implements SapAdapter {
  private baseDir: string;
  private sapDir: string;
  private ordenesFile: string;
  private controlFile: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.sapDir = path.resolve(this.baseDir, "out", "sap");
    this.ordenesFile = path.resolve(this.sapDir, "ordenes.jsonl");
    this.controlFile = path.resolve(this.baseDir, "out", "control.csv");
    this.ensureDirs();
  }

  private ensureDirs(): void {
    if (!fs.existsSync(this.sapDir)) {
      fs.mkdirSync(this.sapDir, { recursive: true });
    }
    const outDir = path.resolve(this.baseDir, "out");
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    if (!fs.existsSync(this.controlFile)) {
      fs.writeFileSync(
        this.controlFile,
        "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts\n",
        "utf-8"
      );
    }
  }

  public async consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null> {
    const proveedoresPath = path.resolve(this.baseDir, "fixtures", "reto-03", "maestros", "proveedores.json");
    if (!fs.existsSync(proveedoresPath)) {
      return null;
    }
    const content = fs.readFileSync(proveedoresPath, "utf-8");
    const proveedores: MaestroProveedor[] = JSON.parse(content);
    const cleanNit = nit.replace(/\D/g, "");
    const found = proveedores.find((p) => p.nit.replace(/\D/g, "") === cleanNit);
    if (!found) {
      return null;
    }
    return {
      codigo_sap: found.codigo_sap,
      activo: found.activo
    };
  }

  public async buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string; fecha: string } | null> {
    if (!fs.existsSync(this.ordenesFile)) {
      return null;
    }
    const lines = fs.readFileSync(this.ordenesFile, "utf-8").split("\n").filter((l) => l.trim().length > 0);
    for (const line of lines) {
      try {
        const item: StoredSapOrder = JSON.parse(line);
        if (item.orden?.referencia?.solicitud_id === solicitud_id) {
          return { numero_oc: item.numero_oc, fecha: item.fecha };
        }
      } catch {
        // Ignorar líneas corruptas
      }
    }
    return null;
  }

  public async crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string; idempotente: boolean }> {
    this.ensureDirs();
    const solicitudId = orden.referencia.solicitud_id;

    // Verificar idempotencia
    const existente = await this.buscarOrdenPorReferencia(solicitudId);
    if (existente) {
      const isRetro = orden.excepciones.some((e) => e.codigo === "RC8");
      this.registrarControl(
        solicitudId,
        "IDEMPOTENTE",
        existente.numero_oc,
        isRetro,
        "",
        orden.excepciones.map((e) => e.codigo).join(";")
      );
      return {
        numero_oc: existente.numero_oc,
        fecha: existente.fecha,
        idempotente: true
      };
    }

    // Calcular siguiente consecutivo
    let maxNum = 4500000000;
    if (fs.existsSync(this.ordenesFile)) {
      const lines = fs.readFileSync(this.ordenesFile, "utf-8").split("\n").filter((l) => l.trim().length > 0);
      for (const line of lines) {
        try {
          const item: StoredSapOrder = JSON.parse(line);
          const n = parseInt(item.numero_oc, 10);
          if (!isNaN(n) && n > maxNum) {
            maxNum = n;
          }
        } catch {
          // ignorar
        }
      }
    }

    const nuevoNumero = (maxNum + 1).toString();
    const fechaActual = new Date().toISOString();

    const record: StoredSapOrder = {
      numero_oc: nuevoNumero,
      fecha: fechaActual,
      orden
    };

    fs.appendFileSync(this.ordenesFile, JSON.stringify(record) + "\n", "utf-8");

    const isRetro = orden.excepciones.some((e) => e.codigo === "RC8");
    this.registrarControl(
      solicitudId,
      "CREADA",
      nuevoNumero,
      isRetro,
      "",
      orden.excepciones.map((e) => e.codigo).join(";")
    );

    return {
      numero_oc: nuevoNumero,
      fecha: fechaActual,
      idempotente: false
    };
  }

  public registrarControl(
    solicitud_id: string,
    resultado: "CREADA" | "BLOQUEADA" | "IDEMPOTENTE" | "PENDIENTE_CONFIRMACION",
    numero_oc: string = "",
    retroactiva: boolean = false,
    bloqueos: string = "",
    confirmaciones: string = ""
  ): void {
    this.ensureDirs();
    const ts = new Date().toISOString();
    const line = `"${solicitud_id}","${resultado}","${numero_oc}",${retroactiva},"${bloqueos}","${confirmaciones}","${ts}"\n`;
    fs.appendFileSync(this.controlFile, line, "utf-8");
  }
}

