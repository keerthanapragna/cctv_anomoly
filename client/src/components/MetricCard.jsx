export default function MetricCard({ label, value, note, icon: Icon, iconStyle, alertDot }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/30 transition hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-slate-500">{label}</p>
          {alertDot && (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
            </span>
          )}
        </div>
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-xl ${
            iconStyle || 'bg-[#f4e6eb] text-[#a94064]'
          }`}
        >
          <Icon size={20} />
        </span>
      </div>
      <p className="mt-4 text-3xl font-bold tracking-tight text-slate-900">{value}</p>
      <p className="mt-2 text-xs text-slate-500">{note}</p>
    </div>
  )
}
