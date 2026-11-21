import type { TutorialSection } from './types'

export const TUTORIAL_SECTIONS: TutorialSection[] = [
  {
    "id": "shipments_window",
    "moduleId": "shipments",
    "title": "1. Ventanilla de Encomiendas: Registro y Formulario 50/50",
    "shortTitle": "Nueva Encomienda",
    "description": "Aprende a emitir encomiendas, registrar remitente y destinatario con datos bolivianos y detallar la carga.",
    "estimatedMinutes": 5,
    "allowedRoles": [
      "secretaria",
      "encargado_agencia",
      "directiva_admin"
    ],
    "steps": [
      {
        "id": "shipments_btn_new",
        "sectionId": "shipments_window",
        "order": 1,
        "target": "[data-tutorial-target=\"btn-new-shipment\"]",
        "fallbackTarget": "main",
        "placement": "bottom",
        "title": "Botón «Nueva Encomienda»",
        "whatIsIt": "Es el botón principal de ventanilla que inicia el registro de un nuevo paquete o envío interprovincial.",
        "whatIsItFor": "Abre el asistente de registro dividido en dos columnas: datos del cliente a la izquierda y cotización/pago a la derecha.",
        "whatToWriteOrSelect": "Haz clic en \"Nueva Encomienda\" cada vez que un cliente se acerque a ventanilla a despachar carga.",
        "example": "Un cliente en Punata desea enviar 2 cajas de repuestos para camión a la ciudad de Cochabamba.",
        "whatHappensAfter": "Se abre el formulario completo con la sucursal de origen preseleccionada según tu agencia.",
        "importantTip": "Antes de abrir el formulario, confirma con el cliente si el paquete ya está debidamente embalado y rotulado.",
        "audioScript": "Para comenzar la atención en ventanilla, pulsa el botón Nueva Encomienda. Esto abrirá el formulario de recepción de carga.",
        "requiredContext": {
          "tab": "shipments"
        }
      },
      {
        "id": "shipments_branch_route",
        "sectionId": "shipments_window",
        "order": 2,
        "target": "[data-tutorial-target=\"shipment-form-route\"]",
        "fallbackTarget": "[data-tutorial-target=\"btn-new-shipment\"]",
        "placement": "top",
        "title": "Ruta: Origen y Destino del Envío",
        "whatIsIt": "Los selectores de agencia de origen y agencia de destino, además de la modalidad de entrega.",
        "whatIsItFor": "Define el recorrido del paquete (Punata a Cochabamba o viceversa) y si el cliente recogerá en oficina o requiere entrega a domicilio.",
        "whatToWriteOrSelect": "Verifica que el origen sea tu agencia y selecciona el destino acordado con el remitente.",
        "example": "Origen: Agencia Central Punata (Calle Sucre). Destino: Agencia Cochabamba (Av. República). Modalidad: Retiro en Agencia.",
        "whatHappensAfter": "El trayecto queda registrado. El personal ingresa manualmente el precio acordado con el cliente.",
        "importantTip": "Asegúrate de confirmar la sucursal de destino; si el cliente se equivoca de agencia, el paquete demorará más en ser retirado.",
        "audioScript": "En la sección de ruta, verifica que la agencia de origen coincida con tu oficina y define la agencia donde se entregará el paquete.",
        "requiredContext": {
          "tab": "shipments", "openModal": "shipment-new", "wizardStep": 1,
        }
      },
      {
        "id": "shipments_client_sender",
        "sectionId": "shipments_window",
        "order": 3,
        "target": "[data-tutorial-target=\"shipment-form-sender\"]",
        "fallbackTarget": "[data-tutorial-target=\"btn-new-shipment\"]",
        "placement": "right",
        "title": "Datos del Remitente (Quien Envía)",
        "whatIsIt": "Los campos donde registras el nombre completo, el documento de identidad (CI) y el número de celular del remitente.",
        "whatIsItFor": "Permite identificar legalmente al propietario original de la carga y contactarlo si ocurre alguna contingencia en ruta.",
        "whatToWriteOrSelect": "Solicita el carnet de identidad del remitente. Escribe su nombre completo, CI y su celular activo con WhatsApp.",
        "example": "Nombre: Carlos Montaño Rojas. CI: 5241890 CB. Celular: 71458923.",
        "whatHappensAfter": "Los datos quedan impresos en la guía oficial y guardados en el historial de clientes frecuentes.",
        "importantTip": "El número de celular es vital para enviar notificaciones de estado y confirmar devoluciones en caso de rezago.",
        "audioScript": "Pide siempre el documento de identidad al remitente y anota su número de celular para que podamos mantenerlo informado.",
        "requiredContext": {
          "tab": "shipments", "openModal": "shipment-new", "wizardStep": 2,
        }
      },
      {
        "id": "shipments_client_recipient",
        "sectionId": "shipments_window",
        "order": 4,
        "target": "[data-tutorial-target=\"shipment-form-recipient\"]",
        "fallbackTarget": "[data-tutorial-target=\"btn-new-shipment\"]",
        "placement": "right",
        "title": "Datos del Destinatario (Quien Recibe)",
        "whatIsIt": "Campos para registrar el nombre, cédula de identidad y teléfono de la persona autorizada a retirar el envío.",
        "whatIsItFor": "Garantiza la entrega segura de la encomienda impidiendo que personas no autorizadas retiren mercadería ajena.",
        "whatToWriteOrSelect": "Escribe con exactitud el nombre tal como figura en su carnet, su CI y su celular de contacto.",
        "example": "Nombre: María Elena Torrico. CI: 4892310 CB. Celular: 72789456.",
        "whatHappensAfter": "La agencia de destino exigirá la presentación de este carnet al momento de entregar el paquete.",
        "importantTip": "Si el remitente indica que otra persona podría recoger, anota los nombres autorizados en las observaciones.",
        "audioScript": "Registra los datos exactos del destinatario. En destino se verificará esta información antes de entregar la carga.",
        "requiredContext": {
          "tab": "shipments", "openModal": "shipment-new", "wizardStep": 2,
        }
      },
      {
        "id": "shipments_cargo_details",
        "sectionId": "shipments_window",
        "order": 5,
        "target": "[data-tutorial-target=\"shipment-form-cargo\"]",
        "fallbackTarget": "[data-tutorial-target=\"btn-new-shipment\"]",
        "placement": "left",
        "title": "Descripción de la Carga, Bultos y Peso",
        "whatIsIt": "Los campos para detallar qué contiene la encomienda, cuántos bultos son y el peso aproximado en kilogramos.",
        "whatIsItFor": "Permite el control físico en almacén, evita reclamos por contenido y ayuda a balancear la carga del vehículo interprovincial.",
        "whatToWriteOrSelect": "Describe con claridad el contenido (ej. \"Ropa\", \"Documentos\", \"Repuestos\"). Indica el número exacto de paquetes y su peso.",
        "example": "Descripción: \"Caja de cartón con repuestos de motor para Punata\". Bultos: 2. Peso: 15 kg.",
        "whatHappensAfter": "La descripción, los bultos y el peso quedan registrados para el control operativo.",
        "importantTip": "Está prohibido recibir sustancias peligrosas, inflamables o artículos ilegales. Pregunta siempre qué contiene el paquete.",
        "audioScript": "Detalla el tipo de mercadería, el número de bultos y el peso aproximado. Esto garantiza un control estricto durante el viaje.",
        "requiredContext": {
          "tab": "shipments", "openModal": "shipment-new", "wizardStep": 3,
        }
      }
    ],
    "category": "operational",
    "isOptional": false
  },
  {
    "id": "shipments_pricing",
    "moduleId": "shipments",
    "title": "2. Precio Manual y Cobro",
    "shortTitle": "Precio y Cobro",
    "description": "Registra el importe acordado manualmente y elige entre pagar en origen o dejar el envío por pagar en destino.",
    "estimatedMinutes": 4,
    "allowedRoles": [
      "secretaria",
      "encargado_agencia",
      "directiva_admin"
    ],
    "steps": [
      {
        "id": "pricing_suggested_vs_agreed",
        "sectionId": "shipments_pricing",
        "order": 1,
        "target": "[data-tutorial-target=\"shipment-pricing-box\"]",
        "fallbackTarget": "[data-tutorial-target=\"btn-new-shipment\"]",
        "placement": "left",
        "title": "Precio ingresado manualmente",
        "whatIsIt": "El importe que el personal registra según el acuerdo realizado con el cliente.",
        "whatIsItFor": "Otorga flexibilidad comercial para cargas voluminosas, clientes frecuentes o bultos livianos que ocupan espacio.",
        "whatToWriteOrSelect": "Escribe el importe exacto acordado en bolivianos. El sistema no propone ni completa una tarifa.",
        "example": "El personal acuerda Bs 20 con el cliente y escribe 20.00 en el campo Precio del Envío.",
        "whatHappensAfter": "El monto manual se usa para la guía, el cobro y los reportes financieros.",
        "importantTip": "El precio acordado debe ser siempre un número entero o con centavos exactos en bolivianos. Nunca dejes el campo vacío.",
        "audioScript": "Escribe el precio que acordaste con el cliente. El importe ingresado se conserva en la guía y en los cobros.",
        "requiredContext": {
          "tab": "shipments", "openModal": "shipment-new", "wizardStep": 4
        }
      },
      {
        "id": "pricing_adjustment_reason",
        "sectionId": "shipments_pricing",
        "order": 2,
        "target": "[data-tutorial-target=\"shipment-price-reason\"]",
        "fallbackTarget": "[data-tutorial-target=\"btn-new-shipment\"]",
        "placement": "top",
        "title": "Motivo de cortesía o exoneración",
        "whatIsIt": "El motivo obligatorio cuando una encomienda se registra con importe Bs 0.00.",
        "whatIsItFor": "Deja constancia auditable de la cortesía o exoneración autorizada.",
        "whatToWriteOrSelect": "Si el importe es cero, escribe un motivo claro. Para otros importes este campo no es necesario.",
        "example": "Cortesía autorizada en acta de Directiva de Expreso Punata.",
        "whatHappensAfter": "El motivo queda guardado con la encomienda para su consulta posterior.",
        "importantTip": "No uses explicaciones genéricas como \"acuerdo\". Especifica el motivo real para evitar observaciones en auditoría.",
        "audioScript": "Si la encomienda no tiene costo, registra el motivo de la cortesía o exoneración.",
        "requiredContext": {
          "tab": "shipments", "openModal": "shipment-new", "wizardStep": 4
        }
      },
      {
        "id": "pricing_payment_mode",
        "sectionId": "shipments_pricing",
        "order": 3,
        "target": "[data-tutorial-target=\"shipment-payment-mode\"]",
        "fallbackTarget": "[data-tutorial-target=\"btn-new-shipment\"]",
        "placement": "top",
        "title": "Condición de pago — Pagado en origen o Por pagar",
        "whatIsIt": "La selección de cuándo se cobrará el flete: \"Pagado en Origen\" (el remitente paga ahora) o \"Por pagar\" (el destinatario paga al retirar).",
        "whatIsItFor": "Determina si el dinero ingresa a la caja de tu sucursal en este momento o si quedará como cuenta por cobrar en la agencia de destino.",
        "whatToWriteOrSelect": "Selecciona \"Pagado en Origen\" si el cliente te entrega el dinero en ventanilla. Selecciona \"Por pagar\" si pagará quien recibe.",
        "example": "Si don Carlos paga los Bs 20 en la agencia Punata, marcas \"Pagado en Origen\". Si su hija pagará en Cochabamba, marcas \"Por pagar\".",
        "whatHappensAfter": "Si es Pagado, se emite un comprobante de cobro para tu caja. Si es Por pagar, la guía viaja con saldo pendiente de pago.",
        "importantTip": "Confirma con el cliente si pagará en efectivo o mediante QR Simple antes de finalizar el registro.",
        "audioScript": "Elige si la encomienda queda pagada en este momento o si será cobrada al destinatario cuando la retire en la agencia de destino.",
        "requiredContext": {
          "tab": "shipments", "openModal": "shipment-new", "wizardStep": 4
        }
      },
      {
        "id": "pricing_submit_print",
        "sectionId": "shipments_pricing",
        "order": 4,
        "target": "[data-tutorial-target=\"shipment-btn-submit\"]",
        "fallbackTarget": "[data-tutorial-target=\"btn-new-shipment\"]",
        "placement": "top",
        "title": "Emisión de la Guía Oficial e Impresión Térmica",
        "whatIsIt": "El botón final para confirmar el registro, generar el número correlativo alfanumérico e imprimir los comprobantes térmicos.",
        "whatIsItFor": "Cierra el registro en el sistema, asienta el movimiento en caja y genera el ticket para entregar al cliente y pegar en el bulto.",
        "whatToWriteOrSelect": "Revisa el resumen final en pantalla y pulsa \"Registrar Encomienda\". Luego selecciona imprimir ticket de 80mm.",
        "example": "El sistema genera la guía \"PNT-2026-0042\" en Punata. Se imprimen 2 tickets térmicos: copia remitente y etiqueta de paquete con código QR.",
        "whatHappensAfter": "La encomienda aparece en la lista con estado \"Recibida en Origen\", lista para ser despachada al camión.",
        "importantTip": "Pega siempre la etiqueta con cinta transparente sobre una superficie visible del paquete para agilizar su escaneo en ruta.",
        "audioScript": "Al hacer clic en Registrar Encomienda, se genera la guía oficial con su código único y podrás imprimir los comprobantes para el cliente.",
        "requiredContext": {
          "tab": "shipments", "openModal": "shipment-new", "wizardStep": 4
        }
      }
    ],
    "category": "operational",
    "isOptional": false
  },
  {
    "id": "shipments_lifecycle",
    "moduleId": "shipments",
    "title": "3. Seguimiento, Búsqueda, Edición Auditada y Entrega con Firma",
    "shortTitle": "Búsqueda y Entrega",
    "description": "Aprende a buscar encomiendas por guía o cliente, gestionar incidencias y efectuar la entrega formal con firma digital.",
    "estimatedMinutes": 4,
    "allowedRoles": [
      "secretaria",
      "encargado_agencia",
      "directiva_admin"
    ],
    "steps": [
      {
        "id": "lifecycle_search_filter",
        "sectionId": "shipments_lifecycle",
        "order": 1,
        "target": "[data-tutorial-target=\"shipment-search-input\"]",
        "fallbackTarget": "main",
        "placement": "bottom",
        "title": "Buscador Universal de Guías y Clientes",
        "whatIsIt": "Una barra de búsqueda inteligente ubicada sobre la tabla de encomiendas.",
        "whatIsItFor": "Permite localizar de forma instantánea cualquier envío escribiendo el código de guía, el carnet del cliente o su nombre.",
        "whatToWriteOrSelect": "Escribe el número de guía (ej. \"PNT-0042\") o el carnet del destinatario (ej. \"4892310\") y presiona Enter.",
        "example": "Una clienta llega a ventanilla diciendo que tiene un paquete a nombre de María Elena Torrico; escribes su CI y encuentras la guía en segundos.",
        "whatHappensAfter": "La tabla filtra los resultados en tiempo real mostrando el estado operativo actual y la ubicación del bulto.",
        "importantTip": "El buscador admite coincidencias parciales; no necesitas escribir los guiones ni las mayúsculas exactamente.",
        "audioScript": "Con el buscador universal puedes ubicar encomiendas rápidamente ingresando el código de la guía o el número de carnet del cliente.",
        "requiredContext": {
          "tab": "shipments"
        }
      },
      {
        "id": "lifecycle_view_detail",
        "sectionId": "shipments_lifecycle",
        "order": 2,
        "target": "[data-tutorial-target=\"shipments-table-row\"]",
        "fallbackTarget": "[data-tutorial-target=\"shipment-search-input\"]",
        "placement": "bottom",
        "title": "Ficha Detallada, Historial y Auditoría",
        "whatIsIt": "La vista completa de la encomienda con pestañas de Datos Generales, Historial de Estados, Edición Auditada e Incidencias.",
        "whatIsItFor": "Permite inspeccionar quién recibió la encomienda, qué chofer la transportó, si se pagó el flete y reimprimir el ticket térmico.",
        "whatToWriteOrSelect": "Haz clic en el botón \"Ver Detalle\" o sobre la fila de la encomienda deseada en la tabla.",
        "example": "Puedes revisar si el paquete ya llegó a Cochabamba o si continúa a bordo del Móvil 14 conducido por Grover Orellana.",
        "whatHappensAfter": "Se abre el panel lateral con la información cronológica completa desde la admisión hasta la custodia actual.",
        "importantTip": "Cualquier corrección permitida de datos (ej. corregir teléfono) quedará grabada con fecha y nombre del operador.",
        "audioScript": "Al abrir el detalle de una guía puedes consultar su trazabilidad completa, ver qué vehículo la transportó y reimprimir los tickets.",
        "requiredContext": {
          "tab": "shipments"
        }
      },
      {
        "id": "lifecycle_delivery_modal",
        "sectionId": "shipments_lifecycle",
        "order": 3,
        "target": "[data-tutorial-target=\"btn-deliver-shipment\"]",
        "fallbackTarget": "[data-tutorial-target=\"shipment-search-input\"]",
        "placement": "top",
        "title": "Entrega de Encomienda y Firma Digital",
        "whatIsIt": "El formulario de entrega final donde se verifica la identidad del receptor, se cobra el saldo pendiente y se registra la firma en pantalla.",
        "whatIsItFor": "Libera la custodia legal del paquete, asienta el ingreso del flete COD si estaba por cobrar y registra la conformidad del cliente.",
        "whatToWriteOrSelect": "Pide el carnet físico del destinatario. Ingresa su número de documento, verifica el pago y solicita que firme con el dedo o puntero en la pantalla.",
        "example": "María Elena presenta su CI 4892310, cancela los Bs 20 de saldo pendiente en efectivo y firma en el recuadro digital.",
        "whatHappensAfter": "La encomienda pasa a estado \"Entregada\", se emite el comprobante de entrega y el dinero ingresa a la caja del turno.",
        "importantTip": "Nunca entregues una encomienda sin verificar físicamente el documento de identidad original del destinatario.",
        "audioScript": "Para entregar un paquete, verifica el carnet del cliente, cobra los saldos pendientes si correspondía y solicita su firma digital de conformidad.",
        "requiredContext": {
          "tab": "shipments"
        }
      }
    ],
    "category": "operational",
    "isOptional": false
  },
  {
    "id": "cash_management",
    "moduleId": "cash",
    "title": "4. Caja del Turno, Cobros, Egresos y Arqueo Físico",
    "shortTitle": "Caja del Turno",
    "description": "Aprende a revisar movimientos, distinguir QR de efectivo y hacer el arqueo de tu turno.",
    "estimatedMinutes": 5,
    "allowedRoles": [
      "secretaria",
      "encargado_agencia",
      "tesoreria",
      "directiva_admin"
    ],
    "steps": [
      {
        "id": "cash_open_shift",
        "sectionId": "cash_management",
        "order": 1,
        "target": "[data-tutorial-target=\"cash-status-card\"]",
        "fallbackTarget": "main",
        "placement": "bottom",
        "title": "Estado de la Caja y Apertura de Turno",
        "whatIsIt": "La tarjeta principal que indica si la caja de la agencia se encuentra abierta o cerrada y el operador responsable del turno.",
        "whatIsItFor": "Garantiza que ningún cobro o pago se realice sin un turno formalmente abierto con su fondo inicial de cambio.",
        "whatToWriteOrSelect": "Al comenzar tu jornada, haz clic en \"Abrir Caja\". Ingresa el fondo de cambio en efectivo recibido (ej. Bs 200).",
        "example": "Inicias el turno matutino en Agencia Punata con Bs 150 en monedas y billetes chicos para dar vuelto.",
        "whatHappensAfter": "La caja queda en estado \"Abierta\" y habilita automáticamente los botones de cobro en ventanilla.",
        "importantTip": "Cuenta físicamente el dinero del fondo antes de registrar la apertura; no aceptes montos no verificados.",
        "audioScript": "Para comenzar a atender cobros en ventanilla, debes abrir el turno de caja indicando el fondo inicial de efectivo para dar cambio.",
        "requiredContext": {
          "tab": "cash"
        }
      },
      {
        "id": "cash_movements_table",
        "sectionId": "cash_management",
        "order": 2,
        "target": "[data-tutorial-target=\"cash-movements-section\"]",
        "fallbackTarget": "[data-tutorial-target=\"cash-status-card\"]",
        "placement": "top",
        "title": "Movimientos de Caja: Ingresos y Cobranzas",
        "whatIsIt": "El registro cronológico de todas las transacciones: cobros de encomiendas en origen, cobros contraentrega COD, aportes y egresos.",
        "whatIsItFor": "Permite revisar los ingresos por medio de pago. Un QR verificado queda identificado como QR y no aumenta el efectivo físico de la gaveta.",
        "whatToWriteOrSelect": "Para entregar al chofer el efectivo pendiente de pasajes QR, abre Pasajes, revisa el saldo y usa \"Entregar efectivo\" con la caja abierta. Antes de registrar otros movimientos, revisa su clasificación.",
        "example": "Ves una fila con \"Cobro Guía PNT-0042 — Bs 20.00 — Efectivo\" registrada a las 09:15 AM.",
        "whatHappensAfter": "El saldo teórico de la caja se actualiza en tiempo real sumando los ingresos y restando los egresos.",
        "importantTip": "El QR no es efectivo en la gaveta. La entrega al chofer sí descuenta efectivo de la caja abierta y queda auditada.",
        "audioScript": "En Caja revisa los movimientos por tipo de pago. El QR no aumenta el dinero físico. La entrega al chofer se inicia desde Pasajes con la caja abierta.",
        "requiredContext": {
          "tab": "cash"
        }
      },
      {
        "id": "cash_physical_count",
        "sectionId": "cash_management",
        "order": 3,
        "target": "[data-tutorial-target=\"cash-count-drawer\"]",
        "fallbackTarget": "[data-tutorial-target=\"cash-status-card\"]",
        "placement": "top",
        "title": "Arqueo Físico de Billetes y Monedas Bolivianas",
        "whatIsIt": "El desglose de monedas y billetes nacionales (Bs 200, 100, 50, 20, 10, monedas de 5, 2, 1 y centavos).",
        "whatIsItFor": "Permite ingresar la cantidad exacta de piezas contadas a mano para comparar el dinero real con el saldo del sistema.",
        "whatToWriteOrSelect": "Cuenta los billetes por corte y escribe la cantidad de piezas en cada casilla correspondiente.",
        "example": "Tienes 4 billetes de Bs 100 (= Bs 400), 5 billetes de Bs 50 (= Bs 250) y 20 monedas de Bs 5 (= Bs 100). Total contado: Bs 750.",
        "whatHappensAfter": "El sistema calcula automáticamente la diferencia: Sobrante, Faltante o Arqueo Cuadrado (Diferencia Bs 0.00).",
        "importantTip": "El arqueo debe cuadrar exactamente. Si existe una diferencia, revisa si quedó algún vale de egreso pendiente de registrar.",
        "audioScript": "Al finalizar el turno, desglosa el dinero físico contando tus billetes y monedas en el módulo de arqueo para cuadrar tu caja.",
        "requiredContext": {
          "tab": "cash"
        }
      },
      {
        "id": "cash_close_shift",
        "sectionId": "cash_management",
        "order": 4,
        "target": "[data-tutorial-target=\"btn-close-cash-shift\"]",
        "fallbackTarget": "[data-tutorial-target=\"cash-status-card\"]",
        "placement": "top",
        "title": "Cierre Definitivo de Caja e Impresión de Acta",
        "whatIsIt": "El botón final para clausurar el turno activo, consolidar los totales e imprimir el comprobante térmico de arqueo.",
        "whatIsItFor": "Entrega la responsabilidad del dinero a la tesorería o al siguiente turno con un respaldo firmado y sellado.",
        "whatToWriteOrSelect": "Verifica las cifras de arqueo, escribe observaciones si existió alguna novedad y pulsa \"Cerrar Turno de Caja\".",
        "example": "Cierras el turno con total ingresos de Bs 1,850. Se imprime el Acta de Cierre en formato térmico de 80mm.",
        "whatHappensAfter": "La caja queda cerrada, no se pueden registrar más movimientos y se emite el ticket con firmas de conformidad.",
        "importantTip": "Guarda el ticket impreso junto con el fajo de billetes en el sobre de remesa para su entrega a Tesorería.",
        "audioScript": "Una vez cuadrado el arqueo, haz clic en Cerrar Turno para generar el acta de cierre que respalda los fondos entregados.",
        "requiredContext": {
          "tab": "cash"
        }
      }
    ],
    "category": "operational",
    "isOptional": false
  },
  {
    "id": "storage_management",
    "moduleId": "storage",
    "title": "5. Módulos de Almacén: Estantes y Ubicación Física",
    "shortTitle": "Almacén y Estantes",
    "description": "Aprende a recepcionar carga que llega de viaje, ubicarla en estantes codificados y localizarla para entrega rápida.",
    "estimatedMinutes": 4,
    "allowedRoles": [
      "secretaria",
      "encargado_agencia",
      "directiva_admin"
    ],
    "steps": [
      {
        "id": "storage_reception_tab",
        "sectionId": "storage_management",
        "order": 1,
        "target": "[data-tutorial-target=\"storage-reception-list\"]",
        "fallbackTarget": "main",
        "placement": "bottom",
        "title": "Recepción de Encomiendas Llegadas de Viaje",
        "whatIsIt": "La lista de paquetes que acaban de llegar en un manifiesto interprovincial y esperan ser guardados en almacén.",
        "whatIsItFor": "Permite cotejar que los bultos descargados del minibús coincidan exactamente con lo que el chofer transportó.",
        "whatToWriteOrSelect": "Revisa la carga descargada y pulsa \"Recepcionar en Almacén\" para cada guía confirmada.",
        "example": "Llega el Móvil 14 a Cochabamba con 14 bultos. La encargada verifica cada caja y marca su ingreso al almacén local.",
        "whatHappensAfter": "La encomienda cambia su estado a \"Recibida en Destino (Almacén)\" y el sistema envía aviso de retiro al destinatario.",
        "importantTip": "Si falta algún bulto de la lista, regístralo inmediatamente como incidencia antes de liberar al conductor.",
        "audioScript": "Al llegar el vehículo a la sucursal, coteja los bultos descargados y marca su recepción en almacén para habilitar su retiro.",
        "requiredContext": {
          "tab": "storage"
        }
      },
      {
        "id": "storage_rack_assignment",
        "sectionId": "storage_management",
        "order": 2,
        "target": "[data-tutorial-target=\"storage-racks-grid\"]",
        "fallbackTarget": "[data-tutorial-target=\"storage-reception-list\"]",
        "placement": "top",
        "title": "Asignación de Estante y Módulo Físico",
        "whatIsIt": "El mapa interactivo de estanterías de la agencia (ej. Estante A - Nivel 2, Estante B - Paquetes Grandes).",
        "whatIsItFor": "Permite saber exactamente en qué rincón de la oficina se guardó cada caja para no perder tiempo buscándola.",
        "whatToWriteOrSelect": "Selecciona la encomienda y asígnale un estante disponible (ej. \"Estante A-3\"). Coloca físicamente el bulto en ese lugar.",
        "example": "En almacén Cochabamba, el sobre PNT-0042 se guarda en \"Estante A - Módulo 2\" para entrega inmediata.",
        "whatHappensAfter": "La ubicación queda registrada en la ficha de la encomienda y se muestra en la pantalla de entrega.",
        "importantTip": "Coloca siempre los paquetes más pesados en los niveles inferiores de las estanterías para evitar accidentes de trabajo.",
        "audioScript": "Asigna a cada bulto un estante y módulo físico. De este modo, cualquier secretaria sabrá de inmediato dónde encontrarlo.",
        "requiredContext": {
          "tab": "storage"
        }
      }
    ],
    "category": "operational",
    "isOptional": false
  },
  {
    "id": "dispatch_manifests",
    "moduleId": "manifests",
    "title": "6. Despachos, Manifiestos de Carga y Ruta Interprovincial",
    "shortTitle": "Despachos y Ruta",
    "description": "Aprende a agrupar encomiendas en un manifiesto oficial, asignar conductor y vehículo, registrar la salida y recibir la carga en destino.",
    "estimatedMinutes": 5,
    "allowedRoles": [
      "secretaria",
      "encargado_agencia",
      "directiva_admin",
      "conductor"
    ],
    "steps": [
      {
        "id": "dispatch_new_manifest",
        "sectionId": "dispatch_manifests",
        "order": 1,
        "target": "[data-tutorial-target=\"btn-new-manifest\"]",
        "fallbackTarget": "main",
        "placement": "bottom",
        "title": "Creación del Manifiesto de Despacho",
        "whatIsIt": "El documento oficial que ampara el transporte de un conjunto de encomiendas desde la agencia de origen hasta la de destino.",
        "whatIsItFor": "Garantiza la cadena de custodia durante el viaje por la carretera interprovincial Punata - Cochabamba.",
        "whatToWriteOrSelect": "Pulsa en \"Crear Manifiesto\". Selecciona la ruta de viaje (ej. Punata hacia Cochabamba).",
        "example": "Preparas el despacho del mediodía que saldrá a las 12:30 PM hacia la terminal de Cochabamba.",
        "whatHappensAfter": "El sistema lista todas las encomiendas que están actualmente en almacén esperando viajar en esa ruta.",
        "importantTip": "Nunca envíes carga en un vehículo sin generar su manifiesto de despacho; es el documento exigido en trancas y por la policía.",
        "audioScript": "Para enviar paquetes a la otra agencia, crea un Manifiesto de Despacho que consolida todas las encomiendas del viaje.",
        "requiredContext": {
          "tab": "manifests",
          "subTab": "manifests"
        }
      },
      {
        "id": "dispatch_assign_driver",
        "sectionId": "dispatch_manifests",
        "order": 2,
        "target": "[data-tutorial-target=\"manifest-assign-vehicle\"]",
        "fallbackTarget": "[data-tutorial-target=\"btn-new-manifest\"]",
        "placement": "top",
        "title": "Asignación de Vehículo y Conductor Responsable",
        "whatIsIt": "Los selectores donde se designa el número de móvil (ej. Móvil 14) y el chofer afiliado a cargo de la custodia.",
        "whatIsItFor": "Establece la responsabilidad legal y financiera sobre las encomiendas mientras se encuentren en tránsito.",
        "whatToWriteOrSelect": "Selecciona el vehículo que realizará el viaje y el nombre del chofer que conducirá.",
        "example": "Vehículo: \"Móvil 14 — Minibús Toyota Hiace\". Conductor: \"Grover Orellana\".",
        "whatHappensAfter": "El sistema vincula el manifiesto al perfil del conductor para que pueda consultarlo en su celular.",
        "importantTip": "Verifica que el conductor cuente con licencia de conducir vigente y SOAT activo antes de autorizar la salida.",
        "audioScript": "Selecciona el móvil y el conductor responsable. Desde este momento, la carga pasa a custodia del transportista asignado.",
        "requiredContext": {
          "tab": "manifests",
          "subTab": "manifests"
        }
      },
      {
        "id": "dispatch_select_shipments",
        "sectionId": "dispatch_manifests",
        "order": 3,
        "target": "[data-tutorial-target=\"manifest-shipments-checklist\"]",
        "fallbackTarget": "[data-tutorial-target=\"btn-new-manifest\"]",
        "placement": "top",
        "title": "Selección y Cotejo Físico de Encomiendas",
        "whatIsIt": "Una lista con casillas de verificación para marcar cada paquete que sube físicamente a la maletera o parrilla del vehículo.",
        "whatIsItFor": "Evita que queden paquetes olvidados en la oficina o que se carguen bultos dirigidos a otra sucursal.",
        "whatToWriteOrSelect": "Marca cada guía a medida que el chofer o cargador la sube al vehículo. Verifica el código y el destinatario.",
        "example": "En Punata seleccionas 8 encomiendas por un flete total de Bs 180 para el despacho en el Móvil 14.",
        "whatHappensAfter": "El sistema calcula el peso total del viaje y el flete devengado para comisiones.",
        "importantTip": "Si un bulto presenta roturas o humedad antes de subir, no lo despaches sin asentar la observación en el sistema.",
        "audioScript": "Marca cada paquete que se sube al vehículo verificando que la cantidad de bultos coincida exactamente con la guía.",
        "requiredContext": {
          "tab": "manifests",
          "subTab": "manifests"
        }
      },
      {
        "id": "dispatch_confirm_exit",
        "sectionId": "dispatch_manifests",
        "order": 4,
        "target": "[data-tutorial-target=\"btn-confirm-departure\"]",
        "fallbackTarget": "[data-tutorial-target=\"btn-new-manifest\"]",
        "placement": "top",
        "title": "Firma de Custodia y Salida a Ruta",
        "whatIsIt": "El botón que formaliza la salida del minibús, genera el manifiesto impreso y cambia el estado de los paquetes a \"En Tránsito\".",
        "whatIsItFor": "Transfiere formalmente la custodia desde la secretaria de origen hacia el conductor.",
        "whatToWriteOrSelect": "El conductor firma la conformidad en pantalla o recibe la copia física del manifiesto y se pulsa \"Confirmar Salida\".",
        "example": "Se imprime el Manifiesto oficial Punata - Cochabamba para entregar la custodia en ruta al chofer del Móvil 14.",
        "whatHappensAfter": "En la agencia de destino, los paquetes aparecen como \"En Camino\" para preparar espacio en sus estantes.",
        "importantTip": "El conductor debe portar una copia física o digital del manifiesto durante todo el trayecto interprovincial.",
        "audioScript": "Al confirmar la salida, las encomiendas pasan a estado En Tránsito y el conductor asume la custodia hasta llegar a destino.",
        "requiredContext": {
          "tab": "manifests",
          "subTab": "manifests"
        }
      }
    ],
    "category": "operational",
    "isOptional": false
  },
  {
    "id": "driver_commissions",
    "moduleId": "manifests",
    "subModuleId": "commisiones",
    "title": "7. Comisiones de Conductores y Rendición de Ruta",
    "shortTitle": "Comisiones Choferes",
    "description": "Aprende cómo se calculan las comisiones por fletes, la diferencia con el dinero COD custodiado y cómo liquidar saldos.",
    "estimatedMinutes": 4,
    "allowedRoles": [
      "conductor",
      "secretaria",
      "encargado_agencia",
      "directiva_admin"
    ],
    "steps": [
      {
        "id": "commissions_driver_balance",
        "sectionId": "driver_commissions",
        "order": 1,
        "target": "[data-tutorial-target=\"driver-commissions-card\"]",
        "fallbackTarget": "main",
        "placement": "bottom",
        "title": "Saldo de Cuenta y Comisiones Devengadas",
        "whatIsIt": "El panel que resume el total de fletes transportados por el chofer y la comisión ganada según la regla de la empresa.",
        "whatIsItFor": "Permite al conductor conocer con exactitud cuánto dinero ha ganado por transportar las encomiendas de sus viajes.",
        "whatToWriteOrSelect": "Selecciona al conductor en la lista para ver su estado de cuenta (ej. Grover Orellana).",
        "example": "El conductor transportó fletes por Bs 1,000 en la semana. Con la regla del 20%, acumula Bs 200 de comisión a su favor.",
        "whatHappensAfter": "El sistema muestra el desglose viaje por viaje de los fletes transportados y el saldo pendiente de liquidar.",
        "importantTip": "Las comisiones se generan sobre el valor del flete de transporte, no sobre el valor de la mercadería enviada.",
        "audioScript": "En el módulo de comisiones, el chofer puede consultar el saldo acumulado que la empresa le adeuda por concepto de fletes realizados.",
        "requiredContext": {
          "tab": "manifests",
          "subTab": "commisiones"
        }
      },
      {
        "id": "commissions_cod_difference",
        "sectionId": "driver_commissions",
        "order": 2,
        "target": "[data-tutorial-target=\"driver-cod-warning-box\"]",
        "fallbackTarget": "[data-tutorial-target=\"driver-commissions-card\"]",
        "placement": "top",
        "title": "Diferencia Crítica: Comisión vs. Dinero COD Custodiado",
        "whatIsIt": "Una distinción fundamental entre el dinero que pertenece al conductor (su comisión) y el dinero recaudado en ruta que pertenece a la empresa (cobros COD).",
        "whatIsItFor": "Evita confusiones financieras en las cuales un conductor retenga cobros de fletes pensando que son su ganancia.",
        "whatToWriteOrSelect": "Revisa siempre las dos columnas separadas: \"Comisión Ganada\" (ingreso para el chofer) vs \"Fondos COD por Rendir\" (dinero a entregar a caja).",
        "example": "Si un chofer cobra Bs 100 de un flete contraentrega en ruta, debe entregar los Bs 100 íntegros a caja. Su comisión de Bs 20 se liquidará aparte.",
        "whatHappensAfter": "Garantiza transparencia absoluta y evita descuadres en las cuentas de la empresa.",
        "importantTip": "El dinero de encomiendas por cobrar (COD) es sagrado; el conductor debe entregarlo en ventanilla al llegar a la agencia.",
        "audioScript": "Atención: la comisión es la ganancia del chofer, mientras que los cobros en ruta son dinero de la empresa que debe rendirse en caja.",
        "requiredContext": {
          "tab": "manifests",
          "subTab": "commisiones"
        }
      },
      {
        "id": "commissions_settlement_action",
        "sectionId": "driver_commissions",
        "order": 3,
        "target": "[data-tutorial-target=\"btn-settle-commission\"]",
        "fallbackTarget": "[data-tutorial-target=\"driver-commissions-card\"]",
        "placement": "top",
        "title": "Liquidación de Comisión y Emisión de Vale",
        "whatIsIt": "El botón que registra el pago de la comisión al conductor, salda su cuenta y emite el vale térmico de liquidación.",
        "whatIsItFor": "Formaliza el egreso de dinero de la empresa y entrega al conductor su comprobante de pago firmado.",
        "whatToWriteOrSelect": "Haz clic en \"Liquidar Comisión\". Ingresa el monto a pagar (puede ser total o parcial) y el método (efectivo de caja).",
        "example": "Se liquidan Bs 200 en efectivo a Grover Orellana. Se imprime el vale térmico con el detalle de las guías correspondientes.",
        "whatHappensAfter": "El saldo pendiente del chofer vuelve a Bs 0.00 y se genera automáticamente un egreso en la caja del turno.",
        "importantTip": "El chofer debe firmar la copia del vale de liquidación como constancia de haber recibido el dinero en efectivo.",
        "audioScript": "Al liquidar la comisión se genera un egreso formal en la caja y se imprime el vale térmico que el conductor debe firmar.",
        "requiredContext": {
          "tab": "manifests",
          "subTab": "commisiones"
        }
      }
    ],
    "category": "operational",
    "isOptional": false
  },
  {
    "id": "union_members",
    "moduleId": "dues",
    "title": "8. Socios y Mensualidades de Mantenimiento",
    "shortTitle": "Socios y Aportes",
    "description": "Aprende a administrar el padrón de socios afiliados, emitir cuotas mensuales de sostenimiento y recaudar aportes en caja.",
    "estimatedMinutes": 4,
    "allowedRoles": [
      "tesoreria",
      "directiva_admin"
    ],
    "steps": [
      {
        "id": "members_roster_table",
        "sectionId": "union_members",
        "order": 1,
        "target": "[data-tutorial-target=\"members-table-container\"]",
        "fallbackTarget": "main",
        "placement": "bottom",
        "title": "Padrón Oficial de Socios Afiliados",
        "whatIsIt": "El registro maestro de propietarios y transportistas asociados a Expreso Punata, con sus vehículos vinculados.",
        "whatIsItFor": "Permite mantener actualizado el padrón social, controlar la antigüedad, teléfonos de contacto y líneas asignadas.",
        "whatToWriteOrSelect": "Consulta la lista de socios o pulsa \"Nuevo Socio\" para afiliar a un transportista incorporado.",
        "example": "Socio: Grover Orellana Balderrama. Vehículo: Móvil 14 (Placa 3045-EPB). Estado: Afiliado Activo.",
        "whatHappensAfter": "El socio queda registrado y habilitado para prestar servicios de transporte y pagar sus cuotas.",
        "importantTip": "Mantén los teléfonos de los socios actualizados para comunicar asambleas y reuniones de la directiva.",
        "audioScript": "En el padrón de socios puedes gestionar los datos de cada transportista afiliado y conocer los vehículos que tiene vinculados.",
        "requiredContext": {
          "tab": "dues"
        }
      },
      {
        "id": "members_monthly_fee",
        "sectionId": "union_members",
        "order": 2,
        "target": "[data-tutorial-target=\"btn-collect-member-fee\"]",
        "fallbackTarget": "[data-tutorial-target=\"members-table-container\"]",
        "placement": "top",
        "title": "Emisión y Recaudación de Cuotas Mensuales",
        "whatIsIt": "El formulario para cobrar la cuota mensual de sostenimiento de la empresa de transporte.",
        "whatIsItFor": "Registra los aportes ordinarios de los socios destinados al mantenimiento de agencias, pago de servicios y administración.",
        "whatToWriteOrSelect": "Selecciona el socio, el mes correspondiente (ej. Noviembre 2026), el importe oficial (ej. Bs 100) y pulsa \"Registrar Aporte\".",
        "example": "Don Grover cancela Bs 100 correspondientes a la cuota mensual de Noviembre 2026 en efectivo.",
        "whatHappensAfter": "El aporte ingresa a la caja del turno con el concepto \"Aporte Socio - Móvil 14\" y se imprime el recibo térmico.",
        "importantTip": "No recibas dinero de cuotas sin emitir inmediatamente el comprobante oficial desde el sistema.",
        "audioScript": "Para cobrar una mensualidad, elige el socio y el período. El dinero ingresará formalmente a la caja y emitirá el comprobante térmico.",
        "requiredContext": {
          "tab": "dues"
        }
      }
    ],
    "category": "operational",
    "isOptional": false
  },
  {
    "id": "workers_expenses",
    "moduleId": "workers",
    "title": "9. Personal de Agencia y Gastos Operativos",
    "shortTitle": "Personal y Gastos",
    "description": "Aprende a registrar al personal de ventanilla y cargadores, emitir anticipos de sueldo y asentar gastos de alquiler, luz y agua.",
    "estimatedMinutes": 4,
    "allowedRoles": [
      "directiva_admin",
      "tesoreria",
      "encargado_agencia"
    ],
    "steps": [
      {
        "id": "workers_payroll_roster",
        "sectionId": "workers_expenses",
        "order": 1,
        "target": "[data-tutorial-target=\"workers-roster-section\"]",
        "fallbackTarget": "main",
        "placement": "bottom",
        "title": "Padrón de Trabajadores y Salarios",
        "whatIsIt": "El catálogo del personal dependiente de las agencias: secretarias de ventanilla, encargados y personal de carga.",
        "whatIsItFor": "Permite registrar sueldos pactados, fechas de ingreso y llevar el historial de anticipos y liquidaciones de sueldo.",
        "whatToWriteOrSelect": "Consulta la nómina de trabajadores o pulsa \"Nuevo Trabajador\" para registrar a un nuevo colaborador.",
        "example": "Trabajadora: Nelson Claros. Cargo: Secretaria de Ventanilla en Agencia Punata. Salario mensual: Bs 2,500.",
        "whatHappensAfter": "El perfil queda creado para asignarle anticipos y pagos mensuales desde el módulo.",
        "importantTip": "Todo anticipo de sueldo debe estar debidamente firmado por el trabajador al momento de entregar el dinero.",
        "audioScript": "En la sección de personal administras a los colaboradores de las agencias, sus salarios y las fechas de pago acordadas.",
        "requiredContext": {
          "tab": "workers"
        }
      },
      {
        "id": "workers_general_expenses",
        "sectionId": "workers_expenses",
        "order": 2,
        "target": "[data-tutorial-target=\"btn-new-expense\"]",
        "fallbackTarget": "[data-tutorial-target=\"workers-roster-section\"]",
        "placement": "top",
        "title": "Registro de Gastos Operativos de Agencia",
        "whatIsIt": "El formulario para asentar egresos de oficina: alquiler de local, servicios básicos (luz de ELFEC, agua de SEMAPA), internet y limpieza.",
        "whatIsItFor": "Permite que la directiva conozca los costos reales de funcionamiento de cada sucursal y justifique salidas de dinero.",
        "whatToWriteOrSelect": "Pulsa \"Nuevo Gasto\". Selecciona la categoría (Alquiler, Luz, Agua, etc.), el importe, el número de factura y la sucursal.",
        "example": "Pago de factura de luz ELFEC por Bs 340.50 correspondiente a la Agencia Cochabamba.",
        "whatHappensAfter": "El egreso se registra en la contabilidad y se resta del disponible de caja si se pagó en ventanilla.",
        "importantTip": "Exige siempre la factura legal o recibo con firma y carnet del proveedor antes de desembolsar dinero de caja.",
        "audioScript": "Registra los gastos de funcionamiento como alquiler o luz seleccionando la categoría e ingresando el número de factura de respaldo.",
        "requiredContext": {
          "tab": "workers"
        }
      }
    ],
    "category": "operational",
    "isOptional": false
  },
  {
    "id": "fixed_assets",
    "moduleId": "assets",
    "subModuleId": "fixed",
    "title": "10. Inventario de Bienes Fijos y Equipamiento",
    "shortTitle": "Bienes Fijos",
    "description": "Aprende a catalogar los activos de la empresa (balanzas, escritorios, computadoras) y controlar traslados y mantenimientos.",
    "estimatedMinutes": 3,
    "allowedRoles": [
      "encargado_agencia",
      "directiva_admin",
      "tesoreria"
    ],
    "steps": [
      {
        "id": "assets_catalog_list",
        "sectionId": "fixed_assets",
        "order": 1,
        "target": "[data-tutorial-target=\"assets-table-container\"]",
        "fallbackTarget": "main",
        "placement": "bottom",
        "title": "Inventario Patrimonial de la Agencia",
        "whatIsIt": "El registro de todos los bienes de uso duradero pertenecientes a Expreso Punata en sus dos sucursales.",
        "whatIsItFor": "Protege el patrimonio de la empresa, previene pérdidas y garantiza que cada oficina cuente con balanzas y equipos en buen estado.",
        "whatToWriteOrSelect": "Consulta los activos o haz clic en \"Nuevo Activo Fijo\" para registrar un mueble o equipo adquirido.",
        "example": "Activo: \"Balanza de plataforma digital 300kg\". Código: \"ACT-PNT-003\". Ubicación: Ventanilla Punata. Estado: Operativo.",
        "whatHappensAfter": "Se genera una ficha patrimonial con opción de imprimir su etiqueta térmica identificadora.",
        "importantTip": "Realiza un relevamiento físico semestral para verificar que ningún bien haya sido cambiado de oficina sin registro.",
        "audioScript": "El inventario de bienes fijos te permite registrar y cuidar el equipamiento de trabajo como balanzas, mostradores y computadoras.",
        "requiredContext": {
          "tab": "assets",
          "subTab": "fixed"
        }
      }
    ],
    "category": "operational",
    "isOptional": false
  },
  {
    "id": "consumables_inventory",
    "moduleId": "assets",
    "subModuleId": "consumables",
    "title": "11. Control de Consumibles e Insumos Operativos",
    "shortTitle": "Insumos de Agencia",
    "description": "Aprende a controlar las existencias de rollos térmicos de 80mm/58mm, guías de envío y cinta de embalaje con alertas de stock mínimo.",
    "estimatedMinutes": 3,
    "allowedRoles": [
      "encargado_agencia",
      "directiva_admin",
      "tesoreria"
    ],
    "steps": [
      {
        "id": "consumables_stock_list",
        "sectionId": "consumables_inventory",
        "order": 1,
        "target": "[data-tutorial-target=\"consumables-grid\"]",
        "fallbackTarget": "main",
        "placement": "bottom",
        "title": "Control de Existencias y Stock Mínimo",
        "whatIsIt": "El catálogo de artículos gastables que las agencias consumen diariamente para la atención de encomiendas.",
        "whatIsItFor": "Evita quedarse sin rollos térmicos para tickets o cinta de embalaje en plena hora punta de atención.",
        "whatToWriteOrSelect": "Consulta el nivel de stock. Si un producto está en amarillo o rojo, significa que llegó al límite de seguridad.",
        "example": "En Agencia Punata: \"Rollos Térmicos 80mm\", stock actual 4 rollos; se activa alerta para solicitar insumos.",
        "whatHappensAfter": "El sistema emite un aviso visual para que el encargado solicite reposición de material a tiempo.",
        "importantTip": "Registra inmediatamente cada salida de rollos o cinta para que el stock refleje la realidad del estante.",
        "audioScript": "Supervisa las existencias de rollos térmicos y cintas de embalar. Las alertas te avisarán antes de que se agote el material.",
        "requiredContext": {
          "tab": "assets",
          "subTab": "consumables"
        }
      }
    ],
    "category": "operational",
    "isOptional": false
  },
  {
    "id": "reports_analytics",
    "moduleId": "reports",
    "title": "12. Reportes, Estadísticas y Exportación Excel / PDF",
    "shortTitle": "Reportes y Cifras",
    "description": "Aprende a generar informes de fletes, arqueos, comisiones y utilidades, filtrando por sucursal y exportando a planillas Excel.",
    "estimatedMinutes": 4,
    "allowedRoles": [
      "secretaria",
      "encargado_agencia",
      "tesoreria",
      "directiva_admin",
      "conductor"
    ],
    "steps": [
      {
        "id": "reports_filter_panel",
        "sectionId": "reports_analytics",
        "order": 1,
        "target": "[data-tutorial-target=\"reports-filters-card\"]",
        "fallbackTarget": "main",
        "placement": "bottom",
        "title": "Filtros de Período y Sucursal",
        "whatIsIt": "Los controles para seleccionar el rango de fechas (hoy, esta semana, mes actual o personalizado) y la agencia a auditar.",
        "whatIsItFor": "Permite acotar el análisis a las fechas exactas requeridas para asambleas, auditorías o conciliaciones bancarias.",
        "whatToWriteOrSelect": "Elige la fecha inicial y fecha final. Selecciona si deseas ver solo Punata, solo Cochabamba o el consolidado general.",
        "example": "Filtro: del 01 al 31 de Octubre de 2026. Sucursal: \"Agencia Central Punata\".",
        "whatHappensAfter": "Todas las tarjetas numéricas y gráficos se actualizan de forma instantánea con los datos solicitados.",
        "importantTip": "Para auditorías mensuales oficiales, utiliza siempre el filtro de mes completo cerrado.",
        "audioScript": "Define el rango de fechas y la sucursal que deseas inspeccionar. El sistema recalculará los totales en tiempo real.",
        "requiredContext": {
          "tab": "reports"
        }
      },
      {
        "id": "reports_export_buttons",
        "sectionId": "reports_analytics",
        "order": 2,
        "target": "[data-tutorial-target=\"reports-export-actions\"]",
        "fallbackTarget": "[data-tutorial-target=\"reports-filters-card\"]",
        "placement": "top",
        "title": "Exportación a Excel XLSX y Reporte PDF Imprimible",
        "whatIsIt": "Los botones de descarga para obtener la información en formato de planilla de cálculo Excel (.xlsx) o documento PDF formal.",
        "whatIsItFor": "Permite enviar resúmenes a la directiva por WhatsApp, archivarlos en carpetas físicas o procesarlos con fórmulas en Excel.",
        "whatToWriteOrSelect": "Haz clic en \"Descargar Excel (XLSX)\" para abrir la planilla con fórmulas y celdas formateadas en bolivianos.",
        "example": "Generas el archivo \"Expreso_Punata_Reporte_Octubre_2026.xlsx\" con pestañas separadas de Encomiendas, Caja y Manifiestos.",
        "whatHappensAfter": "El archivo se descarga en tu computadora o celular listo para abrir o compartir.",
        "importantTip": "El formato Excel exportado incluye fórmulas nativas para que puedas calcular subtotales sin alterar los datos originales.",
        "audioScript": "Con un solo clic puedes descargar el reporte completo en Excel con formato contable o generar un PDF listo para imprimir.",
        "requiredContext": {
          "tab": "reports"
        }
      }
    ],
    "category": "operational",
    "isOptional": false
  },
  {
    "id": "printers_tickets",
    "moduleId": "config",
    "subModuleId": "printers",
    "title": "13. Impresoras Térmicas, Formatos y Protocolo RawBT",
    "shortTitle": "Impresoras y Tickets",
    "description": "Aprende cómo funciona el motor de impresión PACHAX Printing Core, formatos térmicos de 80mm y 58mm y opciones en PC y celular.",
    "estimatedMinutes": 3,
    "allowedRoles": [
      "directiva_admin"
    ],
    "steps": [
      {
        "id": "printers_profiles_setup",
        "sectionId": "printers_tickets",
        "order": 1,
        "target": "[data-tutorial-target=\"printers-config-panel\"]",
        "fallbackTarget": "main",
        "placement": "bottom",
        "title": "Perfiles de Impresión y Formato Térmico (80mm / 58mm)",
        "whatIsIt": "El panel de configuración del motor de impresión para tickets de ventanilla, comprobantes de caja y etiquetas adhesivas.",
        "whatIsItFor": "Permite adaptar la salida de impresión al ancho de rollo de la impresora térmica instalada en la computadora o celular.",
        "whatToWriteOrSelect": "Selecciona el formato predeterminado para tu agencia: \"Térmico 80mm\" (estándar de ventanilla) o \"Térmico 58mm\" (móvil).",
        "example": "En ventanilla de Punata se utiliza una impresora térmica Xprinter de 80mm con corte automático de papel.",
        "whatHappensAfter": "Todos los tickets generados se renderizan exactamente en el ancho del rollo sin márgenes desperdiciados.",
        "importantTip": "Si imprimes desde un teléfono Android, el sistema soporta la apertura directa mediante la aplicación gratuita RawBT.",
        "audioScript": "Configura tus impresoras térmicas eligiendo el ancho de 80 o 58 milímetros para imprimir tickets y etiquetas con código QR nítido.",
        "requiredContext": {
          "tab": "config",
          "subTab": "printers"
        }
      }
    ],
    "category": "operational",
    "isOptional": false
  },
  {
    "id": "login_profile",
    "moduleId": "auth",
    "title": "14. Acceso Seguro, Perfil Operativo y Sucursales (Opcional)",
    "shortTitle": "Acceso y Perfil",
    "description": "Aprende a identificarte en el sistema, reconocer tu agencia asignada y proteger tus credenciales de trabajo.",
    "estimatedMinutes": 3,
    "allowedRoles": [
      "secretaria",
      "conductor",
      "tesoreria",
      "encargado_agencia",
      "directiva_admin"
    ],
    "steps": [
      {
        "id": "login_credentials",
        "sectionId": "login_profile",
        "order": 1,
        "target": "[data-tutorial-target=\"header-user-badge\"]",
        "fallbackTarget": "header",
        "placement": "bottom",
        "title": "Tu Identidad y Rol en Expreso Punata",
        "whatIsIt": "Es el indicador oficial en la barra superior que muestra tu nombre completo y el rol asignado en el sistema.",
        "whatIsItFor": "Permite confirmar que estás trabajando con tu propia cuenta y que tienes los permisos correctos para tu puesto de trabajo.",
        "whatToWriteOrSelect": "Al iniciar sesión, introduce tu correo corporativo y tu contraseña privada. Nunca compartas tu clave con terceras personas.",
        "example": "Si eres Secretaria en Punata, el sistema mostrará tu nombre (ej. Nelson Claros) y la insignia \"SECRETARIA\".",
        "whatHappensAfter": "El sistema carga automáticamente tus módulos autorizados y aplica los permisos de seguridad de Expreso Punata.",
        "importantTip": "Si necesitas ausentarte de tu ventanilla, utiliza el botón de Cerrar Sesión para evitar registros no autorizados a tu nombre.",
        "audioScript": "Bienvenido a Expreso Punata. En la esquina superior derecha puedes verificar tu nombre de usuario y el rol operativo que tienes asignado en el sistema."
      },
      {
        "id": "login_branch_indicator",
        "sectionId": "login_profile",
        "order": 2,
        "target": "[data-tutorial-target=\"header-branch-badge\"]",
        "fallbackTarget": "header",
        "placement": "bottom",
        "title": "Agencia Asignada y Conmutación de Sucursal",
        "whatIsIt": "Es la insignia o selector que identifica la sucursal física en la cual estás operando en este momento.",
        "whatIsItFor": "Garantiza que todas las encomiendas, cobranzas de caja y despachos queden vinculados estrictamente a la agencia correcta.",
        "whatToWriteOrSelect": "Para secretarias y encargados, la agencia es fija según su contrato (Agencia Central Punata o Cochabamba). Los administradores pueden alternar libremente.",
        "example": "Si trabajas en la Calle Sucre de Punata, verás \"Agencia Central Punata\". Si la directiva inspecciona la agencia Cochabamba en Av. República, seleccionará esa sucursal.",
        "whatHappensAfter": "La caja activa, el catálogo de almacén y las tarifas se configuran automáticamente para la sucursal seleccionada.",
        "importantTip": "Las secretarias nunca deben cambiar de agencia sin autorización administrativa previa desde el módulo de usuarios.",
        "audioScript": "Observa la agencia activa en la barra superior. Todos los cobros y guías que registres quedarán asentados en la caja de esta sucursal."
      },
      {
        "id": "login_profile_options",
        "sectionId": "login_profile",
        "order": 3,
        "target": "[data-tutorial-target=\"header-profile-btn\"]",
        "fallbackTarget": "header",
        "placement": "bottom",
        "title": "Mi Perfil y Medidas de Seguridad",
        "whatIsIt": "Un botón de acceso rápido para consultar tus datos de usuario, tu fecha de creación y el estado de tu cuenta.",
        "whatIsItFor": "Sirve para comprobar la seguridad de tu sesión y solicitar restablecimientos de clave autorizados si es necesario.",
        "whatToWriteOrSelect": "Haz clic en el botón con tu inicial para abrir la ficha de perfil.",
        "example": "La secretaria en Agencia Central Punata consulta su perfil oficial y verifica su estado activo en Expreso Punata.",
        "whatHappensAfter": "Se abre una ventana modal con el detalle completo de tus permisos y opciones de seguridad.",
        "importantTip": "Si sospechas que alguien conoce tu contraseña, solicita inmediatamente un restablecimiento a la Administración general.",
        "audioScript": "Al pulsar sobre tu perfil podrás revisar tus datos registrados y confirmar que tu cuenta se encuentra debidamente protegida."
      }
    ],
    "category": "configuration",
    "isOptional": true
  },
  {
    "id": "panel_navigation",
    "moduleId": "navigation",
    "title": "15. Menú Lateral y Navegación (Opcional)",
    "shortTitle": "Panel y Menú",
    "description": "Aprende a contraer el menú, abrirlo en el celular, encontrar la sección actual y reconocer opciones según tu rol.",
    "estimatedMinutes": 3,
    "allowedRoles": [
      "secretaria",
      "conductor",
      "tesoreria",
      "encargado_agencia",
      "directiva_admin",
      "afiliado"
    ],
    "steps": [
      {
        "id": "nav_brand_bar",
        "sectionId": "panel_navigation",
        "order": 1,
        "target": "[data-tutorial-target=\"header-brand\"]",
        "fallbackTarget": "header",
        "placement": "bottom",
        "title": "Identidad Institucional de Expreso Punata",
        "whatIsIt": "La cabecera oficial con los colores verde y amarillo representativos de la empresa interprovincial Punata - Cochabamba.",
        "whatIsItFor": "Identifica la plataforma oficial de trabajo y el entorno en el cual estás operando.",
        "whatToWriteOrSelect": "No requiere seleccionar nada; es un componente institucional siempre visible en computadoras y celulares.",
        "example": "Muestra \"EXPRESO PUNATA\" con el lema del servicio interprovincial entre Punata y Cochabamba.",
        "whatHappensAfter": "Proporciona consistencia visual en todas las pantallas del sistema.",
        "importantTip": "Verifica siempre que la dirección en tu navegador comience con https para garantizar una conexión cifrada y segura.",
        "audioScript": "La barra institucional te acompaña en todo momento, confirmando que te encuentras en el sistema web oficial de Expreso Punata."
      },
      {
        "id": "nav_tabs_menu",
        "sectionId": "panel_navigation",
        "order": 2,
        "target": "[data-tutorial-target=\"nav-menu-controls\"]",
        "fallbackTarget": "header",
        "placement": "bottom",
        "title": "Contraer el menú o abrirlo en el celular",
        "whatIsIt": "Los controles que reducen el menú a iconos en una computadora y abren o cierran el panel lateral del celular.",
        "whatIsItFor": "Dejan más espacio en una pantalla grande o muestran la navegación cuando el menú del celular está cerrado.",
        "whatToWriteOrSelect": "En la computadora usa la flecha para contraer o expandir. En el celular abre el menú con las tres líneas y ciérralo con la X.",
        "example": "En un teléfono de 390 px en Punata, abre el menú para ver Pasajes. En una computadora puedes contraerlo para ampliar el área de trabajo.",
        "whatHappensAfter": "El menú conserva las opciones autorizadas y cambia su ancho o posición según la pantalla.",
        "importantTip": "El tutorial abre el menú móvil en este paso y lo cierra al avanzar o salir. No cambia tus permisos.",
        "audioScript": "En la computadora usa la flecha para contraer el menú. En el celular, abre el panel con las tres líneas y ciérralo con la X.",
        "requiredContext": { "openNavigation": true }
      },
      {
        "id": "nav_current_section",
        "sectionId": "panel_navigation",
        "order": 3,
        "target": "[data-tutorial-target=\"nav-current-item\"]",
        "fallbackTarget": "[data-tutorial-target=\"nav-tabs-bar\"]",
        "placement": "right",
        "title": "Identificar la sección actual",
        "whatIsIt": "La opción resaltada del menú lateral que indica qué módulo está abierto.",
        "whatIsItFor": "Ayuda a confirmar que estás en la pantalla correcta antes de consultar o registrar información.",
        "whatToWriteOrSelect": "Busca el nombre resaltado en amarillo. Para cambiar de sección, selecciona otra opción que aparezca en el menú.",
        "example": "Si la opción \"Pasajes\" está resaltada, ves las operaciones de la sucursal Punata.",
        "whatHappensAfter": "El contenido cambia a la opción seleccionada sin recargar toda la aplicación.",
        "importantTip": "Cada usuario ve solamente las opciones de su rol. Una designación institucional no concede acceso informático.",
        "audioScript": "La opción amarilla muestra la sección actual. El menú presenta solo las funciones habilitadas para tu cuenta.",
        "requiredContext": { "openNavigation": true }
      },
      {
        "id": "nav_tutorial_btn",
        "sectionId": "panel_navigation",
        "order": 4,
        "target": "[data-tutorial-target=\"header-tutorial-btn\"]",
        "fallbackTarget": "header",
        "placement": "bottom",
        "title": "Centro de Tutoriales Siempre Accesible",
        "whatIsIt": "El botón destacado \"Tutorial\" que te permite abrir este Centro de Aprendizaje en cualquier momento.",
        "whatIsItFor": "Permite repasar cualquier función, consultar pasos específicos o reanudar tu capacitación donde la dejaste.",
        "whatToWriteOrSelect": "Haz clic en \"Tutorial\" cuando tengas dudas sobre cómo completar un trámite en ventanilla.",
        "example": "En ventanilla de Punata, una secretaria repasa cómo registrar un envío especial hacia Cochabamba abriendo el tutorial.",
        "whatHappensAfter": "Se abre el diálogo interactivo con las opciones de recorrido guiado, sin afectar los datos que tengas en pantalla.",
        "importantTip": "El tutorial nunca registra cobros ni envíos reales por accidente; puedes practicar con total confianza.",
        "audioScript": "Siempre que tengas una duda, puedes hacer clic en el botón Tutorial para acceder a explicaciones detalladas con ejemplos de la vida real."
      }
    ],
    "category": "configuration",
    "isOptional": true
  },
  {
    "id": "admin_users",
    "moduleId": "config",
    "subModuleId": "users",
    "title": "16. Administración de Usuarios, Roles y Permisos RBAC (Opcional)",
    "shortTitle": "Usuarios y Permisos",
    "description": "Aprende a dar de alta operadores, asignarles sucursal obligatoria, gestionar permisos de directiva y restablecer claves con seguridad.",
    "estimatedMinutes": 4,
    "allowedRoles": [
      "directiva_admin"
    ],
    "steps": [
      {
        "id": "users_roster_table",
        "sectionId": "admin_users",
        "order": 1,
        "target": "[data-tutorial-target=\"users-management-table\"]",
        "fallbackTarget": "main",
        "placement": "bottom",
        "title": "Padrón de Usuarios del Sistema",
        "whatIsIt": "La lista de todas las cuentas habilitadas para ingresar a la plataforma web de Expreso Punata.",
        "whatIsItFor": "Permite conocer qué trabajadores tienen acceso, qué roles desempeñan y si sus cuentas se encuentran activas o suspendidas.",
        "whatToWriteOrSelect": "Revisa la lista de operadores o haz clic en \"Nuevo Usuario\" para crear una cuenta de trabajo.",
        "example": "Puedes verificar las cuentas de secretarias en Punata y Cochabamba y confirmar que sus correos corporativos sean válidos.",
        "whatHappensAfter": "El administrador tiene control soberano para editar datos, cambiar contraseñas o suspender accesos al instante.",
        "importantTip": "Desactiva inmediatamente la cuenta de cualquier persona que deje de trabajar en la empresa para salvaguardar la información.",
        "audioScript": "Desde el panel de administración gestionas las cuentas del personal, supervisando sus roles y estados de actividad.",
        "requiredContext": {
          "tab": "config",
          "subTab": "users"
        }
      },
      {
        "id": "users_branch_enforcement",
        "sectionId": "admin_users",
        "order": 2,
        "target": "[data-tutorial-target=\"btn-new-user-modal\"]",
        "fallbackTarget": "[data-tutorial-target=\"users-management-table\"]",
        "placement": "top",
        "title": "Asignación Estricta de Sucursal por Rol",
        "whatIsIt": "La regla de seguridad que vincula a cada secretaria con una sola sucursal fija, impidiendo que alterne agencias arbitrariamente.",
        "whatIsItFor": "Protege la integridad contable de las cajas y evita que una secretaria opere con fondos de una sucursal distinta a la suya.",
        "whatToWriteOrSelect": "Al crear un usuario con rol \"secretaria\", selecciona obligatoriamente su \"Agencia Asignada\" (Punata o Cochabamba).",
        "example": "Si creas a la nueva secretaria de Punata, seleccionas \"Agencia Central Punata\". Ella no tendrá el menú para cambiarse a Cochabamba.",
        "whatHappensAfter": "El sistema valida tanto en el navegador como en las reglas de Firebase que solo acceda a su sucursal autorizada.",
        "importantTip": "Solo los roles de \"directiva_admin\" y \"tesoreria\" pueden tener permisos multisucursal autorizados.",
        "audioScript": "Al registrar una secretaria, asígnale su sucursal fija. El sistema bloqueará cualquier intento no autorizado de cambio de agencia.",
        "requiredContext": {
          "tab": "config",
          "subTab": "users"
        }
      }
    ],
    "category": "configuration",
    "isOptional": true
  },
  {
    "id": "system_config",
    "moduleId": "config",
    "subModuleId": "general",
    "title": "17. Configuración Empresarial, Tarifas y Parámetros Oficiales (Opcional)",
    "shortTitle": "Configuración Oficial",
    "description": "Aprende a revisar los datos institucionales y las referencias tarifarias conservadas en configuración.",
    "estimatedMinutes": 4,
    "allowedRoles": [
      "directiva_admin"
    ],
    "steps": [
      {
        "id": "config_company_identity",
        "sectionId": "system_config",
        "order": 1,
        "target": "[data-tutorial-target=\"config-general-form\"]",
        "fallbackTarget": "main",
        "placement": "bottom",
        "title": "Identidad Legal y Datos Comerciales",
        "whatIsIt": "El formulario con la razón social, NIT oficial, lema y teléfonos de contacto impresos en cada recibo térmico.",
        "whatIsItFor": "Garantiza que todos los comprobantes emitidos lleven la información legal y comercial vigente de Expreso Punata.",
        "whatToWriteOrSelect": "Revisa los datos de nombre, NIT y teléfonos de las agencias de Punata (4578912) y Cochabamba (4258963).",
        "example": "Razón Social: \"EXPRESO PUNATA S.R.L.\", NIT 1028475029 con agencias autorizadas en Punata y Cochabamba.",
        "whatHappensAfter": "Los cambios se guardan de forma autoritativa en Firestore y se reflejan de inmediato en todas las terminales.",
        "importantTip": "Cualquier modificación en el NIT o datos legales debe ser aprobada previamente en acta de asamblea de socios.",
        "audioScript": "En configuración general administras la identidad de la empresa, los teléfonos de contacto y los datos que figuran en las guías.",
        "requiredContext": {
          "tab": "config",
          "subTab": "general"
        }
      },
      {
        "id": "config_tariffs_editor",
        "sectionId": "system_config",
        "order": 2,
        "target": "[data-tutorial-target=\"config-tariffs-table\"]",
        "fallbackTarget": "[data-tutorial-target=\"config-general-form\"]",
        "placement": "top",
        "title": "Referencias de tarifas conservadas",
        "whatIsIt": "La tabla de referencias de tarifas y recargos guardada en configuración.",
        "whatIsItFor": "Permite consultar los valores conservados, pero no calcula ni completa el precio de una encomienda.",
        "whatToWriteOrSelect": "Para cada envío, el personal escribe manualmente el precio acordado en el formulario. Esta tabla no se aplica automáticamente.",
        "example": "En Expreso Punata, el precio de una encomienda se escribe manualmente y no se obtiene de las referencias aquí.",
        "whatHappensAfter": "El importe de la guía es el que el personal ingresa en el formulario, aunque exista una referencia almacenada.",
        "importantTip": "No presentes estos valores como tarifa automática ni uses un cálculo sugerido para cobrar.",
        "audioScript": "Las referencias se conservan en configuración. El precio de cada encomienda se ingresa manualmente.",
        "requiredContext": {
          "tab": "config",
          "subTab": "tariffs"
        }
      }
    ],
    "category": "configuration",
    "isOptional": true
  },
  {
    "id": "passenger_ticket_sales",
    "moduleId": "tickets",
    "title": "18. Pasajes: Venta QR, comprobantes y entrega al chofer",
    "shortTitle": "Venta de Pasajes",
    "description": "Registra pasajes con importe manual, verifica el QR recibido, imprime comprobantes y consulta el efectivo pendiente del chofer.",
    "estimatedMinutes": 5,
    "allowedRoles": ["secretaria", "encargado_agencia", "directiva_admin"],
    "steps": [
      {
        "id": "ticket_sale_route_driver",
        "sectionId": "passenger_ticket_sales",
        "order": 1,
        "target": "[data-tutorial-target=\"tickets-route\"]",
        "fallbackTarget": "[data-tutorial-target=\"tickets-new-operation\"]",
        "placement": "bottom",
        "title": "Ruta, fecha y chofer",
        "whatIsIt": "El formulario de oficina para registrar una venta de pasajes de Punata o Cochabamba.",
        "whatIsItFor": "Asocia cada operación con la ruta, fecha de viaje y chofer que atenderá los pasajes.",
        "whatToWriteOrSelect": "Selecciona origen y destino, la fecha y el chofer activo. El vehículo y el nombre del pasajero son opcionales.",
        "example": "Para el viaje Punata a Cochabamba, selecciona al chofer asignado y la fecha acordada.",
        "whatHappensAfter": "La operación queda vinculada al recorrido y al chofer seleccionado cuando se registra.",
        "importantTip": "Revisa la ruta y el chofer antes de continuar; el chofer solo podrá validar sus propios pasajes.",
        "audioScript": "Elige el origen, el destino, la fecha y el chofer que corresponde al viaje.",
        "requiredContext": { "tab": "tickets", "openModal": "ticket-new" }
      },
      {
        "id": "ticket_sale_manual_amount",
        "sectionId": "passenger_ticket_sales",
        "order": 2,
        "target": "[data-tutorial-target=\"tickets-manual-amount\"]",
        "fallbackTarget": "[data-tutorial-target=\"tickets-sale-form\"]",
        "placement": "top",
        "title": "Cantidad e importe manual",
        "whatIsIt": "Los campos para indicar cuántos pasajes se venden y el importe por cada uno.",
        "whatIsItFor": "El total se calcula multiplicando la cantidad por el importe ingresado por el personal.",
        "whatToWriteOrSelect": "Escribe la cantidad y el precio acordado en bolivianos. El sistema no propone un precio automático.",
        "example": "Dos pasajes a Bs 12,50 cada uno generan un total de Bs 25,00 para verificar.",
        "whatHappensAfter": "Al registrar, se crea una operación pendiente de verificación QR; el tutorial no la guarda.",
        "importantTip": "No pulses Registrar operación durante el tutorial. No se crean ventas ni cobros de prueba.",
        "audioScript": "Ingresa la cantidad y el precio acordado. El total se muestra para que lo revises antes de registrar.",
        "requiredContext": { "tab": "tickets", "openModal": "ticket-new" }
      },
      {
        "id": "ticket_qr_verification",
        "sectionId": "passenger_ticket_sales",
        "order": 3,
        "target": "[data-tutorial-target=\"tickets-qr-guidance\"]",
        "fallbackTarget": "[data-tutorial-target=\"tickets-sale-form\"]",
        "placement": "bottom",
        "title": "Comprobar el pago QR",
        "whatIsIt": "El aviso de que el pago QR queda pendiente hasta que personal autorizado confirme el abono.",
        "whatIsItFor": "Evita emitir comprobantes válidos basándose solamente en una captura enviada por el pasajero.",
        "whatToWriteOrSelect": "En una operación real, revisa el abono en la cuenta de la oficina y confirma el importe exacto desde la operación. Agrega referencia bancaria si la tienes.",
        "example": "Si la operación muestra Bs 25,00, confirma solo después de ver Bs 25,00 acreditados en la cuenta QR.",
        "whatHappensAfter": "El pago verificado genera su registro QR auditado; no suma efectivo físico a la gaveta.",
        "importantTip": "No confirmes pagos con una captura solamente. El pago QR verificado no puede anularse porque no hay una regla de devolución aprobada.",
        "audioScript": "Comprueba el abono real en la cuenta de la oficina antes de confirmar el pago QR.",
        "requiredContext": { "tab": "tickets", "openModal": "ticket-new" }
      },
      {
        "id": "ticket_pending_delivery",
        "sectionId": "passenger_ticket_sales",
        "order": 4,
        "target": "[data-tutorial-target=\"tickets-pending-settlement\"]",
        "placement": "bottom",
        "title": "QR verificado y efectivo pendiente",
        "whatIsIt": "El resumen de los importes cobrados por QR que todavía se deben entregar en efectivo al chofer.",
        "whatIsItFor": "Distingue el pago QR registrado de la entrega posterior de billetes al conductor.",
        "whatToWriteOrSelect": "Revisa el saldo por chofer. Para una entrega real, usa Entregar efectivo en la operación de Pasajes y confirma solo después de entregar el dinero.",
        "example": "Un QR de Bs 25,00 está verificado, pero continúa pendiente hasta entregar esos Bs 25,00 en efectivo al chofer.",
        "whatHappensAfter": "La entrega descuenta efectivo de la caja abierta, genera un movimiento auditado y marca la operación como entregada.",
        "importantTip": "No registres dos veces una entrega. El sistema no permite repetir una operación ya liquidada.",
        "audioScript": "El pago QR no es efectivo en caja. Registra la entrega desde Pasajes después de dar el dinero al chofer.",
        "requiredContext": { "tab": "tickets" }
      },
      {
        "id": "ticket_history_print",
        "sectionId": "passenger_ticket_sales",
        "order": 5,
        "target": "[data-tutorial-target=\"tickets-history\"]",
        "placement": "top",
        "title": "Historial, comprobantes y reimpresión",
        "whatIsIt": "La lista de operaciones con su estado de pago, uso del pasaje y entrega al chofer.",
        "whatIsItFor": "Permite buscar operaciones, revisar sus estados e imprimir el respaldo de oficina y el comprobante del chofer.",
        "whatToWriteOrSelect": "Filtra por fecha, chofer, pago, uso o entrega. Imprime después de verificar el pago; usa Reimprimir para una copia marcada como duplicado.",
        "example": "La oficina y el chofer reciben dos comprobantes de la operación PJE de Cochabamba a Punata.",
        "whatHappensAfter": "La vista de impresión genera dos copias vinculadas al mismo número; una reimpresión no crea otra venta.",
        "importantTip": "El tamaño 58 u 80 mm se selecciona en la vista de impresión. La compatibilidad física aún requiere probar con la impresora de oficina.",
        "audioScript": "Busca la operación en el historial. Imprime las dos copias y recuerda que toda reimpresión se marca como duplicado.",
        "requiredContext": { "tab": "tickets" }
      }
    ],
    "category": "operational",
    "isOptional": false
  },
  {
    "id": "passenger_ticket_driver",
    "moduleId": "tickets",
    "title": "19. Chofer: Validar pasajes asignados",
    "shortTitle": "Validación de Pasajes",
    "description": "Consulta el pasaje digital y valida solamente operaciones pagadas y asignadas a tu usuario.",
    "estimatedMinutes": 2,
    "allowedRoles": ["conductor"],
    "steps": [
      {
        "id": "driver_validate_code",
        "sectionId": "passenger_ticket_driver",
        "order": 1,
        "target": "[data-tutorial-target=\"tickets-driver-validation\"]",
        "placement": "bottom",
        "title": "Escribir el código del comprobante",
        "whatIsIt": "El formulario que consulta en el registro oficial si un pasaje puede utilizarse.",
        "whatIsItFor": "Comprueba que el pago esté verificado, que la operación esté asignada a tu usuario y que aún queden usos.",
        "whatToWriteOrSelect": "Escribe el código que aparece en el comprobante y pulsa Validar pasaje. Este módulo no incluye un lector de cámara.",
        "example": "Antes de permitir el abordaje en Punata, consulta el código impreso del pasajero.",
        "whatHappensAfter": "El sistema informa si el código es válido, está pendiente de pago, fue anulado o agotó sus usos.",
        "importantTip": "No aceptes una captura como verificación. Consulta el código en el sistema antes del abordaje.",
        "audioScript": "Escribe el código del comprobante y espera el resultado oficial antes de permitir el abordaje.",
        "requiredContext": { "tab": "tickets" }
      },
      {
        "id": "driver_assigned_tickets",
        "sectionId": "passenger_ticket_driver",
        "order": 2,
        "target": "[data-tutorial-target=\"tickets-driver-assignments\"]",
        "placement": "top",
        "title": "Tus pasajes asignados",
        "whatIsIt": "El historial limitado a operaciones asociadas al chofer que inició sesión.",
        "whatIsItFor": "Permite revisar fecha, ruta, cantidad, usos y estado de pago de los pasajes asignados.",
        "whatToWriteOrSelect": "Busca por código, número de operación o fecha. Abre una operación pagada y pendiente para validar un uso.",
        "example": "El chofer asignado al viaje Punata a Cochabamba solo ve y valida sus propios pasajes.",
        "whatHappensAfter": "Cada validación queda auditada y no puede superar la cantidad comprada.",
        "importantTip": "Un código de otro chofer, anulado o sin pago verificado debe rechazarse.",
        "audioScript": "Consulta tus pasajes y verifica que cada operación corresponda a tu usuario y al viaje.",
        "requiredContext": { "tab": "tickets" }
      }
    ],
    "category": "operational",
    "isOptional": false
  },
  {
    "id": "passenger_ticket_review",
    "moduleId": "tickets",
    "title": "20. Tesorería: Consulta de Pasajes",
    "shortTitle": "Consulta de Pasajes",
    "description": "Consulta las operaciones y sus estados desde la vista asignada a Tesorería.",
    "estimatedMinutes": 1,
    "allowedRoles": ["tesoreria"],
    "steps": [
      {
        "id": "treasury_ticket_history",
        "sectionId": "passenger_ticket_review",
        "order": 1,
        "target": "[data-tutorial-target=\"tickets-history\"]",
        "placement": "top",
        "title": "Consulta sin acciones de oficina",
        "whatIsIt": "La lista de operaciones y sus estados visibles para Tesorería.",
        "whatIsItFor": "Permite revisar pagos, uso y entrega registrados sin mostrar controles de venta, verificación o liquidación a este rol.",
        "whatToWriteOrSelect": "Busca por fecha, chofer o estado y consulta el número de operación.",
        "example": "Tesorería revisa en Punata que una operación esté verificada y entregada sin registrar un cobro desde esta pantalla.",
        "whatHappensAfter": "La consulta no crea operaciones ni movimientos financieros.",
        "importantTip": "Si una operación requiere una acción de oficina, debe realizarla un usuario con la autorización existente.",
        "audioScript": "Esta pantalla es de consulta para Tesorería; revisa los estados sin cambiar la operación.",
        "requiredContext": { "tab": "tickets" }
      }
    ],
    "category": "operational",
    "isOptional": true
  },
  {
    "id": "union_office",
    "moduleId": "dues",
    "title": "21. Secretaría: Consulta de afiliados y operaciones autorizadas",
    "shortTitle": "Afiliados en Oficina",
    "description": "Consulta datos, cuotas, préstamos, multas y alertas desde los accesos disponibles para Secretaría.",
    "estimatedMinutes": 3,
    "allowedRoles": ["secretaria"],
    "steps": [
      {
        "id": "office_member_lookup",
        "sectionId": "union_office",
        "order": 1,
        "target": "[data-tutorial-target=\"members-table-container\"]",
        "placement": "bottom",
        "title": "Consultar el padrón",
        "whatIsIt": "La lista de afiliados disponible en la sección Afiliados y Aportes.",
        "whatIsItFor": "Ayuda a ubicar una ficha y consultar los datos que tu rol tiene autorizados.",
        "whatToWriteOrSelect": "Busca el nombre o número de afiliado en los filtros de la lista.",
        "example": "Busca un afiliado de Punata para responder una consulta de su cuenta.",
        "whatHappensAfter": "La ficha muestra la información disponible según los permisos actuales.",
        "importantTip": "Este acceso no autoriza por sí solo a editar el padrón o asignar cuentas.",
        "audioScript": "Usa el padrón para encontrar al afiliado y consulta solo la información habilitada para tu rol.",
        "requiredContext": { "tab": "dues", "subTab": "members" }
      },
      {
        "id": "office_member_dues",
        "sectionId": "union_office",
        "order": 2,
        "target": "[data-tutorial-target=\"union-tab-dues\"]",
        "placement": "bottom",
        "title": "Cuotas y mensualidades",
        "whatIsIt": "La pestaña de cuotas generadas para los afiliados.",
        "whatIsItFor": "Permite consultar períodos y registrar el pago de una cuota que ya fue emitida, con la caja activa cuando corresponda.",
        "whatToWriteOrSelect": "Selecciona el período y la cuota del afiliado. Confirma el importe recibido y entrega el comprobante.",
        "example": "Consulta la cuota de noviembre de un afiliado y registra el pago efectivo recibido en Punata.",
        "whatHappensAfter": "El pago autorizado queda asociado a la cuota y al turno de Caja.",
        "importantTip": "La generación de cuotas corresponde a los roles con esa autorización; no generes períodos nuevos desde este recorrido.",
        "audioScript": "Consulta la cuota emitida y registra el pago solamente después de recibir el importe.",
        "requiredContext": { "tab": "dues", "subTab": "dues" }
      },
      {
        "id": "office_member_loans_fines",
        "sectionId": "union_office",
        "order": 3,
        "target": "[data-tutorial-target=\"union-tab-loans\"]",
        "placement": "bottom",
        "title": "Préstamos y multas",
        "whatIsIt": "Las pestañas de préstamos internos y multas de afiliados.",
        "whatIsItFor": "Permiten consultar y realizar las acciones de cobro habilitadas para el personal de oficina.",
        "whatToWriteOrSelect": "En préstamos revisa saldo y pagos. En multas consulta el motivo, importe y saldo antes de registrar un pago recibido.",
        "example": "Antes de cobrar una multa en Cochabamba, verifica el registro y el saldo pendiente.",
        "whatHappensAfter": "Los cambios quedan registrados mediante las funciones existentes y respetan el turno de Caja cuando aplica.",
        "importantTip": "No alteres importes ni saldos para resolver diferencias; comunícalas a Administración.",
        "audioScript": "Revisa préstamos y multas antes de atender. Confirma el saldo y registra solamente pagos realmente recibidos.",
        "requiredContext": { "tab": "dues", "subTab": "loans" }
      },
      {
        "id": "office_debt_alerts",
        "sectionId": "union_office",
        "order": 4,
        "target": "[data-tutorial-target=\"union-debts-panel\"]",
        "placement": "top",
        "title": "Alertas de deudas",
        "whatIsIt": "La vista que reúne avisos de saldos pendientes de afiliados.",
        "whatIsItFor": "Ayuda a localizar una cuenta que requiere revisión o atención.",
        "whatToWriteOrSelect": "Consulta el aviso y abre la ficha del afiliado si necesitas verificar el detalle.",
        "example": "Revisa en Punata la alerta de una cuota pendiente y confirma el estado en la ficha del afiliado.",
        "whatHappensAfter": "La consulta muestra información de la cuenta y no genera un cobro automáticamente.",
        "importantTip": "La alerta es informativa; confirma siempre el saldo en el módulo correspondiente.",
        "audioScript": "Usa las alertas para encontrar cuentas pendientes y verifica su detalle antes de responder.",
        "requiredContext": { "tab": "dues", "subTab": "debts" }
      }
    ],
    "category": "operational",
    "isOptional": false
  },
  {
    "id": "union_management",
    "moduleId": "dues",
    "title": "22. Administración: Afiliados, obligaciones y Directiva",
    "shortTitle": "Administración Social",
    "description": "Revisa las áreas de padrón, cuotas, préstamos, multas, deportes, Directiva anual y alertas.",
    "estimatedMinutes": 5,
    "allowedRoles": ["directiva_admin", "tesoreria"],
    "steps": [
      {
        "id": "management_roster",
        "sectionId": "union_management",
        "order": 1,
        "target": "[data-tutorial-target=\"members-table-container\"]",
        "placement": "bottom",
        "title": "Padrón e información de afiliados",
        "whatIsIt": "El padrón social con datos del afiliado y vínculos de vehículos o conductores.",
        "whatIsItFor": "Permite mantener las fichas y consultar la información de la organización.",
        "whatToWriteOrSelect": "Busca una persona por sus datos. Usa las acciones de edición solamente cuando estén habilitadas en tu usuario.",
        "example": "Consulta la ficha de un afiliado de Cochabamba antes de actualizar un dato autorizado.",
        "whatHappensAfter": "Los cambios permitidos quedan guardados por las funciones del padrón.",
        "importantTip": "La afiliación o un cargo institucional no asignan una cuenta ni permisos informáticos.",
        "audioScript": "Consulta el padrón y edita datos únicamente con las autorizaciones de tu cuenta.",
        "requiredContext": { "tab": "dues", "subTab": "members" }
      },
      {
        "id": "management_dues",
        "sectionId": "union_management",
        "order": 2,
        "target": "[data-tutorial-target=\"union-tab-dues\"]",
        "placement": "bottom",
        "title": "Cuotas y períodos",
        "whatIsIt": "La sección de emisión y consulta de cuotas periódicas.",
        "whatIsItFor": "Permite revisar los períodos de aportes y sus pagos registrados.",
        "whatToWriteOrSelect": "Selecciona el período requerido y revisa los importes y estados antes de emitir o cobrar.",
        "example": "Consulta el período 2026-11 de los afiliados de Punata y verifica qué cuotas continúan pendientes.",
        "whatHappensAfter": "Las cuotas emitidas y sus pagos quedan vinculados al historial del afiliado.",
        "importantTip": "Usa únicamente los importes y períodos aprobados por la organización.",
        "audioScript": "En cuotas, selecciona el período y verifica los registros antes de emitir o cobrar.",
        "requiredContext": { "tab": "dues", "subTab": "dues" }
      },
      {
        "id": "management_loans",
        "sectionId": "union_management",
        "order": 3,
        "target": "[data-tutorial-target=\"union-loans-panel\"]",
        "placement": "top",
        "title": "Préstamos internos",
        "whatIsIt": "El registro de préstamos, saldos y pagos de afiliados.",
        "whatIsItFor": "Permite consultar el historial y las obligaciones asociadas a cada préstamo.",
        "whatToWriteOrSelect": "Revisa al afiliado, capital, saldo y pagos registrados antes de usar una acción autorizada.",
        "example": "Consulta el saldo pendiente de un préstamo asociado a un afiliado de Punata.",
        "whatHappensAfter": "Las operaciones autorizadas quedan auditadas por el backend.",
        "importantTip": "No registres desembolsos ni pagos durante este tutorial.",
        "audioScript": "Verifica el saldo y los pagos del préstamo antes de realizar una acción autorizada.",
        "requiredContext": { "tab": "dues", "subTab": "loans" }
      },
      {
        "id": "management_fines",
        "sectionId": "union_management",
        "order": 4,
        "target": "[data-tutorial-target=\"union-fines-panel\"]",
        "placement": "top",
        "title": "Multas de afiliados",
        "whatIsIt": "El registro de multas económicas, sus motivos, pagos y saldos pendientes.",
        "whatIsItFor": "Permite consultar la causa y el estado de cada obligación.",
        "whatToWriteOrSelect": "Revisa afiliado, categoría, fecha, importe y saldo. Usa únicamente las acciones autorizadas.",
        "example": "Consulta en Punata una multa de categoría Transporte y verifica su saldo antes de informar al afiliado.",
        "whatHappensAfter": "La consulta no registra cobros; los pagos se guardan mediante el flujo autorizado.",
        "importantTip": "No inventes importes ni marques una multa como pagada sin recibir el dinero.",
        "audioScript": "Consulta el motivo y el saldo de la multa. Registra un pago solo después de recibirlo.",
        "requiredContext": { "tab": "dues", "subTab": "fines" }
      },
      {
        "id": "management_sports",
        "sectionId": "union_management",
        "order": 5,
        "target": "[data-tutorial-target=\"union-sports-panel\"]",
        "placement": "top",
        "title": "Deportes y exenciones",
        "whatIsIt": "El módulo de eventos deportivos, deudas y decisiones de exención.",
        "whatIsItFor": "Registra eventos y consulta las obligaciones deportivas según las autorizaciones existentes.",
        "whatToWriteOrSelect": "Revisa el evento y el afiliado. Las decisiones de exención aparecen solamente para el rol habilitado.",
        "example": "Consulta en Cochabamba una deuda asociada a una actividad deportiva antes de comunicarla al afiliado.",
        "whatHappensAfter": "Las acciones disponibles dependen del rol; el tutorial no registra eventos ni decisiones.",
        "importantTip": "Tesorería y Dirección no tienen necesariamente las mismas acciones de decisión.",
        "audioScript": "Consulta eventos y deudas deportivas. Ejecuta una exención solo si tu rol muestra esa autorización.",
        "requiredContext": { "tab": "dues", "subTab": "sports" }
      },
      {
        "id": "management_annual_board",
        "sectionId": "union_management",
        "order": 6,
        "target": "[data-tutorial-target=\"union-annual-board-panel\"]",
        "placement": "top",
        "title": "Directiva anual",
        "whatIsIt": "El historial de directivas por período y los datos de sus integrantes y cargos.",
        "whatIsItFor": "Permite consultar y mantener las gestiones institucionales anteriores y vigentes.",
        "whatToWriteOrSelect": "Selecciona el período. Registra afiliados existentes y sus cargos según la decisión institucional.",
        "example": "Consulta la Directiva anual de Punata del período 2026 antes de registrar una gestión nueva.",
        "whatHappensAfter": "La información queda como designación institucional y no crea cuentas del sistema.",
        "importantTip": "Ser integrante de la Directiva no concede automáticamente permisos de usuario.",
        "audioScript": "Consulta las gestiones y registra cargos aprobados sin crear cuentas o accesos automáticos.",
        "requiredContext": { "tab": "dues", "subTab": "annual-board" }
      },
      {
        "id": "management_debt_alerts",
        "sectionId": "union_management",
        "order": 7,
        "target": "[data-tutorial-target=\"union-debts-panel\"]",
        "placement": "top",
        "title": "Alertas y consulta de saldos",
        "whatIsIt": "La lista de avisos de obligaciones pendientes de afiliados.",
        "whatIsItFor": "Facilita la revisión de cuotas, préstamos y multas que requieren seguimiento.",
        "whatToWriteOrSelect": "Abre el afiliado y confirma el detalle en el módulo de origen antes de comunicar un saldo.",
        "example": "Una alerta de cuota pendiente de un afiliado de Punata se confirma consultando la cuota y sus pagos.",
        "whatHappensAfter": "La alerta sirve para seguimiento; no crea ni cobra obligaciones por sí misma.",
        "importantTip": "Confirma siempre la información en el registro original antes de tomar una decisión.",
        "audioScript": "Usa las alertas para encontrar saldos que requieren revisión y comprueba cada uno en su registro.",
        "requiredContext": { "tab": "dues", "subTab": "debts" }
      }
    ],
    "category": "operational",
    "isOptional": false
  },
  {
    "id": "secretary_sports_fines",
    "moduleId": "sports-fines",
    "title": "23. Multas deportivas: consulta y cobro autorizado",
    "shortTitle": "Multas Deportivas",
    "description": "Consulta multas deportivas y registra pagos solamente después de recibir el importe.",
    "estimatedMinutes": 2,
    "allowedRoles": ["secretaria"],
    "steps": [
      {
        "id": "sports_fines_collection",
        "sectionId": "secretary_sports_fines",
        "order": 1,
        "target": "[data-tutorial-target=\"union-fines-panel\"]",
        "placement": "top",
        "title": "Consultar y atender una multa deportiva",
        "whatIsIt": "La vista de multas deportivas disponible para Secretaría.",
        "whatIsItFor": "Permite consultar registros y usar las acciones de cobro disponibles en el turno.",
        "whatToWriteOrSelect": "Busca al afiliado, revisa la actividad y el saldo. Registra el pago solo después de recibir el importe.",
        "example": "Confirma el saldo de un evento deportivo de Punata antes de entregar el comprobante.",
        "whatHappensAfter": "El pago confirmado queda registrado y refleja el estado en la cuenta del afiliado.",
        "importantTip": "No decidas una exención ni cambies una deuda; esas acciones dependen de la autorización vigente.",
        "audioScript": "Revisa el evento y el saldo. Registra únicamente el pago realmente recibido.",
        "requiredContext": { "tab": "sports-fines" }
      }
    ],
    "category": "operational",
    "isOptional": false
  },
  {
    "id": "affiliate_account",
    "moduleId": "my-account",
    "title": "24. Mi cuenta de afiliado",
    "shortTitle": "Mi Cuenta",
    "description": "Consulta cuotas, préstamos, multas y saldos desde la cuenta personal de afiliado.",
    "estimatedMinutes": 2,
    "allowedRoles": ["afiliado"],
    "steps": [
      {
        "id": "affiliate_profile",
        "sectionId": "affiliate_account",
        "order": 1,
        "target": "[data-tutorial-target=\"affiliate-account-overview\"]",
        "placement": "bottom",
        "title": "Tus datos de afiliado",
        "whatIsIt": "El resumen de identidad y afiliación vinculado a tu cuenta.",
        "whatIsItFor": "Te ayuda a verificar tu nombre, número de afiliado y sucursal registrada.",
        "whatToWriteOrSelect": "Revisa que los datos mostrados correspondan a ti y comunica cualquier diferencia a la oficina.",
        "example": "Comprueba tu afiliación en la sucursal Punata antes de consultar tus obligaciones.",
        "whatHappensAfter": "La pantalla presenta los datos disponibles; no permite administrar usuarios.",
        "importantTip": "La cuenta de afiliado solo muestra información propia autorizada.",
        "audioScript": "Revisa tus datos de afiliación y consulta a la oficina si observas una diferencia.",
        "requiredContext": { "tab": "my-account" }
      },
      {
        "id": "affiliate_balance_summary",
        "sectionId": "affiliate_account",
        "order": 2,
        "target": "[data-tutorial-target=\"affiliate-account-balances\"]",
        "placement": "top",
        "title": "Resumen de saldos",
        "whatIsIt": "Los saldos pendientes de cuotas, préstamos y multas asociados a tu cuenta.",
        "whatIsItFor": "Permite conocer qué obligaciones requieren consulta o atención.",
        "whatToWriteOrSelect": "Compara cada saldo con su detalle y solicita aclaración si no reconoces un registro.",
        "example": "En la cuenta de Punata, el saldo pendiente de una multa se muestra separado del saldo de un préstamo.",
        "whatHappensAfter": "Los importes son de consulta y no ejecutan pagos desde este resumen.",
        "importantTip": "Un saldo mostrado no significa que el sistema haya cobrado dinero.",
        "audioScript": "Consulta por separado tus cuotas, préstamos y multas pendientes.",
        "requiredContext": { "tab": "my-account" }
      },
      {
        "id": "affiliate_dues_detail",
        "sectionId": "affiliate_account",
        "order": 3,
        "target": "[data-tutorial-target=\"affiliate-account-dues\"]",
        "placement": "top",
        "title": "Detalle de cuotas",
        "whatIsIt": "El historial de cuotas y períodos registrados en tu cuenta.",
        "whatIsItFor": "Permite revisar los estados y valores de cada período.",
        "whatToWriteOrSelect": "Busca el período que deseas consultar y revisa su estado de pago.",
        "example": "Consulta el período 2026-11 de Punata y confirma si figura pendiente o pagado.",
        "whatHappensAfter": "La consulta no modifica el estado de la cuota.",
        "importantTip": "Para corregir una diferencia, comunícate con la oficina y presenta tu comprobante.",
        "audioScript": "Revisa el período y el estado de cada cuota registrada.",
        "requiredContext": { "tab": "my-account" }
      },
      {
        "id": "affiliate_loans_fines_detail",
        "sectionId": "affiliate_account",
        "order": 4,
        "target": "[data-tutorial-target=\"affiliate-account-fines\"]",
        "placement": "top",
        "title": "Detalle de préstamos y multas",
        "whatIsIt": "El detalle de saldos y pagos asociados a préstamos y multas.",
        "whatIsItFor": "Te permite revisar cuánto queda pendiente en cada registro.",
        "whatToWriteOrSelect": "Revisa el número, motivo y pagos. Solicita ayuda en la oficina si un dato no coincide.",
        "example": "Verifica en Punata los pagos anotados para una multa de categoría Transporte.",
        "whatHappensAfter": "La pantalla informa el historial disponible y no registra operaciones financieras.",
        "importantTip": "No compartas tu sesión para pedir a otra persona que consulte tu cuenta.",
        "audioScript": "Consulta los detalles de préstamos y multas y comunica cualquier diferencia a la oficina.",
        "requiredContext": { "tab": "my-account" }
      }
    ],
    "category": "operational",
    "isOptional": false
  }
]

export function getSectionsForRole(role: string): TutorialSection[] {
  return TUTORIAL_SECTIONS.filter((section: TutorialSection) =>
    section.allowedRoles.includes(role as any)
  )
}

export function getTotalStepsForRole(role: string): number {
  return getSectionsForRole(role).reduce(
    (acc: number, sec: TutorialSection) => acc + sec.steps.length,
    0
  )
}
