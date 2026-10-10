import { useState, useEffect } from 'react'
import {
  Bell,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Flame,
  LogOut,
  Menu,
  Plus,
  Radio,
  Send,
  ShieldAlert,
  Users,
  X,
  AlertTriangle,
  Building2,
  Camera,
  RefreshCw,
} from 'lucide-react'

import { DEMO_ACCOUNTS, INITIAL_INCIDENTS, SENSOR_DEVICES, CAMPUS_STAFF_MEMBERS } from './data/mockData'
import { ROLE_CONFIGS } from './utils/roleConfig'
import { incidentAPI } from './services/api'
import MetricCard from './components/MetricCard'
import IncidentTable from './components/IncidentTable'
import CategoryDistribution from './components/CategoryDistribution'
import CreateIncidentModal from './components/CreateIncidentModal'
import ExecutiveDirectiveModal from './components/ExecutiveDirectiveModal'
import LoginScreen from './components/LoginScreen'

function normalizeIncident(inc) {
  return {
    id: inc.incidentId || inc.id,
    title: inc.title,
    type: inc.hazardCategory || inc.type,
    location:
      typeof inc.location === 'object'
        ? inc.location?.rawText || inc.location?.building || 'Campus Zone'
        : inc.location || 'Campus Zone',
    department: inc.department,
    severity: inc.severity,
    status: inc.status,
    assignee: inc.assigneeLabel || inc.assignee || 'Unassigned',
    assignedOfficer: inc.assignedOfficer || null,
    assignedStaff: inc.assignedStaff || null,
    time: inc.detectedAt
      ? new Date(inc.detectedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : inc.time || 'Recent',
    deadline: inc.deadline || 'Standard SLA',
    isOverdue: inc.isOverdue || false,
    isEscalated: inc.isEscalated || false,
    escalationTier: inc.escalationTier || null,
    sensor: inc.evidenceMetadata?.sensorId || inc.sensor || null,
    notes: inc.notes || '',
  }
}

export default function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem('hazard_user')
      return saved ? JSON.parse(saved) : DEMO_ACCOUNTS[0]
    } catch {
      return DEMO_ACCOUNTS[0]
    }
  })

  const [allIncidents, setAllIncidents] = useState(INITIAL_INCIDENTS)
  const [directives, setDirectives] = useState([
    {
      id: 1,
      incidentId: 'INC-2026-0137',
      directiveType: 'Emergency Chiller Protocol',
      instructions: 'Primary Datacenter HVAC chiller failed. Authorized facilities to engage secondary chiller.',
      issuedAt: '09:30 AM',
      issuer: 'Vice Chancellor Richardson',
    },
  ])

  const [activePage, setActivePage] = useState('Overview')
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [directiveModalOpen, setDirectiveModalOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [dataSource, setDataSource] = useState('Demo Fallback (Offline Mode)')

  const loadIncidents = async () => {
    setLoading(true)
    try {
      const res = await incidentAPI.list()
      if (res?.data?.incidents && res.data.incidents.length > 0) {
        setAllIncidents(res.data.incidents.map(normalizeIncident))
        setDataSource('API (Live Database)')
      } else {
        setAllIncidents(INITIAL_INCIDENTS)
        setDataSource('Demo Baseline (Database Initialized)')
      }
    } catch {
      setAllIncidents(INITIAL_INCIDENTS)
      setDataSource('Demo Fallback (Offline Mode)')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let ignore = false
    const initFetch = async () => {
      try {
        const res = await incidentAPI.list()
        if (ignore) return
        if (res?.data?.incidents && res.data.incidents.length > 0) {
          setAllIncidents(res.data.incidents.map(normalizeIncident))
          setDataSource('API (Live Database)')
        } else {
          setAllIncidents(INITIAL_INCIDENTS)
          setDataSource('Demo Baseline (Database Initialized)')
        }
      } catch {
        if (ignore) return
        setAllIncidents(INITIAL_INCIDENTS)
        setDataSource('Demo Fallback (Offline Mode)')
      }
    }

    if (currentUser) {
      initFetch()
    }

    return () => {
      ignore = true
    }
  }, [currentUser])

  // Session Handlers
  function handleLogin(user, token) {
    setCurrentUser(user)
    if (token) localStorage.setItem('hazard_token', token)
    localStorage.setItem('hazard_user', JSON.stringify(user))
    setActivePage('Overview')
  }

  function handleLogout() {
    setCurrentUser(null)
    setUserMenuOpen(false)
    localStorage.removeItem('hazard_token')
    localStorage.removeItem('hazard_user')
  }

  function handleSwitchRole(roleKey) {
    const targetAccount = DEMO_ACCOUNTS.find((a) => a.role === roleKey)
    if (targetAccount) {
      setCurrentUser(targetAccount)
      localStorage.setItem('hazard_user', JSON.stringify(targetAccount))
      setUserMenuOpen(false)
      setActivePage('Overview')
    }
  }

  // Interactive Action Handlers (API first with local state update)
  async function handleUpdateStatus(incidentId, newStatus) {
    try {
      await incidentAPI.updateStatus(incidentId, newStatus)
    } catch {
      // Fallback update
    }
    setAllIncidents((current) =>
      current.map((inc) =>
        inc.id === incidentId
          ? {
              ...inc,
              status: newStatus,
              deadline: newStatus === 'Resolved' ? 'Resolved' : inc.deadline,
              isOverdue: newStatus === 'Resolved' ? false : inc.isOverdue,
            }
          : inc,
      ),
    )
  }

  async function handleEscalate(incidentId, tier) {
    try {
      await incidentAPI.escalate(incidentId, tier)
    } catch {
      // Fallback update
    }
    setAllIncidents((current) =>
      current.map((inc) =>
        inc.id === incidentId
          ? {
              ...inc,
              isEscalated: true,
              escalationTier: tier,
              notes: `${inc.notes ? inc.notes + ' ' : ''}[Escalated by ${currentUser.name} to ${tier}]`,
            }
          : inc,
      ),
    )
  }

  async function handleAcknowledge(incidentId) {
    try {
      await incidentAPI.acknowledge(incidentId)
    } catch {
      // Fallback update
    }
    setAllIncidents((current) =>
      current.map((inc) =>
        inc.id === incidentId
          ? {
              ...inc,
              status: 'Assigned',
              assignee: currentUser.name,
              notes: `${inc.notes ? inc.notes + ' ' : ''}[Acknowledged by ${currentUser.name} at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}]`,
            }
          : inc,
      ),
    )
  }

  async function handleCreateIncident(newData) {
    let createdRecord = null
    try {
      const res = await incidentAPI.create({
        title: newData.title,
        hazardCategory: newData.type,
        severity: newData.severity,
        location: newData.location,
        department: newData.department,
      })
      if (res?.data?.incident) {
        createdRecord = normalizeIncident(res.data.incident)
      }
    } catch {
      // Fallback
    }

    if (!createdRecord) {
      const nextNumber = 143 + allIncidents.length - INITIAL_INCIDENTS.length
      createdRecord = {
        id: `INC-2026-${String(nextNumber).padStart(4, '0')}`,
        title: newData.title,
        type: newData.type,
        location: newData.location,
        department: newData.department,
        severity: newData.severity,
        status: 'New',
        assignee: newData.assignee,
        assignedOfficer: newData.assignedOfficer,
        assignedStaff: newData.assignedStaff,
        time: 'Just now',
        deadline: newData.severity === 'Critical' ? '15 mins' : '2 hours',
        isOverdue: false,
        isEscalated: false,
        escalationTier: null,
        sensor: 'Manual Field Report',
        notes: `Reported by ${currentUser.name} (${currentUser.role})`,
      }
    }

    setAllIncidents((current) => [createdRecord, ...current])
    setActivePage('Overview')
  }

  function handleIssueDirective(directive) {
    const newDirective = {
      id: Date.now(),
      ...directive,
      issuer: currentUser.name,
    }
    setDirectives((current) => [newDirective, ...current])

    // Update target incident
    setAllIncidents((current) =>
      current.map((inc) =>
        inc.id === directive.incidentId
          ? {
              ...inc,
              notes: `${inc.notes ? inc.notes + ' ' : ''}[Directive: ${directive.directiveType} - "${directive.instructions}"]`,
            }
          : inc,
      ),
    )
  }

  // Unauthenticated: Render Login Screen
  if (!currentUser) {
    return <LoginScreen onLogin={handleLogin} />
  }

  // Role Configuration and Scoped Incidents
  const roleConfig = ROLE_CONFIGS[currentUser.role] || ROLE_CONFIGS.ADMIN
  const roleIncidents = roleConfig.filterIncidents(allIncidents, currentUser)

  // Derived Scoped Metrics
  const criticalCount = roleIncidents.filter(
    (i) => i.severity === 'Critical' && i.status !== 'Resolved',
  ).length
  const openCount = roleIncidents.filter((i) => i.status !== 'Resolved').length
  const overdueCount = roleIncidents.filter((i) => i.isOverdue && i.status !== 'Resolved').length
  const escalatedCount = roleIncidents.filter((i) => i.isEscalated).length
  const resolvedCount = roleIncidents.filter((i) => i.status === 'Resolved').length
  const assignedCount = roleIncidents.filter(
    (i) =>
      i.status === 'Assigned' ||
      i.assignedOfficer === currentUser.name ||
      i.assignedStaff === currentUser.name,
  ).length

  const userInitials = (currentUser.name || 'User')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  // Navigation Renderer
  function renderNavigation() {
    return (
      <nav className="space-y-1">
        {roleConfig.navItems.map((item) => {
          const Icon = item.icon
          const selected = activePage === item.id

          let badgeValue = null
          if (item.badgeKey === 'total') badgeValue = roleIncidents.length
          if (item.badgeKey === 'open') badgeValue = openCount
          if (item.badgeKey === 'critical') badgeValue = criticalCount
          if (item.badgeKey === 'escalated') badgeValue = escalatedCount
          if (item.badgeKey === 'assigned') badgeValue = assignedCount
          if (item.badgeKey === 'tampered') {
            badgeValue = SENSOR_DEVICES.filter((d) => d.status.includes('Tamper')).length
          }

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActivePage(item.id)
                setMobileMenuOpen(false)
              }}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition ${
                selected
                  ? 'bg-[#a94064] font-semibold text-white shadow-lg shadow-[#a94064]/20'
                  : 'text-slate-300 hover:bg-white/8 hover:text-white'
              }`}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span className="flex-1 truncate">{item.label}</span>
              {badgeValue !== null && badgeValue > 0 && (
                <span
                  className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                    selected ? 'bg-white/20 text-white' : 'bg-white/10 text-slate-300'
                  }`}
                >
                  {badgeValue}
                </span>
              )}
            </button>
          )
        })}
      </nav>
    )
  }

  return (
    <div className="min-h-screen bg-[#f5f6fa] text-slate-800">
      {/* Backend Integration & Scoped Session Status Banner */}
      <div
        className={`flex flex-col justify-between gap-1 border-b px-4 py-2 text-xs sm:flex-row sm:items-center md:px-8 ${
          dataSource.includes('Live')
            ? 'border-emerald-200 bg-emerald-50/90 text-emerald-900'
            : 'border-amber-200/80 bg-amber-50/90 text-amber-900'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
              dataSource.includes('Live')
                ? 'bg-emerald-200 text-emerald-900'
                : 'bg-amber-200 text-amber-900'
            }`}
          >
            {dataSource}
          </span>
          <span>
            Active view: <strong className="font-semibold">{roleConfig.roleLabel}</strong> ·{' '}
            <span className="text-slate-600">{roleConfig.scopeDescription}</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-slate-600">
            Enforced API:{' '}
            <span className="font-mono text-[10px] text-slate-800">/api/v1/incidents</span>
          </span>
          <button
            type="button"
            onClick={loadIncidents}
            disabled={loading}
            className="flex items-center gap-1 rounded font-medium text-[#a94064] hover:underline disabled:opacity-50"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            <span>{loading ? 'Refreshing...' : 'Sync'}</span>
          </button>
        </div>
      </div>

      <div className="flex min-h-[calc(100vh-37px)]">
        {/* Left Sidebar */}
        <aside className="hidden w-[265px] shrink-0 flex-col bg-[#151925] text-white md:flex">
          <div className="flex h-[82px] items-center gap-3 border-b border-white/8 px-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#a94064]">
              <ShieldAlert size={23} />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-wide">HAZARD RESPONSE</h1>
              <p className="mt-0.5 text-[11px] text-slate-400">Campus safety platform</p>
            </div>
          </div>

          <div className="px-4 pt-6">
            <div className="mb-4 rounded-xl border border-white/10 bg-white/5 p-3">
              <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold ${roleConfig.badgeColor}`}>
                {roleConfig.badgeText}
              </span>
              <p className="mt-1.5 text-xs font-semibold text-slate-200 truncate">{currentUser.name}</p>
              <p className="text-[11px] text-slate-400 truncate">{currentUser.department}</p>
            </div>

            <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
              Role Workspace
            </p>
            {renderNavigation()}
          </div>

          <div className="mt-auto p-4">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3.5">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                <span className="text-xs font-medium text-slate-200">Session active</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                Authorized under {currentUser.role} policy rules.
              </p>
            </div>
          </div>
        </aside>

        {/* Mobile Sidebar */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-40 flex md:hidden">
            <button
              type="button"
              aria-label="Close menu backdrop"
              className="absolute inset-0 bg-black/50"
              onClick={() => setMobileMenuOpen(false)}
            />
            <aside className="relative flex w-[285px] flex-col bg-[#151925] text-white">
              <div className="flex items-center justify-between border-b border-white/10 p-5">
                <span className="text-sm font-bold">HAZARD RESPONSE</span>
                <button
                  type="button"
                  aria-label="Close navigation"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <X size={20} />
                </button>
              </div>
              <div className="p-4">{renderNavigation()}</div>
            </aside>
          </div>
        )}

        {/* Main Content Area */}
        <main className="min-w-0 flex-1">
          {/* Header */}
          <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-slate-200/80 bg-white/95 px-4 backdrop-blur md:px-8">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="rounded-lg p-2 hover:bg-slate-100 md:hidden"
                aria-label="Open navigation"
                onClick={() => setMobileMenuOpen(true)}
              >
                <Menu size={21} />
              </button>
              <div>
                <p className="text-xs text-slate-500">
                  {roleConfig.roleLabel} <span className="mx-1">/</span> {activePage}
                </p>
                <h2 className="mt-0.5 text-base font-bold tracking-tight text-slate-900 md:text-lg">
                  {activePage}
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={loadIncidents}
                disabled={loading}
                aria-label="Sync with backend API"
                title="Sync with backend API"
                className="flex items-center gap-1.5 rounded-xl border border-slate-200/80 px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin text-[#a94064]' : 'text-slate-500'} />
                <span className="hidden sm:inline">{loading ? 'Syncing...' : 'Sync API'}</span>
              </button>

              <button
                type="button"
                aria-label="Notifications"
                title="Notifications"
                className="relative rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
              >
                <Bell size={18} />
                {criticalCount > 0 && (
                  <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#a94064]" />
                )}
              </button>

              {/* Quick Switch Role Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setUserMenuOpen((prev) => !prev)}
                  className="flex items-center gap-2 rounded-xl border border-slate-200/80 p-1.5 transition hover:bg-slate-50"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f4e6eb] text-xs font-bold text-[#8c2f50]">
                    {userInitials}
                  </div>
                  <div className="hidden text-left sm:block">
                    <p className="text-xs font-semibold text-slate-800">{currentUser.name}</p>
                    <p className="text-[11px] text-slate-500">{roleConfig.roleLabel}</p>
                  </div>
                  <ChevronDown size={14} className="text-slate-400" />
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
                    <div className="border-b border-slate-100 pb-3">
                      <p className="text-xs font-bold text-slate-900">{currentUser.name}</p>
                      <p className="text-[11px] text-slate-500 truncate">{currentUser.email}</p>
                      <span className={`mt-2 inline-block rounded px-2 py-0.5 text-[10px] font-bold ${roleConfig.badgeColor}`}>
                        {roleConfig.roleLabel}
                      </span>
                      <p className="mt-1 text-[11px] text-slate-400 truncate">{currentUser.department}</p>
                    </div>

                    <div className="pt-2">
                      <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Switch Demo Role
                      </p>
                      {DEMO_ACCOUNTS.map((acc) => (
                        <button
                          key={acc.role}
                          type="button"
                          onClick={() => handleSwitchRole(acc.role)}
                          className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs transition ${
                            acc.role === currentUser.role
                              ? 'bg-[#f4e6eb] font-semibold text-[#8c2f50]'
                              : 'text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          <span className="truncate">{acc.name}</span>
                          <span className="text-[10px] opacity-75">{acc.roleLabel}</span>
                        </button>
                      ))}
                    </div>

                    <div className="mt-2 border-t border-slate-100 pt-2">
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-semibold text-rose-600 transition hover:bg-rose-50"
                      >
                        <LogOut size={14} />
                        Sign out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* Body Content */}
          <div className="mx-auto max-w-[1600px] p-4 md:p-8">
            {/* OVERVIEW TAB */}
            {activePage === 'Overview' && (
              <>
                {/* Hero Greeting & Action Controls */}
                <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                  <div>
                    <span className={`inline-block rounded px-2.5 py-0.5 text-xs font-bold ${roleConfig.badgeColor}`}>
                      {roleConfig.title}
                    </span>
                    <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
                      Welcome, {currentUser.name.split(' ')[0]}.
                    </h1>
                    <p className="mt-1.5 text-sm text-slate-500 max-w-2xl">{roleConfig.subtitle}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Authorized Action Buttons based on role capabilities */}
                    {roleConfig.capabilities.canCreateIncident && (
                      <button
                        type="button"
                        onClick={() => setCreateModalOpen(true)}
                        className="inline-flex items-center gap-2 rounded-xl bg-[#a94064] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#a94064]/15 transition hover:bg-[#8f3454]"
                      >
                        <Plus size={17} />
                        Report Incident
                      </button>
                    )}

                    {roleConfig.capabilities.canIssueDirective && (
                      <button
                        type="button"
                        onClick={() => setDirectiveModalOpen(true)}
                        className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-amber-600/15 transition hover:bg-amber-700"
                      >
                        <Send size={16} />
                        Issue Directive
                      </button>
                    )}
                  </div>
                </div>

                {/* Role-Specific Metric Cards */}
                <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {currentUser.role === 'ADMIN' && (
                    <>
                      <MetricCard
                        label="Campus Total Incidents"
                        value={roleIncidents.length}
                        note="All departments & buildings"
                        icon={Building2}
                      />
                      <MetricCard
                        label="Critical Hazards"
                        value={criticalCount}
                        note="Require urgent mitigation"
                        icon={AlertTriangle}
                        iconStyle="bg-rose-50 text-rose-600"
                        alertDot={criticalCount > 0}
                      />
                      <MetricCard
                        label="Active Escalations"
                        value={escalatedCount}
                        note="SLA thresholds monitored"
                        icon={ShieldAlert}
                        iconStyle="bg-amber-50 text-amber-600"
                      />
                      <MetricCard
                        label="Resolved Incidents"
                        value={resolvedCount}
                        note="In institutional archive"
                        icon={CheckCircle2}
                        iconStyle="bg-emerald-50 text-emerald-600"
                      />
                    </>
                  )}

                  {currentUser.role === 'SECURITY_OFFICER' && (
                    <>
                      <MetricCard
                        label="Field Incidents"
                        value={openCount}
                        note="Require security dispatch"
                        icon={Radio}
                        iconStyle="bg-blue-50 text-blue-700"
                      />
                      <MetricCard
                        label="Critical Alarms"
                        value={criticalCount}
                        note="Urgent patrol required"
                        icon={AlertTriangle}
                        iconStyle="bg-rose-50 text-rose-600"
                        alertDot={criticalCount > 0}
                      />
                      <MetricCard
                        label="Camera Tampering"
                        value={
                          SENSOR_DEVICES.filter((d) => d.status.includes('Tamper')).length
                        }
                        note="CAM-12 obstruction flagged"
                        icon={Camera}
                        iconStyle="bg-violet-50 text-violet-700"
                      />
                      <MetricCard
                        label="Patrols Completed"
                        value={resolvedCount}
                        note="Resolved by field team"
                        icon={CheckCircle2}
                        iconStyle="bg-emerald-50 text-emerald-600"
                      />
                    </>
                  )}

                  {currentUser.role === 'FACULTY_STAFF' && (
                    <>
                      <MetricCard
                        label="My Department Items"
                        value={roleIncidents.length}
                        note="Chemistry & Science Labs"
                        icon={Building2}
                        iconStyle="bg-emerald-50 text-emerald-700"
                      />
                      <MetricCard
                        label="Lab Critical Hazards"
                        value={criticalCount}
                        note="Solvent room smoke alarm"
                        icon={AlertTriangle}
                        iconStyle="bg-rose-50 text-rose-600"
                        alertDot={criticalCount > 0}
                      />
                      <MetricCard
                        label="Overdue Actions"
                        value={overdueCount}
                        note="Chemical solvent breach"
                        icon={Clock3}
                        iconStyle="bg-amber-50 text-amber-700"
                        alertDot={overdueCount > 0}
                      />
                      <MetricCard
                        label="Actions Completed"
                        value={resolvedCount}
                        note="Verified lab tasks"
                        icon={CheckCircle2}
                        iconStyle="bg-slate-100 text-slate-700"
                      />
                    </>
                  )}

                  {currentUser.role === 'DEPT_HEAD' && (
                    <>
                      <MetricCard
                        label="Engineering Cases"
                        value={roleIncidents.length}
                        note="All School of Engineering labs"
                        icon={Building2}
                        iconStyle="bg-purple-50 text-purple-700"
                      />
                      <MetricCard
                        label="Pending Escalations"
                        value={escalatedCount}
                        note="Awaiting Head intervention"
                        icon={ShieldAlert}
                        iconStyle="bg-rose-50 text-rose-600"
                        alertDot={escalatedCount > 0}
                      />
                      <MetricCard
                        label="Overdue Tasks"
                        value={overdueCount}
                        note="Past response SLA deadline"
                        icon={Clock3}
                        iconStyle="bg-amber-50 text-amber-600"
                      />
                      <MetricCard
                        label="Sign-offs Granted"
                        value={resolvedCount}
                        note="Approved resolutions"
                        icon={CheckCircle2}
                        iconStyle="bg-emerald-50 text-emerald-600"
                      />
                    </>
                  )}

                  {currentUser.role === 'HIGHER_AUTHORITY' && (
                    <>
                      <MetricCard
                        label="Tier 2 Escalations"
                        value={escalatedCount}
                        note="Executive council docket"
                        icon={ShieldAlert}
                        iconStyle="bg-amber-50 text-amber-700"
                        alertDot={escalatedCount > 0}
                      />
                      <MetricCard
                        label="Critical Emergencies"
                        value={criticalCount}
                        note="Immediate leadership review"
                        icon={AlertTriangle}
                        iconStyle="bg-rose-50 text-rose-600"
                        alertDot={criticalCount > 0}
                      />
                      <MetricCard
                        label="Directives Issued"
                        value={directives.length}
                        note="Official campus orders"
                        icon={Send}
                        iconStyle="bg-blue-50 text-blue-700"
                      />
                      <MetricCard
                        label="Cross-Dept Compliance"
                        value="85.7%"
                        note="SLA timeline adherence"
                        icon={CheckCircle2}
                        iconStyle="bg-emerald-50 text-emerald-600"
                      />
                    </>
                  )}
                </section>

                {/* Main Incident Table & Side Widgets */}
                <section className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.8fr)]">
                  <IncidentTable
                    incidents={roleIncidents}
                    currentUser={currentUser}
                    capabilities={roleConfig.capabilities}
                    onUpdateStatus={handleUpdateStatus}
                    onEscalate={handleEscalate}
                    onAcknowledge={handleAcknowledge}
                    title={`${roleConfig.roleLabel} Incident Stream`}
                    subtitle={`Scoped to: ${roleConfig.scopeDescription}`}
                  />

                  <div className="space-y-6">
                    <CategoryDistribution
                      incidents={roleIncidents}
                      subtitle={`Derived from ${roleIncidents.length} ${currentUser.role} records`}
                    />

                    {/* Role-Specific Right Side Cards */}
                    {currentUser.role === 'SECURITY_OFFICER' && (
                      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
                        <div className="flex items-center gap-3">
                          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
                            <Camera size={20} />
                          </span>
                          <div>
                            <h3 className="font-bold text-slate-900">Camera Tamper Alert</h3>
                            <p className="text-xs text-slate-500">South Parking CAM-12</p>
                          </div>
                        </div>
                        <p className="mt-3 text-xs leading-5 text-slate-600">
                          Optical spray obstruction detected at 10:31 AM. Unit 4 dispatched to verify lens casing and perimeter.
                        </p>
                        <button
                          type="button"
                          onClick={() => setActivePage('Camera Tampering')}
                          className="mt-3 text-xs font-semibold text-[#a94064] hover:underline"
                        >
                          View sensor stream &rarr;
                        </button>
                      </div>
                    )}

                    {currentUser.role === 'HIGHER_AUTHORITY' && (
                      <div className="rounded-2xl bg-[#202637] p-5 text-white">
                        <div className="flex items-center gap-2">
                          <ShieldAlert size={18} className="text-amber-400" />
                          <h3 className="text-sm font-semibold">Executive Directives Active</h3>
                        </div>
                        <div className="mt-3 space-y-2">
                          {directives.map((d) => (
                            <div key={d.id} className="rounded-xl bg-white/5 p-3 text-xs">
                              <p className="font-semibold text-amber-300">{d.directiveType}</p>
                              <p className="mt-1 text-slate-300 leading-relaxed">{d.instructions}</p>
                              <p className="mt-1.5 text-[10px] text-slate-400">
                                Issued by {d.issuer} at {d.issuedAt}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {currentUser.role === 'FACULTY_STAFF' && (
                      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                            <Building2 size={18} />
                          </span>
                          <div>
                            <h3 className="text-xs font-bold text-slate-900">Chemical Protocol</h3>
                            <p className="text-[11px] text-slate-500">Chemistry Building</p>
                          </div>
                        </div>
                        <p className="mt-2.5 text-xs leading-relaxed text-slate-600">
                          Hazardous solvent breach requires prompt neutralization. If neutralizing kit is unavailable, trigger escalation to Dr. Reynolds.
                        </p>
                      </div>
                    )}

                    {currentUser.role === 'DEPT_HEAD' && (
                      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-50 text-purple-700">
                            <Users size={18} />
                          </span>
                          <div>
                            <h3 className="text-xs font-bold text-slate-900">Coordinator Workload</h3>
                            <p className="text-[11px] text-slate-500">School of Engineering</p>
                          </div>
                        </div>
                        <p className="mt-2.5 text-xs leading-relaxed text-slate-600">
                          3 active engineering cases across 2 building zones. 1 case approaching Higher Authority escalation SLA.
                        </p>
                      </div>
                    )}

                    <div className="rounded-2xl bg-[#151925] p-5 text-white">
                      <div className="flex items-center gap-2">
                        <Flame size={18} className="text-rose-400" />
                        <h3 className="text-sm font-semibold">Accountability Rule</h3>
                      </div>
                      <p className="mt-2.5 text-xs leading-relaxed text-slate-300">
                        Critical hazards initiate automated emergency protocol instantly. All actions and timestamps are preserved in the accountability audit log.
                      </p>
                    </div>
                  </div>
                </section>
              </>
            )}

            {/* ALL INCIDENTS / SCOPED LIST TAB */}
            {['All Incidents', 'Field Dispatch', 'Assigned Patrols', 'My Action Items', 'Department Safety', 'Department Incidents', 'Pending Escalations', 'Escalation Board', 'Critical Hazards'].includes(activePage) && (
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">{activePage}</h2>
                    <p className="text-xs text-slate-500">
                      Scoped records for {currentUser.name} ({roleConfig.roleLabel})
                    </p>
                  </div>
                  {roleConfig.capabilities.canCreateIncident && (
                    <button
                      type="button"
                      onClick={() => setCreateModalOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#a94064] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#8f3454]"
                    >
                      <Plus size={15} /> Create Record
                    </button>
                  )}
                </div>

                <IncidentTable
                  incidents={
                    activePage === 'Critical Hazards'
                      ? roleIncidents.filter((i) => i.severity === 'Critical')
                      : activePage === 'Pending Escalations' || activePage === 'Escalation Board'
                        ? roleIncidents.filter((i) => i.isEscalated)
                        : activePage === 'My Action Items' || activePage === 'Assigned Patrols'
                          ? roleIncidents.filter(
                              (i) =>
                                i.assignedStaff === currentUser.name ||
                                i.assignedOfficer === currentUser.name,
                            )
                          : roleIncidents
                  }
                  currentUser={currentUser}
                  capabilities={roleConfig.capabilities}
                  onUpdateStatus={handleUpdateStatus}
                  onEscalate={handleEscalate}
                  onAcknowledge={handleAcknowledge}
                  title={`${activePage} View`}
                  subtitle={`Showing records matching '${activePage}' filter.`}
                />
              </section>
            )}

            {/* CAMERAS & SENSORS TAB */}
            {['Cameras & Sensors', 'Camera Tampering'].includes(activePage) && (
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">Cameras & Sensory Infrastructure</h2>
                    <p className="text-xs text-slate-500">
                      Live sensor telemetry, camera obstruction detection, and hardware health.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {SENSOR_DEVICES.map((device) => (
                    <div
                      key={device.id}
                      className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm"
                    >
                      <div className="flex items-start justify-between">
                        <span className="font-mono text-xs font-bold text-slate-500">{device.id}</span>
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                            device.status.includes('Alarm')
                              ? 'bg-rose-100 text-rose-800'
                              : device.status.includes('Tamper')
                                ? 'bg-violet-100 text-violet-800'
                                : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {device.status}
                        </span>
                      </div>
                      <h4 className="mt-3 text-sm font-bold text-slate-900">{device.name}</h4>
                      <p className="mt-1 text-xs text-slate-500">{device.location}</p>

                      <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs">
                        <p className="font-medium text-slate-700">Telemetry Status:</p>
                        <p className="mt-0.5 text-slate-500">{device.issue}</p>
                        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                          <span>Health: {device.health}</span>
                          <span>Ping: {device.lastPing}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* PEOPLE & ROLES TAB (ADMIN ONLY) */}
            {activePage === 'People & Roles' && (
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">Authorized Personnel & Roles</h2>
                    <p className="text-xs text-slate-500">
                      Provisioned institutional accounts and authorization permissions.
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50/80 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-5 py-3.5">Personnel Name & Email</th>
                        <th className="px-4 py-3.5">Role Authorization</th>
                        <th className="px-4 py-3.5">Department</th>
                        <th className="px-4 py-3.5">Assigned Cases</th>
                        <th className="px-4 py-3.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {CAMPUS_STAFF_MEMBERS.map((member) => (
                        <tr key={member.email} className="hover:bg-slate-50/70">
                          <td className="px-5 py-4">
                            <p className="font-semibold text-slate-800">{member.name}</p>
                            <p className="text-[11px] text-slate-400">{member.email}</p>
                          </td>
                          <td className="px-4 py-4">
                            <span className="rounded bg-[#f4e6eb] px-2 py-0.5 text-[11px] font-bold text-[#8c2f50]">
                              {member.role}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-slate-600">{member.department}</td>
                          <td className="px-4 py-4 font-semibold text-slate-700">
                            {member.assignedCases} active
                          </td>
                          <td className="px-4 py-4">
                            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              {member.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* STAFF WORKLOAD (DEPT HEAD) */}
            {activePage === 'Staff Workload' && (
              <section className="space-y-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Coordinator & Staff Workload</h2>
                  <p className="text-xs text-slate-500">
                    Distribution of active hazards across School of Engineering coordinators.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="font-bold text-slate-900">Coordinator Case Load</h3>
                    <div className="mt-4 space-y-3">
                      {CAMPUS_STAFF_MEMBERS.filter((m) =>
                        ['DEPT_HEAD', 'SECURITY_OFFICER', 'FACULTY_STAFF'].includes(m.role),
                      ).map((m) => (
                        <div key={m.name} className="flex items-center justify-between border-b border-slate-100 pb-2 text-xs">
                          <div>
                            <p className="font-semibold text-slate-800">{m.name}</p>
                            <p className="text-[11px] text-slate-400">{m.department}</p>
                          </div>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-bold text-slate-700">
                            {m.assignedCases} cases
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="font-bold text-slate-900">SLA Resolution Thresholds</h3>
                    <p className="mt-1 text-xs text-slate-500">School of Engineering compliance benchmark</p>
                    <div className="mt-4 space-y-3 text-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-600">Average acknowledgement</span>
                        <span className="font-bold text-emerald-700">4.2 mins</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">Average resolution time</span>
                        <span className="font-bold text-slate-800">38 mins</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">Pending Council escalations</span>
                        <span className="font-bold text-rose-600">1 case</span>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* EXECUTIVE DIRECTIVES / AUDIT TAB (HIGHER AUTHORITY & REPORTS) */}
            {['Executive Directives', 'Reports', 'Audit & Reports', 'Safety Compliance', 'Institutional Audit', 'Action History', 'Escalations & SLAs', 'Escalations'].includes(activePage) && (
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">{activePage}</h2>
                    <p className="text-xs text-slate-500">
                      Audit trails, SLA monitoring, and formal institutional directive records.
                    </p>
                  </div>
                  {currentUser.role === 'HIGHER_AUTHORITY' && (
                    <button
                      type="button"
                      onClick={() => setDirectiveModalOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700"
                    >
                      <Send size={14} /> New Directive
                    </button>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="font-bold text-slate-900">Published Directives & Accountability Trail</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Recorded actions with verified timestamps and authorization signatures.
                  </p>

                  <div className="mt-5 space-y-3">
                    {directives.map((d) => (
                      <div key={d.id} className="rounded-xl border border-slate-200/80 p-4 text-xs">
                        <div className="flex items-start justify-between">
                          <span className="font-bold text-slate-900">{d.directiveType}</span>
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                            {d.issuedAt}
                          </span>
                        </div>
                        <p className="mt-2 text-slate-700 leading-relaxed">{d.instructions}</p>
                        <p className="mt-2 font-mono text-[11px] text-slate-400">
                          Target: {d.incidentId} · Issuer: {d.issuer}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </div>
        </main>
      </div>

      {/* Modals */}
      <CreateIncidentModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreate={handleCreateIncident}
        currentUser={currentUser}
      />

      <ExecutiveDirectiveModal
        isOpen={directiveModalOpen}
        onClose={() => setDirectiveModalOpen(false)}
        onIssueDirective={handleIssueDirective}
        incidents={roleIncidents}
      />
    </div>
  )
}
