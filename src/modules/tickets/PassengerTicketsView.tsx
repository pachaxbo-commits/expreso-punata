import { hasOperationalRole } from '../auth/operationalRoles'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Banknote, CheckCircle2, Printer,
  QrCode, Search, Ticket, TicketCheck, X,
} from 'lucide-react'
import type { Branch, DriverDirectoryEntry, PassengerTicketOperation, UserProfile, Vehicle } from '../../types/index.ts'
import { formatCurrencyBob, parseBobToCents } from '../../domain/parcelEngine.ts'
import { listActiveDriversThroughBackend, subscribeVehicles } from '../../services/dispatchService.ts'
import {
  cancelPassengerTicketThroughBackend,
  createPassengerTicketThroughBackend,
  deliverPassengerTicketToDriverThroughBackend,
  subscribePassengerTicketOperations,
  validatePassengerTicketThroughBackend,
  verifyPassengerTicketPaymentThroughBackend,
} from '../../services/passengerTicketService.ts'
import { buildPassengerTicketPairHtml, printPassengerTicketPair, type PassengerTicketPaperWidth } from '../../services/passengerTicketPrintService.ts'

interface Props { currentUser: UserProfile; currentBranch: Branch; tutorialFormContextOpen?: boolean }

const staffRoles = ['secretaria', 'encargado_agencia', 'directiva_admin']
const formatDate = (value: string) => {
  if (!value) return '—'
  const date = new Date(`${value}T12:00:00`)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('es-BO', { dateStyle: 'medium' }) : value
}
const makeKey = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
const statusCopy: Record<PassengerTicketOperation['paymentStatus'], string> = {
  pending_verification: 'Pendiente de verificación', paid_verified: 'Pagado y verificado', cancelled: 'Anulado',
}

