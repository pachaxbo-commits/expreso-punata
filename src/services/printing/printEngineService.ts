import jsPDF from 'jspdf'
import type {
  UnifiedDocumentPayload,
  PrinterProfile,
  PrintResult,
  PaperFormat,
} from '../../types/printing.ts'
import { getDefaultPrinter, loadPrinterProfiles } from './printerProfiles.ts'
import { printViaBrowserDialog, buildDocumentHtml } from '../../adapters/printing/browserDialogPrinterAdapter.ts'
import { printViaRawBt, isAndroidDevice } from '../../adapters/printing/rawbtPrinterAdapter.ts'
import { INITIAL_BRANCHES } from '../../domain/expresoPunataConfig.ts'
import type { Shipment, CashShift, FinancialMovement, DispatchManifest } from '../../types/index.ts'

export class PrintEngineService {
  private static instance: PrintEngineService

  public static getInstance(): PrintEngineService {
    if (!PrintEngineService.instance) {
      PrintEngineService.instance = new PrintEngineService()
    }
    return PrintEngineService.instance
  }

  /**
   * Imprime un documento unificado usando la impresora predeterminada o especificada.
   */
  public async printDocument(
    doc: UnifiedDocumentPayload,
    printerOverride?: PrinterProfile
  ): Promise<PrintResult> {
    const branch = INITIAL_BRANCHES.find((b) => b.id === doc.branchId) || INITIAL_BRANCHES[0]
    const effectivePrinter = printerOverride || getDefaultPrinter(doc.branchId)

    // Completar datos de sucursal si faltan
    if (!doc.branchName) doc.branchName = branch.name
    if (!doc.branchAddress) doc.branchAddress = branch.address
    if (!doc.branchPhone) doc.branchPhone = branch.phone

    const paperFormat: PaperFormat = effectivePrinter.paperFormat || '80mm'
    const options = {
      fontSize: effectivePrinter.capabilities.fontSize,
      marginsMm: effectivePrinter.capabilities.marginsMm,
      includeQr: effectivePrinter.capabilities.supportsQrCode,
      includeLogo: effectivePrinter.capabilities.supportsLogo,
      cutPaper: effectivePrinter.cutPaperOnFinish,
      kickDrawer: effectivePrinter.kickDrawerOnReceipt,
    }

    if (effectivePrinter.connectionType === 'virtual_pdf') {
      return await this.downloadVirtualPdf(doc, paperFormat)
    }

    if (effectivePrinter.connectionType === 'rawbt_intent') {
      return await printViaRawBt(doc, paperFormat, options)
    }

    // Por defecto y para Windows USB (o Red configurada en Windows): Diálogo estándar de navegador
    return await printViaBrowserDialog(doc, paperFormat, options)
  }

