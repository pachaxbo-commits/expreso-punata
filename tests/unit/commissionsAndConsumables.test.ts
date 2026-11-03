import { describe, it } from 'node:test'
import assert from 'node:assert'
import { printEngine } from '../../src/services/printing/printEngineService.ts'
import type {
  DriverCommissionAccount,
  DriverCommissionRule,
  ConsumableItem,
  ShipmentIncident,
} from '../../src/types/index.ts'

describe('FASE 5A: Comisiones de Conductores (Reglas de Cálculo y Saldos)', () => {
  it('1. Cálculo de comisión porcentual sobre flete', () => {
    const rule: DriverCommissionRule = { type: 'percentage', value: 10 }
    const baseShippingCents = 2500 // Bs 25.00

    const commissionCents = Math.round(baseShippingCents * (rule.value / 100))
    assert.strictEqual(commissionCents, 250) // Bs 2.50
    assert.strictEqual(commissionCents / 100, 2.5)
  })

  it('2. Cálculo de comisión por monto fijo por guía', () => {
    const rule: DriverCommissionRule = { type: 'fixed_per_shipment', value: 300 } // Bs 3.00 fijo
    // baseShippingCents = 5000

    const commissionCents = rule.value
    assert.strictEqual(commissionCents, 300)
    assert.strictEqual(commissionCents / 100, 3.0)
  })

  it('3. Saldo de cuenta de conductor: devengo y liquidación exacta', () => {
    const account: DriverCommissionAccount = {
      driverUid: 'driver-123',
      driverName: 'Juan Carlos Rodríguez',
      accruedCents: 0,
      paidCents: 0,
      pendingCents: 0,
    }

    // Devengo de 3 encomiendas: Bs 2.50, Bs 5.00, Bs 3.00
    const shipments = [250, 500, 300]
    for (const c of shipments) {
      account.accruedCents += c
      account.pendingCents += c
    }

    assert.strictEqual(account.accruedCents, 1050) // Bs 10.50
    assert.strictEqual(account.pendingCents, 1050)
    assert.strictEqual(account.paidCents, 0)

    // Liquidación parcial de Bs 6.00
    const settlePartial = 600
    assert.ok(settlePartial <= account.pendingCents, 'El pago no supera el saldo pendiente')
    account.paidCents += settlePartial
    account.pendingCents -= settlePartial

    assert.strictEqual(account.paidCents, 600)
    assert.strictEqual(account.pendingCents, 450) // Bs 4.50 restantes

    // Liquidación final de Bs 4.50
    const settleFinal = 450
    account.paidCents += settleFinal
    account.pendingCents -= settleFinal

    assert.strictEqual(account.pendingCents, 0)
    assert.strictEqual(account.paidCents, 1050)
    assert.strictEqual(account.accruedCents, 1050)
  })

  it('4. Generación de Vale Térmico de Liquidación con PrintEngine', () => {
    const voucher = {
      id: 'VOUCH-01',
      voucherNumber: 'COM-2026-00042',
      driverUid: 'driver-123',
      driverName: 'Juan Carlos Rodríguez',
      driverPhone: '71712345',
      branchId: 'punata',
      cashShiftId: 'shift-99',
      settledAmountCents: 4500,
      settledAmountBob: 45.0,
      previousPendingCents: 5000,
      remainingPendingCents: 500,
      commissionRecordIds: ['rec-1', 'rec-2'],
      shipmentIds: ['PUN202600001', 'PUN202600002'],
      notes: 'Liquidación conforme de manifiesto matutino',
      paidByUid: 'sec-01',
      paidByName: 'Secretaria Punata',
      createdAtIso: '2026-11-03T10:00:00.000Z',
    }

    const doc = printEngine.buildFromCommissionVoucher(voucher, 'Secretaria Punata')
    assert.strictEqual(doc.documentType, 'commission_voucher')
    assert.strictEqual(doc.title, 'VALE DE LIQUIDACIÓN DE COMISIÓN')
    assert.strictEqual(doc.documentNumber, 'COM-2026-00042')
    assert.strictEqual(doc.financials?.totalBob, 45.0)
    assert.ok(doc.qrContent?.includes('COM-2026-00042'))
    assert.ok(doc.signatures?.clientSignatureName?.includes('Juan Carlos Rodríguez'))
  })
})

