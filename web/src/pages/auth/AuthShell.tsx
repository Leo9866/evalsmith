import type { CSSProperties, ReactNode } from 'react'
import BrandMark from '@/components/brand/BrandMark'
import SignalFlowField from '@/components/brand/SignalFlowField'
import { cn } from '@/lib/utils'

interface AuthShellProps {
  title: string
  description: string
  footer: ReactNode
  children: ReactNode
  variant?: 'default' | 'loginSplit'
  heroEyebrow?: string
  heroTitle?: string
  heroDescription?: string
  highlights?: string[]
  signalTags?: string[]
  formBadge?: string
}

const authTheme = {
  '--auth-bg': '#f4fbff',
  '--auth-bg-soft': '#ecf6fb',
  '--auth-panel': 'rgba(255, 255, 255, 0.82)',
  '--auth-panel-strong': '#ffffff',
  '--auth-text': '#10243b',
  '--auth-text-soft': '#5d7188',
  '--auth-line': 'rgba(16, 36, 59, 0.10)',
  '--auth-line-strong': 'rgba(16, 36, 59, 0.18)',
  '--auth-accent': '#1d73e8',
  '--auth-accent-strong': '#1558b6',
  '--auth-signal': '#7fc8ff',
  '--auth-signal-soft': '#dff3ff',
  '--auth-danger': '#c54a46',
} as CSSProperties

const defaultHighlights = [
  '统一身份进入同一套 Agent 评测控制台',
  'Trace、Dataset、Experiment 与 Monitoring 全链路留痕',
  '支持远程 Agent Endpoint 评测、项目隔离与 API Key 管理',
]

const defaultSignalTags = [
  'Trace-linked',
  'Remote endpoint eval',
  'Project RBAC',
]