  /**
   * Genera y descarga un documento PDF virtual.
   */
  public async downloadVirtualPdf(
    doc: UnifiedDocumentPayload,
    paperFormat: PaperFormat = 'letter'
  ): Promise<PrintResult> {
    const jobId = `pdf-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
    const nowIso = new Date().toISOString()

    try {
      const isThermal = paperFormat === '58mm' || paperFormat === '80mm'
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: isThermal ? [paperFormat === '58mm' ? 58 : 80, 200] : paperFormat === 'half_letter' ? [140, 216] : 'letter',
      })

      const pageWidth = pdf.internal.pageSize.getWidth()
      let y = 12

      // Encabezado
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(isThermal ? 13 : 16)
      pdf.text('EXPRESO PUNATA', pageWidth / 2, y, { align: 'center' })
      y += 5

      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(isThermal ? 9 : 10)
      pdf.text(`Agencia: ${doc.branchName || doc.branchId}`, pageWidth / 2, y, { align: 'center' })
      y += 4
      if (doc.branchPhone) {
        pdf.text(`Tel: ${doc.branchPhone}`, pageWidth / 2, y, { align: 'center' })
        y += 4
      }

      pdf.line(8, y, pageWidth - 8, y)
      y += 5

      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(isThermal ? 11 : 12)
      pdf.text(doc.title.toUpperCase(), pageWidth / 2, y, { align: 'center' })
      y += 4
      pdf.setFontSize(isThermal ? 10 : 11)
      pdf.text(`DOC: ${doc.documentNumber}`, pageWidth / 2, y, { align: 'center' })
      y += 6

      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(isThermal ? 8.5 : 9.5)
      pdf.text(`Fecha: ${new Date(doc.timestampIso).toLocaleString('es-BO')}`, 10, y)
      y += 4
      pdf.text(`Operador: ${doc.operatorName}`, 10, y)
      y += 5

      if (doc.sender) {
        pdf.text(`Remitente: ${doc.sender.name}`, 10, y)
        y += 4
      }
      if (doc.recipient) {
        pdf.text(`Consignatario: ${doc.recipient.name}`, 10, y)
        y += 5
      }

      if (doc.items && doc.items.length > 0) {
        pdf.line(8, y, pageWidth - 8, y)
        y += 4
        pdf.setFont('helvetica', 'bold')
        pdf.text('Contenido:', 10, y)
        y += 4
        pdf.setFont('helvetica', 'normal')
        for (const it of doc.items) {
          pdf.text(`${it.quantity}x ${it.description} (${it.weightKg || 0} kg) - Bs ${(it.totalBob || 0).toFixed(2)}`, 10, y)
          y += 4
        }
      }

      if (doc.financials) {
        pdf.line(8, y, pageWidth - 8, y)
        y += 5
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(isThermal ? 11 : 13)
        const total = doc.financials.totalBob || (doc.financials.amountCents / 100) || 0
        pdf.text(`TOTAL: Bs ${total.toFixed(2)}`, pageWidth - 10, y, { align: 'right' })
        y += 6
      }

      pdf.setFont('helvetica', 'italic')
      pdf.setFontSize(7.5)
      pdf.text('DOCUMENTO OPERATIVO INTERNO — NO CONSTITUYE FACTURA FISCAL', pageWidth / 2, y + 6, { align: 'center' })

      const fileName = `${doc.documentType}_${doc.documentNumber}.pdf`
      pdf.save(fileName)

      return {
        success: true,
        jobId,
        connectionType: 'virtual_pdf',
        status: 'pdf_downloaded',
        message: `Documento PDF generado y descargado: ${fileName}`,
        dispatchedAtIso: nowIso,
      }
    } catch (err: any) {
      return {
        success: false,
        jobId,
        connectionType: 'virtual_pdf',
        status: 'failed',
        message: 'Error al generar documento PDF.',
        errorMessage: err?.message,
        dispatchedAtIso: nowIso,
      }
    }
  }

  /**
   * Genera el código HTML del documento para vista previa en pantalla o modal.
   */
  public async generatePreviewHtml(
    doc: UnifiedDocumentPayload,
    paperFormat: PaperFormat = '80mm'
  ): Promise<string> {
    return await buildDocumentHtml(doc, paperFormat)
  }

  /**
   * Construye un payload unificado a partir de una encomienda real.
   */
  public buildFromShipment(
    shipment: Shipment,
    operatorName: string,
    isDeliveryProof: boolean = false,
    signatureUrl?: string | null
  ): UnifiedDocumentPayload {
    const branch = INITIAL_BRANCHES.find((b) => b.id === shipment.originBranchId) || INITIAL_BRANCHES[0]
    const destBranch = INITIAL_BRANCHES.find((b) => b.id === shipment.destinationBranchId) || INITIAL_BRANCHES[1]
    const nowIso = new Date().toISOString()
    const amountBob = (shipment.finalAmountCents || 0) / 100

    return {
      documentType: isDeliveryProof ? 'delivery_proof' : 'shipment_guide',
      title: isDeliveryProof ? 'CONSTANCIA DE ENTREGA DE ENCOMIENDA' : 'GUÍA OFICIAL DE ENCOMIENDA',
      subtitle: `${branch.name} ➔ ${destBranch.name}`,
      branchId: isDeliveryProof ? shipment.destinationBranchId : shipment.originBranchId,
      branchName: isDeliveryProof ? destBranch.name : branch.name,
      branchAddress: isDeliveryProof ? destBranch.address : branch.address,
      branchPhone: isDeliveryProof ? destBranch.phone : branch.phone,
      documentNumber: shipment.trackingCode,
      trackingCode: shipment.trackingCode,
      qrContent: `EXPRESO-PUNATA:${shipment.trackingCode}`,
      timestampIso: isDeliveryProof && shipment.deliveryRecord?.deliveredAtIso ? shipment.deliveryRecord.deliveredAtIso : (shipment.createdAtIso || nowIso),
      operatorName,
      sender: {
        name: shipment.sender.name,
        phone: shipment.sender.phone,
        docType: shipment.sender.docType,
        docNumber: shipment.sender.docNumber,
      },
      recipient: {
        name: shipment.recipient.name,
        phone: shipment.recipient.phone,
        docType: shipment.recipient.docType,
        docNumber: shipment.recipient.docNumber,
        relationship: shipment.deliveryRecord?.recipientRelationship,
      },
      items: shipment.items.map((it) => ({
        description: it.description,
        quantity: it.quantity,
        packaging: it.packaging,
        weightKg: shipment.totalWeightKg,
        totalBob: amountBob,
      })),
      financials: {
        subtotalBob: amountBob,
        totalBob: amountBob,
        amountCents: shipment.finalAmountCents,
        paymentTiming: shipment.paymentTiming,
        paymentStatus: shipment.paymentStatus === 'paid' ? 'paid' : 'pending',
        paymentMethod: shipment.paymentMethod,
        collectedByDriverUid: (shipment as any).collectedByDriverUid || shipment.driverCustody?.driverUid || shipment.assignedVehicle?.driverUid || null,
      },
      signatures: {
        operatorSignatureName: operatorName,
        clientSignatureName: isDeliveryProof ? (shipment.deliveryRecord?.receivedByName || shipment.recipient.name) : undefined,
        signatureDataUrl: signatureUrl || shipment.deliveryRecord?.signatureDataUrl,
      },
      footerNotes: [
        'Conserve este comprobante para cualquier consulta sobre su envío.',
      ],
    }
  }

  /**
   * Construye un payload unificado para recibo de cobro en ventanilla.
   */
  public buildFromCashMovement(
    movement: FinancialMovement,
    operatorName: string
  ): UnifiedDocumentPayload {
    const branch = INITIAL_BRANCHES.find((b) => b.id === movement.branchId) || INITIAL_BRANCHES[0]
    const amountBob = movement.amountCents / 100

    return {
      documentType: 'payment_receipt',
      title: 'RECIBO DE COBRO EN VENTANILLA',
      subtitle: movement.concept,
      branchId: movement.branchId,
      branchName: branch.name,
      branchAddress: branch.address,
      branchPhone: branch.phone,
      documentNumber: movement.id || `REC-${Date.now().toString().slice(-6)}`,
      trackingCode: movement.trackingCode || undefined,
      timestampIso: movement.timestamp || new Date().toISOString(),
      operatorName,
      financials: {
        subtotalBob: amountBob,
        totalBob: amountBob,
        amountCents: movement.amountCents,
        paymentMethod: movement.paymentMethod === 'none' ? 'cash' : (movement.paymentMethod as any),
        paymentStatus: 'paid',
        paymentConditionLabel: movement.type === 'driver_remittance'
          ? (movement.settlementType === 'partial' ? 'RENDICIÓN PARCIAL EN CAJA' : 'RENDICIÓN COMPLETA EN CAJA')
          : movement.type === 'cod_income'
          ? 'CONTRAENTREGA COBRADA EN DESTINO'
          : 'PAGADO EN ORIGEN',
      },
      footerNotes: ['Comprobante de ingreso de caja.'],
    }
  }

  /**
   * Construye un payload unificado para cierre de turno y arqueo de caja.
   */
  public buildFromCashShift(
    shift: CashShift,
    operatorName: string
  ): UnifiedDocumentPayload {
    const branch = INITIAL_BRANCHES.find((b) => b.id === shift.branchId) || INITIAL_BRANCHES[0]
    const b = shift.breakdown

    return {
      documentType: 'cash_shift_close',
      title: 'ACTA DE CIERRE DE TURNO Y ARQUEO',
      subtitle: `Turno: ${shift.id}`,
      branchId: shift.branchId,
      branchName: branch.name,
      branchAddress: branch.address,
      branchPhone: branch.phone,
      documentNumber: shift.id,
      timestampIso: shift.closedAt || new Date().toISOString(),
      operatorName: shift.closedByName || operatorName,
      financials: {
        subtotalBob: (shift.expectedCashCents || 0) / 100,
        totalBob: (shift.actualCashCents ?? shift.expectedCashCents ?? 0) / 100,
        amountCents: shift.actualCashCents ?? shift.expectedCashCents ?? 0,
        initialCashBob: (shift.initialCashCents || 0) / 100,
        expectedCashBob: (shift.expectedCashCents || 0) / 100,
        countedCashBob: shift.actualCashCents !== undefined && shift.actualCashCents !== null ? shift.actualCashCents / 100 : undefined,
        differenceBob: shift.differenceCents !== undefined && shift.differenceCents !== null ? shift.differenceCents / 100 : 0,
        paymentConditionLabel: 'ARQUEO Y CONCILIACIÓN DE CAJA',
      },
      items: [
        { description: 'Fondo Inicial de Caja', quantity: 1, totalBob: (shift.initialCashCents || 0) / 100 },
        { description: 'Ingresos por Encomiendas (Origen)', quantity: 1, totalBob: (b.shipmentsIncomeCents || 0) / 100 },
        { description: 'Ingresos por Contraentrega (COD)', quantity: 1, totalBob: (b.codIncomeCents || 0) / 100 },
        { description: 'Remesas Rendidas por Choferes', quantity: 1, totalBob: (b.otherIncomeCents || 0) / 100 },
        { description: 'Egresos de Caja Autorizados', quantity: 1, totalBob: -((b.expensesCents || 0) / 100) },
      ],
      signatures: {
        operatorSignatureName: shift.operatorName,
      },
      footerNotes: [
        shift.closingNotes ? `Observaciones: ${shift.closingNotes}` : 'Arqueo de turno completado.',
      ],
    }
  }

  /**
   * Construye un payload unificado para acta de rendición de cuentas de conductor.
   */
  public buildFromDriverSettlement(
    settlement: any,
    operatorName: string
  ): UnifiedDocumentPayload {
    const branch = INITIAL_BRANCHES.find((b) => b.id === settlement.branchId) || INITIAL_BRANCHES[0]
    const amountBob = (settlement.amountCents || 0) / 100

    return {
      documentType: 'driver_settlement',
      title: 'ACTA DE RENDICIÓN DE FONDOS DE CONDUCTOR',
      subtitle: `Comprobante: ${settlement.settlementNumber || settlement.id}`,
      branchId: settlement.branchId || 'punata',
      branchName: branch.name,
      branchAddress: branch.address,
      branchPhone: branch.phone,
      documentNumber: settlement.settlementNumber || settlement.id,
      timestampIso: settlement.createdAtIso || new Date().toISOString(),
      operatorName,
      financials: {
        subtotalBob: amountBob,
        totalBob: amountBob,
        amountCents: settlement.amountCents || 0,
        driverBalanceBeforeBob: settlement.previousDriverBalanceCents !== undefined ? settlement.previousDriverBalanceCents / 100 : undefined,
        driverRemittanceBob: amountBob,
        driverBalanceRemainingBob: settlement.remainingDriverBalanceCents !== undefined ? settlement.remainingDriverBalanceCents / 100 : 0,
        remittanceType: settlement.remainingDriverBalanceCents === 0 ? 'full' : 'partial',
        paymentMethod: 'cash',
        paymentConditionLabel: settlement.remainingDriverBalanceCents === 0 ? 'RENDICIÓN COMPLETA EN CAJA' : 'RENDICIÓN PARCIAL EN CAJA',
      },
      items: (settlement.shipmentIds || []).map((sId: string) => ({
        description: `Guía conciliada: ${sId}`,
        quantity: 1,
        totalBob: amountBob,
      })),
      signatures: {
        operatorSignatureName: operatorName,
        driverSignatureName: settlement.driverName || 'Conductor Titular',
      },
      footerNotes: [
        'Transferencia interna de custodia bajo verificación física.',
      ],
    }
  }

  /**
   * Construye un payload unificado para manifiesto de despacho y hoja de ruta.
   */
  public buildFromDispatchManifest(
    manifest: DispatchManifest,
    operatorName: string
  ): UnifiedDocumentPayload {
    const originBranch = INITIAL_BRANCHES.find((b) => b.id === manifest.originBranchId) || INITIAL_BRANCHES[0]
    const destBranch = INITIAL_BRANCHES.find((b) => b.id === manifest.destinationBranchId) || INITIAL_BRANCHES[1]
    const codBob = (manifest.totalCodAmountCents || 0) / 100

    return {
      documentType: 'dispatch_manifest',
      title: 'MANIFIESTO DE DESPACHO Y HOJA DE RUTA',
      subtitle: `${originBranch.name} ➔ ${destBranch.name}`,
      branchId: manifest.originBranchId,
      branchName: originBranch.name,
      branchAddress: originBranch.address,
      branchPhone: originBranch.phone,
      documentNumber: manifest.manifestNumber || manifest.id,
      timestampIso: manifest.dispatchedAtIso || manifest.dispatchedAt || new Date().toISOString(),
      operatorName: manifest.dispatchedByName || operatorName,
      qrContent: `EXPRESO-PUNATA:MAN:${manifest.manifestNumber || manifest.id}:${manifest.vehiclePlate}:${manifest.driverName}`,
      dispatch: {
        originBranchName: originBranch.name,
        destinationBranchName: destBranch.name,
        vehiclePlate: manifest.vehiclePlate,
        mobileNumber: manifest.mobileNumber,
        driverName: manifest.driverName,
        driverPhone: manifest.driverPhone,
        totalPackages: manifest.totalPackages || manifest.shipmentSummaries?.reduce((acc, s) => acc + (s.packageCount || 1), 0) || 0,
        totalWeightKg: manifest.totalWeightKg || manifest.shipmentSummaries?.reduce((acc, s) => acc + (s.totalWeightKg || 0), 0) || 0,
        totalCodToCollectBob: codBob,
      },
      financials: {
        subtotalBob: codBob,
        totalBob: codBob,
        amountCents: manifest.totalCodAmountCents || 0,
        paymentConditionLabel: codBob > 0 ? `COD A COBRAR EN DESTINO: Bs ${codBob.toFixed(2)}` : 'SIN COBROS PENDIENTES',
      },
      items: (manifest.shipmentSummaries || []).map((s) => ({
        description: `Guía: ${s.trackingCode} (${s.packageCount || 1} bulto(s) - ${s.senderName} ➔ ${s.recipientName})`,
        quantity: s.packageCount || 1,
        weightKg: s.totalWeightKg,
        totalBob: (s.finalAmountCents || 0) / 100,
      })),
      signatures: {
        driverSignatureName: manifest.driverName,
        operatorSignatureName: manifest.dispatchedByName || operatorName,
        clientSignatureName: manifest.receivedByName || undefined,
      },
      footerNotes: [
        `Vehículo: ${manifest.vehiclePlate} | Móvil: Nº ${manifest.mobileNumber}`,
        `Total Guías: ${manifest.totalShipments || manifest.shipmentIds?.length || 0} | Bultos: ${manifest.totalPackages}`,
        manifest.departureNotes ? `Observaciones: ${manifest.departureNotes}` : 'Manifiesto oficial de carga interprovincial.',
      ],
    }
  }

  /**
   * Construye un payload unificado para recibo de aporte de socio o cuota mensual.
   */
  public buildFromMemberPayment(
    paymentResult: any,
    member: any,
    branchId: string,
    operatorName: string
  ): UnifiedDocumentPayload {
    const branch = INITIAL_BRANCHES.find((b) => b.id === branchId) || INITIAL_BRANCHES[0]
    const amountBob = paymentResult.amountBob || (paymentResult.amountCents / 100) || 0

    return {
      documentType: 'payment_receipt',
      title: 'RECIBO OFICIAL DE APORTE SOCIAL',
      subtitle: `Período: ${paymentResult.periodLabel || paymentResult.period}`,
      branchId,
      branchName: branch.name,
      branchAddress: branch.address,
      branchPhone: branch.phone,
      documentNumber: paymentResult.receiptNumber,
      timestampIso: paymentResult.paidAtIso || new Date().toISOString(),
      operatorName: paymentResult.collectedByName || operatorName,
      qrContent: `EXPRESO-PUNATA:SOC-REC:${paymentResult.receiptNumber}:${paymentResult.memberNumber}:${amountBob.toFixed(2)}`,
      recipient: {
        name: `${paymentResult.memberNumber} - ${paymentResult.memberName || member?.fullName || 'Socio'}`,
        phone: member?.phone,
        docType: 'CI',
        docNumber: member?.ci,
      },
      items: [
        {
          description: `Cuota mensual ordinaria (${paymentResult.periodLabel || paymentResult.period})`,
          quantity: 1,
          totalBob: amountBob,
        },
      ],
      financials: {
        subtotalBob: amountBob,
        totalBob: amountBob,
        amountCents: paymentResult.amountCents,
        paymentMethod: paymentResult.paymentMethod || 'cash',
        paymentConditionLabel: paymentResult.status === 'paid' ? 'APORTE MENSUAL CANCELADO' : 'PAGO PARCIAL DE APORTE',
      },
      signatures: {
        operatorSignatureName: paymentResult.collectedByName || operatorName,
        clientSignatureName: paymentResult.memberName || member?.fullName,
      },
      footerNotes: [
        `Socio: ${paymentResult.memberNumber} | Categoría: ${member?.category || 'Socio'}`,
        paymentResult.remainingBalanceBob > 0
          ? `Saldo adeudado de cuota: Bs ${paymentResult.remainingBalanceBob.toFixed(2)}`
          : 'Cuota del período cancelada en su totalidad.',
        'Aporte registrado en el libro oficial de recaudaciones sindicales.',
      ],
    }
  }

  /**
   * Genera e imprime un ticket de prueba y diagnóstico de estación de trabajo.
   */
  /**
   * Construye el documento unificado para comprobante de pago de salario o anticipo a trabajador.
   */
  public buildFromWorkerPayment(
    payment: any,
    branchId: string,
    operatorName: string
  ): UnifiedDocumentPayload {
    const branch = INITIAL_BRANCHES.find((b) => b.id === branchId) || INITIAL_BRANCHES[0]
    const amountBob = payment.amountBob || (payment.amountCents ? payment.amountCents / 100 : 0)

    return {
      documentType: 'worker_payroll_receipt',
      title: 'RECIBO DE PAGO DE PERSONAL',
      subtitle: `Concepto: ${payment.concept || 'Nómina / Salario'}`,
      branchId,
      branchName: branch.name,
      branchAddress: branch.address,
      branchPhone: branch.phone,
      documentNumber: payment.paymentNumber || payment.receiptNumber || 'REC-TRA-00000',
      timestampIso: payment.paidAtIso || new Date().toISOString(),
      operatorName: payment.registeredByName || operatorName,
      qrContent: `EXPRESO-PUNATA:PAGO-TRA:${payment.paymentNumber || payment.receiptNumber}:${payment.workerCode || ''}:${amountBob.toFixed(2)}`,
      recipient: {
        name: `${payment.workerName || 'Trabajador'} (${payment.workerCode || ''})`,
        docType: 'CI',
        docNumber: payment.workerCi || '',
      },
      items: [
        {
          description: `${payment.concept || 'Sueldo / Adelanto'} (${payment.period || 'Período corriente'})`,
          quantity: 1,
          totalBob: amountBob,
        },
      ],
      financials: {
        subtotalBob: amountBob,
        totalBob: amountBob,
        amountCents: payment.amountCents || Math.round(amountBob * 100),
        paymentMethod: payment.paymentMethod || 'cash',
        paymentConditionLabel: 'PAGO DE PERSONAL EFECTUADO',
      },
      signatures: {
        operatorSignatureName: payment.registeredByName || operatorName,
        clientSignatureName: payment.workerName || 'Firma Trabajador',
      },
      footerNotes: [
        `Cargo: ${payment.workerRole || 'Personal'} | Período: ${payment.period || '-'}`,
        `Método: ${(payment.paymentMethod || 'cash').toUpperCase()}`,
        'Constancia de pago y conformidad de recepción de fondos.',
      ],
    }
  }

  /**
   * Construye el documento unificado para comprobante oficial de egreso operativo.
   */
  public buildFromGeneralExpense(
    expense: any,
    branchId: string,
    operatorName: string
  ): UnifiedDocumentPayload {
    const branch = INITIAL_BRANCHES.find((b) => b.id === branchId) || INITIAL_BRANCHES[0]
    const amountBob = expense.amountBob || (expense.amountCents ? expense.amountCents / 100 : 0)

    return {
      documentType: 'general_expense_voucher',
      title: 'COMPROBANTE DE EGRESO OPERATIVO',
      subtitle: `Categoría: ${(expense.category || 'Gasto').toUpperCase()}`,
      branchId,
      branchName: branch.name,
      branchAddress: branch.address,
      branchPhone: branch.phone,
      documentNumber: expense.voucherNumber || 'EGR-00000',
      timestampIso: expense.createdAtIso || expense.paidAtIso || new Date().toISOString(),
      operatorName: expense.createdByName || expense.registeredByName || operatorName,
      qrContent: `EXPRESO-PUNATA:EGRESO:${expense.voucherNumber}:${expense.category}:${amountBob.toFixed(2)}`,
      recipient: {
        name: expense.supplier ? `Proveedor / Beneficiario: ${expense.supplier}` : 'Beneficiario General',
        docType: expense.invoiceOrReceiptNumber ? 'DOC' : undefined,
        docNumber: expense.invoiceOrReceiptNumber,
      },
      items: [
        {
          description: expense.concept || 'Gasto operativo',
          quantity: 1,
          totalBob: amountBob,
        },
      ],
      financials: {
        subtotalBob: amountBob,
        totalBob: amountBob,
        amountCents: expense.amountCents || Math.round(amountBob * 100),
        paymentMethod: expense.paymentMethod || 'cash',
        paymentConditionLabel: 'EGRESO OPERATIVO CONTABILIZADO',
      },
      signatures: {
        operatorSignatureName: expense.createdByName || operatorName,
        clientSignatureName: expense.supplier || 'Recibí Conforme',
      },
      footerNotes: [
        `Categoría: ${(expense.category || '').toUpperCase()} | Sucursal: ${(expense.branchId || branchId).toUpperCase()}`,
        expense.invoiceOrReceiptNumber ? `Nro Factura / Recibo: ${expense.invoiceOrReceiptNumber}` : '',
        'Comprobante interno justificado y auditado para rendición de caja.',
      ].filter(Boolean),
    }
  }

  /**
   * Construye el documento para etiqueta térmica de inventario de activo fijo.
   */
  public buildFromFixedAssetLabel(
    asset: any,
    branchId: string
  ): UnifiedDocumentPayload {
    const branch = INITIAL_BRANCHES.find((b) => b.id === (asset.branchId || branchId)) || INITIAL_BRANCHES[0]

    return {
      documentType: 'fixed_asset_label',
      title: 'ACTIVO FIJO — EXPRESO PUNATA',
      subtitle: `Código: ${asset.assetCode}`,
      branchId: asset.branchId || branchId,
      branchName: branch.name,
      branchAddress: branch.address,
      branchPhone: branch.phone,
      documentNumber: asset.assetCode,
      timestampIso: new Date().toISOString(),
      operatorName: asset.responsiblePersonName || 'Encargado',
      qrContent: `EXPRESO-PUNATA:ACTIVO:${asset.assetCode}:${asset.branchId}`,
      items: [
        {
          description: asset.name,
          quantity: 1,
        },
      ],
      footerNotes: [
        `Categoría: ${(asset.category || '').toUpperCase()}`,
        `Ubicación: ${asset.physicalLocation}`,
        `Responsable: ${asset.responsiblePersonName}`,
        `Estado: ${(asset.status || '').toUpperCase()}`,
      ],
    }
  }

  public async printTestTicket(
    branchId: string = 'punata',
    operatorName: string = 'Administrador',
    printerOverride?: PrinterProfile
  ): Promise<PrintResult> {
    const branch = INITIAL_BRANCHES.find((b) => b.id === branchId) || INITIAL_BRANCHES[0]
    const nowIso = new Date().toISOString()
    const printer = printerOverride || getDefaultPrinter(branchId)

    const testDoc: UnifiedDocumentPayload = {
      documentType: 'test_page',
      title: 'PÁGINA DE PRUEBA Y DIAGNÓSTICO',
      subtitle: '[TICKET DE PRUEBA SINTÉTICO]',
      branchId,
      branchName: branch.name,
      branchAddress: branch.address,
      branchPhone: branch.phone,
      documentNumber: `TEST-${Date.now().toString().slice(-6)}`,
      timestampIso: nowIso,
      operatorName,
      operatorRole: 'Operador / Administrador',
      qrContent: `EXPRESO-PUNATA:TEST-PRINT:${branchId}:${printer.id}:${nowIso}`,
      items: [
        { description: 'Verificación de fuentes y márgenes', quantity: 1, unitPriceBob: 0, totalBob: 0 },
        { description: 'Alineación de columnas térmicas', quantity: 1, unitPriceBob: 0, totalBob: 0 },
        { description: 'Contraste de líneas y separadores', quantity: 1, unitPriceBob: 0, totalBob: 0 },
      ],
      financials: {
        subtotalBob: 0,
        totalBob: 0,
        amountCents: 0,
        paymentConditionLabel: 'PRUEBA OPERATIVA — SIN VALOR COMERCIAL',
      },
      footerNotes: [
        `Impresora: ${printer.name}`,
        `Conexión: ${printer.connectionType.toUpperCase()}`,
        `Formato: ${printer.paperFormat} | Margen: ${printer.capabilities.marginsMm}mm`,
        `Plataforma: ${isAndroidDevice() ? 'Android (RawBT Ready)' : 'Windows / Web (Browser Dialog Ready)'}`,
        'Si lee este mensaje con claridad, su estación está lista para operar.',
      ],
    }

    return await this.printDocument(testDoc, printer)
  }

  /**
   * Ejecuta un autodiagnóstico de capacidades del dispositivo actual.
   */
  public runDiagnostics(branchId: string = 'punata') {
    const isAndroid = isAndroidDevice()
    const profiles = loadPrinterProfiles(branchId)
    const hasLocalStorage = typeof localStorage !== 'undefined'
    const defaultPrinter = profiles.find((p) => p.isDefault) || profiles[0]

    return {
      platform: isAndroid ? 'Android' : 'Windows / Escritorio',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Node.js',
      storageAvailable: hasLocalStorage,
      activeProfilesCount: profiles.length,
      defaultPrinterName: defaultPrinter?.name || 'Ninguna configurada',
      defaultFormat: defaultPrinter?.paperFormat || '80mm',
      defaultConnection: defaultPrinter?.connectionType || 'browser_dialog',
      rawBtSupported: isAndroid,
      browserDialogSupported: typeof window !== 'undefined',
      readyForProduction: profiles.length > 0 && hasLocalStorage,
    }
  }
}

export const printEngine = PrintEngineService.getInstance()