export const PassengerTicketsView: React.FC<Props> = ({ currentUser, currentBranch, tutorialFormContextOpen = false }) => {
  const isDriver = currentUser.role === 'conductor'
  const canRegister = hasOperationalRole(currentUser, staffRoles)
  const canReadAll = hasOperationalRole(currentUser, ['directiva_admin', 'tesoreria'])
  const [operations, setOperations] = useState<PassengerTicketOperation[]>([])
  const [drivers, setDrivers] = useState<DriverDirectoryEntry[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const tutorialOpenedFormRef = useRef(false)
  const [originBranchId, setOriginBranchId] = useState(currentBranch.id)
  const [destinationBranchId, setDestinationBranchId] = useState(currentBranch.id === 'punata' ? 'cochabamba' : 'punata')
  const [travelDate, setTravelDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' }))
  const [driverUid, setDriverUid] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [passengerName, setPassengerName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unitAmount, setUnitAmount] = useState('')
  const [search, setSearch] = useState('')
  const [filterDate, setFilterDate] = useState('')
  const [filterDriver, setFilterDriver] = useState('all')
  const [filterPayment, setFilterPayment] = useState('all')
  const [filterUse, setFilterUse] = useState('all')
  const [filterSettlement, setFilterSettlement] = useState('all')
  const [codeToValidate, setCodeToValidate] = useState('')
  const [verificationOperation, setVerificationOperation] = useState<PassengerTicketOperation | null>(null)
  const [confirmedAmount, setConfirmedAmount] = useState('')
  const [paymentReference, setPaymentReference] = useState('')
  const [cancelOperation, setCancelOperation] = useState<PassengerTicketOperation | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [deliveryOperation, setDeliveryOperation] = useState<PassengerTicketOperation | null>(null)
  const [authorizationCode, setAuthorizationCode] = useState('')
  const [printPreview, setPrintPreview] = useState<{ operation: PassengerTicketOperation; html: string; reprint: boolean } | null>(null)
  const [paperWidth, setPaperWidth] = useState<PassengerTicketPaperWidth>(80)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (tutorialFormContextOpen && canRegister) {
      if (!showForm) {
        tutorialOpenedFormRef.current = true
        setShowForm(true)
      }
      return
    }
    if (!tutorialFormContextOpen && tutorialOpenedFormRef.current) {
      tutorialOpenedFormRef.current = false
      setShowForm(false)
    }
  }, [tutorialFormContextOpen, canRegister, showForm])

  useEffect(() => subscribePassengerTicketOperations(currentUser, currentBranch.id, (items) => {
    setOperations(items)
    setLoading(false)
  }, (err) => {
    setError(err.message || 'No se pudieron consultar los pasajes.')
    setLoading(false)
  }), [currentUser.uid, currentUser.role, currentBranch.id])

  useEffect(() => {
    if (!canRegister) return
    let active = true
    listActiveDriversThroughBackend().then((result) => {
      if (active) setDrivers((result.drivers || []).filter((driver: DriverDirectoryEntry) => driver.isActive))
    }).catch((err) => {
      if (active) setError(err.message || 'No se pudo cargar el directorio de choferes.')
    })
    return () => { active = false }
  }, [canRegister])

  useEffect(() => {
    if (!canRegister) return
    return subscribeVehicles((items) => setVehicles(items.filter((vehicle) => vehicle.status === 'active')),
      (err) => setError(err.message || 'No se pudo consultar el padrón de vehículos.'))
  }, [canRegister])

  const amountCents = parseBobToCents(unitAmount)
  const count = Number(quantity)
  const totalCents = amountCents !== null && Number.isInteger(count) && count > 0 ? amountCents * count : 0
  const availableVehicles = vehicles.filter((vehicle) => vehicle.branchId === originBranchId && (!vehicle.assignedDriverUid || vehicle.assignedDriverUid === driverUid))

  const visibleOperations = useMemo(() => {
    const term = search.trim().toLowerCase()
    return operations.filter((operation) => {
      if (filterDate && operation.travelDate !== filterDate) return false
      if (filterDriver !== 'all' && operation.driverUid !== filterDriver) return false
      if (filterPayment !== 'all' && operation.paymentStatus !== filterPayment) return false
      if (filterUse !== 'all' && operation.useStatus !== filterUse) return false
      if (filterSettlement !== 'all' && operation.settlementStatus !== filterSettlement) return false
      if (term && ![operation.operationNumber, operation.ticketCode, operation.driverName, operation.passengerName || ''].some((field) => field.toLowerCase().includes(term))) return false
      return true
    })
  }, [operations, search, filterDate, filterDriver, filterPayment, filterUse, filterSettlement])

  const pendingByDriver = useMemo(() => {
    const totals = new Map<string, { name: string; amount: number; operations: number }>()
    operations.filter((operation) => operation.paymentStatus === 'paid_verified' && operation.settlementStatus === 'pending_delivery' && operation.pendingSettlementCents > 0)
      .forEach((operation) => {
        const current = totals.get(operation.driverUid) || { name: operation.driverName, amount: 0, operations: 0 }
        current.amount += operation.pendingSettlementCents
        current.operations += 1
        totals.set(operation.driverUid, current)
      })
    return Array.from(totals.entries()).map(([uid, value]) => ({ uid, ...value })).sort((a, b) => b.amount - a.amount)
  }, [operations])

  const setActionError = (err: unknown) => {
    const message = err instanceof Error ? err.message : 'No se pudo completar la operación.'
    setError(message)
    setNotice('')
  }

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setNotice('')
    if (!canRegister) return
    if (!driverUid || !travelDate || originBranchId === destinationBranchId || !Number.isInteger(count) || count < 1 || amountCents === null || amountCents <= 0) {
      setError('Completa ruta, fecha, chofer, cantidad e importe positivo por pasaje.')
      return
    }
    setSaving(true)
    try {
      const result = await createPassengerTicketThroughBackend({
        branchId: currentBranch.id, originBranchId, destinationBranchId, travelDate, driverUid,
        vehicleId: vehicleId || null, passengerName, quantity: count, unitAmountCents: amountCents,
        idempotencyKey: makeKey('pasaje-create'),
      })
      setShowForm(false)
      setNotice(`Operación ${result.operation.operationNumber} creada. Verifica el QR recibido antes de emitir comprobantes.`)
      setVerificationOperation(result.operation)
      setConfirmedAmount('')
      setPaymentReference('')
      setDriverUid('')
      setVehicleId('')
      setPassengerName('')
      setQuantity('1')
      setUnitAmount('')
    } catch (err) { setActionError(err) } finally { setSaving(false) }
  }

  const handleVerify = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!verificationOperation) return
    const confirmedCents = parseBobToCents(confirmedAmount)
    if (confirmedCents === null || confirmedCents <= 0) { setError('Ingresa el importe que realmente viste acreditado en la cuenta QR.'); return }
    setSaving(true); setError('')
    try {
      const result = await verifyPassengerTicketPaymentThroughBackend({
        operationId: verificationOperation.id, confirmedAmountCents: confirmedCents,
        paymentReference, idempotencyKey: makeKey('pasaje-verify'),
      })
      setVerificationOperation(null)
      setNotice('Pago QR verificado. La operación quedó pendiente de entrega al chofer.')
      await openTicketPreview(result.operation, false)
    } catch (err) { setActionError(err) } finally { setSaving(false) }
  }

  const openTicketPreview = async (operation: PassengerTicketOperation, reprint: boolean) => {
    setError('')
    try {
      const html = await buildPassengerTicketPairHtml(operation, { paperWidth, reprint })
      setPrintPreview({ operation, html, reprint })
    } catch (err) { setActionError(err) }
  }

  const handleValidateTicket = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(''); setNotice('')
    if (!codeToValidate.trim()) { setError('Escribe o escanea el código impreso en el comprobante.'); return }
    setSaving(true)
    try {
      const result = await validatePassengerTicketThroughBackend({ ticketCode: codeToValidate.trim(), idempotencyKey: makeKey('pasaje-use') })
      setNotice(`Pasaje verificado para ${result.driverName}. Uso ${result.usedCount} de ${result.quantity}; quedan ${result.remainingCount}.`)
      setCodeToValidate('')
    } catch (err) { setActionError(err) } finally { setSaving(false) }
  }

  const handleCancel = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!cancelOperation) return
    setSaving(true); setError('')
    try {
      await cancelPassengerTicketThroughBackend({ operationId: cancelOperation.id, reason: cancelReason, idempotencyKey: makeKey('pasaje-cancel') })
      setNotice(`Operación ${cancelOperation.operationNumber} anulada. No se emitieron comprobantes válidos.`)
      setCancelOperation(null); setCancelReason('')
    } catch (err) { setActionError(err) } finally { setSaving(false) }
  }

  const handleDelivery = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!deliveryOperation) return
    setSaving(true); setError('')
    try {
      const result = await deliverPassengerTicketToDriverThroughBackend({
        operationId: deliveryOperation.id, authorizationCode, idempotencyKey: makeKey('pasaje-delivery'),
      })
      setNotice(`Entrega registrada. Caja actualizada y operación ${result.operation.operationNumber} liquidada.`)
      setDeliveryOperation(null); setAuthorizationCode('')
    } catch (err) { setActionError(err) } finally { setSaving(false) }
  }

  const branchName = (id: string) => id === 'punata' ? 'Punata' : 'Cochabamba'
  const routeName = (operation: PassengerTicketOperation) => `${branchName(operation.originBranchId)} → ${branchName(operation.destinationBranchId)}`

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <div className="flex items-center gap-2 text-[#064e3b]"><Ticket className="h-5 w-5"/><h1 className="text-lg font-extrabold">{isDriver ? 'Validar pasajes' : 'Pasajes'}</h1></div>
          <p className="mt-1 text-xs text-slate-600">{isDriver ? 'Consulta el registro digital antes de permitir el abordaje.' : `Venta QR recibida en oficina · Sucursal ${currentBranch.name}`}</p>
        </div>
        {canRegister && <button type="button" data-tutorial-target="tickets-new-operation" onClick={() => { setShowForm((value) => !value); setError(''); setNotice('') }} className="min-h-11 rounded-lg bg-[#064e3b] px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800">{showForm ? 'Cerrar formulario' : 'Nuevo pasaje'}</button>}
      </div>

      {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0"/>{error}</div>}
      {notice && <div role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0"/>{notice}</div>}

      {(isDriver || canRegister) && <section data-tutorial-target="tickets-driver-validation" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-extrabold text-slate-800">Comprobar comprobante</h2>
        <p className="mt-1 text-xs text-slate-600">Escribe el código que aparece en el comprobante. La confirmación consulta el registro oficial.</p>
        <form onSubmit={handleValidateTicket} className="mt-3 flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor="passenger-ticket-code">Código de pasaje</label>
          <input id="passenger-ticket-code" value={codeToValidate} onChange={(event) => setCodeToValidate(event.target.value.toUpperCase())} placeholder="PJE-…" className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 font-mono text-sm uppercase" autoComplete="off" />
          <button disabled={saving} className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#064e3b] px-4 text-sm font-bold text-white disabled:opacity-50"><TicketCheck className="h-4 w-4"/>{saving ? 'Consultando…' : 'Validar pasaje'}</button>
        </form>
        <p className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900">No permitas abordar por una captura solamente. El código debe aparecer como pagado y verificado aquí.</p>
      </section>}

      {showForm && canRegister && <form data-tutorial-target="tickets-sale-form" onSubmit={handleCreate} className="grid gap-4 rounded-xl border border-emerald-200 bg-white p-4 shadow-sm sm:grid-cols-2">
        <div className="sm:col-span-2"><h2 className="text-sm font-extrabold text-slate-800">Registrar pasaje</h2><p className="mt-1 text-xs text-slate-500">El importe se registra manualmente. No hay tarifa automática confirmada.</p></div>
        <label data-tutorial-target="tickets-route" className="text-xs font-bold text-slate-700">Origen<select value={originBranchId} onChange={(e) => { setOriginBranchId(e.target.value); setDestinationBranchId(e.target.value === 'punata' ? 'cochabamba' : 'punata'); setVehicleId('') }} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal"><option value="punata">Punata</option><option value="cochabamba">Cochabamba</option></select></label>
        <label className="text-xs font-bold text-slate-700">Destino<select value={destinationBranchId} onChange={(e) => setDestinationBranchId(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal"><option value="punata">Punata</option><option value="cochabamba">Cochabamba</option></select></label>
        <label data-tutorial-target="tickets-travel-date" className="text-xs font-bold text-slate-700">Fecha del viaje<input type="date" required value={travelDate} onChange={(e) => setTravelDate(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal"/></label>
        <label data-tutorial-target="tickets-driver-select" className="text-xs font-bold text-slate-700">Chofer<select required value={driverUid} onChange={(e) => { setDriverUid(e.target.value); setVehicleId('') }} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal"><option value="">Seleccionar chofer</option>{drivers.map((driver) => <option key={driver.uid} value={driver.uid}>{driver.fullName}</option>)}</select></label>
        <label className="text-xs font-bold text-slate-700">Vehículo (opcional)<select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal"><option value="">Sin vehículo asignado</option>{availableVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.mobileNumber} · {vehicle.plate}{vehicle.assignedDriverName ? ` · ${vehicle.assignedDriverName}` : ''}</option>)}</select></label>
        <label className="text-xs font-bold text-slate-700">Nombre del pasajero (opcional)<input value={passengerName} onChange={(e) => setPassengerName(e.target.value)} maxLength={120} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal" placeholder="Nombre, si se necesita"/></label>
        <label data-tutorial-target="tickets-quantity" className="text-xs font-bold text-slate-700">Cantidad de pasajes<input type="number" required min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal"/></label>
        <label data-tutorial-target="tickets-manual-amount" className="text-xs font-bold text-slate-700">Importe por pasaje (Bs)<input type="text" inputMode="decimal" required value={unitAmount} onChange={(e) => setUnitAmount(e.target.value)} placeholder="Escribir importe" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal"/></label>
        <div data-tutorial-target="tickets-qr-guidance" className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 sm:col-span-2"><QrCode className="h-4 w-4 shrink-0"/>Método: QR recibido y comprobado en la oficina. El pago quedará pendiente hasta que lo confirmes.</div>
        <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-4 py-3 sm:col-span-2"><span className="text-sm font-bold text-emerald-900">Total a verificar</span><strong className="font-mono text-xl text-emerald-900">{formatCurrencyBob(totalCents, true)}</strong></div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 sm:col-span-2"><span>Oficina que recibe: {currentBranch.name} · Registrado por: {currentUser.fullName}</span><button disabled={saving} className="min-h-11 rounded-lg bg-[#064e3b] px-5 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Guardando…' : 'Registrar operación'}</button></div>
      </form>}

      {!isDriver && <section data-tutorial-target="tickets-pending-settlement" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-extrabold text-slate-800">Pendiente de entregar a choferes</h2><p className="text-xs text-slate-500">QR recibido en la oficina; el efectivo sigue pendiente hasta registrarlo en Caja.</p></div><Banknote className="h-5 w-5 text-amber-700"/></div>
        {pendingByDriver.length === 0 ? <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-500">No hay entregas pendientes en esta sucursal.</p> : <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{pendingByDriver.map((item) => <div key={item.uid} className="rounded-lg border border-amber-200 bg-amber-50 p-3"><div className="font-bold text-amber-950">{item.name}</div><div className="mt-1 text-xs text-amber-900">{item.operations} operación(es) pendientes</div><div className="mt-1 font-mono text-lg font-extrabold text-amber-950">{formatCurrencyBob(item.amount, true)}</div></div>)}</div>}
      </section>}

      <section data-tutorial-target={isDriver ? 'tickets-driver-assignments' : 'tickets-history'} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-extrabold text-slate-800">{isDriver ? 'Mis pasajes asignados' : 'Historial de operaciones'}</h2><p className="text-xs text-slate-500">{isDriver ? 'Solo pasajes asignados a tu usuario.' : `Sucursal consultada: ${currentBranch.name}`}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{visibleOperations.length} registro(s)</span></div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <label className="relative sm:col-span-2 lg:col-span-1"><span className="sr-only">Buscar operación</span><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400"/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="N.º, código o chofer" className="min-h-10 w-full rounded-lg border border-slate-300 pl-9 pr-3 text-xs"/></label>
          <label className="text-xs"><span className="sr-only">Filtrar por fecha</span><input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="min-h-10 w-full rounded-lg border border-slate-300 px-2 text-xs"/></label>
          {!isDriver && <label className="text-xs"><span className="sr-only">Filtrar por chofer</span><select value={filterDriver} onChange={(e) => setFilterDriver(e.target.value)} className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs"><option value="all">Todos los choferes</option>{drivers.map((driver) => <option key={driver.uid} value={driver.uid}>{driver.fullName}</option>)}</select></label>}
          {!isDriver && <label className="text-xs"><span className="sr-only">Filtrar por pago</span><select value={filterPayment} onChange={(e) => setFilterPayment(e.target.value)} className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs"><option value="all">Todos los pagos</option><option value="pending_verification">Pendiente de verificación</option><option value="paid_verified">Pagado y verificado</option><option value="cancelled">Anulado</option></select></label>}
          <label className="text-xs"><span className="sr-only">Filtrar por uso</span><select value={filterUse} onChange={(e) => setFilterUse(e.target.value)} className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs"><option value="all">Todos los usos</option><option value="pending_boarding">Pendiente de abordar</option><option value="partially_used">Uso parcial</option><option value="used">Utilizado</option></select></label>
          {!isDriver && <label className="text-xs"><span className="sr-only">Filtrar entrega al chofer</span><select value={filterSettlement} onChange={(e) => setFilterSettlement(e.target.value)} className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs"><option value="all">Todas las entregas</option><option value="pending_delivery">Pendiente de entrega</option><option value="delivered">Entregado</option></select></label>}
        </div>
        {loading ? <p className="p-4 text-center text-sm text-slate-500">Cargando operaciones…</p> : visibleOperations.length === 0 ? <p className="rounded-lg bg-slate-50 p-5 text-center text-sm text-slate-500">No hay operaciones que coincidan con la búsqueda.</p> : <div className="grid gap-3 lg:grid-cols-2">{visibleOperations.map((operation) => {
          const canVerify = canRegister && operation.paymentStatus === 'pending_verification'
          const canDeliver = canRegister && operation.paymentStatus === 'paid_verified' && operation.settlementStatus === 'pending_delivery'
          const canPrint = operation.paymentStatus === 'paid_verified' && operation.paymentVerificationStatus === 'verified'
          return <article key={operation.id} className="rounded-xl border border-slate-200 p-3 sm:p-4" data-ticket-operation={operation.operationNumber}>
            <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="flex flex-wrap items-center gap-2"><strong className="font-mono text-sm text-slate-900">{operation.operationNumber}</strong><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${operation.paymentStatus === 'paid_verified' ? 'bg-emerald-100 text-emerald-800' : operation.paymentStatus === 'cancelled' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-900'}`}>{statusCopy[operation.paymentStatus]}</span></div><p className="mt-1 text-xs text-slate-600">{routeName(operation)} · viaje {formatDate(operation.travelDate)}</p></div><span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">{operation.branchId === 'punata' ? 'PUNATA' : 'COCHABAMBA'}</span></div>
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs"><span className="text-slate-500">Chofer</span><strong>{operation.driverName}</strong><span className="text-slate-500">Vehículo</span><strong>{operation.vehiclePlate || 'Sin vehículo'}</strong><span className="text-slate-500">Pasajes</span><strong>{operation.usedCount}/{operation.quantity} utilizados</strong><span className="text-slate-500">Total</span><strong className="font-mono">{formatCurrencyBob(operation.totalAmountCents, true)}</strong><span className="text-slate-500">Uso</span><strong>{operation.useStatus === 'used' ? 'Utilizado' : operation.useStatus === 'partially_used' ? 'Uso parcial' : 'Pendiente de abordar'}</strong><span className="text-slate-500">Entrega al chofer</span><strong>{operation.settlementStatus === 'delivered' ? 'Entregado' : operation.paymentStatus === 'paid_verified' ? 'Pendiente de entrega' : '—'}</strong></div>
            {canReadAll && <div className="mt-2 rounded-md bg-slate-50 p-2 text-[11px] text-slate-500">Registró: {operation.createdByName} · Verificó: {operation.paymentVerifiedByName || '—'} · Recibió QR: {operation.paymentReference || 'Sin referencia bancaria'}</div>}
            <div className="mt-3 flex flex-wrap gap-2">
              {canVerify && <button type="button" onClick={() => { setVerificationOperation(operation); setConfirmedAmount(''); setPaymentReference(''); setError('') }} className="min-h-10 rounded-lg bg-emerald-700 px-3 text-xs font-bold text-white">Confirmar QR recibido</button>}
              {canPrint && <button type="button" onClick={() => void openTicketPreview(operation, true)} className="flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-700"><Printer className="h-4 w-4"/>Reimprimir (duplicado)</button>}
              {canDeliver && <button type="button" onClick={() => { setDeliveryOperation(operation); setAuthorizationCode(''); setError('') }} className="flex min-h-10 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-bold text-white"><Banknote className="h-4 w-4"/>Entregar efectivo</button>}
              {canRegister && operation.paymentStatus === 'pending_verification' && <button type="button" onClick={() => { setCancelOperation(operation); setCancelReason(''); setError('') }} className="min-h-10 rounded-lg border border-rose-200 px-3 text-xs font-bold text-rose-700">Anular operación</button>}
              {isDriver && operation.paymentStatus === 'paid_verified' && operation.useStatus !== 'used' && <button type="button" onClick={() => setCodeToValidate(operation.ticketCode)} className="min-h-10 rounded-lg bg-[#064e3b] px-3 text-xs font-bold text-white">Validar esta operación</button>}
            </div>
          </article>
        })}</div>}
      </section>

      {verificationOperation && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-3"><form onSubmit={handleVerify} className="w-full max-w-md space-y-3 rounded-xl bg-white p-4 shadow-xl"><div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-extrabold">Confirmar pago QR recibido</h2><p className="mt-1 text-xs text-slate-600">Operación {verificationOperation.operationNumber} · total {formatCurrencyBob(verificationOperation.totalAmountCents, true)}</p></div><button type="button" onClick={() => setVerificationOperation(null)} aria-label="Cerrar" className="rounded p-1 text-slate-600"><X className="h-5 w-5"/></button></div><p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">Confirma solo después de comprobar el abono en la cuenta de la oficina. Una captura del pasajero no confirma el pago.</p><label className="block text-xs font-bold">Importe que aparece recibido (Bs)<input required inputMode="decimal" value={confirmedAmount} onChange={(e) => setConfirmedAmount(e.target.value)} placeholder="Ingresar importe recibido" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal"/></label><label className="block text-xs font-bold">Referencia bancaria (opcional)<input value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} maxLength={120} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal"/></label><label className="flex items-start gap-2 text-xs text-slate-700"><input type="checkbox" required className="mt-0.5"/>Ya comprobé que el dinero se acreditó en la cuenta QR de la oficina.</label><div className="flex justify-end gap-2"><button type="button" onClick={() => setVerificationOperation(null)} className="min-h-10 rounded-lg border px-4 text-xs font-bold">Volver</button><button disabled={saving} className="min-h-10 rounded-lg bg-emerald-700 px-4 text-xs font-bold text-white">{saving ? 'Verificando…' : 'Confirmar pago recibido'}</button></div></form></div>}

      {cancelOperation && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-3"><form onSubmit={handleCancel} className="w-full max-w-md space-y-3 rounded-xl bg-white p-4 shadow-xl"><h2 className="text-sm font-extrabold">Anular operación pendiente</h2><p className="text-xs text-slate-600">{cancelOperation.operationNumber}. No se puede anular un pago QR ya verificado porque no existe una regla de devolución confirmada.</p><label className="block text-xs font-bold">Motivo<input required minLength={3} maxLength={300} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal"/></label><div className="flex justify-end gap-2"><button type="button" onClick={() => setCancelOperation(null)} className="min-h-10 rounded-lg border px-4 text-xs font-bold">Volver</button><button disabled={saving} className="min-h-10 rounded-lg bg-rose-700 px-4 text-xs font-bold text-white">{saving ? 'Anulando…' : 'Anular operación'}</button></div></form></div>}

      {deliveryOperation && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-3"><form onSubmit={handleDelivery} className="w-full max-w-md space-y-3 rounded-xl bg-white p-4 shadow-xl"><h2 className="text-sm font-extrabold">Entregar efectivo al chofer</h2><p className="text-xs text-slate-600">{deliveryOperation.operationNumber} · {deliveryOperation.driverName}</p><div className="rounded-lg bg-amber-50 p-3"><div className="text-xs text-amber-900">Efectivo a entregar</div><strong className="font-mono text-xl text-amber-950">{formatCurrencyBob(deliveryOperation.pendingSettlementCents, true)}</strong><div className="mt-1 text-[11px] text-amber-900">Se descontará del efectivo físico de la caja abierta. La acción no se puede repetir.</div></div><label className="block text-xs font-bold">Código de autorización (solo si Caja lo solicita)<input value={authorizationCode} onChange={(e) => setAuthorizationCode(e.target.value.toUpperCase())} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm font-normal"/></label><div className="flex justify-end gap-2"><button type="button" onClick={() => setDeliveryOperation(null)} className="min-h-10 rounded-lg border px-4 text-xs font-bold">Volver</button><button disabled={saving} className="min-h-10 rounded-lg bg-amber-700 px-4 text-xs font-bold text-white">{saving ? 'Registrando…' : 'Confirmar entrega en efectivo'}</button></div></form></div>}

      {printPreview && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-2 sm:p-5"><div className="flex h-[96vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"><div className="flex flex-wrap items-center justify-between gap-2 border-b p-3"><div><h2 className="text-sm font-extrabold">{printPreview.reprint ? 'Reimpresión de dos comprobantes' : 'Dos comprobantes de la misma operación'}</h2><p className="text-xs text-slate-500">{printPreview.operation.operationNumber} · Solo se generan el respaldo de oficina y el ticket para el chofer.</p></div><div className="flex items-center gap-2"><label className="text-xs">Papel<select aria-label="Ancho de papel" value={paperWidth} onChange={async (e) => { const width = Number(e.target.value) as PassengerTicketPaperWidth; setPaperWidth(width); const html = await buildPassengerTicketPairHtml(printPreview.operation, { paperWidth: width, reprint: printPreview.reprint }); setPrintPreview({ ...printPreview, html }) }} className="ml-1 rounded border px-2 py-1"><option value={58}>58 mm</option><option value={80}>80 mm</option></select></label><button type="button" aria-label="Cerrar comprobantes" onClick={() => setPrintPreview(null)} className="rounded p-2 text-slate-600 hover:bg-slate-100"><X className="h-5 w-5"/></button></div></div><iframe ref={iframeRef} title="Vista previa de los dos comprobantes" srcDoc={printPreview.html} className="min-h-0 flex-1 bg-slate-100"/><div className="flex justify-end gap-2 border-t p-3"><button type="button" onClick={() => setPrintPreview(null)} className="min-h-10 rounded-lg border px-4 text-xs font-bold">Cerrar</button><button type="button" onClick={() => { try { printPassengerTicketPair(iframeRef.current) } catch (err) { setActionError(err) } }} className="flex min-h-10 items-center gap-2 rounded-lg bg-[#064e3b] px-4 text-xs font-bold text-white"><Printer className="h-4 w-4"/>Imprimir los dos comprobantes</button></div></div></div>}
    </div>
  )
}
