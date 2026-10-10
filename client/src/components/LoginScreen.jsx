import { useState } from 'react'
import {
  ShieldAlert,
  Lock,
  Mail,
  ArrowRight,
  AlertCircle,
  KeyRound,
  UserCheck,
} from 'lucide-react'
import { DEMO_ACCOUNTS } from '../data/mockData'

export default function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('form') // 'form' or 'demo'

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // Attempt backend authentication
      const response = await fetch('http://localhost:5000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim(), password }),
      })

      const data = await response.json()

      if (response.ok && data.success) {
        onLogin(data.data.user, data.data.accessToken)
        return
      }

      // If backend explicitly rejected invalid credentials
      if (!response.ok) {
        setError(data.message || 'Invalid credentials. Please verify your email and password.')
        setLoading(false)
        return
      }
    } catch {
      // Fallback for offline / demo mode when backend server is not active
      const matchedDemo = DEMO_ACCOUNTS.find(
        (a) => a.email.toLowerCase() === email.trim().toLowerCase(),
      )

      if (matchedDemo && password.length >= 6) {
        onLogin(
          {
            name: matchedDemo.name,
            email: matchedDemo.email,
            role: matchedDemo.role,
            department: matchedDemo.department,
          },
          'demo-offline-token',
        )
        return
      }

      setError(
        'Backend connection offline. Please select one of the Campus Demo Accounts below to test role-based access.',
      )
    } finally {
      setLoading(false)
    }
  }

  function handleSelectDemo(account) {
    setEmail(account.email)
    setPassword(account.password)
    setError(null)
    setActiveTab('form')
  }

  return (
    <div className="flex min-h-screen flex-col justify-center bg-[#f5f6fa] px-4 py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#a94064] text-white shadow-lg shadow-[#a94064]/20">
            <ShieldAlert size={30} />
          </div>
        </div>
        <h2 className="mt-4 text-center text-2xl font-bold tracking-tight text-slate-900">
          HAZARD RESPONSE
        </h2>
        <p className="mt-1 text-center text-xs font-semibold tracking-wider uppercase text-slate-500">
          Campus Safety & Incident Accountability System
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm shadow-slate-200/40 sm:p-8">
          <div className="mb-6 flex rounded-xl bg-slate-100 p-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab('form')}
              className={`flex-1 rounded-lg py-2 text-center transition ${
                activeTab === 'form'
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('demo')}
              className={`flex-1 rounded-lg py-2 text-center transition ${
                activeTab === 'demo'
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Campus Roles ({DEMO_ACCOUNTS.length})
            </button>
          </div>

          {error && (
            <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {activeTab === 'form' ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="login-email"
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-600"
                >
                  Campus Email
                </label>
                <div className="relative">
                  <Mail
                    size={17}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    id="login-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="e.g. officer@campus.safety"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pl-10 pr-3.5 text-sm text-slate-800 outline-none transition focus:border-[#a94064] focus:bg-white focus:ring-2 focus:ring-[#a94064]/10"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-600"
                >
                  Password
                </label>
                <div className="relative">
                  <Lock
                    size={17}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    id="login-password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pl-10 pr-3.5 text-sm text-slate-800 outline-none transition focus:border-[#a94064] focus:bg-white focus:ring-2 focus:ring-[#a94064]/10"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#a94064] py-3 text-sm font-semibold text-white shadow-lg shadow-[#a94064]/15 transition hover:bg-[#8f3454] disabled:opacity-70"
                >
                  {loading ? (
                    <span>Verifying session...</span>
                  ) : (
                    <>
                      <span>Enter Workspace</span>
                      <ArrowRight size={16} />
                    </>
                  )}
                </button>
              </div>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => setActiveTab('demo')}
                  className="text-xs font-medium text-[#a94064] hover:underline"
                >
                  Test with a pre-configured campus role &rarr;
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <p className="text-xs leading-5 text-slate-500">
                Select any institutional role to evaluate role-based authorization:
              </p>
              <div className="space-y-2">
                {DEMO_ACCOUNTS.map((account) => (
                  <button
                    key={account.role}
                    type="button"
                    onClick={() => handleSelectDemo(account)}
                    className="flex w-full items-start justify-between rounded-xl border border-slate-200/80 p-3 text-left transition hover:border-[#a94064]/40 hover:bg-slate-50"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-800">
                          {account.name}
                        </span>
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${account.badgeColor}`}
                        >
                          {account.roleLabel}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {account.department}
                      </p>
                      <p className="mt-1 text-[10px] text-slate-400">
                        {account.email}
                      </p>
                    </div>
                    <UserCheck size={16} className="mt-1 shrink-0 text-slate-400" />
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setActiveTab('form')}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                <KeyRound size={14} /> Back to credential login
              </button>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Protected System · Unauthorized access is logged and investigated
        </p>
      </div>
    </div>
  )
}
