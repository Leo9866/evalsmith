import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Activity,
  BarChart3,
  CheckSquare,
  ChevronsLeft,
  ChevronsRight,
  Database,
  FlaskConical,
  GitCompareArrows,
  LayoutDashboard,
  MessageSquare,
  Radar,
  Settings,
  TestTube2,
  X,
} from 'lucide-react'
import EvalSmithMark from '@/components/brand/EvalSmithMark'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'

type NavItem = {
  to: string
  label: string
  icon: typeof Activity
  exact?: string[]
  prefixes?: string[]
  exclude?: string[]
}

const navGroups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: '观测',
    items: [
      { to: '/dashboard', label: '概览', icon: LayoutDashboard, exact: ['/dashboard'] },
      {
        to: '/tracing',
        label: 'Trace',
        icon: Activity,
        exact: ['/tracing'],
        prefixes: ['/tracing/'],
        exclude: ['/tracing/stats'],
      },
      { to: '/tracing/stats', label: '分析', icon: BarChart3, exact: ['/tracing/stats'] },
    ],
  },
  {
    label: '评测',
    items: [
      { to: '/datasets', label: 'Dataset', icon: Database, exact: ['/datasets', '/datasets/new'], prefixes: ['/datasets/'] },
      { to: '/evaluators', label: 'Evaluator', icon: FlaskConical, exact: ['/evaluators', '/evaluators/new'], prefixes: ['/evaluators/'] },
      { to: '/prompts', label: 'Prompt', icon: MessageSquare, exact: ['/prompts'], prefixes: ['/prompts/'] },
      {
        to: '/experiments',
        label: 'Experiment',
        icon: TestTube2,
        exact: ['/experiments', '/experiments/new'],
        prefixes: ['/experiments/'],
        exclude: ['/experiments/compare'],
      },
      { to: '/experiments/compare', label: '回归对比', icon: GitCompareArrows, exact: ['/experiments/compare'] },
      { to: '/annotation', label: '标注队列', icon: CheckSquare, exact: ['/annotation'], prefixes: ['/annotation/'] },
      { to: '/monitoring', label: '在线监控', icon: Radar, exact: ['/monitoring'], prefixes: ['/monitoring/'] },
    ],
  },
  {
    label: '系统',
    items: [{ to: '/settings', label: '设置', icon: Settings, exact: ['/settings'], prefixes: ['/settings/'] }],
  },
]

function isItemActive(pathname: string, item: NavItem) {
  if (item.exclude?.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return false
  }
  if (item.exact?.includes(pathname)) {
    return true
  }
  return item.prefixes?.some((prefix) => pathname.startsWith(prefix)) ?? false
}

export default function Sidebar() {
  const location = useLocation()
  const collapsed = useAppStore((state) => state.sidebarCollapsed)
  const mobileNavOpen = useAppStore((state) => state.mobileNavOpen)
  const toggleSidebar = useAppStore((state) => state.toggleSidebar)
  const closeMobileNav = useAppStore((state) => state.closeMobileNav)

  useEffect(() => {
    closeMobileNav()
  }, [location.pathname, closeMobileNav])

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-40 bg-[rgba(36,31,26,0.18)] transition-opacity duration-200 lg:hidden',
          mobileNavOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={closeMobileNav}
      />
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col overflow-hidden border-r border-[color:var(--color-line)] bg-[color:var(--color-sidebar)] text-[color:var(--color-text)] transition-all duration-300 ease-out',
          collapsed ? 'w-[5rem]' : 'w-[16.5rem]',
          mobileNavOpen ? 'translate-x-0' : '-translate-x-[110%]',
          'lg:translate-x-0'
        )}
      >
        <div className="border-b border-[color:var(--color-line)] px-4 pb-4 pt-5">
          <div className="relative flex items-start justify-between gap-3">
            <div className={cn('flex items-center gap-3', collapsed && 'justify-center')}>
              <EvalSmithMark className="h-11 w-11 rounded-[0.95rem]" variant="dark" />
              {!collapsed && (
                <div>
                  <p className="text-[0.68rem] uppercase tracking-[0.24em] text-[color:rgba(106,95,85,0.58)]">
                    Agent 质量
                  </p>
                  <h1 className="text-lg font-bold tracking-tight text-[color:var(--color-text)]">EvalSmith</h1>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={closeMobileNav}
              className="rounded-full border border-[color:var(--color-line)] p-2 text-[color:var(--color-text-soft)] transition hover:border-[color:var(--color-line-strong)] hover:text-[color:var(--color-text)] lg:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {!collapsed && (
            <p className="mt-4 max-w-[14rem] text-sm leading-6 text-[color:var(--color-text-soft)]">
              在一个更轻量的控制台里完成 Trace、评测与变更对比。
            </p>
          )}
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
          {navGroups.map((group) => (
            <div key={group.label}>
              {!collapsed && (
                <p className="mb-2 px-3 text-[0.66rem] uppercase tracking-[0.28em] text-[color:rgba(106,95,85,0.54)]">
                  {group.label}
                </p>
              )}
              <div className="space-y-1">
                {group.items.map((item) => {
                  const active = isItemActive(location.pathname, item)
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={closeMobileNav}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group relative flex items-center gap-3 rounded-[1.15rem] border px-3 py-3 text-sm transition-colors duration-200',
                        active
                          ? 'border-[color:rgba(193,109,58,0.18)] bg-[rgba(193,109,58,0.11)] text-[color:var(--color-text)]'
                          : 'border-transparent text-[color:rgba(36,31,26,0.7)] hover:border-[color:var(--color-line)] hover:bg-[rgba(36,31,26,0.03)] hover:text-[color:var(--color-text)]'
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-[color:var(--color-line)] px-3 py-3">
          <button
            type="button"
            onClick={toggleSidebar}
            className="hidden w-full items-center justify-center rounded-[1.15rem] border border-[color:var(--color-line)] bg-[color:var(--color-panel-strong)] px-3 py-3 text-[color:var(--color-text-soft)] transition hover:border-[color:var(--color-line-strong)] hover:bg-[color:var(--color-panel)] hover:text-[color:var(--color-text)] lg:flex"
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        </div>
      </aside>
    </>
  )
}
