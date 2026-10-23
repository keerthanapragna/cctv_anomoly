import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Camera,
  Video,
  VideoOff,
  Upload,
  Play,
  Square,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Shield,
  ShieldAlert,
  Radio,
  Eye,
  RefreshCw,
  ExternalLink,
  Info,
  Sliders,
  Server,
  Activity,
  Layers,
} from 'lucide-react'
import { violenceAPI } from '../services/api'

export default function LiveViolenceMonitor({
  currentUser,
  onNavigateToIncidents,
  onIncidentCreated,
}) {
  // Source tabs: 'webcam', 'cctv', 'upload'
  const [activeSource, setActiveSource] = useState('webcam')

  // Subsystem health state
  const [subsystemStatus, setSubsystemStatus] = useState(null)
  const [statusLoading, setStatusLoading] = useState(false)

  // Threshold & Config
  const [threshold, setThreshold] = useState(0.65)
  const [sampleInterval, setSampleInterval] = useState(4) // seconds between webcam inference passes

  // Webcam State
  const [isWebcamActive, setIsWebcamActive] = useState(false)
  const [webcamError, setWebcamError] = useState(null)
  const [isSampling, setIsSampling] = useState(false)
  const [sampleCountdown, setSampleCountdown] = useState(0)
  const [webcamCamId, setWebcamCamId] = useState('CAM-WEBCAM-01')

  // Video Upload State
  const [uploadFile, setUploadFile] = useState(null)
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState(null)
  const [uploadCamId, setUploadCamId] = useState('CAM-FILE-01')
  const [isAnalyzingVideo, setIsAnalyzingVideo] = useState(false)

  // CCTV State
  const [cctvCamId, setCctvCamId] = useState('CAM-CCTV-01')
  const [cctvStatus, setCctvStatus] = useState({ is_running: false, status: 'stopped' })
  const [cctvLoading, setCctvLoading] = useState(false)

  // Latest Result & History
  const [latestResult, setLatestResult] = useState(null)
  const [persistenceInfo, setPersistenceInfo] = useState(null)
  const [eventHistory, setEventHistory] = useState([])
  const [generalError, setGeneralError] = useState(null)

  // Refs for media streams and canvas
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const samplingTimerRef = useRef(null)
  const countdownTimerRef = useRef(null)

  // Mutable refs to prevent stale closure bugs in timers and callbacks
  const isWebcamActiveRef = useRef(false)
  const isSamplingRef = useRef(false)
  const thresholdRef = useRef(threshold)
  const sampleIntervalRef = useRef(sampleInterval)
  const webcamCamIdRef = useRef(webcamCamId)

  useEffect(() => {
    thresholdRef.current = threshold
  }, [threshold])

  useEffect(() => {
    sampleIntervalRef.current = sampleInterval
  }, [sampleInterval])

  useEffect(() => {
    webcamCamIdRef.current = webcamCamId
  }, [webcamCamId])

  // Fetch subsystem status
  const fetchStatus = useCallback(async () => {
    setStatusLoading(true)
    try {
      const res = await violenceAPI.getStatus()
      if (res && res.data) {
        setSubsystemStatus(res.data)
        if (res.data.defaultThreshold) {
          setThreshold(res.data.defaultThreshold)
        }
      }
    } catch (err) {
      console.warn('Could not fetch violence subsystem status:', err.message)
    } finally {
      setStatusLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  // Poll CCTV status if in CCTV tab
  useEffect(() => {
    if (activeSource !== 'cctv') return
    let intervalId = setInterval(async () => {
      try {
        const res = await violenceAPI.getCctvStatus()
        if (res && res.data) {
          setCctvStatus(res.data)
        }
      } catch {}
    }, 4000)
    return () => clearInterval(intervalId)
  }, [activeSource])

  // Stop webcam tracks cleanly
  const stopWebcam = useCallback(() => {
    isWebcamActiveRef.current = false
    isSamplingRef.current = false
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop()
        } catch {}
      })
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    if (samplingTimerRef.current) {
      clearTimeout(samplingTimerRef.current)
      clearInterval(samplingTimerRef.current)
      samplingTimerRef.current = null
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current)
      countdownTimerRef.current = null
    }
    setIsWebcamActive(false)
    setIsSampling(false)
    setSampleCountdown(0)
  }, [])

  // Cleanup on unmount or logout
  useEffect(() => {
    return () => {
      stopWebcam()
      if (uploadPreviewUrl) {
        URL.revokeObjectURL(uploadPreviewUrl)
      }
    }
  }, [stopWebcam, uploadPreviewUrl])

  // Start webcam with explicit permission flow
  const startWebcam = async () => {
    setWebcamError(null)
    setGeneralError(null)
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Your browser does not support webcam video capture (mediaDevices API unavailable).')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
        },
        audio: false,
      })

      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      isWebcamActiveRef.current = true
      setIsWebcamActive(true)

      // Schedule first capture pass after short camera stabilization delay (1.2s)
      scheduleNextWebcamPass(1.2)
    } catch (err) {
      console.error('Webcam start error:', err)
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setWebcamError(
          'Browser camera permission denied. Please click the lock or camera icon in your address bar and allow camera access.'
        )
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setWebcamError('No camera found on this computer. Please connect a working webcam.')
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setWebcamError('Camera hardware is currently busy or in use by another program.')
      } else {
        setWebcamError(err.message || 'Unable to open camera stream.')
      }
      stopWebcam()
    }
  }

  // Schedule next inference pass cleanly with countdown feedback
  const scheduleNextWebcamPass = (delaySec) => {
    if (!isWebcamActiveRef.current) return
    if (samplingTimerRef.current) {
      clearTimeout(samplingTimerRef.current)
      clearInterval(samplingTimerRef.current)
      samplingTimerRef.current = null
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current)
      countdownTimerRef.current = null
    }

    const wholeSec = Math.max(1, Math.round(delaySec))
    setSampleCountdown(wholeSec)
    let remaining = wholeSec

    countdownTimerRef.current = setInterval(() => {
      remaining -= 1
      if (remaining <= 0) {
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current)
          countdownTimerRef.current = null
        }
        setSampleCountdown(0)
      } else {
        setSampleCountdown(remaining)
      }
    }, 1000)

    samplingTimerRef.current = setTimeout(async () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current)
        countdownTimerRef.current = null
      }
      setSampleCountdown(0)
      await captureAndInferWebcamFrames()
    }, delaySec * 1000)
  }

  // Capture 16 frames uniformly over a ~2.0-second temporal window and infer on CPU
  const captureAndInferWebcamFrames = async () => {
    if (!isWebcamActiveRef.current) return
    if (!videoRef.current || !streamRef.current) return
    if (isSamplingRef.current) return // Prevent concurrent runs

    // Ensure video track is actually delivering frames (video ready)
    if (videoRef.current.readyState < 2 || videoRef.current.videoWidth === 0) {
      console.warn('Camera video frame not ready yet; deferring sample pass.')
      scheduleNextWebcamPass(1.0)
      return
    }

    isSamplingRef.current = true
    setIsSampling(true)
    try {
      const canvas = canvasRef.current || document.createElement('canvas')
      canvas.width = 224
      canvas.height = 224
      const ctx = canvas.getContext('2d')

      const frames = []
      const totalFrames = 16
      const frameDelayMs = 125 // 16 frames * 125ms = 2.0 second temporal action window

      for (let i = 0; i < totalFrames; i++) {
        if (!isWebcamActiveRef.current || !videoRef.current) break
        ctx.drawImage(videoRef.current, 0, 0, 224, 224)
        const frameData = canvas.toDataURL('image/jpeg', 0.8)
        frames.push(frameData)
        if (i < totalFrames - 1) {
          await new Promise((r) => setTimeout(r, frameDelayMs))
        }
      }

      if (!isWebcamActiveRef.current) return

      if (frames.length < 8) {
        console.warn('Insufficient frames captured:', frames.length)
        return
      }

      const res = await violenceAPI.analyzeFrames({
        frames,
        threshold: thresholdRef.current,
        cameraId: webcamCamIdRef.current,
        source: 'webcam',
      })

      if (res && res.data) {
        const inf = res.data.inference
        const pers = res.data.persistence

        setLatestResult(inf)
        setPersistenceInfo(pers)

        // Append to history
        setEventHistory((prev) => [
          {
            id: Date.now(),
            time: new Date().toLocaleTimeString(),
            source: 'webcam',
            cameraId: webcamCamIdRef.current,
            prob: inf.violence_prob,
            uncertainty: inf.uncertainty_score,
            severity: inf.severity_assessment,
            priority: inf.response_priority,
            requiresReview: inf.requires_human_review,
            qualifies: inf.qualifies_as_incident,
            persisted: pers?.persisted || false,
            deduplicated: pers?.deduplicated || false,
            incidentId: pers?.incidentId || null,
          },
          ...prev.slice(0, 14), // keep last 15
        ])

        if (pers?.persisted && !pers?.deduplicated && onIncidentCreated) {
          onIncidentCreated()
        }
      }
    } catch (err) {
      console.error('Live frame inference error:', err)
      setGeneralError(err.message || 'Live frame inference error')
    } finally {
      isSamplingRef.current = false
      setIsSampling(false)
      // Chain next pass sequentially after inference completes
      if (isWebcamActiveRef.current) {
        scheduleNextWebcamPass(sampleIntervalRef.current)
      }
    }
  }

  // Handle uploaded video file analysis
  const handleVideoFileChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadFile(file)
    if (uploadPreviewUrl) {
      URL.revokeObjectURL(uploadPreviewUrl)
    }
    setUploadPreviewUrl(URL.createObjectURL(file))
    setLatestResult(null)
    setPersistenceInfo(null)
    setGeneralError(null)
  }

  const handleAnalyzeVideoFile = async () => {
    if (!uploadFile) return
    setIsAnalyzingVideo(true)
    setGeneralError(null)
    try {
      const formData = new FormData()
      formData.append('file', uploadFile)
      formData.append('threshold', threshold.toString())
      formData.append('cameraId', uploadCamId)

      const res = await violenceAPI.analyzeVideo(formData)
      if (res && res.data) {
        const inf = res.data.inference
        const pers = res.data.persistence

        setLatestResult(inf)
        setPersistenceInfo(pers)

        setEventHistory((prev) => [
          {
            id: Date.now(),
            time: new Date().toLocaleTimeString(),
            source: 'uploaded_video',
            filename: uploadFile.name,
            cameraId: uploadCamId,
            prob: inf.violence_prob,
            uncertainty: inf.uncertainty_score,
            severity: inf.severity_assessment,
            priority: inf.response_priority,
            requiresReview: inf.requires_human_review,
            qualifies: inf.qualifies_as_incident,
            persisted: pers?.persisted || false,
            deduplicated: pers?.deduplicated || false,
            incidentId: pers?.incidentId || null,
          },
          ...prev.slice(0, 14),
        ])

        if (pers?.persisted && !pers?.deduplicated && onIncidentCreated) {
          onIncidentCreated()
        }
      }
    } catch (err) {
      console.error('Video upload error:', err)
      setGeneralError(err.message || 'Video analysis failed')
    } finally {
      setIsAnalyzingVideo(false)
    }
  }

  // CCTV Start/Stop
  const handleStartCctv = async () => {
    setCctvLoading(true)
    setGeneralError(null)
    try {
      const res = await violenceAPI.startCctv({
        cameraId: cctvCamId,
        threshold,
        sampleInterval: 4.0,
      })
      if (res && res.data) {
        setCctvStatus(res.data)
      }
    } catch (err) {
      setGeneralError(err.message || 'Failed to start CCTV stream')
    } finally {
      setCctvLoading(false)
    }
  }

  const handleStopCctv = async () => {
    setCctvLoading(true)
    setGeneralError(null)
    try {
      const res = await violenceAPI.stopCctv()
      if (res && res.data) {
        setCctvStatus({ is_running: false, status: 'stopped' })
      }
    } catch (err) {
      setGeneralError(err.message || 'Failed to stop CCTV stream')
    } finally {
      setCctvLoading(false)
    }
  }

  // Helper styles for severity badges
  const getSeverityBadgeClass = (severity) => {
    if (!severity) return 'bg-slate-100 text-slate-700'
    const s = severity.toLowerCase()
    if (s.includes('severe') || s.includes('critical')) return 'bg-rose-100 text-rose-800 border-rose-300'
    if (s.includes('moderate')) return 'bg-amber-100 text-amber-800 border-amber-300'
    if (s.includes('slight')) return 'bg-blue-100 text-blue-800 border-blue-300'
    return 'bg-emerald-100 text-emerald-800 border-emerald-300'
  }

  const getPriorityBadgeClass = (priority) => {
    if (!priority) return 'bg-slate-100 text-slate-600'
    switch (priority) {
      case 'Critical':
        return 'bg-rose-600 text-white'
      case 'High':
        return 'bg-amber-600 text-white'
      case 'Medium':
        return 'bg-blue-600 text-white'
      case 'Low':
        return 'bg-slate-200 text-slate-700'
      default:
        return 'bg-slate-100 text-slate-500'
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Banner & Subsystem Status */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#a94064]/10 text-[#a94064]">
                <ShieldAlert size={22} />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-900">
                    Live Camera & CCTV Violence Detection Monitor
                  </h2>
                  <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-[11px] font-bold text-purple-800">
                    ResNet3D + Transformer
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  Pretrained Hybrid Video Classifier · Dual-Head Logits & Uncertainty · Operational Triage & SLA Dispatch
                </p>
              </div>
            </div>
          </div>

          {/* Subsystem Health Indicators */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs">
              <span className="text-slate-500 font-medium">Python AI Service:</span>
              {subsystemStatus?.pythonService?.status === 'healthy' ? (
                <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  Online (CPU)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-bold text-rose-700">
                  <span className="h-2 w-2 rounded-full bg-rose-500" />
                  {subsystemStatus?.pythonService?.status || 'Offline'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs">
              <span className="text-slate-500 font-medium">MongoDB:</span>
              {subsystemStatus?.database === 'connected' ? (
                <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Connected
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-1 font-bold text-amber-700 cursor-help"
                  title="MongoDB Atlas SSL 80 / Offline: In offline mode, inference runs normally and reports results without persisting fake records."
                >
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  Offline Mode
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={fetchStatus}
              disabled={statusLoading}
              title="Refresh subsystem status"
              className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw size={14} className={statusLoading ? 'animate-spin text-[#a94064]' : ''} />
            </button>
          </div>
        </div>

        {/* Global Error Alert */}
        {generalError && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
            <div className="flex items-center gap-2">
              <AlertTriangle size={15} className="shrink-0 text-rose-600" />
              <span>{generalError}</span>
            </div>
            <button
              type="button"
              onClick={() => setGeneralError(null)}
              className="font-semibold text-rose-700 hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Main Monitoring Section */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(340px,1fr)]">
        {/* Left Column: Camera Feeds & Controls */}
        <div className="space-y-6">
          {/* Source Tabs Header */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    stopWebcam()
                    setActiveSource('webcam')
                  }}
                  className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                    activeSource === 'webcam'
                      ? 'bg-[#a94064] text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <Video size={15} />
                  Browser Webcam
                </button>

                <button
                  type="button"
                  onClick={() => {
                    stopWebcam()
                    setActiveSource('cctv')
                  }}
                  className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                    activeSource === 'cctv'
                      ? 'bg-[#a94064] text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <Radio size={15} />
                  Authorized CCTV Stream
                </button>

                <button
                  type="button"
                  onClick={() => {
                    stopWebcam()
                    setActiveSource('upload')
                  }}
                  className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                    activeSource === 'upload'
                      ? 'bg-[#a94064] text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <Upload size={15} />
                  Recorded Video File
                </button>
              </div>

              {/* Threshold Setting */}
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <Sliders size={14} className="text-slate-400" />
                <span className="font-semibold">Threshold:</span>
                <span className="font-mono font-bold text-slate-800">{threshold.toFixed(2)}</span>
                <input
                  type="range"
                  min="0.30"
                  max="0.90"
                  step="0.05"
                  value={threshold}
                  onChange={(e) => setThreshold(parseFloat(e.target.value))}
                  className="w-20 accent-[#a94064]"
                />
              </div>
            </div>

            {/* TAB 1: WEBCAM MONITORING */}
            {activeSource === 'webcam' && (
              <div className="pt-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-700">Camera Source ID:</span>
                    <input
                      type="text"
                      value={webcamCamId}
                      onChange={(e) => setWebcamCamId(e.target.value)}
                      disabled={isWebcamActive}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-mono font-medium text-slate-800 disabled:opacity-60"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Sample Interval:</span>
                    <select
                      value={sampleInterval}
                      onChange={(e) => setSampleInterval(Number(e.target.value))}
                      disabled={isWebcamActive}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700"
                    >
                      <option value={3}>Every 3 seconds</option>
                      <option value={4}>Every 4 seconds</option>
                      <option value={5}>Every 5 seconds</option>
                      <option value={8}>Every 8 seconds</option>
                    </select>
                  </div>
                </div>

                {/* Webcam Preview Screen */}
                <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-slate-900 border border-slate-800 shadow-inner flex items-center justify-center">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`h-full w-full object-cover transition duration-300 ${isWebcamActive ? 'opacity-100' : 'opacity-0'}`}
                  />
                  <canvas ref={canvasRef} className="hidden" />

                  {/* Idle / Stopped Overlay */}
                  {!isWebcamActive && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-slate-400">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-slate-300 mb-3">
                        <Camera size={28} />
                      </div>
                      <p className="text-sm font-semibold text-slate-200">Camera is currently inactive</p>
                      <p className="mt-1 text-xs max-w-sm text-slate-400">
                        Click "Start Camera" to activate your webcam. The browser will request explicit permission before streaming.
                      </p>
                    </div>
                  )}

                  {/* Active Monitoring HUD Overlay */}
                  {isWebcamActive && (
                    <>
                      <div className="absolute top-3 left-3 flex items-center gap-2 rounded-lg bg-black/60 backdrop-blur px-2.5 py-1 text-[11px] font-semibold text-white">
                        <span className="h-2 w-2 rounded-full bg-rose-500 animate-ping" />
                        <span>LIVE PREVIEW · {webcamCamId}</span>
                      </div>

                      <div className="absolute top-3 right-3 flex items-center gap-2 rounded-lg bg-black/60 backdrop-blur px-2.5 py-1 text-[11px] font-semibold text-white">
                        {isSampling ? (
                          <span className="flex items-center gap-1.5 text-amber-300">
                            <RefreshCw size={12} className="animate-spin" />
                            Analyzing 16 frames on CPU...
                          </span>
                        ) : (
                          <span className="text-slate-300">Next sample in {sampleCountdown}s</span>
                        )}
                      </div>

                      <div className="absolute bottom-3 left-3 rounded-lg bg-black/60 backdrop-blur px-2.5 py-1 text-[10px] text-slate-300">
                        Controlled 16-frame CPU window · 224x224
                      </div>
                    </>
                  )}
                </div>

                {/* Webcam Error Warning */}
                {webcamError && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                    <AlertTriangle size={16} className="shrink-0 text-rose-600 mt-0.5" />
                    <div>
                      <p className="font-semibold">Camera Access Warning</p>
                      <p className="mt-0.5">{webcamError}</p>
                    </div>
                  </div>
                )}

                {/* Controls */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <div className="text-xs text-slate-500">
                    Privacy Policy: Camera tracks stop automatically when monitoring ends or when navigating away.
                  </div>

                  <div className="flex items-center gap-2">
                    {!isWebcamActive ? (
                      <button
                        type="button"
                        onClick={startWebcam}
                        className="inline-flex items-center gap-2 rounded-xl bg-[#a94064] px-4 py-2 text-xs font-bold text-white shadow-md shadow-[#a94064]/20 hover:bg-[#8f3454] transition"
                      >
                        <Play size={14} />
                        Start Camera
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={stopWebcam}
                        className="inline-flex items-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 transition"
                      >
                        <Square size={14} />
                        Stop Camera
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: CCTV / RTSP MONITORING */}
            {activeSource === 'cctv' && (
              <div className="pt-4 space-y-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start gap-3">
                    <Info size={18} className="shrink-0 text-blue-600 mt-0.5" />
                    <div className="text-xs text-slate-600 leading-relaxed">
                      <p className="font-bold text-slate-800">Secure Server-Side CCTV Streaming</p>
                      <p className="mt-1">
                        CCTV/RTSP camera stream credentials and network addresses are held exclusively on the Express
                        server (via <code className="bg-slate-200 px-1 rounded font-mono">CCTV_STREAM_URL</code>). Credentials
                        are never sent to client browsers or exposed in client bundles.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      Camera Identifier
                    </label>
                    <input
                      type="text"
                      value={cctvCamId}
                      onChange={(e) => setCctvCamId(e.target.value)}
                      disabled={cctvStatus?.is_running}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      Monitoring Worker Status
                    </label>
                    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
                      {cctvStatus?.is_running ? (
                        <span className="flex items-center gap-1.5 font-bold text-emerald-700">
                          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                          Streaming & Sampling (Active)
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 font-semibold text-slate-500">
                          <span className="h-2 w-2 rounded-full bg-slate-300" />
                          Worker Stopped (Idle)
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <div className="text-xs text-slate-500">
                    Restricted to Administrator & Security Officer roles.
                  </div>

                  <div className="flex items-center gap-2">
                    {!cctvStatus?.is_running ? (
                      <button
                        type="button"
                        onClick={handleStartCctv}
                        disabled={cctvLoading}
                        className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 transition disabled:opacity-50"
                      >
                        <Play size={14} />
                        {cctvLoading ? 'Starting...' : 'Start CCTV Stream'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleStopCctv}
                        disabled={cctvLoading}
                        className="inline-flex items-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 transition disabled:opacity-50"
                      >
                        <Square size={14} />
                        {cctvLoading ? 'Stopping...' : 'Stop CCTV Stream'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: RECORDED VIDEO FILE (OFFLINE TESTING) */}
            {activeSource === 'upload' && (
              <div className="pt-4 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      Camera / Source Label
                    </label>
                    <input
                      type="text"
                      value={uploadCamId}
                      onChange={(e) => setUploadCamId(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800"
                    />
                  </div>

                  <div className="flex-1">
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      Supported Formats
                    </label>
                    <p className="text-xs text-slate-500 py-2">
                      MP4, AVI, MOV, MKV, WebM (Max 100MB)
                    </p>
                  </div>
                </div>

                {/* File Upload Drop Area */}
                <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-6 text-center hover:bg-slate-50 transition">
                  <input
                    type="file"
                    id="videoFileInput"
                    accept=".mp4,.avi,.mov,.mkv,.webm"
                    onChange={handleVideoFileChange}
                    className="hidden"
                  />
                  <label htmlFor="videoFileInput" className="cursor-pointer">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-purple-50 text-purple-700 mb-2">
                      <Upload size={22} />
                    </div>
                    <p className="text-xs font-bold text-slate-800">
                      {uploadFile ? uploadFile.name : 'Select or drop a video file for model testing'}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {uploadFile ? `${(uploadFile.size / (1024 * 1024)).toFixed(2)} MB` : 'Click to browse local files'}
                    </p>
                  </label>
                </div>

                {/* Video Preview */}
                {uploadPreviewUrl && (
                  <div className="overflow-hidden rounded-2xl bg-black border border-slate-800">
                    <video
                      src={uploadPreviewUrl}
                      controls
                      className="max-h-[300px] w-full object-contain mx-auto"
                    />
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={handleAnalyzeVideoFile}
                    disabled={!uploadFile || isAnalyzingVideo}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#a94064] px-5 py-2.5 text-xs font-bold text-white shadow-md shadow-[#a94064]/20 hover:bg-[#8f3454] transition disabled:opacity-50"
                  >
                    {isAnalyzingVideo ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" />
                        Analyzing on CPU...
                      </>
                    ) : (
                      <>
                        <Play size={14} />
                        Analyze Video Clip
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Operational Triage Policy Reference Card */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 font-bold text-slate-900 text-xs mb-3">
              <Layers size={16} className="text-[#a94064]" />
              <h3>Operational Policy Triage Framework</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                <span className="font-bold text-emerald-800">No Apparent Violence</span>
                <p className="text-emerald-700 mt-1 text-[11px]">Score &lt; 0.35 with low uncertainty. No safety alert created.</p>
              </div>
              <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3">
                <span className="font-bold text-blue-800">Slight or Suspected</span>
                <p className="text-blue-700 mt-1 text-[11px]">Score &lt; threshold. Low priority triage audit only.</p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                <span className="font-bold text-amber-800">Moderate Suspected</span>
                <p className="text-amber-700 mt-1 text-[11px]">Score &ge; threshold. Qualifying alert dispatched to Security.</p>
              </div>
              <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3">
                <span className="font-bold text-rose-800">Severe or Critical</span>
                <p className="text-rose-700 mt-1 text-[11px]">Score &ge; 0.85 and uncertainty &lt; 0.40. Immediate emergency response.</p>
              </div>
            </div>
            <p className="mt-3 text-[11px] text-slate-500 italic">
              Note: Model produces raw violence logits and an uncertainty value. Severity classifications are provisional
              operational guidelines for human verification, not ground-truth clinical diagnostic labels.
            </p>
          </div>
        </div>

        {/* Right Column: Latest Inference Output & Persistence Feedback */}
        <div className="space-y-6">
          {/* Latest Inference Card */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-xs flex items-center gap-2">
                <Activity size={16} className="text-[#a94064]" />
                Latest Inference Evaluation
              </h3>
              {latestResult && (
                <span className="text-[11px] text-slate-400 font-mono">
                  {latestResult.processing_time_ms} ms (CPU)
                </span>
              )}
            </div>

            {latestResult ? (
              <div className="mt-4 space-y-4">
                {/* Result Status Badges */}
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-lg border px-2.5 py-1 text-xs font-bold ${getSeverityBadgeClass(
                      latestResult.severity_assessment
                    )}`}
                  >
                    {latestResult.severity_assessment}
                  </span>
                  <span
                    className={`rounded-lg px-2 py-0.5 text-xs font-bold ${getPriorityBadgeClass(
                      latestResult.response_priority
                    )}`}
                  >
                    Priority: {latestResult.response_priority}
                  </span>
                </div>

                {/* Mandatory Human Review Warning */}
                {latestResult.requires_human_review && (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                    <div className="flex items-center gap-2 font-bold">
                      <AlertTriangle size={15} className="text-amber-600" />
                      <span>Human Review Required</span>
                    </div>
                    <p className="mt-1 text-[11px] text-amber-800">
                      High model uncertainty ({latestResult.uncertainty_score?.toFixed(2)}) or near decision threshold. Mandatory
                      verification by safety personnel is required.
                    </p>
                  </div>
                )}

                {/* Score Meters */}
                <div className="space-y-3 pt-1">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-semibold text-slate-700">Violence Probability:</span>
                      <span className="font-mono font-bold text-slate-900">
                        {(latestResult.violence_prob * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full transition-all duration-500 ${
                          latestResult.violence_prob >= threshold ? 'bg-rose-600' : 'bg-emerald-500'
                        }`}
                        style={{ width: `${Math.min(latestResult.violence_prob * 100, 100)}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-semibold text-slate-700">Model Uncertainty:</span>
                      <span className="font-mono font-bold text-slate-900">
                        {latestResult.uncertainty_score?.toFixed(2)}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full transition-all duration-500 ${
                          latestResult.uncertainty_score >= 0.40 ? 'bg-amber-500' : 'bg-blue-500'
                        }`}
                        style={{ width: `${Math.min(latestResult.uncertainty_score * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Explanation text */}
                <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 border border-slate-200">
                  <p className="font-semibold text-slate-700 mb-0.5">Policy Assessment:</p>
                  <p className="text-[11px] leading-relaxed text-slate-600">
                    {latestResult.policy_explanation}
                  </p>
                </div>

                {/* MongoDB Persistence Status */}
                {persistenceInfo && (
                  <div
                    className={`rounded-xl border p-3.5 text-xs ${
                      persistenceInfo.persisted && !persistenceInfo.deduplicated
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                        : persistenceInfo.deduplicated
                        ? 'border-amber-200 bg-amber-50 text-amber-900'
                        : 'border-slate-200 bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        {persistenceInfo.persisted ? (
                          <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                        ) : (
                          <Info size={16} className="text-slate-500 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <p className="font-bold">
                            {persistenceInfo.persisted
                              ? persistenceInfo.deduplicated
                                ? 'Consecutive Detection Grouped'
                                : 'Official Safety Incident Saved'
                              : 'Persistence Notice'}
                          </p>
                          <p className="mt-0.5 text-[11px] leading-relaxed">{persistenceInfo.message}</p>
                          {persistenceInfo.incidentId && (
                            <p className="mt-1 font-mono font-bold text-xs">
                              ID: {persistenceInfo.incidentId}
                            </p>
                          )}
                        </div>
                      </div>

                      {persistenceInfo.incidentId && onNavigateToIncidents && (
                        <button
                          type="button"
                          onClick={onNavigateToIncidents}
                          className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-700 transition"
                        >
                          View Incident <ExternalLink size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-10 text-center text-slate-400 text-xs">
                <Clock size={28} className="mx-auto mb-2 text-slate-300" />
                <p className="font-medium text-slate-600">No inference results yet</p>
                <p className="text-[11px] mt-0.5">
                  Start the webcam or upload a video file to run model evaluation.
                </p>
              </div>
            )}
          </div>

          {/* Session Detection Feed */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <h3 className="font-bold text-slate-900 text-xs mb-3 flex items-center justify-between">
              <span>Session Inference Feed</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 font-semibold">
                {eventHistory.length} events
              </span>
            </h3>

            {eventHistory.length > 0 ? (
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {eventHistory.map((ev) => (
                  <div
                    key={ev.id}
                    className="rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 text-xs flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-800">{ev.severity}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{ev.time}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        Score: {(ev.prob * 100).toFixed(0)}% · Unc: {ev.uncertainty?.toFixed(2)} · {ev.cameraId}
                      </div>
                    </div>
                    {ev.incidentId ? (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-mono font-bold text-emerald-800">
                        {ev.incidentId}
                      </span>
                    ) : ev.qualifies ? (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                        Qualifying
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400">Normal</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 text-center py-4">
                Events recorded during this session will appear here.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
