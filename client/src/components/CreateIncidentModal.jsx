import { useState } from 'react'
import { X, Plus } from 'lucide-react'

export default function CreateIncidentModal({ isOpen, onClose, onCreate, currentUser }) {
  const [form, setForm] = useState({
    title: '',
    type: 'Fire / Smoke',
    location: '',
    severity: 'High',
    department: currentUser.department || 'General Campus',
  })

  if (!isOpen) return null

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim() || !form.location.trim()) return

    onCreate({
      title: form.title.trim(),
      type: form.type,
      location: form.location.trim(),
      severity: form.severity,
      department: form.department,
      assignee: currentUser.role === 'SECURITY_OFFICER' ? 'Campus Security' : 'Pending Triage',
      assignedOfficer: currentUser.role === 'SECURITY_OFFICER' ? currentUser.name : null,
      assignedStaff: currentUser.role === 'FACULTY_STAFF' ? currentUser.name : null,
    })

    setForm({
      title: '',
      type: 'Fire / Smoke',
      location: '',
      severity: 'High',
      department: currentUser.department || 'General Campus',
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4">
      <button
        type="button"
        aria-label="Close modal backdrop"
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-incident-title"
        className="relative z-10 my-8 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl sm:p-7"
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[#a94064]">
              {currentUser.roleLabel || currentUser.role} Dispatch
            </p>
            <h3 id="create-incident-title" className="mt-1 text-xl font-bold text-slate-900">
              Create an incident record
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Filed under {currentUser.name} ({currentUser.department})
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
          >
            <X size={19} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="inc-title" className="mb-1.5 block text-xs font-semibold text-slate-700">
              Incident Title
            </label>
            <input
              id="inc-title"
              required
              minLength={3}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Smoke detected near corridor"
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-[#a94064] focus:ring-2 focus:ring-[#a94064]/10"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="inc-category" className="mb-1.5 block text-xs font-semibold text-slate-700">
                Hazard Category
              </label>
              <select
                id="inc-category"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#a94064]"
              >
                <option>Fire / Smoke</option>
                <option>Human safety</option>
                <option>Camera tampering</option>
                <option>Unauthorized access</option>
                <option>Environmental hazard</option>
              </select>
            </div>

            <div>
              <label htmlFor="inc-severity" className="mb-1.5 block text-xs font-semibold text-slate-700">
                Initial Severity
              </label>
              <select
                id="inc-severity"
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#a94064]"
              >
                <option>Low</option>
                <option>Medium</option>
                <option>High</option>
                <option>Critical</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="inc-location" className="mb-1.5 block text-xs font-semibold text-slate-700">
              Campus Location
            </label>
            <input
              id="inc-location"
              required
              minLength={2}
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="e.g. Block B · Floor 2 · Room 204"
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-[#a94064] focus:ring-2 focus:ring-[#a94064]/10"
            />
          </div>

          <div>
            <label htmlFor="inc-dept" className="mb-1.5 block text-xs font-semibold text-slate-700">
              Responsible Department
            </label>
            <input
              id="inc-dept"
              required
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-[#a94064]"
            />
          </div>

          <div className="flex flex-col-reverse gap-2 pt-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#a94064] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#8f3454]"
            >
              <Plus size={15} />
              Register Incident
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
