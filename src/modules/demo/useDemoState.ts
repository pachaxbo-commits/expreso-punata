import { useState, useEffect, useCallback } from 'react'
import type {
  Shipment,
  CashShift,
  UnionMember,
  FixedAsset,
  UserProfile,
  ParcelDeliveryRecord,
} from '../../types'
import { DEMO_PROFILES, type DemoRoleId } from './demoTypes'
import {
  INITIAL_DEMO_SHIPMENTS,
  INITIAL_DEMO_CASH_SHIFT,
  INITIAL_DEMO_MEMBERS,
  INITIAL_DEMO_ASSETS,
} from './demoInitialData'

const DEMO_STORAGE_KEY = 'expreso-punata:demo:state:v2'

interface StoredDemoState {
  currentRoleId: DemoRoleId
  currentBranchId: string
  shipments: Shipment[]
  cashShift: CashShift | null
  members: UnionMember[]
  assets: FixedAsset[]
}

export function useDemoState() {
  const [currentRoleId, setCurrentRoleId] = useState<DemoRoleId>('admin')
  const [currentBranchId, setCurrentBranchId] = useState<string>('punata')
  const [shipments, setShipments] = useState<Shipment[]>(INITIAL_DEMO_SHIPMENTS)
  const [cashShift, setCashShift] = useState<CashShift | null>(INITIAL_DEMO_CASH_SHIFT)
  const [members, setMembers] = useState<UnionMember[]>(INITIAL_DEMO_MEMBERS)
  const [assets, setAssets] = useState<FixedAsset[]>(INITIAL_DEMO_ASSETS)
  const [isInitialized, setIsInitialized] = useState(false)

  // Carga inicial resiliente desde localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DEMO_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as StoredDemoState
        if (parsed.currentRoleId && DEMO_PROFILES[parsed.currentRoleId]) {
          setCurrentRoleId(parsed.currentRoleId)
        }
        if (parsed.currentBranchId) setCurrentBranchId(parsed.currentBranchId)
        if (Array.isArray(parsed.shipments)) setShipments(parsed.shipments)
        if (parsed.cashShift !== undefined) setCashShift(parsed.cashShift)
        if (Array.isArray(parsed.members)) setMembers(parsed.members)
        if (Array.isArray(parsed.assets)) setAssets(parsed.assets)
      }
    } catch (e) {
      console.warn('[DemoState] No se pudo recuperar estado previo, usando inicial:', e)
    } finally {
      setIsInitialized(true)
    }
  }, [])

  // Persistencia automática
  useEffect(() => {
    if (!isInitialized) return
    try {
      const stateToSave: StoredDemoState = {
        currentRoleId,
        currentBranchId,
        shipments,
        cashShift,
        members,
        assets,
      }
      localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(stateToSave))
    } catch (e) {
      console.error('[DemoState] Error al persistir estado demo:', e)
    }
  }, [currentRoleId, currentBranchId, shipments, cashShift, members, assets, isInitialized])

  // Perfil sintetizado de usuario según el rol seleccionado
  const roleConfig = DEMO_PROFILES[currentRoleId]
  const demoUserProfile: UserProfile = {
    uid: `demo-user-${currentRoleId}`,
    email: `${currentRoleId}@demo.expresopunata.com`,
    phone: '70000000',
    fullName: roleConfig.fullName,
    role: roleConfig.role,
    primaryBranchId: roleConfig.branchId,
    allowedBranchIds: roleConfig.allowedBranches,
    isActive: true,
  }

  // Cambio de rol seguro
  const switchRole = useCallback((roleId: DemoRoleId) => {
    const config = DEMO_PROFILES[roleId]
    if (!config) return
    setCurrentRoleId(roleId)
    setCurrentBranchId(config.branchId)
  }, [])

  // Cambio de sucursal (para administradores)
  const switchBranch = useCallback((branchId: string) => {
    setCurrentBranchId(branchId)
  }, [])

  // Operación simulada: Registro de encomienda
  const addShipment = useCallback((newShipment: Partial<Shipment>) => {
    const codeNumber = Math.floor(100 + Math.random() * 900)
    const trackingCode = `DEMO-PNT-${codeNumber}`
    const created: Shipment = {
      id: `demo-shp-${Date.now()}`,
      trackingCode,
      createdAt: new Date().toISOString(),
      createdAtIso: new Date().toISOString(),
      registeredByUid: demoUserProfile.uid,
      registeredByName: demoUserProfile.fullName,
      originBranchId: currentBranchId,
      originCity: currentBranchId === 'punata' ? 'Punata' : 'Cochabamba',
      destinationBranchId: newShipment.destinationBranchId || (currentBranchId === 'punata' ? 'cochabamba' : 'punata'),
      destinationCity: newShipment.destinationBranchId === 'cochabamba' ? 'Cochabamba' : 'Punata',
      deliveryType: newShipment.deliveryType || 'agency',
      sender: newShipment.sender || {
        name: 'Cliente Remitente Demo',
        phone: '70000001',
        docType: 'CI',
        docNumber: '1234567-CB',
      },
      recipient: newShipment.recipient || {
        name: 'Cliente Destinatario Demo',
        phone: '70000002',
        docType: 'CI',
        docNumber: '7654321-CB',
      },
      items: newShipment.items || [
        {
          description: 'Paquete de muestra demostrativa',
          category: 'general',
          quantity: 1,
          packaging: 'paquete',
          weightKg: 2.0,
          declaredValue: 50,
          isFragile: false,
        },
      ],
      packageCount: newShipment.packageCount || 1,
      totalWeightKg: newShipment.totalWeightKg || 2.0,
      declaredValueTotal: newShipment.declaredValueTotal || 50,
      prohibitedGoodsNoticeAccepted: true,
      shippingFeeCents: newShipment.shippingFeeCents || 2000,
      weightSurchargeCents: newShipment.weightSurchargeCents || 0,
      homeDeliveryFeeCents: newShipment.homeDeliveryFeeCents || 0,
      discountCents: newShipment.discountCents || 0,
      agreedAmountCents: newShipment.agreedAmountCents || 2000,
      finalAmountCents: newShipment.finalAmountCents || 2000,
      finalAmountBob: (newShipment.finalAmountCents || 2000) / 100,
      paymentTiming: newShipment.paymentTiming || 'origin_paid',
      paymentStatus: newShipment.paymentTiming === 'destination_cod' ? 'pending' : 'paid',
      paymentMethod: 'cash',
      paidAt: newShipment.paymentTiming === 'destination_cod' ? undefined : new Date().toISOString(),
      status: 'received',
      ...newShipment,
      auditHistory: [{
        reason: 'Guía registrada', changedAt: new Date().toISOString(),
        operatorUid: demoUserProfile.uid, operatorName: demoUserProfile.fullName,
        operatorRole: demoUserProfile.role, branchId: currentBranchId,
        newStatus: 'received', previousValues: {}, newValues: { status: 'received' },
      }],
    }

    setShipments(prev => [created, ...prev])
    return created
  }, [currentBranchId, demoUserProfile])

  const updateShipment = (updated: Shipment) => setShipments(prev =>
    prev.map(shipment => shipment.id === updated.id ? updated : shipment))

  // Operación simulada: Entrega con firma
  const deliverShipment = useCallback((shipmentId: string, deliveryData?: Partial<ParcelDeliveryRecord>) => {
    setShipments(prev =>
      prev.map(s => {
        if (s.id !== shipmentId) return s
        const record: ParcelDeliveryRecord = {
          deliveredAt: new Date().toISOString(),
          deliveredAtIso: new Date().toISOString(),
          deliveredByUid: demoUserProfile.uid,
          deliveredByName: demoUserProfile.fullName,
          deliveredByRole: demoUserProfile.role,
          deliveryChannel: 'agency_counter',
          receivedByName: deliveryData?.receivedByName || s.recipient.name,
          receivedByDocType: deliveryData?.receivedByDocType || s.recipient.docType || 'CI',
          receivedByDocNumber: deliveryData?.receivedByDocNumber || s.recipient.docNumber || '1234567-CB',
          recipientRelationship: deliveryData?.recipientRelationship || 'titular',
          signatureDataUrl: deliveryData?.signatureDataUrl || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="30"><path d="M5 15 Q 35 2, 70 18 T 95 15" stroke="black" fill="none"/></svg>',
          deliveryNotes: deliveryData?.deliveryNotes || 'Entrega confirmada en entorno demo interactivo',
        }
        return {
          ...s,
          status: 'delivered',
          auditHistory: [...(s.auditHistory || []), {
            reason: 'Entrega con firma', changedAt: record.deliveredAt,
            operatorUid: demoUserProfile.uid, operatorName: demoUserProfile.fullName,
            operatorRole: demoUserProfile.role, branchId: currentBranchId,
            previousStatus: s.status, newStatus: 'delivered',
            previousValues: { status: s.status }, newValues: { status: 'delivered' },
          }],
          deliveryRecord: record,
          paymentStatus: 'paid',
          paidAt: s.paidAt || new Date().toISOString(),
        }
      })
    )
  }, [demoUserProfile, currentBranchId])

  // Restablecer datos iniciales
  const resetDemo = useCallback(() => {
    try {
      localStorage.removeItem(DEMO_STORAGE_KEY)
    } catch (e) {
      console.warn('Error clearing localStorage', e)
    }
    setCurrentRoleId('admin')
    setCurrentBranchId('punata')
    setShipments(INITIAL_DEMO_SHIPMENTS)
    setCashShift(INITIAL_DEMO_CASH_SHIFT)
    setMembers(INITIAL_DEMO_MEMBERS)
    setAssets(INITIAL_DEMO_ASSETS)
  }, [])

  return {
    currentRoleId,
    currentProfile: roleConfig,
    demoUserProfile,
    currentBranchId,
    shipments,
    cashShift,
    members,
    assets,
    switchRole,
    switchBranch,
    addShipment,
    updateShipment,
    deliverShipment,
    resetDemo,
  }
}
