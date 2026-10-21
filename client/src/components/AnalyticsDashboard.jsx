import { useState, useEffect, useCallback } from 'react'
import {
  AreaChart, Area, BarChart, Bar, RadialBarChart, RadialBar,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Clock, CheckCircle2, AlertTriangle,
  Users, ShieldCheck, RefreshCw, Filter, Award, BarChart3,
  Activity, Target, Minus,
} from 'lucide-react'
import { analyticsAPI } from '../services/api'

const ROLE_COLORS = {
  SECURITY_OFFICER: '#3b82f6',
  FACULTY_STAFF: '#10b981',
  DEPT_HEAD: '#8b5cf6',
  HIGHER_AUTHORITY: '#f59e0b',
  ADMIN: '#a94064',
}

const SEVERITY_COLORS = {
  Critical: '#ef4444', High: '#f97316', Medium: '#eab308', Low: '#22c55e',
}

const CATEGORY_COLORS = [
  '#a94064','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#f97316','#14b8a6','#ec4899',
]

const RANGE_OPTIONS = [
  { label: '7 d', value: '7' }, { label: '14 d', value: '14' },
  { label: '30 d', value: '30' }, { label: '90 d', value: '90' },
]

function pct(v) { return v !== null && v !== undefined ? `${v}%` : 'N/A' }

