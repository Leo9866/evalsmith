import { useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, LogOut, Menu, Search } from 'lucide-react'
import { logout } from '@/api/auth'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import { formatProjectRole } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'

const routeLabels: Record<string, string> = {
  dashboard: '概览',
  tracing: 'Trace',
  stats: '分析',
  datasets: 'Dataset',
  evaluators: 'Evaluator',
  experiments: 'Experiment',
  settings: '设置',
  new: '新建',
}

export default function Header() {
  const location = useLocation()
  const currentProject = useAppStore((state) => state.currentProject)
  const currentProjectRole = useAppStore((state) => state.currentProjectRole)
  const currentUser = useAppStore((state) => state.currentUser)
  const projects = useAppStore((state) => state.projects)
  const setProject = useAppStore((state) => state.setProject)
  const clearAuth = useAppStore((state) => state.clearAuth)
  const toggleMobileNav = useAppStore((state) => state.toggleMobileNav)

  const breadcrumbs = useMemo(() => {
    const segments = location.pathname.split('/').filter(Boolean)
    return segments.map((segment) => routeLabels[segment] || segment)
  }, [location.pathname])

  const projectOptions = useMemo(() => {
    const options =
      projects.map((project) => ({
        value: project.id,
        label: project.name,
      })) ?? []

    if (!options.some((option) => option.value === currentProject)) {
      options.unshift({
        value: currentProject,
        label: currentProject,
      })
    }

    return options
  }, [currentProject, projects])

  const handleLogout = async () => {
    try {
      await logout()
    } finally {
      clearAuth()
    }
  }

  return (
    <header className="sticky top-0 z-30 border-b border-[color:var(--color-line)] bg-[rgba(247,243,236,0.96)]">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-5 py-4 sm:px-6 lg:px-10">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={toggleMobileNav}
            className="inline-flex rounded-[1rem] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] p-2.5 text-[color:var(--color-text-soft)] transition hover:border-[color:var(--color-line-strong)] hover:text-[color:var(--color-text)] lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1 text-sm text-[color:var(--color-text-soft)]">
              <Link to="/dashboard" className="transition hover:text-[color:var(--color-text)]">
                EvalSmith
              </Link>
              {breadcrumbs.map((crumb, index) => (
                <span key={`${crumb}-${index}`} className="inline-flex items-center gap-1">
                  <ChevronRight className="h-3.5 w-3.5 opacity-45" />
                  <span
                    className={cn(
                      index === breadcrumbs.length - 1
                        ? 'font-semibold text-[color:var(--color-text)]'
                        : 'text-[color:var(--color-text-soft)]'
                    )}
                  >
                    {crumb}
                  </span>
                </span>
              ))}
            </div>
            <p className="mt-1 text-xs uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.58)]">
              EvalSmith 控制台
            </p>
          </div>
        </div>

        <div className="flex items-end gap-3">
          <div className="hidden md:block">
            <Input
              type="search"
              placeholder="搜索 Trace、Dataset、Experiment"
              icon={<Search className="h-4 w-4" />}
              className="w-56"
            />
          </div>

          <div className="w-[15rem] shrink-0 sm:w-[18rem]">
            <Select
              aria-label="选择项目"
              label="项目"
              value={currentProject}
              onChange={(event) => setProject(event.target.value)}
              options={projectOptions}
            />
          </div>

          {currentUser && (
            <div className="hidden items-center gap-2.5 lg:flex">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgba(193,109,58,0.14)] text-[0.7rem] font-bold uppercase tracking-wide text-[color:var(--color-accent-strong)]">
                {currentUser.name?.slice(0, 2) ?? '??'}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-tight text-[color:var(--color-text)]">{currentUser.name}</p>
                <p className="text-[0.67rem] uppercase tracking-[0.22em] text-[color:rgba(93,83,73,0.52)]">
                  {formatProjectRole(currentProjectRole)}
                </p>
              </div>
            </div>
          )}

          <button
            type="button"
            title="退出登录"
            onClick={() => void handleLogout()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[color:var(--color-text-soft)] transition hover:bg-[rgba(36,31,26,0.06)] hover:text-[color:var(--color-text)]"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  )
}
