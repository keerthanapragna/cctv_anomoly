import { Activity } from 'lucide-react'

export default function CategoryDistribution({ incidents, subtitle = 'Distribution in current records' }) {
  const categories = [
    {
      label: 'Fire / Smoke',
      count: incidents.filter((i) => i.type === 'Fire / Smoke').length,
      color: 'bg-[#a94064]',
    },
    {
      label: 'Human safety',
      count: incidents.filter((i) => i.type === 'Human safety').length,
      color: 'bg-orange-400',
    },
    {
      label: 'Camera tampering',
      count: incidents.filter((i) => i.type === 'Camera tampering').length,
      color: 'bg-violet-500',
    },
    {
      label: 'Environmental hazard',
      count: incidents.filter((i) => i.type === 'Environmental hazard').length,
      color: 'bg-teal-500',
    },
    {
      label: 'Unauthorized access',
      count: incidents.filter((i) => i.type === 'Unauthorized access').length,
      color: 'bg-amber-500',
    },
  ]

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/30">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-bold text-slate-900">Incident categories</h3>
          <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
        </div>
        <span className="rounded-lg bg-slate-100 p-2 text-slate-500">
          <Activity size={17} />
        </span>
      </div>

      <div className="space-y-4 pt-2">
        {categories.map((category) => {
          const percentage = incidents.length
            ? Math.round((category.count / incidents.length) * 100)
            : 0

          return (
            <div key={category.label} className="mt-3">
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-600">{category.label}</span>
                <span className="font-semibold text-slate-800">
                  {category.count} ({percentage}%)
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${category.color}`}
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