function KpiCard({ icon: Icon, label, value, sub, color = '#a94064' }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${color}18`, color }}>
        <Icon size={20} strokeWidth={1.8} />
      </span>
      <p className="mt-4 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
      <p className="mt-0.5 text-xs font-medium text-slate-500">{label}</p>
      {sub && <p className="mt-1 text-[11px] text-slate-400">{sub}</p>}
    </div>
  )
}

function SectionTitle({ icon: Icon, title, subtitle }) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f4e6eb] text-[#a94064]">
        <Icon size={17} strokeWidth={1.8} />
      </span>
      <div>
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        {subtitle && <p className="text-[11px] text-slate-500">{subtitle}</p>}
      </div>
    </div>
  )
}

function TooltipBox({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xl text-xs">
      {label && <p className="mb-2 font-bold text-slate-700">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="font-medium">{p.name}: {p.value}</p>
      ))}
    </div>
  )
}

export default function AnalyticsDashboard({ currentUser }) {
  const [range, setRange] = useState('30')
  const [overview, setOverview] = useState(null)
  const [roles, setRoles] = useState([])
  const [trends, setTrends] = useState([])
  const [workload, setWorkload] = useState(null)
  const [leaderboard, setLeaderboard] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [lbSort, setLbSort] = useState('resolved')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = { days: range }
    try {
      const [ovRes, rolesRes, trendsRes, wkRes, lbRes] = await Promise.all([
        analyticsAPI.getOverview(params),
        analyticsAPI.getRoles(params),
        analyticsAPI.getTrends(params),
        analyticsAPI.getWorkload(params),
        analyticsAPI.getLeaderboard({ ...params, sortBy: lbSort, order: 'desc' }),
      ])
      setOverview(ovRes?.data?.summary || null)
      setRoles(rolesRes?.data?.roles || [])
      setTrends(trendsRes?.data?.trends || [])
      setWorkload(wkRes?.data || null)
      setLeaderboard(lbRes?.data?.leaderboard || [])
    } catch (err) {
      setError(err.message || 'Failed to load analytics.')
    } finally {
      setLoading(false)
    }
  }, [range, lbSort])

  useEffect(() => { fetchAll() }, [fetchAll])

  const trendData = trends.map((t) => ({
    ...t,
    ackMin: t.avgResponseTimeMinutes ?? 0,
    resMin: t.avgResolutionTimeMinutes ?? 0,
  }))
  const displayTrends = trendData.length > 45 ? trendData.filter((_, i) => i % 2 === 0) : trendData

  const rolesChartData = roles.map((r) => ({
    name: r.roleLabel.replace('Faculty / ', 'Fac. '),
    responseMin: r.avgResponseTimeSeconds ? +(r.avgResponseTimeSeconds / 60).toFixed(1) : 0,
    sla: r.slaComplianceRate,
    color: ROLE_COLORS[r.role] || '#64748b',
  }))

  const severityPieData = (workload?.bySeverity || []).map((s) => ({
    name: s.severity, value: s.total, color: SEVERITY_COLORS[s.severity] || '#64748b',
  }))

  const categoryBarData = (workload?.byCategory || [])
    .sort((a, b) => b.total - a.total).slice(0, 8)
    .map((c, i) => ({
      name: c.category.length > 22 ? c.category.slice(0, 20) + '...' : c.category,
      total: c.total, fill: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    }))

  const roleWorkloadData = (workload?.byRole || []).map((r) => ({
    name: r.label.replace('Faculty / ', 'Fac. '),
    resolved: r.resolved, pending: r.pending,
  }))

  const slaRate = overview?.slaComplianceRate ?? 0
  const slaRadialData = [{
    name: 'SLA', value: slaRate,
    fill: slaRate >= 80 ? '#10b981' : slaRate >= 60 ? '#f59e0b' : '#ef4444',
  }]

  const TABS = [
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'trends', label: 'Trends', icon: TrendingUp },
    { id: 'roles', label: 'By Role', icon: Users },
    { id: 'workload', label: 'Workload', icon: BarChart3 },
    { id: 'leaderboard', label: 'Leaderboard', icon: Award },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <span className="inline-block rounded bg-[#f4e6eb] px-2.5 py-0.5 text-xs font-bold text-[#a94064]">
            Response Performance Analytics
          </span>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
            Operational Intelligence Dashboard
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Real-time metrics · SLA compliance · Role performance · Responder rankings
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
            <Filter size={13} className="ml-1.5 text-slate-400" />
            {RANGE_OPTIONS.map((opt) => (
              <button key={opt.value} type="button" onClick={() => setRange(opt.value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${range === opt.value ? 'bg-[#a94064] text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}>
                {opt.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={fetchAll} disabled={loading}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw size={13} className={loading ? 'animate-spin text-[#a94064]' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
          <AlertTriangle size={15} className="shrink-0 text-rose-600" />
          {error}
          <button type="button" onClick={fetchAll} className="ml-auto font-semibold underline">Retry</button>
        </div>
      )}

      {loading && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-slate-100" />)}
        </div>
      )}

      {!loading && !error && overview && (
        <>
          {/* Primary KPIs */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard icon={Activity}     label="Total Incidents"      value={overview.totalIncidents}           sub={`${overview.incidentsResolved} resolved, ${overview.incidentsPending} pending`} color="#a94064" />
            <KpiCard icon={Clock}        label="Avg. Acknowledgement" value={overview.avgResponseTimeFormatted}  sub={`${overview.responseTimeCount} with ack timestamp`} color="#3b82f6" />
            <KpiCard icon={CheckCircle2} label="Resolution Rate"      value={pct(overview.resolutionRate)}      sub={`${overview.incidentsResolved} of ${overview.totalIncidents}`} color="#10b981" />
            <KpiCard icon={ShieldCheck}  label="SLA Compliance"       value={pct(overview.slaComplianceRate)}   sub={`${overview.slaNumerator}/${overview.slaDenominator} within threshold`} color={slaRate >= 80 ? '#10b981' : slaRate >= 60 ? '#f59e0b' : '#ef4444'} />
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard icon={Target}        label="Avg. Resolution Time" value={overview.avgResolutionTimeFormatted} sub={`${overview.resolutionTimeCount} resolved incidents`} color="#8b5cf6" />
            <KpiCard icon={TrendingUp}    label="Avg. Assignment Time" value={overview.avgAssignmentTimeFormatted} sub={`${overview.assignmentTimeCount} assignments`} color="#f59e0b" />
            <KpiCard icon={Users}         label="Responders Tracked"   value={leaderboard.length}                 sub="Active personnel" color="#0ea5e9" />
            <KpiCard icon={AlertTriangle} label="Incomplete Records"   value={overview.incompleteRecordsCount}    sub="Missing detectedAt" color="#64748b" />
          </div>

          {/* Tab nav */}
          <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" onClick={() => setActiveTab(id)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition ${activeTab === id ? 'bg-[#a94064] text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}>
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>

          {/* OVERVIEW TAB */}
          {activeTab === 'overview' && (
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
                <SectionTitle icon={ShieldCheck} title="SLA Compliance Rate" subtitle="Proportion of incidents acknowledged within severity threshold" />
                <div className="flex items-center justify-center gap-10">
                  <div className="relative h-48 w-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadialBarChart cx="50%" cy="50%" innerRadius="60%" outerRadius="100%" startAngle={90} endAngle={-270}
                        data={[{ name: 'bg', value: 100, fill: '#f1f5f9' }, ...slaRadialData]}>
                        <RadialBar dataKey="value" cornerRadius={8} />
                      </RadialBarChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-3xl font-bold text-slate-900">{slaRate}%</span>
                      <span className="text-[11px] text-slate-500">SLA Met</span>
                    </div>
                  </div>
                  <div className="space-y-3 text-xs">
                    {[
                      { label: 'Total', value: overview.totalIncidents },
                      { label: 'Within SLA', value: overview.slaNumerator },
                      { label: 'Breached', value: overview.slaDenominator - overview.slaNumerator },
                      { label: 'Res. Rate', value: `${overview.resolutionRate}%` },
                    ].map((r) => (
                      <div key={r.label} className="flex items-center justify-between gap-8">
                        <span className="text-slate-500">{r.label}</span>
                        <span className="font-bold text-slate-800">{r.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
                <SectionTitle icon={BarChart3} title="Severity Distribution" subtitle="Total incident volume by priority level" />
                <div className="flex items-center gap-6">
                  <div className="h-48 flex-1">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={severityPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                          {severityPieData.map((entry, idx) => <Cell key={idx} fill={entry.color} />)}
                        </Pie>
                        <Tooltip content={<TooltipBox />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-2 text-xs">
                    {severityPieData.map((s) => (
                      <div key={s.name} className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-sm" style={{ background: s.color }} />
                        <span className="text-slate-600">{s.name}</span>
                        <span className="ml-auto font-bold text-slate-800">{s.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TRENDS TAB */}
          {activeTab === 'trends' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
                <SectionTitle icon={Activity} title="Daily Incident Volume" subtitle={`Last ${range} days`} />
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={displayTrends} margin={{ left: -10 }}>
                      <defs>
                        <linearGradient id="incGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#a94064" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#a94064" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                      <Tooltip content={<TooltipBox />} />
                      <Area type="monotone" dataKey="incidentCount" name="Incidents" stroke="#a94064" strokeWidth={2} fill="url(#incGrad)" dot={false} />
                      <Area type="monotone" dataKey="resolvedCount" name="Resolved" stroke="#10b981" strokeWidth={2} fill="none" strokeDasharray="4 2" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
                <SectionTitle icon={Clock} title="Response Time Trends" subtitle="Daily avg acknowledgement vs resolution (minutes)" />
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={displayTrends} margin={{ left: -10 }}>
                      <defs>
                        <linearGradient id="ackGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="resGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip content={<TooltipBox />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Area type="monotone" dataKey="ackMin" name="Avg Ack (min)" stroke="#3b82f6" strokeWidth={2} fill="url(#ackGrad)" dot={false} />
                      <Area type="monotone" dataKey="resMin" name="Avg Resolution (min)" stroke="#8b5cf6" strokeWidth={2} fill="url(#resGrad)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
                <SectionTitle icon={ShieldCheck} title="Daily SLA Compliance" subtitle="Percentage acknowledged within threshold per day" />
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={displayTrends} margin={{ left: -10 }}>
                      <defs>
                        <linearGradient id="slaGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} unit="%" />
                      <Tooltip content={<TooltipBox />} />
                      <Area type="monotone" dataKey="slaComplianceRate" name="SLA %" stroke="#10b981" strokeWidth={2} fill="url(#slaGrad)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* BY ROLE TAB */}
          {activeTab === 'roles' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
                <SectionTitle icon={Clock} title="Avg. Acknowledgement Time by Role" subtitle="Minutes from detection to first acknowledgement" />
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rolesChartData} margin={{ left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} unit=" min" />
                      <Tooltip content={<TooltipBox />} />
                      <Bar dataKey="responseMin" name="Avg Ack (min)" radius={[6, 6, 0, 0]}>
                        {rolesChartData.map((entry, idx) => <Cell key={idx} fill={entry.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
                <SectionTitle icon={ShieldCheck} title="SLA Compliance by Role" />
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rolesChartData} margin={{ left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} unit="%" />
                      <Tooltip content={<TooltipBox />} />
                      <Bar dataKey="sla" name="SLA %" radius={[6, 6, 0, 0]}>
                        {rolesChartData.map((entry, idx) => <Cell key={idx} fill={entry.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
                <div className="p-5 pb-3">
                  <SectionTitle icon={Users} title="Role Performance Summary" subtitle="Detailed metrics per response role category" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-5 py-3 text-left">Role</th>
                        <th className="px-4 py-3 text-right">Assigned</th>
                        <th className="px-4 py-3 text-right">Resolved</th>
                        <th className="px-4 py-3 text-right">Avg Ack</th>
                        <th className="px-4 py-3 text-right">Avg Resolution</th>
                        <th className="px-4 py-3 text-right">SLA</th>
                        <th className="px-4 py-3 text-right">Res. Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {roles.map((r) => (
                        <tr key={r.role} className="hover:bg-slate-50/70">
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ background: ROLE_COLORS[r.role] || '#64748b' }} />
                              <span className="font-semibold text-slate-800">{r.roleLabel}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-right text-slate-700">{r.incidentsAssigned}</td>
                          <td className="px-4 py-3.5 text-right font-semibold text-emerald-700">{r.incidentsResolved}</td>
                          <td className="px-4 py-3.5 text-right text-slate-600">{r.avgResponseTimeFormatted}</td>
                          <td className="px-4 py-3.5 text-right text-slate-600">{r.avgResolutionTimeFormatted}</td>
                          <td className="px-4 py-3.5 text-right">
                            <span className={`rounded px-2 py-0.5 font-bold ${r.slaComplianceRate >= 80 ? 'bg-emerald-100 text-emerald-800' : r.slaComplianceRate >= 60 ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'}`}>
                              {r.slaComplianceRate}%
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-right text-slate-600">{r.resolutionRate}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* WORKLOAD TAB */}
          {activeTab === 'workload' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
                <SectionTitle icon={Users} title="Incident Workload by Role" subtitle="Resolved vs. pending per response category" />
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={roleWorkloadData} margin={{ left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                      <Tooltip content={<TooltipBox />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="resolved" name="Resolved" stackId="a" fill="#10b981" />
                      <Bar dataKey="pending" name="Pending" stackId="a" fill="#ef4444" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
                <SectionTitle icon={BarChart3} title="Hazard Category Breakdown" subtitle="Top 8 incident types by volume" />
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={categoryBarData} layout="vertical" margin={{ left: 16, right: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={130} />
                      <Tooltip content={<TooltipBox />} />
                      <Bar dataKey="total" name="Total" radius={[0, 6, 6, 0]}>
                        {categoryBarData.map((entry, idx) => <Cell key={idx} fill={entry.fill} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
                <div className="p-5 pb-3">
                  <SectionTitle icon={AlertTriangle} title="Severity Workload" subtitle="Active vs resolved by priority level" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-5 py-3 text-left">Severity</th>
                        <th className="px-4 py-3 text-right">Total</th>
                        <th className="px-4 py-3 text-right">Resolved</th>
                        <th className="px-4 py-3 text-right">Pending</th>
                        <th className="px-4 py-3 text-right">Resolution %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(workload?.bySeverity || []).map((s) => (
                        <tr key={s.severity} className="hover:bg-slate-50/70">
                          <td className="px-5 py-3.5">
                            <span className="rounded px-2 py-0.5 text-[11px] font-bold"
                              style={{ background: `${SEVERITY_COLORS[s.severity] || '#64748b'}18`, color: SEVERITY_COLORS[s.severity] || '#64748b' }}>
                              {s.severity}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-right font-semibold text-slate-800">{s.total}</td>
                          <td className="px-4 py-3.5 text-right text-emerald-700">{s.resolved}</td>
                          <td className="px-4 py-3.5 text-right text-rose-600">{s.pending}</td>
                          <td className="px-4 py-3.5 text-right text-slate-600">
                            {s.total > 0 ? `${Math.round((s.resolved / s.total) * 100)}%` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* LEADERBOARD TAB */}
          {activeTab === 'leaderboard' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-slate-500">Sort by:</span>
                {[
                  { id: 'resolved', label: 'Cases Resolved' },
                  { id: 'responseTime', label: 'Fastest Ack' },
                  { id: 'resolutionTime', label: 'Fastest Resolution' },
                  { id: 'slaCompliance', label: 'SLA Score' },
                ].map((opt) => (
                  <button key={opt.id} type="button" onClick={() => setLbSort(opt.id)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${lbSort === opt.id ? 'bg-[#a94064] text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-4 py-3.5 text-left">Rank</th>
                        <th className="px-5 py-3.5 text-left">Responder</th>
                        <th className="px-4 py-3.5 text-left">Role</th>
                        <th className="px-4 py-3.5 text-right">Assigned</th>
                        <th className="px-4 py-3.5 text-right">Resolved</th>
                        <th className="px-4 py-3.5 text-right">Avg Ack</th>
                        <th className="px-4 py-3.5 text-right">Avg Resolution</th>
                        <th className="px-4 py-3.5 text-right">SLA</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {leaderboard.map((person) => (
                        <tr key={person.id} className={`hover:bg-slate-50/70 ${person.rank === 1 ? 'bg-amber-50/60' : ''}`}>
                          <td className="px-4 py-3.5">
                            {person.rank === null ? (
                              <span className="text-slate-300">—</span>
                            ) : person.rank <= 3 ? (
                              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${person.rank === 1 ? 'bg-amber-400 text-white' : person.rank === 2 ? 'bg-slate-300 text-slate-700' : 'bg-orange-600/70 text-white'}`}>
                                {person.rank}
                              </span>
                            ) : (
                              <span className="font-semibold text-slate-600">#{person.rank}</span>
                            )}
                          </td>
                          <td className="px-5 py-3.5">
                            <p className="font-semibold text-slate-800">{person.name}</p>
                            <p className="text-[11px] text-slate-400">{person.email}</p>
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="rounded px-2 py-0.5 text-[10px] font-bold"
                              style={{ background: `${ROLE_COLORS[person.role] || '#64748b'}18`, color: ROLE_COLORS[person.role] || '#64748b' }}>
                              {person.role}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-right text-slate-700">{person.incidentsAssigned}</td>
                          <td className="px-4 py-3.5 text-right font-semibold text-emerald-700">{person.incidentsResolved}</td>
                          <td className="px-4 py-3.5 text-right text-slate-600">{person.avgResponseTimeFormatted}</td>
                          <td className="px-4 py-3.5 text-right text-slate-600">{person.avgResolutionTimeFormatted}</td>
                          <td className="px-4 py-3.5 text-right">
                            <span className={`rounded px-2 py-0.5 font-bold ${person.slaComplianceRate >= 80 ? 'bg-emerald-100 text-emerald-800' : person.slaComplianceRate >= 60 ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'}`}>
                              {person.slaComplianceRate}%
                            </span>
                          </td>
                        </tr>
                      ))}
                      {leaderboard.length === 0 && (
                        <tr>
                          <td colSpan={8} className="px-5 py-8 text-center text-slate-400">No responder data for this period.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