describe('FASE 5B: Inventario de Consumibles e Insumos', () => {
  it('1. Control de existencias y activación de alerta de stock mínimo', () => {
    const item: ConsumableItem = {
      id: 'cons-01',
      code: 'ROL-80MM',
      name: 'Rollo de Papel Térmico 80mm',
      category: 'thermal_rolls',
      branchId: 'punata',
      currentStock: 10,
      unit: 'rollos',
      minStockAlert: 5,
      isLowStock: false,
      costPerUnitCents: 850,
      costPerUnitBob: 8.5,
      status: 'active',
      createdAtIso: new Date().toISOString(),
      updatedAtIso: new Date().toISOString(),
    }

    // Consumo de 3 rollos: stock = 7 (superior a minStockAlert 5 -> no alerta)
    item.currentStock -= 3
    item.isLowStock = item.currentStock <= item.minStockAlert
    assert.strictEqual(item.currentStock, 7)
    assert.strictEqual(item.isLowStock, false)

    // Consumo de 3 rollos adicionales: stock = 4 (menor a minStockAlert 5 -> alerta activada)
    item.currentStock -= 3
    item.isLowStock = item.currentStock <= item.minStockAlert
    assert.strictEqual(item.currentStock, 4)
    assert.strictEqual(item.isLowStock, true)

    // Entrada de 10 rollos nuevos: stock = 14 -> alerta desactivada
    item.currentStock += 10
    item.isLowStock = item.currentStock <= item.minStockAlert
    assert.strictEqual(item.currentStock, 14)
    assert.strictEqual(item.isLowStock, false)
  })

  it('2. Valuación de inventario de consumibles', () => {
    const items: ConsumableItem[] = [
      {
        id: '1',
        code: 'ROL-80MM',
        name: 'Rollos 80mm',
        category: 'thermal_rolls',
        branchId: 'punata',
        currentStock: 20,
        unit: 'rollos',
        minStockAlert: 5,
        costPerUnitCents: 800,
        costPerUnitBob: 8.0,
        status: 'active',
        createdAtIso: '',
        updatedAtIso: '',
      },
      {
        id: '2',
        code: 'PRE-SEG',
        name: 'Precintos de Seguridad',
        category: 'security_seals',
        branchId: 'punata',
        currentStock: 100,
        unit: 'unidades',
        minStockAlert: 20,
        costPerUnitCents: 150,
        costPerUnitBob: 1.5,
        status: 'active',
        createdAtIso: '',
        updatedAtIso: '',
      },
    ]

    const totalValuationCents = items.reduce(
      (sum, it) => sum + it.currentStock * (it.costPerUnitCents || 0),
      0
    )
    assert.strictEqual(totalValuationCents, 20 * 800 + 100 * 150) // 16000 + 15000 = 31000 centavos
    assert.strictEqual(totalValuationCents / 100, 310.0) // Bs 310.00
  })
})

describe('FASE 5C: Incidencias, Devoluciones y Daños de Encomiendas', () => {
  it('1. Registro de incidencia y mapeo a estado operativo', () => {
    const incident: ShipmentIncident = {
      id: 'inc-01',
      incidentNumber: 'INC-2026-00001',
      shipmentId: 'ship-100',
      trackingCode: 'PUN202600042',
      branchId: 'punata',
      incidentType: 'damaged',
      description: 'Caja recibida con rasgadura lateral y daño leve de embalaje',
      responsiblePerson: 'Conductor Móvil 14',
      status: 'open',
      compensationAmountCents: 0,
      compensationAmountBob: 0,
      financialConsequence: 'none',
      reportedByUid: 'sec-01',
      reportedByName: 'Secretaria Punata',
      createdAtIso: new Date().toISOString(),
      updatedAtIso: new Date().toISOString(),
    }

    assert.strictEqual(incident.incidentNumber, 'INC-2026-00001')
    assert.strictEqual(incident.status, 'open')
    assert.strictEqual(incident.financialConsequence, 'none')

    // Resolución con indemnización financiera acordada
    incident.status = 'compensated'
    incident.compensationAmountCents = 15000 // Bs 150.00
    incident.compensationAmountBob = 150.0
    incident.financialConsequence = 'cash_indemnity'

    assert.strictEqual(incident.compensationAmountCents, 15000)
    assert.strictEqual(incident.financialConsequence, 'cash_indemnity')
  })
})
