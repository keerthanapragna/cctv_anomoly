const API_BASE_URL = 'http://localhost:5000/api/v1'

export async function apiFetch(endpoint, options = {}) {
  const token = localStorage.getItem('hazard_token')
  const headers = {
    'Content-Type': 'application/json',
    ...(token && token !== 'demo-offline-token' ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include',
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const errorMsg = data?.message || `HTTP error ${response.status}: ${response.statusText}`
    const error = new Error(errorMsg)
    error.status = response.status
    error.data = data
    throw error
  }

  return data
}

export const authAPI = {
  login: (email, password) =>
    apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () =>
    apiFetch('/auth/logout', {
      method: 'POST',
    }),
  getMe: () => apiFetch('/auth/me'),
}

export const incidentAPI = {
  list: (params = {}) => {
    const queryString = new URLSearchParams(params).toString()
    return apiFetch(`/incidents${queryString ? `?${queryString}` : ''}`)
  },
  getById: (id) => apiFetch(`/incidents/${id}`),
  create: (incidentData) =>
    apiFetch('/incidents', {
      method: 'POST',
      body: JSON.stringify(incidentData),
    }),
  acknowledge: (id) =>
    apiFetch(`/incidents/${id}/acknowledge`, {
      method: 'PATCH',
    }),
  updateStatus: (id, status, notes = '') =>
    apiFetch(`/incidents/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, notes }),
    }),
  assign: (id, assignmentData) =>
    apiFetch(`/incidents/${id}/assign`, {
      method: 'PATCH',
      body: JSON.stringify(assignmentData),
    }),
  resolve: (id, resolutionDetails) =>
    apiFetch(`/incidents/${id}/resolve`, {
      method: 'PATCH',
      body: JSON.stringify({ resolutionDetails }),
    }),
  escalate: (id, escalationTier, reason = '') =>
    apiFetch(`/incidents/${id}/escalate`, {
      method: 'POST',
      body: JSON.stringify({ escalationTier, reason }),
    }),
}
