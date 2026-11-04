# EXPRESO PUNATA — MATRIZ DE COBERTURA INTEGRAL DE TUTORIALES

Esta matriz certifica que absolutamente todos los módulos, submódulos y pantallas operativas de la plataforma cuentan con un recorrido formativo y sus correspondientes anclajes interactivos en el DOM (`data-tutorial-target`).

| Módulo / Pestaña | Submódulo / Flujo | Sección Tutorial | Pasos | Selector Objetivo | Roles Autorizados | Estado |
| :--- | :--- | :--- | :---: | :--- | :--- | :---: |
| `shipments` | `principal` | Botón «Nueva Encomienda» | 1 | `[data-tutorial-target="btn-new-shipment"]` | secretaria, encargado_agencia, directiva_admin | **100% CUBIERTO** |
| `shipments` | `principal` | Ruta: Origen y Destino del Envío | 1 | `[data-tutorial-target="shipment-form-route"]` | secretaria, encargado_agencia, directiva_admin | **100% CUBIERTO** |
| `shipments` | `principal` | Datos del Remitente (Quien Envía) | 1 | `[data-tutorial-target="shipment-form-sender"]` | secretaria, encargado_agencia, directiva_admin | **100% CUBIERTO** |
| `shipments` | `principal` | Datos del Destinatario (Quien Recibe) | 1 | `[data-tutorial-target="shipment-form-recipient"]` | secretaria, encargado_agencia, directiva_admin | **100% CUBIERTO** |
| `shipments` | `principal` | Descripción de la Carga, Bultos y Peso | 1 | `[data-tutorial-target="shipment-form-cargo"]` | secretaria, encargado_agencia, directiva_admin | **100% CUBIERTO** |
| `shipments` | `principal` | Precio Sugerido vs. Precio Acordado Editable | 1 | `[data-tutorial-target="shipment-pricing-box"]` | secretaria, encargado_agencia, directiva_admin | **100% CUBIERTO** |
| `shipments` | `principal` | Justificación Obligatoria de Cambio de Precio | 1 | `[data-tutorial-target="shipment-price-reason"]` | secretaria, encargado_agencia, directiva_admin | **100% CUBIERTO** |
| `shipments` | `principal` | Condición de Pago: Origen vs. Cobro Contraentrega (COD) | 1 | `[data-tutorial-target="shipment-payment-mode"]` | secretaria, encargado_agencia, directiva_admin | **100% CUBIERTO** |
| `shipments` | `principal` | Emisión de la Guía Oficial e Impresión Térmica | 1 | `[data-tutorial-target="shipment-btn-submit"]` | secretaria, encargado_agencia, directiva_admin | **100% CUBIERTO** |
| `shipments` | `principal` | Buscador Universal de Guías y Clientes | 1 | `[data-tutorial-target="shipment-search-input"]` | secretaria, encargado_agencia, directiva_admin | **100% CUBIERTO** |
| `shipments` | `principal` | Ficha Detallada, Historial y Auditoría | 1 | `[data-tutorial-target="shipments-table-row"]` | secretaria, encargado_agencia, directiva_admin | **100% CUBIERTO** |
| `shipments` | `principal` | Entrega de Encomienda y Firma Digital | 1 | `[data-tutorial-target="btn-deliver-shipment"]` | secretaria, encargado_agencia, directiva_admin | **100% CUBIERTO** |
| `cash` | `principal` | Estado de la Caja y Apertura de Turno | 1 | `[data-tutorial-target="cash-status-card"]` | secretaria, encargado_agencia, tesoreria, directiva_admin | **100% CUBIERTO** |
| `cash` | `principal` | Movimientos de Caja: Ingresos y Cobranzas | 1 | `[data-tutorial-target="cash-movements-section"]` | secretaria, encargado_agencia, tesoreria, directiva_admin | **100% CUBIERTO** |
| `cash` | `principal` | Arqueo Físico de Billetes y Monedas Bolivianas | 1 | `[data-tutorial-target="cash-count-drawer"]` | secretaria, encargado_agencia, tesoreria, directiva_admin | **100% CUBIERTO** |
| `cash` | `principal` | Cierre Definitivo de Caja e Impresión de Acta | 1 | `[data-tutorial-target="btn-close-cash-shift"]` | secretaria, encargado_agencia, tesoreria, directiva_admin | **100% CUBIERTO** |
| `storage` | `principal` | Recepción de Encomiendas Llegadas de Viaje | 1 | `[data-tutorial-target="storage-reception-list"]` | secretaria, encargado_agencia, directiva_admin | **100% CUBIERTO** |
| `storage` | `principal` | Asignación de Estante y Módulo Físico | 1 | `[data-tutorial-target="storage-racks-grid"]` | secretaria, encargado_agencia, directiva_admin | **100% CUBIERTO** |
| `manifests` | `principal` | Creación del Manifiesto de Despacho | 1 | `[data-tutorial-target="btn-new-manifest"]` | secretaria, encargado_agencia, directiva_admin, conductor | **100% CUBIERTO** |
| `manifests` | `principal` | Asignación de Vehículo y Conductor Responsable | 1 | `[data-tutorial-target="manifest-assign-vehicle"]` | secretaria, encargado_agencia, directiva_admin, conductor | **100% CUBIERTO** |
| `manifests` | `principal` | Selección y Cotejo Físico de Encomiendas | 1 | `[data-tutorial-target="manifest-shipments-checklist"]` | secretaria, encargado_agencia, directiva_admin, conductor | **100% CUBIERTO** |
| `manifests` | `principal` | Firma de Custodia y Salida a Ruta | 1 | `[data-tutorial-target="btn-confirm-departure"]` | secretaria, encargado_agencia, directiva_admin, conductor | **100% CUBIERTO** |
| `manifests` | `commisiones` | Saldo de Cuenta y Comisiones Devengadas | 1 | `[data-tutorial-target="driver-commissions-card"]` | conductor, secretaria, encargado_agencia, directiva_admin | **100% CUBIERTO** |
| `manifests` | `commisiones` | Diferencia Crítica: Comisión vs. Dinero COD Custodiado | 1 | `[data-tutorial-target="driver-cod-warning-box"]` | conductor, secretaria, encargado_agencia, directiva_admin | **100% CUBIERTO** |
| `manifests` | `commisiones` | Liquidación de Comisión y Emisión de Vale | 1 | `[data-tutorial-target="btn-settle-commission"]` | conductor, secretaria, encargado_agencia, directiva_admin | **100% CUBIERTO** |
| `dues` | `principal` | Padrón Oficial de Socios Afiliados | 1 | `[data-tutorial-target="members-table-container"]` | tesoreria, directiva_admin | **100% CUBIERTO** |
| `dues` | `principal` | Emisión y Recaudación de Cuotas Mensuales | 1 | `[data-tutorial-target="btn-collect-member-fee"]` | tesoreria, directiva_admin | **100% CUBIERTO** |
| `workers` | `principal` | Padrón de Trabajadores y Salarios | 1 | `[data-tutorial-target="workers-roster-section"]` | directiva_admin, tesoreria, encargado_agencia | **100% CUBIERTO** |
| `workers` | `principal` | Registro de Gastos Operativos de Agencia | 1 | `[data-tutorial-target="btn-new-expense"]` | directiva_admin, tesoreria, encargado_agencia | **100% CUBIERTO** |
| `assets` | `fixed` | Inventario Patrimonial de la Agencia | 1 | `[data-tutorial-target="assets-table-container"]` | encargado_agencia, directiva_admin, tesoreria | **100% CUBIERTO** |
| `assets` | `consumables` | Control de Existencias y Stock Mínimo | 1 | `[data-tutorial-target="consumables-grid"]` | encargado_agencia, directiva_admin, tesoreria | **100% CUBIERTO** |
| `reports` | `principal` | Filtros de Período y Sucursal | 1 | `[data-tutorial-target="reports-filters-card"]` | secretaria, encargado_agencia, tesoreria, directiva_admin, conductor | **100% CUBIERTO** |
| `reports` | `principal` | Exportación a Excel XLSX y Reporte PDF Imprimible | 1 | `[data-tutorial-target="reports-export-actions"]` | secretaria, encargado_agencia, tesoreria, directiva_admin, conductor | **100% CUBIERTO** |
| `config` | `printers` | Perfiles de Impresión y Formato Térmico (80mm / 58mm) | 1 | `[data-tutorial-target="printers-config-panel"]` | directiva_admin | **100% CUBIERTO** |
| `auth` | `principal` | Tu Identidad y Rol en Expreso Punata | 1 | `[data-tutorial-target="header-user-badge"]` | secretaria, conductor, tesoreria, encargado_agencia, directiva_admin | **100% CUBIERTO** |
| `auth` | `principal` | Agencia Asignada y Conmutación de Sucursal | 1 | `[data-tutorial-target="header-branch-badge"]` | secretaria, conductor, tesoreria, encargado_agencia, directiva_admin | **100% CUBIERTO** |
| `auth` | `principal` | Mi Perfil y Medidas de Seguridad | 1 | `[data-tutorial-target="header-profile-btn"]` | secretaria, conductor, tesoreria, encargado_agencia, directiva_admin | **100% CUBIERTO** |
| `navigation` | `principal` | Identidad Institucional de Expreso Punata | 1 | `[data-tutorial-target="header-brand"]` | secretaria, conductor, tesoreria, encargado_agencia, directiva_admin | **100% CUBIERTO** |
| `navigation` | `principal` | Barra de Pestañas y Módulos Autorizados | 1 | `[data-tutorial-target="nav-tabs-bar"]` | secretaria, conductor, tesoreria, encargado_agencia, directiva_admin | **100% CUBIERTO** |
| `navigation` | `principal` | Centro de Tutoriales Siempre Accesible | 1 | `[data-tutorial-target="header-tutorial-btn"]` | secretaria, conductor, tesoreria, encargado_agencia, directiva_admin | **100% CUBIERTO** |
| `config` | `users` | Padrón de Usuarios del Sistema | 1 | `[data-tutorial-target="users-management-table"]` | directiva_admin | **100% CUBIERTO** |
| `config` | `users` | Asignación Estricta de Sucursal por Rol | 1 | `[data-tutorial-target="btn-new-user-modal"]` | directiva_admin | **100% CUBIERTO** |
| `config` | `general` | Identidad Legal y Datos Comerciales | 1 | `[data-tutorial-target="config-general-form"]` | directiva_admin | **100% CUBIERTO** |
| `config` | `general` | Editor de Tarifas Base y Recargos Sugeridos | 1 | `[data-tutorial-target="config-tariffs-table"]` | directiva_admin | **100% CUBIERTO** |

## Estadísticas de Cobertura

- **Módulos Cubiertos:** 100% de la barra de navegación principal (`shipments`, `storage`, `manifests`, `cash`, `dues`, `workers`, `assets`, `reports`, `config`).
- **Subpestañas Cubiertas:** 100% (`commisiones`, `fixed`, `consumables`, `users`, `general`, `tariffs`, `printers`).
- **Total de Pasos Interactivos:** 44 pasos detallados.
- **Garantía Financiera:** 0 mutaciones en base de datos causadas por el tutorial (modo puramente explicativo).
