export type Moneda = "COP" | "USD";

export interface Solicitud {
  solicitud_id: string;
  solicitante: string;
  proveedor_nombre: string;
  proveedor_nit?: string;
  descripcion: string;
  centro_costo: string;
  subarea: string;
  cantidad: number;
  valor_unitario: number;
  valor_total: number;
  moneda: Moneda;
  indicador_iva?: string;
  condiciones_pago?: string;
  fecha_solicitud: string;
}

export interface Cotizacion {
  proveedor: string;
  nit: string | null;
  total: number;
  moneda: string;
  validez_hasta: string | null;
  texto: string;
  codigo?: string | null;
}

export interface Aprobacion {
  de: string;
  fecha: string;
  aprobado: boolean;
  texto: string;
}

export interface Factura {
  numero: string;
  fecha: string;
  total: number;
}

export interface Correo {
  id: string;
  de: string;
  asunto: string;
  fecha: string;
}

export interface Paquete {
  correo: Correo;
  solicitud: Solicitud;
  cotizacion: Cotizacion | null;
  aprobacion: Aprobacion | null;
  factura: Factura | null;
}

export interface PosicionOC {
  numero: number;
  descripcion: string;
  cantidad: number;
  unidad: "UN" | "H" | "MES";
  precio_unitario: number;
  centro_costo: string;
  subarea: string;
  indicador_iva: string;
}

export interface ExcepcionOC {
  codigo: string;
  detalle: string;
  confirmado_por: string | null;
}

export interface OrdenCompra {
  referencia: {
    solicitud_id: string;
    correo_id: string;
    cotizacion_ref: string | null;
  };
  sociedad: "1000";
  organizacion_compras: "1000";
  proveedor: {
    codigo_sap: string;
    nit: string;
    nombre: string;
  };
  moneda: Moneda;
  condiciones_pago: string;
  aprobador: {
    email: string;
    fecha_aprobacion: string;
    evidencia_sha256: string;
  };
  posiciones: PosicionOC[];
  excepciones: ExcepcionOC[];
}

export interface ResultadoValidacion {
  apta: boolean;
  bloqueos: string[];
  confirmaciones: string[];
  derivados: Record<string, unknown>;
  retroactiva: boolean;
}

export interface MaestroProveedor {
  codigo_sap: string;
  nit: string;
  nombre: string;
  condiciones_pago_default: string;
  indicador_iva_default: string;
  activo: boolean;
}

export interface AprobadorCentro {
  email: string;
  nombre: string;
  tope: number;
}

export interface MaestroCentroCosto {
  centro_costo: string;
  nombre: string;
  subareas: string[];
  aprobadores: AprobadorCentro[];
}

export interface MaestroIndicadorIVA {
  codigo: string;
  descripcion: string;
  tasa: number;
}

export interface MaestroCondicionPago {
  codigo: string;
  descripcion: string;
  dias: number;
}

export interface ToolExecutionContext {
  directory: string;
  sessionId: string;
}

export interface ToolResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