export default function AuthShell({
  title,
  description,
  footer,
  children,
  variant = 'default',
  heroEyebrow = 'Agent quality console',
  heroTitle = '让团队进入同一套 Agent 质量系统',
  heroDescription = '把认证、评测、追踪和监控放进同一条工作流里，让每一次登录都直接回到清晰可执行的工程上下文。',
  highlights = defaultHighlights,
  signalTags = defaultSignalTags,
  formBadge = 'Team Access',
}: AuthShellProps) {
  if (variant === 'loginSplit') {
    return (
      <div
        style={authTheme}
        className="min-h-[100dvh] bg-[linear-gradient(180deg,var(--auth-bg)_0%,var(--auth-bg-soft)_100%)] text-[color:var(--auth-text)]"
      >
        <div className="grid min-h-[100dvh] lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
          <section className="relative hidden overflow-hidden lg:flex">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_14%_18%,rgba(223,243,255,0.86),transparent_24%),radial-gradient(circle_at_74%_18%,rgba(127,200,255,0.28),transparent_26%),radial-gradient(circle_at_24%_86%,rgba(127,200,255,0.22),transparent_28%),linear-gradient(180deg,rgba(248,252,255,0.96)_0%,rgba(236,246,251,0.94)_100%)]" />
            <div className="absolute inset-y-0 right-0 w-px bg-[linear-gradient(180deg,transparent,rgba(16,36,59,0.14),transparent)]" />
            <div className="absolute left-[12%] top-[8%] h-48 w-48 rounded-full bg-[rgba(223,243,255,0.74)] blur-3xl" />
            <div className="absolute bottom-[10%] left-[22%] h-56 w-56 rounded-full bg-[rgba(127,200,255,0.2)] blur-3xl" />
            <div className="absolute right-[12%] top-[24%] h-52 w-52 rounded-full bg-[rgba(127,200,255,0.18)] blur-3xl" />
            <SignalFlowField className="absolute inset-0 opacity-95" />

            <div className="relative z-10 flex w-full flex-col justify-between px-16 py-14 xl:px-20 xl:py-16">
              <BrandMark subtitle="Agent quality platform" />

              <div className="max-w-[38rem]">
                <div className="inline-flex items-center rounded-full border border-[var(--auth-line)] bg-white/62 px-4 py-2 text-[0.72rem] font-medium uppercase tracking-[0.26em] text-[color:rgba(93,113,136,0.74)] shadow-[0_10px_24px_rgba(19,70,142,0.05)] backdrop-blur-md">
                  {heroEyebrow}
                </div>

                <h1 className="mt-7 max-w-[12ch] text-balance text-[3.65rem] font-semibold leading-[0.96] tracking-[-0.08em] text-[color:var(--auth-text)] xl:text-[4.15rem]">
                  {heroTitle}
                </h1>
                <p className="mt-6 max-w-[34rem] text-pretty text-[1.02rem] leading-8 text-[color:var(--auth-text-soft)]">
                  {heroDescription}
                </p>

                <div className="mt-10 grid max-w-[38rem] gap-3">
                  {highlights.map((item, index) => (
                    <div
                      key={item}
                      className="group rounded-[1.7rem] border border-[rgba(16,36,59,0.08)] bg-white/58 px-5 py-4 shadow-[0_18px_40px_rgba(19,70,142,0.05)] backdrop-blur-xl transition duration-300 hover:-translate-y-px hover:border-[rgba(16,36,59,0.14)]"
                    >
                      <div className="flex items-start gap-4">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[rgba(29,115,232,0.12)] bg-[rgba(255,255,255,0.88)] font-mono text-[0.78rem] font-medium text-[var(--auth-accent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                          {String(index + 1).padStart(2, '0')}
                        </div>
                        <p className="pt-1 text-sm leading-7 text-[color:rgba(16,36,59,0.78)]">{item}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                {signalTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full border border-[rgba(16,36,59,0.08)] bg-white/56 px-4 py-2 text-[0.78rem] font-medium tracking-[-0.01em] text-[color:rgba(16,36,59,0.72)] backdrop-blur-md"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </section>

          <section className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-5 py-10 sm:px-8 lg:px-12 xl:px-16">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(223,243,255,0.9),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(127,200,255,0.22),transparent_34%)]" />
            <div className="absolute right-[6%] top-[14%] h-44 w-44 rounded-full bg-[rgba(127,200,255,0.22)] blur-3xl" />
            <div className="absolute bottom-[10%] left-[4%] h-56 w-56 rounded-full bg-[rgba(223,243,255,0.88)] blur-3xl" />
            <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(16,36,59,0.12),transparent)] lg:hidden" />

            <div className="relative w-full max-w-[31rem]">
              <div className="mb-8 flex items-center justify-center gap-3 lg:hidden">
                <BrandMark compact />
                <p className="text-sm font-medium text-[color:var(--auth-text-soft)]">团队认证</p>
              </div>

              <div className="rounded-[2.15rem] border border-[var(--auth-line)] bg-[color:var(--auth-panel)] p-7 shadow-[0_28px_70px_rgba(19,70,142,0.1)] backdrop-blur-[18px] sm:p-9">
                <div className="inline-flex items-center rounded-full border border-[rgba(29,115,232,0.1)] bg-white/76 px-3.5 py-1.5 text-[0.72rem] font-medium uppercase tracking-[0.26em] text-[color:rgba(93,113,136,0.7)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                  {formBadge}
                </div>
                <h2 className="mt-5 text-balance text-4xl font-semibold tracking-[-0.07em] text-[color:var(--auth-text)] sm:text-[2.7rem]">
                  {title}
                </h2>
                <p className="mt-3 max-w-[30rem] text-sm leading-7 text-[color:var(--auth-text-soft)] sm:text-[0.96rem]">
                  {description}
                </p>

                <div className="mt-9">{children}</div>
                <div className="mt-7 text-sm text-[color:var(--auth-text-soft)]">{footer}</div>
              </div>
            </div>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div
      style={authTheme}
      className="min-h-[100dvh] bg-[linear-gradient(180deg,var(--auth-bg)_0%,var(--auth-bg-soft)_100%)] px-4 py-10 text-[color:var(--auth-text)] sm:px-6"
    >
      <div className="mx-auto grid min-h-[calc(100dvh-5rem)] max-w-6xl items-center gap-8 lg:grid-cols-[1.08fr_0.92fr]">
        <section
          className={cn(
            'relative hidden overflow-hidden rounded-[2.2rem] border border-[var(--auth-line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.88)_0%,rgba(236,246,251,0.88)_100%)] p-10 shadow-[0_24px_70px_rgba(19,70,142,0.08)] lg:block'
          )}
        >
          <SignalFlowField className="absolute inset-0 opacity-80" />
          <div className="relative z-10">
            <BrandMark subtitle="Agent quality platform" />
            <h1 className="mt-10 max-w-[11ch] text-balance text-5xl font-semibold tracking-[-0.08em] text-[color:var(--auth-text)]">
              {heroTitle}
            </h1>
            <p className="mt-5 max-w-[34rem] text-base leading-8 text-[color:var(--auth-text-soft)]">
              {heroDescription}
            </p>

            <div className="mt-10 grid gap-4">
              {highlights.map((item, index) => (
                <div
                  key={item}
                  className="rounded-[1.5rem] border border-[var(--auth-line)] bg-white/72 px-5 py-4 text-sm leading-7 text-[color:rgba(16,36,59,0.76)] backdrop-blur-md"
                >
                  <span className="mr-3 font-mono text-[0.75rem] uppercase tracking-[0.18em] text-[var(--auth-accent)]">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-xl rounded-[2rem] border border-[var(--auth-line)] bg-[color:var(--auth-panel)] p-6 shadow-[0_22px_70px_rgba(19,70,142,0.08)] backdrop-blur-xl sm:p-8">
          <p className="text-[0.72rem] uppercase tracking-[0.28em] text-[color:rgba(93,113,136,0.62)]">{formBadge}</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.06em] text-[color:var(--auth-text)]">{title}</h2>
          <p className="mt-3 text-sm leading-7 text-[color:var(--auth-text-soft)]">{description}</p>

          <div className="mt-8">{children}</div>
          <div className="mt-6 text-sm text-[color:var(--auth-text-soft)]">{footer}</div>
        </section>
      </div>
    </div>
  )
}
