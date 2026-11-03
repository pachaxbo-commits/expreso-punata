import React, { useState, useEffect, useMemo } from 'react'
import {
  Briefcase,
  DollarSign,
  Plus,
  Search,
  Printer,
  X,
  AlertTriangle,
  CheckCircle2,
  UserCheck,
  Receipt,
} from 'lucide-react'
import type {
  Worker,
  WorkerPayment,
  GeneralExpense,
  WorkerRole,
  WorkerStatus,
  ExpenseCategory,
  UserProfile,
  CashShift,
} from '../../types/index.ts'
import {
  manageWorker,
  registerWorkerPayment,
  subscribeWorkers,
  subscribeWorkerPayments,
} from '../../services/workerService.ts'
import {
  registerGeneralExpense,
  subscribeGeneralExpenses,
} from '../../services/expenseService.ts'
import { printEngine } from '../../services/printing/printEngineService.ts'
import { subscribeActiveCashShift } from '../../services/cashService.ts'

interface WorkersAndExpensesViewProps {
  currentBranchId: string
  userProfile: UserProfile
}

const WORKER_ROLE_LABELS: Record<WorkerRole, string> = {
  secretaria: 'Secretaria de Ventanilla',
  estibador: 'Estibador / Carga y Descarga',
  chofer_relevo: 'Chofer de Relevo / Operaciones',
  limpieza: 'Personal de Limpieza',
  seguridad: 'Seguridad y Custodia',
  administrativo: 'Personal Administrativo',
  encargado: 'Encargado de Agencia',
  otro: 'Otro Personal Operativo',
}

const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  alquiler: 'Alquiler de Inmuebles',
  servicios_basicos: 'Servicios Básicos (Luz / Agua / Internet)',
  combustible: 'Combustible y Lubricantes',
  mantenimiento: 'Mantenimiento y Reparaciones',
  material_escritorio: 'Material de Escritorio y Útiles',
  viaticos: 'Viáticos y Alimentación',
  impuestos_tasas: 'Impuestos, Tasas y Patentes',
  otro: 'Otros Egresos Operativos',
}

