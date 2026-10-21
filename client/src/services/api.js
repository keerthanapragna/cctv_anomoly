const RAW_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'
export const BASE_SERVER_URL = RAW_BASE_URL.replace(/\/+$/, '')
const API_BASE_URL = `${BASE_SERVER_URL}/api/v1`

export async function apiFetch(endpoint, options = {}) {
  const token = localStorage.getItem('hazard_token')
  const headers = {
    'Content-Type': 'application/json',
    ...(token && token !== 'demo-offline-token' ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  }

  let response
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
      credentials: 'include',
    })
  } catch (netErr) {
    const error = new Error(`Cannot connect to Hazard Response API at ${BASE_SERVER_URL}. Please ensure the backend server is running. (${netErr.message})`)
    error.isNetworkError = true
    throw error
  }

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
  health: async () => {
    try {
      const res = await fetch(`${BASE_SERVER_URL}/api/health`)
      return await res.json()
    } catch (err) {
      return { success: false, message: err.message }
    }
  },
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
  startResponse: (id) =>
    apiFetch(`/incidents/${id}/start-response`, {
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

export const userAPI = {
  list: (params = {}) => {
    const queryString = new URLSearchParams(params).toString()
    return apiFetch(`/users${queryString ? `?${queryString}` : ''}`)
  },
  getById: (id) => apiFetch(`/users/${id}`),
  updateStatus: (id, isActive) =>
    apiFetch(`/users/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    }),
}

export const sensorAPI = {
  list: (params = {}) => {
    const queryString = new URLSearchParams(params).toString()
    return apiFetch(`/sensors${queryString ? `?${queryString}` : ''}`)
  },
  getById: (id) => apiFetch(`/sensors/${id}`),
  create: (sensorData) =>
    apiFetch('/sensors', {
      method: 'POST',
      body: JSON.stringify(sensorData),
    }),
  updateStatus: (id, statusData) =>
    apiFetch(`/sensors/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(statusData),
    }),
}

export const directiveAPI = {
  list: () => apiFetch('/directives'),
  create: (directiveData) =>
    apiFetch('/directives', {
      method: 'POST',
      body: JSON.stringify(directiveData),
    }),
}

export const analyticsAPI = {
  getOverview: (params = {}) => {
    const queryString = new URLSearchParams(params).toString()
    return apiFetch(`/analytics/overview${queryString ? `?${queryString}` : ''}`)
  },
  getRoles: (params = {}) => {
    const queryString = new URLSearchParams(params).toString()
    return apiFetch(`/analytics/roles${queryString ? `?${queryString}` : ''}`)
  },
  getTrends: (params = {}) => {
    const queryString = new URLSearchParams(params).toString()
    return apiFetch(`/analytics/trends${queryString ? `?${queryString}` : ''}`)
  },
  getWorkload: (params = {}) => {
    const queryString = new URLSearchParams(params).toString()
    return apiFetch(`/analytics/workload${queryString ? `?${queryString}` : ''}`)
  },
  getLeaderboard: (params = {}) => {
    const queryString = new URLSearchParams(params).toString()
    return apiFetch(`/analytics/leaderboard${queryString ? `?${queryString}` : ''}`)
  },
}

export const aiAPI = {
  getStatus: () => apiFetch('/ai/status'),
  createEventSource: () => new EventSource(`${API_BASE_URL}/ai/stream`),
  inferImage: (imageB64, cameraId = 'CAM-01') =>
    apiFetch('/ai/infer-image', {
      method: 'POST',
      body: JSON.stringify({ image: imageB64, cameraId }),
    }),
  startCamera: () =>
    apiFetch('/ai/camera/start', {
      method: 'POST',
    }),
  stopCamera: () =>
    apiFetch('/ai/camera/stop', {
      method: 'POST',
    }),
  triggerTestScenario: async (scenarioId, cameraId = 'CAM-12') => {
    try {
      return await apiFetch('/ai/scenario', {
        method: 'POST',
        body: JSON.stringify({ scenario: scenarioId, cameraId }),
      })
    } catch (err) {
      // Fallback to direct Python service port 8000 if backend route proxy is unreachable
      try {
        const res = await fetch('http://127.0.0.1:8000/trigger-scenario', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scenario: scenarioId, camera_id: cameraId }),
        })
        return await res.json()
      } catch (subErr) {
        throw new Error(
          `AI Inference service unavailable. Please ensure 'python src/inference_service.py' is running. (${err.message})`
        )
      }
    }
  },
}


