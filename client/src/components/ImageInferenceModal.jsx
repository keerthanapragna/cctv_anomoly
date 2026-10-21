import { X, CheckCircle2, AlertTriangle, Shield, User, Dog } from 'lucide-react'

export default function ImageInferenceModal({ isOpen, onClose, result }) {
  if (!isOpen || !result) return null

  const hasEvents = result.events && result.events.length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50/70">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-100 text-purple-700">
              <Shield size={18} />
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-900">Neural Vision Inference Inspection</h2>
              <p className="text-xs text-slate-500">
                Camera: <span className="font-semibold text-slate-700">{result.camera_id || 'CAM-01'}</span> · Frame #{result.frame_id || 1}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Annotated image preview */}
          {result.annotated_image ? (
            <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-950 flex items-center justify-center max-h-80">
              <img
                src={result.annotated_image}
                alt="AI Annotated Frame"
                className="max-h-80 w-auto object-contain"
              />
            </div>
          ) : (
            <div className="rounded-xl bg-slate-100 p-8 text-center text-xs text-slate-400">
              Annotated frame visualization unavailable.
            </div>
          )}

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <User size={14} className="text-blue-600" />
                <span>People Detected</span>
              </div>
              <p className="mt-1 text-xl font-bold text-slate-800">{result.people_count || 0}</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <Dog size={14} className="text-orange-600" />
                <span>Dogs Detected</span>
              </div>
              <p className="mt-1 text-xl font-bold text-slate-800">{result.dog_count || 0}</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <AlertTriangle size={14} className={hasEvents ? 'text-rose-600' : 'text-emerald-600'} />
                <span>Hazards Flagged</span>
              </div>
              <p className={`mt-1 text-xl font-bold ${hasEvents ? 'text-rose-600' : 'text-emerald-600'}`}>
                {result.events ? result.events.length : 0}
              </p>
            </div>
          </div>

          {/* Hazard Evaluation Results */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              Hazard Assessment Findings
            </h4>
            {hasEvents ? (
              <div className="space-y-2.5">
                {result.events.map((evt, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50/80 p-3 text-rose-900"
                  >
                    <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-600" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider">
                          {evt.event}
                        </span>
                        {evt.dispatched && (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                            Dispatched to Backend & MongoDB
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-rose-800 leading-relaxed">{evt.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5 text-xs text-emerald-800 font-medium">
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                <span>No anomalous hazard detected in this frame. Scene evaluated within safe parameters.</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 bg-slate-50 px-6 py-3 flex items-center justify-between">
          <p className="text-[11px] text-slate-400">
            Computed by YOLO26 Neural Models & Multi-modal Rule Engine.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition"
          >
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  )
}
