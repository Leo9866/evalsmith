import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { getCurrentSession } from './api/auth'
import AppLayout from './components/layout/AppLayout'
import LoadingSpinner from './components/ui/LoadingSpinner'
import ToastViewport from './components/ui/ToastViewport'
import LoginPage from './pages/auth/LoginPage'
import RegisterPage from './pages/auth/RegisterPage'
import DashboardPage from './pages/dashboard/DashboardPage'
import TraceListPage from './pages/tracing/TraceListPage'
import TraceDetailPage from './pages/tracing/TraceDetailPage'
import TraceStatsPage from './pages/tracing/TraceStatsPage'
import DatasetListPage from './pages/datasets/DatasetListPage'
import NewDatasetPage from './pages/datasets/NewDatasetPage'
import DatasetDetailPage from './pages/datasets/DatasetDetailPage'
import EvaluatorListPage from './pages/evaluators/EvaluatorListPage'
import NewEvaluatorPage from './pages/evaluators/NewEvaluatorPage'
import PromptListPage from './pages/prompts/PromptListPage'
import PromptDetailPage from './pages/prompts/PromptDetailPage'
import ExperimentListPage from './pages/experiments/ExperimentListPage'
import NewExperimentPage from './pages/experiments/NewExperimentPage'
import ExperimentDetailPage from './pages/experiments/ExperimentDetailPage'
import ExperimentComparePage from './pages/experiments/ExperimentComparePage'
import AnnotationListPage from './pages/annotation/AnnotationListPage'
import AnnotationDetailPage from './pages/annotation/AnnotationDetailPage'
import MonitoringPage from './pages/monitoring/MonitoringPage'
import SettingsPage from './pages/settings/SettingsPage'
import { useAppStore } from './stores/app'

export default function App() {
  const authInitialized = useAppStore((state) => state.authInitialized)
  const currentUser = useAppStore((state) => state.currentUser)
  const setAuthSession = useAppStore((state) => state.setAuthSession)
  const clearAuth = useAppStore((state) => state.clearAuth)

  useEffect(() => {
    if (authInitialized) {
      return
    }

    let active = true
    void getCurrentSession()
      .then((session) => {
        if (active) {
          setAuthSession(session)
        }
      })
      .catch(() => {
        if (active) {
          clearAuth()
        }
      })

    return () => {
      active = false
    }
  }, [authInitialized, clearAuth, setAuthSession])

  if (!authInitialized) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-[color:var(--color-line)] bg-[rgba(255,252,247,0.9)] px-5 py-3 text-sm text-[color:var(--color-text-soft)] shadow-[0_14px_32px_rgba(103,78,55,0.06)]">
          <LoadingSpinner size="sm" />
          正在检查登录状态
        </div>
      </div>
    )
  }

  return (
    <>
      <Routes>
        <Route path="/login" element={currentUser ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
        <Route path="/register" element={currentUser ? <Navigate to="/dashboard" replace /> : <RegisterPage />} />
        <Route element={currentUser ? <AppLayout /> : <Navigate to="/login" replace />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/tracing" element={<TraceListPage />} />
          <Route path="/tracing/stats" element={<TraceStatsPage />} />
          <Route path="/tracing/:id" element={<TraceDetailPage />} />
          <Route path="/datasets" element={<DatasetListPage />} />
          <Route path="/datasets/new" element={<NewDatasetPage />} />
          <Route path="/datasets/:id" element={<DatasetDetailPage />} />
          <Route path="/evaluators" element={<EvaluatorListPage />} />
          <Route path="/evaluators/new" element={<NewEvaluatorPage />} />
          <Route path="/prompts" element={<PromptListPage />} />
          <Route path="/prompts/:id" element={<PromptDetailPage />} />
          <Route path="/experiments" element={<ExperimentListPage />} />
          <Route path="/experiments/new" element={<NewExperimentPage />} />
          <Route path="/experiments/compare" element={<ExperimentComparePage />} />
          <Route path="/experiments/:id" element={<ExperimentDetailPage />} />
          <Route path="/annotation" element={<AnnotationListPage />} />
          <Route path="/annotation/:id" element={<AnnotationDetailPage />} />
          <Route path="/monitoring" element={<MonitoringPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
      <ToastViewport />
    </>
  )
}