export const WorkersAndExpensesView: React.FC<WorkersAndExpensesViewProps> = ({
  currentBranchId,
  userProfile,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'workers' | 'expenses'>('workers')

  // Estado Trabajadores
  const [workers, setWorkers] = useState<Worker[]>([])
  const [payments, setPayments] = useState<WorkerPayment[]>([])
  const [loadingWorkers, setLoadingWorkers] = useState(true)

  // Estado Egresos Generales
  const [expenses, setExpenses] = useState<GeneralExpense[]>([])
  const [loadingExpenses, setLoadingExpenses] = useState(true)

  // Turno de caja activo (para asociar pagos en efectivo si existe)
  const [activeShift, setActiveShift] = useState<CashShift | null>(null)

  // Alertas
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Filtros Trabajadores
  const [workerSearch, setWorkerSearch] = useState('')
  const [workerBranchFilter, setWorkerBranchFilter] = useState<string>('all')
  const [workerStatusFilter, setWorkerStatusFilter] = useState<string>('all')

  // Filtros Egresos
  const [expenseSearch, setExpenseSearch] = useState('')
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState<string>('all')
  const [expenseBranchFilter, setExpenseBranchFilter] = useState<string>('all')

  // Modales
  const [showCreateWorkerModal, setShowCreateWorkerModal] = useState(false)
  const [showPayWorkerModal, setShowPayWorkerModal] = useState(false)
  const [showCreateExpenseModal, setShowCreateExpenseModal] = useState(false)

  // Formularios
  const [newWorkerForm, setNewWorkerForm] = useState({
    fullName: '',
    ci: '',
    phone: '',
    role: 'estibador' as WorkerRole,
    branchId: (currentBranchId === 'cochabamba' ? 'cochabamba' : 'punata') as 'punata' | 'cochabamba' | 'ambas',
    salaryType: 'monthly' as 'monthly' | 'daily' | 'per_task',
    baseSalaryBob: '',
    status: 'active' as WorkerStatus,
    joinedAt: new Date().toISOString().slice(0, 10),
    notes: '',
  })

  const [payWorkerForm, setPayWorkerForm] = useState({
    workerId: '',
    amountBob: '',
    concept: 'Salario mensual correspondiente',
    period: new Date().toISOString().slice(0, 7),
    paymentMethod: 'cash' as 'cash' | 'transfer' | 'check',
    useCurrentShift: true,
    notes: '',
  })

  const [newExpenseForm, setNewExpenseForm] = useState({
    category: 'servicios_basicos' as ExpenseCategory,
    branchId: (currentBranchId === 'cochabamba' ? 'cochabamba' : 'punata') as 'punata' | 'cochabamba' | 'general',
    concept: '',
    amountBob: '',
    supplier: '',
    invoiceOrReceiptNumber: '',
    paymentMethod: 'cash' as 'cash' | 'transfer' | 'qr',
    useCurrentShift: true,
    notes: '',
  })

  // Permisos
  const canManageWorkers = ['directiva_admin', 'tesoreria'].includes(userProfile.role)
  const canRegisterExpenses = ['directiva_admin', 'tesoreria', 'encargado_agencia', 'secretaria'].includes(userProfile.role)

  // Suscripciones en tiempo real
  useEffect(() => {
    setLoadingWorkers(true)
    const unsubWorkers = subscribeWorkers(
      (data) => {
        setWorkers(data)
        setLoadingWorkers(false)
      },
      (err) => console.error('Error cargando trabajadores:', err)
    )

    const unsubPayments = subscribeWorkerPayments(
      (data) => setPayments(data),
      (err) => console.error('Error cargando pagos de nómina:', err)
    )

    const unsubExpenses = subscribeGeneralExpenses(
      (data) => {
        setExpenses(data)
        setLoadingExpenses(false)
      },
      (err) => console.error('Error cargando egresos:', err)
    )

    const unsubShift = subscribeActiveCashShift(
      userProfile.uid,
      currentBranchId,
      (shift: CashShift | null) => setActiveShift(shift)
    )

    return () => {
      unsubWorkers()
      unsubPayments()
      unsubExpenses()
      unsubShift()
    }
  }, [userProfile.uid, currentBranchId])

  // Filtros aplicados a trabajadores
  const filteredWorkers = useMemo(() => {
    return workers.filter((w) => {
      if (workerBranchFilter !== 'all' && w.branchId !== workerBranchFilter) return false
      if (workerStatusFilter !== 'all' && w.status !== workerStatusFilter) return false
      if (workerSearch.trim()) {
        const q = workerSearch.toLowerCase().trim()
        const matchName = w.fullName?.toLowerCase().includes(q)
        const matchCi = w.ci?.toLowerCase().includes(q)
        const matchCode = w.workerCode?.toLowerCase().includes(q)
        if (!matchName && !matchCi && !matchCode) return false
      }
      return true
    })
  }, [workers, workerBranchFilter, workerStatusFilter, workerSearch])

  // Filtros aplicados a egresos
  const filteredExpenses = useMemo(() => {
    return expenses.filter((e) => {
      if (expenseBranchFilter !== 'all' && e.branchId !== expenseBranchFilter) return false
      if (expenseCategoryFilter !== 'all' && e.category !== expenseCategoryFilter) return false
      if (expenseSearch.trim()) {
        const q = expenseSearch.toLowerCase().trim()
        const matchConcept = e.concept?.toLowerCase().includes(q)
        const matchVoucher = e.voucherNumber?.toLowerCase().includes(q)
        const matchSupplier = e.supplier?.toLowerCase().includes(q)
        if (!matchConcept && !matchVoucher && !matchSupplier) return false
      }
      return true
    })
  }, [expenses, expenseBranchFilter, expenseCategoryFilter, expenseSearch])

  // Métricas
  const workerMetrics = useMemo(() => {
    const totalWorkers = workers.length
    const activeWorkers = workers.filter((w) => w.status === 'active').length
    const totalPayrollMonthlyBob = workers
      .filter((w) => w.status === 'active' && w.salaryType === 'monthly')
      .reduce((acc, curr) => acc + (curr.baseSalaryBob || 0), 0)

    const totalPaidThisMonthBob = payments.reduce((acc, curr) => acc + (curr.amountBob || 0), 0)

    return { totalWorkers, activeWorkers, totalPayrollMonthlyBob, totalPaidThisMonthBob }
  }, [workers, payments])

  const expenseMetrics = useMemo(() => {
    const totalExpensesBob = expenses.reduce((acc, curr) => acc + (curr.amountBob || 0), 0)
    const expensesCount = expenses.length
    return { totalExpensesBob, expensesCount }
  }, [expenses])

  // Manejo de Creación de Trabajador
  const handleCreateWorker = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newWorkerForm.fullName.trim() || !newWorkerForm.ci.trim()) {
      setErrorMsg('Nombre completo y C.I. son obligatorios.')
      return
    }

    try {
      setIsSubmitting(true)
      setErrorMsg(null)
      const salaryBob = parseFloat(newWorkerForm.baseSalaryBob) || 0
      const res = await manageWorker({
        action: 'create',
        fullName: newWorkerForm.fullName.trim(),
        ci: newWorkerForm.ci.trim(),
        phone: newWorkerForm.phone.trim(),
        role: newWorkerForm.role,
        roleLabel: WORKER_ROLE_LABELS[newWorkerForm.role],
        branchId: newWorkerForm.branchId,
        salaryType: newWorkerForm.salaryType,
        baseSalaryBob: salaryBob,
        baseSalaryCents: Math.round(salaryBob * 100),
        status: newWorkerForm.status,
        joinedAt: newWorkerForm.joinedAt,
        notes: newWorkerForm.notes.trim(),
      })

      setSuccessMsg(res.message || 'Trabajador registrado con éxito.')
      setShowCreateWorkerModal(false)
      setNewWorkerForm({
        fullName: '',
        ci: '',
        phone: '',
        role: 'estibador',
        branchId: currentBranchId === 'cochabamba' ? 'cochabamba' : 'punata',
        salaryType: 'monthly',
        baseSalaryBob: '',
        status: 'active',
        joinedAt: new Date().toISOString().slice(0, 10),
        notes: '',
      })
    } catch (err: any) {
      console.error('Error registrando trabajador:', err)
      setErrorMsg(err.message || 'No se pudo registrar el trabajador.')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Manejo de Pago a Trabajador
  const handlePayWorker = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!payWorkerForm.workerId || !payWorkerForm.amountBob) {
      setErrorMsg('Seleccione un trabajador y especifique el monto.')
      return
    }

    const amountBob = parseFloat(payWorkerForm.amountBob)
    if (isNaN(amountBob) || amountBob <= 0) {
      setErrorMsg('El monto a pagar debe ser mayor a 0.')
      return
    }

    try {
      setIsSubmitting(true)
      setErrorMsg(null)

      const shiftIdToUse =
        payWorkerForm.paymentMethod === 'cash' && payWorkerForm.useCurrentShift && activeShift
          ? activeShift.id
          : null

      const res = await registerWorkerPayment({
        workerId: payWorkerForm.workerId,
        amountBob,
        amountCents: Math.round(amountBob * 100),
        concept: payWorkerForm.concept.trim(),
        period: payWorkerForm.period,
        paymentMethod: payWorkerForm.paymentMethod,
        shiftId: shiftIdToUse,
        branchId: currentBranchId,
        notes: payWorkerForm.notes.trim(),
        idempotencyKey: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      })

      setSuccessMsg(res.message || `Pago ${res.receiptNumber} registrado.`)
      setShowPayWorkerModal(false)

      // Imprimir recibo
      try {
        const doc = printEngine.buildFromWorkerPayment(res, currentBranchId, userProfile.fullName)
        await printEngine.printDocument(doc)
      } catch (printErr: any) {
        console.warn('Error imprimiendo recibo de nómina:', printErr)
      }
    } catch (err: any) {
      console.error('Error registrando pago de personal:', err)
      setErrorMsg(err.message || 'Error al procesar pago de personal.')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Manejo de Registro de Gasto Operativo
  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newExpenseForm.concept.trim() || !newExpenseForm.amountBob) {
      setErrorMsg('Concepto y monto del egreso son obligatorios.')
      return
    }

    const amountBob = parseFloat(newExpenseForm.amountBob)
    if (isNaN(amountBob) || amountBob <= 0) {
      setErrorMsg('El monto debe ser mayor a 0.')
      return
    }

    try {
      setIsSubmitting(true)
      setErrorMsg(null)

      const shiftIdToUse =
        newExpenseForm.paymentMethod === 'cash' && newExpenseForm.useCurrentShift && activeShift
          ? activeShift.id
          : null

      const res = await registerGeneralExpense({
        category: newExpenseForm.category,
        branchId: newExpenseForm.branchId,
        concept: newExpenseForm.concept.trim(),
        amountBob,
        amountCents: Math.round(amountBob * 100),
        supplier: newExpenseForm.supplier.trim(),
        invoiceOrReceiptNumber: newExpenseForm.invoiceOrReceiptNumber.trim(),
        paymentMethod: newExpenseForm.paymentMethod,
        shiftId: shiftIdToUse,
        notes: newExpenseForm.notes.trim(),
        idempotencyKey: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      })

      setSuccessMsg(res.message || `Egreso ${res.voucherNumber} registrado con éxito.`)
      setShowCreateExpenseModal(false)
      setNewExpenseForm({
        category: 'servicios_basicos',
        branchId: currentBranchId === 'cochabamba' ? 'cochabamba' : 'punata',
        concept: '',
        amountBob: '',
        supplier: '',
        invoiceOrReceiptNumber: '',
        paymentMethod: 'cash',
        useCurrentShift: true,
        notes: '',
      })

      // Imprimir comprobante
      try {
        const doc = printEngine.buildFromGeneralExpense(res, currentBranchId, userProfile.fullName)
        await printEngine.printDocument(doc)
      } catch (printErr: any) {
        console.warn('Error imprimiendo comprobante de egreso:', printErr)
      }
    } catch (err: any) {
      console.error('Error registrando egreso:', err)
      setErrorMsg(err.message || 'Error al registrar egreso.')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Reimpresión de Recibo de Nómina
  const handleReprintWorkerPayment = async (payment: WorkerPayment) => {
    try {
      setErrorMsg(null)
      const doc = printEngine.buildFromWorkerPayment(payment, payment.branchId || currentBranchId, userProfile.fullName)
      await printEngine.printDocument(doc)
      setSuccessMsg(`Recibo ${payment.paymentNumber} enviado a impresión.`)
    } catch (err: any) {
      console.error('Error imprimiendo recibo:', err)
      setErrorMsg(`Error de impresión: ${err.message}`)
    }
  }

  // Reimpresión de Comprobante de Egreso
  const handleReprintExpense = async (expense: GeneralExpense) => {
    try {
      setErrorMsg(null)
      const doc = printEngine.buildFromGeneralExpense(expense, expense.branchId || currentBranchId, userProfile.fullName)
      await printEngine.printDocument(doc)
      setSuccessMsg(`Comprobante ${expense.voucherNumber} enviado a impresión.`)
    } catch (err: any) {
      console.error('Error imprimiendo comprobante:', err)
      setErrorMsg(`Error de impresión: ${err.message}`)
    }
  }

  return (
    <div className="space-y-4">
      {/* Alertas */}
      {errorMsg && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-xl flex items-center justify-between text-xs animate-fadeIn">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-rose-500 hover:text-rose-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 rounded-xl flex items-center justify-between text-xs animate-fadeIn">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* HEADER PRINCIPAL */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-[#064e3b]" />
            <h3 className="text-base font-bold text-slate-800">
              Personal, Nómina & Egresos Operativos — EXPRESO PUNATA
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Padrón de trabajadores, pagos de sueldos y anticipos, y registro justificado de gastos operativos por agencia.
          </p>
        </div>

        {/* SELECTOR DE SUBPESTAÑAS */}
        <div className="flex items-center bg-slate-100 p-1 rounded-xl self-start sm:self-auto border border-slate-200">
          <button
            type="button"
            onClick={() => setActiveSubTab('workers')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
              activeSubTab === 'workers'
                ? 'bg-[#064e3b] text-white shadow'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Personal & Nómina</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('expenses')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
              activeSubTab === 'expenses'
                ? 'bg-[#064e3b] text-white shadow'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>Gastos Operativos</span>
          </button>
        </div>
      </div>

      {/* =================================================================== */}
      {/* SUBPESTAÑA 1: PERSONAL & NÓMINA                                     */}
      {/* =================================================================== */}
      {activeSubTab === 'workers' && (
        <div className="space-y-4">
          {/* Métricas Personal */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
              <span className="text-[11px] text-slate-500 block font-medium">Trabajadores Registrados</span>
              <span className="text-lg font-bold text-slate-800">{workerMetrics.totalWorkers}</span>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
              <span className="text-[11px] text-emerald-700 block font-medium">Personal Activo</span>
              <span className="text-lg font-bold text-emerald-800">{workerMetrics.activeWorkers}</span>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
              <span className="text-[11px] text-blue-700 block font-medium">Planilla Mensual Base</span>
              <span className="text-lg font-bold text-blue-800">
                Bs {workerMetrics.totalPayrollMonthlyBob.toLocaleString('es-BO', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
              <span className="text-[11px] text-slate-500 block font-medium">Total Pagado en Nómina</span>
              <span className="text-lg font-bold text-[#064e3b]">
                Bs {workerMetrics.totalPaidThisMonthBob.toLocaleString('es-BO', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Acciones y Filtros */}
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row gap-2.5 items-center justify-between">
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Buscar por nombre, CI o código..."
                value={workerSearch}
                onChange={(e) => setWorkerSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#064e3b]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <select
                value={workerBranchFilter}
                onChange={(e) => setWorkerBranchFilter(e.target.value)}
                className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#064e3b]"
              >
                <option value="all">Todas las Agencias</option>
                <option value="punata">Agencia Punata</option>
                <option value="cochabamba">Agencia Cochabamba</option>
                <option value="ambas">Ambas Agencias</option>
              </select>

              <select
                value={workerStatusFilter}
                onChange={(e) => setWorkerStatusFilter(e.target.value)}
                className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#064e3b]"
              >
                <option value="all">Todos los Estados</option>
                <option value="active">Activos</option>
                <option value="inactive">Inactivos</option>
                <option value="suspended">Suspendidos</option>
              </select>

              {canManageWorkers && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowCreateWorkerModal(true)}
                    className="px-3.5 py-1.5 bg-[#064e3b] text-white text-xs font-bold rounded-lg shadow hover:bg-[#053e2f] flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Nuevo Trabajador</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setPayWorkerForm({
                        workerId: workers[0]?.id || '',
                        amountBob: workers[0]?.baseSalaryBob?.toString() || '',
                        concept: 'Salario mensual correspondiente',
                        period: new Date().toISOString().slice(0, 7),
                        paymentMethod: 'cash',
                        useCurrentShift: true,
                        notes: '',
                      })
                      setShowPayWorkerModal(true)
                    }}
                    className="px-3.5 py-1.5 bg-blue-700 text-white text-xs font-bold rounded-lg shadow hover:bg-blue-800 flex items-center gap-1.5"
                  >
                    <DollarSign className="w-3.5 h-3.5" />
                    <span>Pagar Nómina / Adelanto</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* TABLA DE TRABAJADORES */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Padrón Oficial de Personal ({filteredWorkers.length})
              </h4>
            </div>

            {loadingWorkers ? (
              <div className="text-center py-8 text-xs text-slate-500">Cargando personal...</div>
            ) : filteredWorkers.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500">No hay trabajadores registrados.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold text-[11px] uppercase tracking-wider">
                      <th className="py-2.5 px-3">Código</th>
                      <th className="py-2.5 px-3">Nombre Completo</th>
                      <th className="py-2.5 px-3">C.I. / Teléfono</th>
                      <th className="py-2.5 px-3">Cargo / Rol</th>
                      <th className="py-2.5 px-3">Agencia</th>
                      <th className="py-2.5 px-3">Sueldo Base</th>
                      <th className="py-2.5 px-3">Estado</th>
                      <th className="py-2.5 px-3 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredWorkers.map((w) => (
                      <tr key={w.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-2.5 px-3 font-mono font-bold text-[#064e3b]">
                          {w.workerCode}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-slate-900">
                          {w.fullName}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">
                          <span>{w.ci}</span>
                          {w.phone && <span className="block text-[10px] text-slate-400">Tel: {w.phone}</span>}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                            {WORKER_ROLE_LABELS[w.role] || w.role}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 capitalize text-slate-700 font-medium">
                          {w.branchId}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-slate-800">
                          Bs {(w.baseSalaryBob || 0).toFixed(2)}
                          <span className="block text-[10px] text-slate-400 font-normal">
                            {w.salaryType === 'monthly' ? 'Mensual' : w.salaryType === 'daily' ? 'Diario' : 'Por tarea'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              w.status === 'active'
                                ? 'bg-emerald-100 text-emerald-800'
                                : w.status === 'suspended'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {w.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {canManageWorkers && w.status === 'active' && (
                            <button
                              type="button"
                              onClick={() => {
                                setPayWorkerForm({
                                  workerId: w.id,
                                  amountBob: (w.baseSalaryBob || 0).toString(),
                                  concept: `Salario mensual - ${w.fullName}`,
                                  period: new Date().toISOString().slice(0, 7),
                                  paymentMethod: 'cash',
                                  useCurrentShift: true,
                                  notes: '',
                                })
                                setShowPayWorkerModal(true)
                              }}
                              className="px-2.5 py-1 bg-[#064e3b] text-white text-[11px] font-bold rounded hover:bg-[#053e2f] transition-all"
                            >
                              Pagar
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* HISTORIAL RECIENTE DE PAGOS DE NÓMINA */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Comprobantes de Pago de Personal ({payments.length})
              </h4>
            </div>

            {payments.length === 0 ? (
              <div className="text-center py-6 text-xs text-slate-500">No hay pagos registrados aún.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold text-[11px] uppercase tracking-wider">
                      <th className="py-2.5 px-3">Nro. Recibo</th>
                      <th className="py-2.5 px-3">Fecha y Hora</th>
                      <th className="py-2.5 px-3">Trabajador</th>
                      <th className="py-2.5 px-3">Concepto / Período</th>
                      <th className="py-2.5 px-3">Método</th>
                      <th className="py-2.5 px-3">Monto Cancelado</th>
                      <th className="py-2.5 px-3">Registrado Por</th>
                      <th className="py-2.5 px-3 text-right">Imprimir</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {payments.slice(0, 15).map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-2.5 px-3 font-mono font-bold text-[#064e3b]">
                          {p.paymentNumber}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">
                          {p.paidAtIso ? new Date(p.paidAtIso).toLocaleString('es-BO') : '-'}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-slate-900">
                          {p.workerName}
                          <span className="block text-[10px] text-slate-400 font-normal">CI: {p.workerCi}</span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-700">
                          {p.concept}
                          {p.period && <span className="block text-[10px] text-blue-600 font-semibold">Período: {p.period}</span>}
                        </td>
                        <td className="py-2.5 px-3 uppercase text-[10px] font-semibold text-slate-600">
                          {p.paymentMethod}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-[#064e3b]">
                          Bs {(p.amountBob || 0).toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 text-[11px]">
                          {p.registeredByName}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleReprintWorkerPayment(p)}
                            className="p-1.5 text-slate-500 hover:text-[#064e3b] hover:bg-slate-100 rounded transition-colors"
                            title="Reimprimir Recibo"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* SUBPESTAÑA 2: GASTOS OPERATIVOS                                     */}
      {/* =================================================================== */}
      {activeSubTab === 'expenses' && (
        <div className="space-y-4">
          {/* Métricas Gastos */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
              <span className="text-[11px] text-slate-500 block font-medium">Total de Egresos Registrados</span>
              <span className="text-lg font-bold text-slate-800">{expenseMetrics.expensesCount}</span>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
              <span className="text-[11px] text-rose-700 block font-medium">Monto Total de Gastos</span>
              <span className="text-lg font-bold text-rose-800">
                Bs {expenseMetrics.totalExpensesBob.toLocaleString('es-BO', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm col-span-2 sm:col-span-1">
              <span className="text-[11px] text-slate-500 block font-medium">Turno de Caja Ventanilla</span>
              <span className={`text-xs font-bold block mt-1 ${activeShift ? 'text-emerald-700' : 'text-slate-400'}`}>
                {activeShift ? `Turno Abierto (${currentBranchId.toUpperCase()})` : 'Sin Turno Abierto'}
              </span>
            </div>
          </div>

          {/* Acciones y Filtros */}
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row gap-2.5 items-center justify-between">
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Buscar por concepto, proveedor o voucher..."
                value={expenseSearch}
                onChange={(e) => setExpenseSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#064e3b]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <select
                value={expenseCategoryFilter}
                onChange={(e) => setExpenseCategoryFilter(e.target.value)}
                className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#064e3b]"
              >
                <option value="all">Todas las Categorías</option>
                {Object.entries(EXPENSE_CATEGORY_LABELS).map(([cat, label]) => (
                  <option key={cat} value={cat}>
                    {label}
                  </option>
                ))}
              </select>

              <select
                value={expenseBranchFilter}
                onChange={(e) => setExpenseBranchFilter(e.target.value)}
                className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#064e3b]"
              >
                <option value="all">Todas las Agencias</option>
                <option value="punata">Agencia Punata</option>
                <option value="cochabamba">Agencia Cochabamba</option>
                <option value="general">Gasto General</option>
              </select>

              {canRegisterExpenses && (
                <button
                  type="button"
                  onClick={() => setShowCreateExpenseModal(true)}
                  className="px-3.5 py-1.5 bg-[#064e3b] text-white text-xs font-bold rounded-lg shadow hover:bg-[#053e2f] flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Registrar Gasto Operativo</span>
                </button>
              )}
            </div>
          </div>

          {/* TABLA DE GASTOS */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Libro de Egresos Operativos ({filteredExpenses.length})
              </h4>
            </div>

            {loadingExpenses ? (
              <div className="text-center py-8 text-xs text-slate-500">Cargando egresos...</div>
            ) : filteredExpenses.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500">No hay egresos registrados.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold text-[11px] uppercase tracking-wider">
                      <th className="py-2.5 px-3">Voucher</th>
                      <th className="py-2.5 px-3">Fecha y Hora</th>
                      <th className="py-2.5 px-3">Categoría</th>
                      <th className="py-2.5 px-3">Agencia</th>
                      <th className="py-2.5 px-3">Concepto Detallado</th>
                      <th className="py-2.5 px-3">Proveedor / Nro Doc</th>
                      <th className="py-2.5 px-3">Monto en Bs</th>
                      <th className="py-2.5 px-3">Registrado Por</th>
                      <th className="py-2.5 px-3 text-right">Comprobante</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredExpenses.map((exp) => (
                      <tr key={exp.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-2.5 px-3 font-mono font-bold text-rose-800">
                          {exp.voucherNumber}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">
                          {exp.createdAtIso ? new Date(exp.createdAtIso).toLocaleString('es-BO') : '-'}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-800 border border-rose-100">
                            {EXPENSE_CATEGORY_LABELS[exp.category] || exp.category}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 capitalize text-slate-700 font-medium">
                          {exp.branchId}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-slate-900">
                          {exp.concept}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">
                          {exp.supplier || '-'}
                          {exp.invoiceOrReceiptNumber && (
                            <span className="block text-[10px] text-slate-400">Doc: {exp.invoiceOrReceiptNumber}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-rose-700">
                          Bs {(exp.amountBob || 0).toFixed(2)}
                          <span className="block text-[10px] text-slate-400 uppercase font-normal">{exp.paymentMethod}</span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 text-[11px]">
                          {exp.createdByName}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleReprintExpense(exp)}
                            className="p-1.5 text-slate-500 hover:text-rose-800 hover:bg-slate-100 rounded transition-colors"
                            title="Imprimir Comprobante de Egreso"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODALES                                                             */}
      {/* =================================================================== */}

      {/* MODAL: REGISTRAR TRABAJADOR */}
      {showCreateWorkerModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-[#064e3b]" />
                <h3 className="text-sm font-bold text-slate-900">Registrar Trabajador en Padrón</h3>
              </div>
              <button onClick={() => setShowCreateWorkerModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateWorker} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Nombre Completo *
                </label>
                <input
                  type="text"
                  required
                  placeholder="ej. Juan Carlos Mamani Torrico"
                  value={newWorkerForm.fullName}
                  onChange={(e) => setNewWorkerForm({ ...newWorkerForm, fullName: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#064e3b]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Cédula de Identidad (C.I.) *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="ej. 4532189-CB"
                    value={newWorkerForm.ci}
                    onChange={(e) => setNewWorkerForm({ ...newWorkerForm, ci: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#064e3b]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Teléfono Celular
                  </label>
                  <input
                    type="tel"
                    placeholder="ej. 71712345"
                    value={newWorkerForm.phone}
                    onChange={(e) => setNewWorkerForm({ ...newWorkerForm, phone: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#064e3b]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Cargo / Rol Operativo *
                  </label>
                  <select
                    value={newWorkerForm.role}
                    onChange={(e) => setNewWorkerForm({ ...newWorkerForm, role: e.target.value as any })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#064e3b]"
                  >
                    {Object.entries(WORKER_ROLE_LABELS).map(([rol, label]) => (
                      <option key={rol} value={rol}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Agencia Asignada *
                  </label>
                  <select
                    value={newWorkerForm.branchId}
                    onChange={(e) => setNewWorkerForm({ ...newWorkerForm, branchId: e.target.value as any })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#064e3b]"
                  >
                    <option value="punata">Agencia Punata</option>
                    <option value="cochabamba">Agencia Cochabamba</option>
                    <option value="ambas">Ambas Agencias</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Tipo de Salario *
                  </label>
                  <select
                    value={newWorkerForm.salaryType}
                    onChange={(e) => setNewWorkerForm({ ...newWorkerForm, salaryType: e.target.value as any })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#064e3b]"
                  >
                    <option value="monthly">Salario Mensual Fijo</option>
                    <option value="daily">Jornal Diario</option>
                    <option value="per_task">Por Tarea / Bulto</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Monto Base Pactado (Bs) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    placeholder="ej. 2500.00"
                    value={newWorkerForm.baseSalaryBob}
                    onChange={(e) => setNewWorkerForm({ ...newWorkerForm, baseSalaryBob: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#064e3b]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Notas u Observaciones
                </label>
                <textarea
                  rows={2}
                  placeholder="Detalles del contrato o condiciones laborales..."
                  value={newWorkerForm.notes}
                  onChange={(e) => setNewWorkerForm({ ...newWorkerForm, notes: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#064e3b]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateWorkerModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-[#064e3b] text-white text-xs font-bold rounded-lg shadow hover:bg-[#053e2f] transition-all disabled:opacity-50"
                >
                  {isSubmitting ? 'Guardando...' : 'Registrar en Padrón'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: PAGAR SALARIO / ADELANTO */}
      {showPayWorkerModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900">Registrar Pago a Trabajador</h3>
              </div>
              <button onClick={() => setShowPayWorkerModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handlePayWorker} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Trabajador Beneficiario *
                </label>
                <select
                  value={payWorkerForm.workerId}
                  onChange={(e) => {
                    const selId = e.target.value
                    const w = workers.find((item) => item.id === selId)
                    setPayWorkerForm({
                      ...payWorkerForm,
                      workerId: selId,
                      amountBob: w?.baseSalaryBob?.toString() || payWorkerForm.amountBob,
                    })
                  }}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-600"
                >
                  <option value="">Seleccione un trabajador...</option>
                  {workers
                    .filter((w) => w.status === 'active')
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.workerCode} — {w.fullName} ({WORKER_ROLE_LABELS[w.role] || w.role})
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Monto a Pagar (Bs) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    required
                    placeholder="0.00"
                    value={payWorkerForm.amountBob}
                    onChange={(e) => setPayWorkerForm({ ...payWorkerForm, amountBob: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Período / Mes
                  </label>
                  <input
                    type="month"
                    value={payWorkerForm.period}
                    onChange={(e) => setPayWorkerForm({ ...payWorkerForm, period: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Concepto del Pago *
                </label>
                <input
                  type="text"
                  required
                  placeholder="ej. Sueldo completo Octubre 2026, Anticipo quincenal"
                  value={payWorkerForm.concept}
                  onChange={(e) => setPayWorkerForm({ ...payWorkerForm, concept: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Método de Pago *
                </label>
                <select
                  value={payWorkerForm.paymentMethod}
                  onChange={(e) => setPayWorkerForm({ ...payWorkerForm, paymentMethod: e.target.value as any })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-600"
                >
                  <option value="cash">Efectivo de Caja de Ventanilla</option>
                  <option value="transfer">Transferencia Bancaria Directa</option>
                  <option value="check">Cheque Oficial</option>
                </select>
              </div>

              {payWorkerForm.paymentMethod === 'cash' && activeShift && (
                <div className="bg-emerald-50 border border-emerald-200 p-2.5 rounded-lg text-xs flex items-start gap-2">
                  <input
                    type="checkbox"
                    id="linkShift"
                    checked={payWorkerForm.useCurrentShift}
                    onChange={(e) => setPayWorkerForm({ ...payWorkerForm, useCurrentShift: e.target.checked })}
                    className="mt-0.5 rounded text-[#064e3b] focus:ring-[#064e3b]"
                  />
                  <label htmlFor="linkShift" className="text-emerald-900 cursor-pointer">
                    Descontar este egreso del efectivo en mano del turno activo de ventanilla ({currentBranchId.toUpperCase()}).
                  </label>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowPayWorkerModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-blue-700 text-white text-xs font-bold rounded-lg shadow hover:bg-blue-800 transition-all disabled:opacity-50"
                >
                  {isSubmitting ? 'Procesando...' : 'Confirmar Pago e Imprimir'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: REGISTRAR GASTO OPERATIVO */}
      {showCreateExpenseModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-rose-700" />
                <h3 className="text-sm font-bold text-slate-900">Registrar Gasto Operativo</h3>
              </div>
              <button onClick={() => setShowCreateExpenseModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateExpense} className="space-y-3">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Categoría del Gasto *
                  </label>
                  <select
                    value={newExpenseForm.category}
                    onChange={(e) => setNewExpenseForm({ ...newExpenseForm, category: e.target.value as any })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-rose-600"
                  >
                    {Object.entries(EXPENSE_CATEGORY_LABELS).map(([cat, label]) => (
                      <option key={cat} value={cat}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Agencia Responsable *
                  </label>
                  <select
                    value={newExpenseForm.branchId}
                    onChange={(e) => setNewExpenseForm({ ...newExpenseForm, branchId: e.target.value as any })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-rose-600"
                  >
                    <option value="punata">Agencia Punata</option>
                    <option value="cochabamba">Agencia Cochabamba</option>
                    <option value="general">Gasto General</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Concepto Detallado del Gasto *
                </label>
                <input
                  type="text"
                  required
                  placeholder="ej. Pago servicio de energía eléctrica ANDE Punata, Compra papel térmico"
                  value={newExpenseForm.concept}
                  onChange={(e) => setNewExpenseForm({ ...newExpenseForm, concept: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-rose-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Monto en Bolivianos (Bs) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.5"
                    required
                    placeholder="0.00"
                    value={newExpenseForm.amountBob}
                    onChange={(e) => setNewExpenseForm({ ...newExpenseForm, amountBob: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-rose-600"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Método de Pago *
                  </label>
                  <select
                    value={newExpenseForm.paymentMethod}
                    onChange={(e) => setNewExpenseForm({ ...newExpenseForm, paymentMethod: e.target.value as any })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-rose-600"
                  >
                    <option value="cash">Efectivo</option>
                    <option value="transfer">Transferencia</option>
                    <option value="qr">Pago QR</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Proveedor / Empresa
                  </label>
                  <input
                    type="text"
                    placeholder="ej. ENDE, Librería San Martín"
                    value={newExpenseForm.supplier}
                    onChange={(e) => setNewExpenseForm({ ...newExpenseForm, supplier: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-rose-600"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Nro. Factura o Recibo Oficial
                  </label>
                  <input
                    type="text"
                    placeholder="ej. FAC-10293, REC-45"
                    value={newExpenseForm.invoiceOrReceiptNumber}
                    onChange={(e) => setNewExpenseForm({ ...newExpenseForm, invoiceOrReceiptNumber: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-rose-600"
                  />
                </div>
              </div>

              {newExpenseForm.paymentMethod === 'cash' && activeShift && (
                <div className="bg-emerald-50 border border-emerald-200 p-2.5 rounded-lg text-xs flex items-start gap-2">
                  <input
                    type="checkbox"
                    id="linkShiftExpense"
                    checked={newExpenseForm.useCurrentShift}
                    onChange={(e) => setNewExpenseForm({ ...newExpenseForm, useCurrentShift: e.target.checked })}
                    className="mt-0.5 rounded text-[#064e3b] focus:ring-[#064e3b]"
                  />
                  <label htmlFor="linkShiftExpense" className="text-emerald-900 cursor-pointer">
                    Descontar este egreso del efectivo de caja del turno abierto ({currentBranchId.toUpperCase()}).
                  </label>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateExpenseModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-rose-700 text-white text-xs font-bold rounded-lg shadow hover:bg-rose-800 transition-all disabled:opacity-50"
                >
                  {isSubmitting ? 'Registrando...' : 'Registrar Egreso e Imprimir'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
