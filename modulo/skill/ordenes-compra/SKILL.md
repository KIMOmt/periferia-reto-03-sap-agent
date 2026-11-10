---
name: "ordenes-compra"
description: "Conocimiento del proceso de compras, reglas de negocio y validación de órdenes de compra SAP para Periferia IT Group"
---

# Base de Conocimiento: Proceso de Órdenes de Compra SAP

Este documento describe las reglas de negocio, catálogos maestros y políticas de validación para la preparación y creación de órdenes de compra en SAP dentro de Periferia IT Group.

---

## 1. Flujo del Proceso

1. **Recepción del paquete**: Cada compra ingresa con tres componentes fundamentales:
   - Formulario de solicitud (`solicitud.json`).
   - Cotización del proveedor (`cotizacion.txt`).
   - Correo de aprobación del líder facultado (`aprobacion.json`).
   - Factura previa (`factura.txt`, solo si el servicio o bien fue entregado antes de solicitar la OC).
2. **Validación contra Maestros**: Verificación sistemática contra los catálogos corporativos:
   - Proveedores registrados y vigentes.
   - Centros de costo, subáreas y topes de autorización de los aprobadores.
   - Indicadores de IVA y condiciones de pago.
3. **Construcción del Payload**: Estructuración técnica de la orden de compra en formato SAP.
4. **Evidencia Documental**: Generación del archivo inmutable de aprobación con hash SHA-256.
5. **Creación e Idempotencia**: Asignación de consecutivo secuencial (`4500000001+`) y registro de auditoría en `out/control.csv`.

---

## 2. Matriz de Reglas de Control (RC1 a RC10)

### Reglas de Bloqueo (Impiden la creación de la OC):
- **RC1**: El proveedor debe existir en el maestro de proveedores (por NIT; si falta el NIT, por coincidencia exacta insensible a mayúsculas del nombre normalizado) y debe tener el atributo `activo: true`.
- **RC2**: La aprobación debe existir, contener explícitamente la palabra "Aprobado" (case-insensitive) y el correo del remitente debe coincidir con un aprobador registrado para el centro de costos de la solicitud.
- **RC3**: El valor total de la solicitud (`solicitud.valor_total`) debe ser menor o igual al `tope` de autorización configurado para ese aprobador en ese centro de costo.
- **RC4**: La subárea indicada en la solicitud debe pertenecer a la lista de subáreas autorizadas para el centro de costo.
- **RC10**: La multiplicación de `cantidad × valor_unitario` debe coincidir con `valor_total` con una tolerancia máxima de $\pm 1$ unidad monetaria para tolerar redondeos.

### Reglas de Confirmación (Exigen confirmación humana explícita antes de crear la OC):
- **RC5**: El desvío entre el monto de la cotización y el monto de la solicitud no debe superar el 2%:
  $$\frac{|\text{cotizacion.total} - \text{solicitud.valor\_total}|}{\text{solicitud.valor\_total}} \le 0.02$$
  Si no se adjuntó cotización o el desvío supera el 2%, el agente debe pausar y pedir confirmación informando ambos valores.
- **RC8**: Si se detecta una factura adjunta con fecha anterior a la fecha de la solicitud (`factura.fecha < solicitud.fecha_solicitud`), se clasifica como compra retroactiva (`retroactiva = true`). El agente debe requerir confirmación y registrar el desvío en el log de auditoría.
- **RC9**: La fecha del correo de aprobación debe ser igual o posterior a la fecha de la solicitud (`aprobacion.fecha >= solicitud.fecha_solicitud`). Si es anterior, se pide confirmación.

### Reglas de Derivación (Completitud automática desde maestros):
- **RC6**: Si la solicitud no especifica el `indicador_iva`, se deriva automáticamente el `indicador_iva_default` configurado en el maestro del proveedor y se solicita confirmación al usuario.
- **RC7**: Si la solicitud no especifica `condiciones_pago`, se deriva automáticamente el `condiciones_pago_default` del proveedor. Se informa al usuario sin bloquear la orden.

---

## 3. Catálogos Maestros de Referencia

### Proveedores
- `100234` | NIT: `900555111` | TecnoSuministros S.A.S. | Pago: `Z030` | IVA: `C1` | Activo: `true`
- `100310` | NIT: `901222333` | Cloud Andina S.A.S. | Pago: `Z000` | IVA: `C1` | Activo: `true`
- `100118` | NIT: `800444555` | Papelería Central Ltda. | Pago: `Z015` | IVA: `C1` | Activo: `true`
- `100150` | NIT: `830111222` | Mobiliario Andino S.A. | Pago: `Z030` | IVA: `C1` | Activo: `true`
- `100402` | NIT: `901777888` | Consultores Ágiles S.A.S. | Pago: `Z030` | IVA: `C1` | Activo: `false` (INACTIVO)

### Centros de Costo
- **CC-1010 (Tecnología)**:
  - Subáreas: `Infraestructura`, `Soporte`, `Desarrollo`
  - Aprobadores:
    - Mariana López Cárdenas (`mlopez@periferia-ficticia.com`) - Tope: COP 50.000.000
    - Diego García Rincón (`dgarcia@periferia-ficticia.com`) - Tope: COP 200.000.000
- **CC-2020 (Administración)**:
  - Subáreas: `Compras`, `Servicios Generales`
  - Aprobador:
    - Rocío Torres Ibáñez (`rtorres@periferia-ficticia.com`) - Tope: COP 30.000.000
- **CC-3030 (Comercial)**:
  - Subáreas: `Preventa`, `Marketing`
  - Aprobador:
    - Felipe Vargas Ocampo (`fvargas@periferia-ficticia.com`) - Tope: COP 80.000.000

### Códigos SAP Estándar
- Sociedad: `1000`
- Organización de Compras: `1000`
- Unidades de Medida admitidas: `UN`, `H`, `MES`
- Límite de texto breve en posición: **40 caracteres máximo**.

