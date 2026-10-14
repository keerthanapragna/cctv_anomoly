import { useState } from 'react'
import {
  MapPin,
  Search,
  Activity,
  AlertTriangle,
  Clock3,
  CheckCircle2,
  Radio,
  ArrowUpRight,
  ShieldAlert,
} from 'lucide-react'

export default function IncidentTable({
  incidents,
  currentUser,
  capabilities,
  onUpdateStatus,
  onEscalate,
  onAcknowledge,
  emptyMessage = 'No incidents match your current scope or search filter.',
  title = 'Recent incidents',
  subtitle = 'Cases within your authorized jurisdiction',
}) {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')

  const filtered = incidents.filter((incident) => {
    const matchesSearch = [
      incident.id,
      incident.title,
      incident.type,
      incident.location,
      incident.department,
      incident.assignee,
      incident.status,
      incident.notes,
    ]
      .join(' ')
      .toLowerCase()
      .includes(searchTerm.toLowerCase())

    const matchesStatus =
      statusFilter === 'ALL'
        ? true
        : statusFilter === 'OPEN'
          ? incident.status !== 'Resolved'
          : incident.status === statusFilter

    return matchesSearch && matchesStatus
  })

  return (
    <div className="min-w-0 rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/30">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-slate-900">{title}</h3>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
              {filtered.length}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {['ALL', 'OPEN', 'Under review', 'Assigned', 'Resolved'].map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setStatusFilter(filter)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                statusFilter === filter
                  ? 'bg-[#a94064] text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      <div className="border-b border-slate-100 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search
              size={17}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by ID, keyword, location, or department..."
              aria-label="Search incidents"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-[#a94064] focus:ring-2 focus:ring-[#a94064]/10"
            />
          </div>
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              <Activity size={16} /> Clear search
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[850px] text-left">
          <thead className="bg-slate-50/80">
            <tr className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              <th className="px-5 py-3">Incident & Location</th>
              <th className="px-4 py-3">Severity & Deadline</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Department & Assignee</th>
              <th className="px-4 py-3 text-right">Available Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((incident) => (
              <tr key={incident.id} className="transition hover:bg-slate-50/70">
                <td className="px-5 py-4">
                  <div className="flex items-start gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        {incident.title}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] font-medium text-slate-400">
                          {incident.id}
                        </span>
                        <span className="text-[11px] font-medium text-slate-500">
                          · {incident.type}
                        </span>
                        {incident.sensor && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                            {incident.sensor}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                        <MapPin size={12} className="shrink-0 text-slate-400" />
                        {incident.location}
                      </p>
                    </div>
                  </div>
                </td>

                <td className="px-4 py-4">
                  <div className="space-y-1.5">
                    <span
                      className={`inline-flex rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                        incident.severity === 'Critical'
                          ? 'bg-rose-50 text-rose-700'
                          : incident.severity === 'High'
                            ? 'bg-orange-50 text-orange-700'
                            : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {incident.severity}
                    </span>

                    {incident.isOverdue ? (
                      <p className="flex items-center gap-1 text-[11px] font-bold text-rose-600">
                        <AlertTriangle size={12} /> {incident.deadline}
                      </p>
                    ) : (
                      <p className="flex items-center gap-1 text-[11px] text-slate-500">
                        <Clock3 size={12} /> {incident.deadline || 'Standard SLA'}
                      </p>
                    )}

                    {incident.isEscalated && (
                      <span className="inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800">
                        <ShieldAlert size={10} /> {incident.escalationTier || 'Escalated'}
                      </span>
                    )}
                  </div>
                </td>

                <td className="px-4 py-4">
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                      incident.status === 'Resolved'
                        ? 'text-emerald-700'
                        : incident.status === 'Investigating'
                          ? 'text-blue-700'
                          : incident.status === 'Under review'
                            ? 'text-amber-700'
                            : 'text-rose-700'
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        incident.status === 'Resolved'
                          ? 'bg-emerald-500'
                          : incident.status === 'Investigating'
                            ? 'bg-blue-500'
                            : incident.status === 'Under review'
                              ? 'bg-amber-500'
                              : 'bg-rose-500'
                      }`}
                    />
                    {incident.status}
                  </span>
                  <p className="mt-1 text-[11px] text-slate-400">Logged {incident.time}</p>
                </td>

                <td className="px-4 py-4 text-xs">
                  <p className="font-medium text-slate-700">{incident.department}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    Assignee: <span className="font-semibold text-slate-700">{incident.assignee}</span>
                  </p>
                  {incident.assignedStaff && (
                    <p className="text-[10px] text-slate-400">Staff: {incident.assignedStaff}</p>
                  )}
                </td>

                <td className="px-4 py-4 text-right">
                  <div className="flex flex-col items-end gap-1.5">
                    {/* Role-specific authorized actions */}
                    {currentUser.role === 'SECURITY_OFFICER' && incident.status !== 'Resolved' && (
                      <button
                        type="button"
                        onClick={() => onUpdateStatus(incident.id, 'Investigating')}
                        className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                      >
                        <Radio size={12} /> Start Patrol
                      </button>
                    )}

                    {currentUser.role === 'SECURITY_OFFICER' && incident.status === 'Investigating' && (
                      <button
                        type="button"
                        onClick={() => onUpdateStatus(incident.id, 'Resolved')}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                      >
                        <CheckCircle2 size={12} /> Mark Secured
                      </button>
                    )}

                    {currentUser.role === 'FACULTY_STAFF' && !incident.isEscalated && (
                      <button
                        type="button"
                        onClick={() => onEscalate(incident.id, 'Tier 1 (Dept Head)')}
                        className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                      >
                        <ShieldAlert size={12} /> Escalate to Head
                      </button>
                    )}

                    {currentUser.role === 'DEPT_HEAD' && incident.isEscalated && incident.escalationTier?.includes('Tier 1') && (
                      <button
                        type="button"
                        onClick={() => onEscalate(incident.id, 'Tier 2 (Higher Authority)')}
                        className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                      >
                        <ArrowUpRight size={12} /> Escalate to Council
                      </button>
                    )}

                    {currentUser.role === 'DEPT_HEAD' && incident.status !== 'Resolved' && (
                      <button
                        type="button"
                        onClick={() => onUpdateStatus(incident.id, 'Resolved')}
                        className="inline-flex items-center gap-1 rounded-lg bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-700 hover:bg-purple-100"
                      >
                        <CheckCircle2 size={12} /> Sign-off Resolved
                      </button>
                    )}

                    {currentUser.role === 'ADMIN' && incident.status !== 'Resolved' && (
                      <button
                        type="button"
                        onClick={() => onUpdateStatus(incident.id, 'Resolved')}
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                      >
                        <CheckCircle2 size={12} /> Admin Close
                      </button>
                    )}

                    {currentUser.role === 'HIGHER_AUTHORITY' && incident.severity === 'Critical' && (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800">
                        Directive Pending
                      </span>
                    )}

                    {/* Quick acknowledgement */}
                    {capabilities.canAcknowledge && incident.status === 'New' && (
                      <button
                        type="button"
                        onClick={() => onAcknowledge(incident.id)}
                        className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200"
                      >
                        Acknowledge
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}

            {filtered.length === 0 && (
              <tr>
                <td colSpan="5" className="px-5 py-12 text-center text-sm text-slate-500">
                  {incidents.length === 0
                    ? 'No detections recorded yet.'
                    : (searchTerm || statusFilter !== 'ALL')
                      ? 'No incidents match your search or filter.'
                      : emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="border-t border-slate-100 px-5 py-3">
        <p className="text-xs text-slate-500">
          Displaying {filtered.length} of {incidents.length} records permitted for{' '}
          <span className="font-semibold text-slate-700">{currentUser.name}</span> ({currentUser.role})
        </p>
      </div>
    </div>
  )
}
