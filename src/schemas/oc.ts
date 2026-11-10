import { z } from "zod";

export const SolicitudSchema = z.object({
  solicitud_id: z.string().describe("Identificador de la solicitud, ej. SOL-2026-001"),
  solicitante: z.string().describe("Nombre de quien solicita"),
  proveedor_nombre: z.string().describe("Nombre o razón social del proveedor"),
  proveedor_nit: z.string().optional().describe("NIT del proveedor si fue suministrado"),
  descripcion: z.string().describe("Descripción de la compra"),
  centro_costo: z.string().describe("Centro de costos, ej. CC-1010"),
  subarea: z.string().describe("Subárea asignada"),
  cantidad: z.number().positive().describe("Cantidad requerida"),
  valor_unitario: z.number().nonnegative().describe("Valor unitario"),
  valor_total: z.number().positive().describe("Valor total calculado"),
  moneda: z.enum(["COP", "USD"]).describe("Moneda de la solicitud"),
  indicador_iva: z.string().optional().describe("Indicador de IVA (ej. C1)"),
  condiciones_pago: z.string().optional().describe("Condiciones de pago (ej. Z030)"),
  fecha_solicitud: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Fecha en formato YYYY-MM-DD")
});

export const CotizacionSchema = z.object({
  proveedor: z.string(),
  nit: z.string().nullable(),
  total: z.number(),
  moneda: z.string(),
  validez_hasta: z.string().nullable(),
  texto: z.string(),
  codigo: z.string().nullable().optional()
});

export const AprobacionSchema = z.object({
  de: z.string().email(),
  fecha: z.string(),
  aprobado: z.boolean(),
  texto: z.string()
});

export const FacturaSchema = z.object({
  numero: z.string(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  total: z.number()
});

export const CorreoSchema = z.object({
  id: z.string(),
  de: z.string(),
  asunto: z.string(),
  fecha: z.string()
});

export const PaqueteSchema = z.object({
  correo: CorreoSchema,
  solicitud: SolicitudSchema,
  cotizacion: CotizacionSchema.nullable(),
  aprobacion: AprobacionSchema.nullable(),
  factura: FacturaSchema.nullable()
});

export const PosicionOrdenCompraSchema = z.object({
  numero: z.number().int().positive().describe("Número de posición: 10, 20, 30..."),
  descripcion: z.string().max(40, "La descripción breve no debe superar los 40 caracteres (límite SAP)"),
  cantidad: z.number().positive(),
  unidad: z.enum(["UN", "H", "MES"]),
  precio_unitario: z.number().nonnegative(),
  centro_costo: z.string(),
  subarea: z.string(),
  indicador_iva: z.string().describe("Código SAP, ej. C1")
});

export const ExcepcionOrdenCompraSchema = z.object({
  codigo: z.string().describe("Código de la excepción o regla, ej. RC5, RC8"),
  detalle: z.string().describe("Detalle explicativo"),
  confirmado_por: z.string().nullable().describe("Usuario que autorizó la excepción")
});

export const OrdenCompraSchema = z.object({
  referencia: z.object({
    solicitud_id: z.string(),
    correo_id: z.string(),
    cotizacion_ref: z.string().nullable()
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({
    codigo_sap: z.string(),
    nit: z.string(),
    nombre: z.string()
  }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string().describe("Código SAP de condiciones de pago, ej. Z030"),
  aprobador: z.object({
    email: z.string().email(),
    fecha_aprobacion: z.string(),
    evidencia_sha256: z.string()
  }),
  posiciones: z.array(PosicionOrdenCompraSchema).min(1),
  excepciones: z.array(ExcepcionOrdenCompraSchema)
});

export const ResultadoValidacionSchema = z.object({
  apta: z.boolean(),
  bloqueos: z.array(z.string()),
  confirmaciones: z.array(z.string()),
  derivados: z.record(z.unknown()),
  retroactiva: z.boolean()
});

