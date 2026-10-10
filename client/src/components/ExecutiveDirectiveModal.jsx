import { useState } from 'react'
import { X, ShieldAlert, Send } from 'lucide-react'

export default function ExecutiveDirectiveModal({ isOpen, onClose, onIssueDirective, incidents }) {
  const [selectedIncidentId, setSelectedIncidentId] = useState(
    incidents.find((i) => i.severity === 'Critical')?.id || incidents[0]?.id || '',
  )
  const [directiveType, setDirectiveType] = useState('Safety Advisory')
  const [instructions, setInstructions] = useState('')

  if (!isOpen) return null

  function handleSubmit(e) {
    e.preventDefault()
    if (!instructions.trim()) return

    onIssueDirective({
      incidentId: selectedIncidentId,
      directiveType,
      instructions: instructions.trim(),
      issuedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    })
    setInstructions('')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close modal background"
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
              <ShieldAlert size={22} />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-amber-700">
                Executive Action
              </p>
              <h3 className="text-lg font-bold text-slate-900">Issue Executive Safety Directive</h3>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close modal"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="directive-incident" className="mb-1 block text-xs font-semibold text-slate-700">
              Target Incident
            </label>
            <select
              id="directive-incident"
              value={selectedIncidentId}
              onChange={(e) => setSelectedIncidentId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-800 outline-none focus:border-[#a94064]"
            >
              {incidents.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.id} · {i.title} ({i.severity})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="directive-type" className="mb-1 block text-xs font-semibold text-slate-700">
              Directive Classification
            </label>
            <select
              id="directive-type"
              value={directiveType}
              onChange={(e) => setDirectiveType(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-800 outline-none focus:border-[#a94064]"
            >
              <option>Campus Safety Advisory</option>
              <option>Building Evacuation Order</option>
              <option>Emergency Service Deployment</option>
              <option>Special Accountability Inquiry</option>
            </select>
          </div>

          <div>
            <label htmlFor="directive-instructions" className="mb-1 block text-xs font-semibold text-slate-700">
              Executive Instructions & Directives
            </label>
            <textarea
              id="directive-instructions"
              required
              rows={4}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. Directing Facilities to engage backup thermal chillers immediately under emergency protocol..."
              className="w-full rounded-xl border border-slate-200 p-2.5 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#a94064] focus:ring-2 focus:ring-[#a94064]/10"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-amber-700"
            >
              <Send size={13} />
              Publish Directive
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
