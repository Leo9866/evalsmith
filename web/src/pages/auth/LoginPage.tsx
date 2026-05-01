import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CircleAlert, KeyRound, Mail } from 'lucide-react'
import { login } from '@/api/auth'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { useAppStore } from '@/stores/app'
import { toast } from '@/stores/toast'
import AuthShell from './AuthShell'

export default function LoginPage() {
  const navigate = useNavigate()
  const setAuthSession = useAppStore((state) => state.setAuthSession)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const session = await login({ email, password })
      setAuthSession(session)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : '登录失败'
      setError(message)
      toast.error(message, '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      variant="loginSplit"
      title="登录 EvalSmith"
      description="使用已注册账号进入团队控制台。登录后会自动恢复你在可访问项目中的角色、项目列表和 API 能力。"
      heroEyebrow="Signal-driven evaluation"
      heroTitle="让团队进入同一套 Agent 质量系统"
      heroDescription="统一接入 Trace、Dataset、Experiment 与 Monitoring，把远程 Agent Endpoint 评测、项目权限和运维闭环收进同一个工作区。"
      highlights={[
        '从登录开始恢复你的项目范围、角色权限和可访问数据面板。',
        '直接连接远程 Agent Endpoint，用统一数据集跑评测并回看结果。',
        '把 Trace、监控告警、失败样本和后续标注流转放进同一条工程闭环。',
      ]}
      signalTags={['Remote endpoint eval', 'Trace-linked analysis', 'Project RBAC']}
      footer={
        <span>
          还没有账号？{' '}
          <Link to="/register" className="font-medium text-[color:var(--auth-accent)] transition hover:text-[color:var(--auth-accent-strong)]">
            创建团队空间
          </Link>
        </span>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Input
          label="邮箱"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          icon={<Mail className="h-4 w-4" />}
          labelClassName="text-[0.72rem] tracking-[0.22em] text-[color:rgba(93,113,136,0.7)]"
          iconClassName="text-[color:rgba(93,113,136,0.66)]"
          className="h-[3.25rem] rounded-[1.15rem] border-[rgba(16,36,59,0.1)] bg-white/92 text-[color:var(--auth-text)] placeholder:text-[color:rgba(93,113,136,0.56)] focus:border-[color:rgba(29,115,232,0.34)] focus:shadow-[0_0_0_4px_rgba(29,115,232,0.1)]"
          required
        />
        <Input
          label="密码"
          type="password"
          autoComplete="current-password"
          placeholder="请输入密码"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          icon={<KeyRound className="h-4 w-4" />}
          labelClassName="text-[0.72rem] tracking-[0.22em] text-[color:rgba(93,113,136,0.7)]"
          iconClassName="text-[color:rgba(93,113,136,0.66)]"
          className="h-[3.25rem] rounded-[1.15rem] border-[rgba(16,36,59,0.1)] bg-white/92 text-[color:var(--auth-text)] placeholder:text-[color:rgba(93,113,136,0.56)] focus:border-[color:rgba(29,115,232,0.34)] focus:shadow-[0_0_0_4px_rgba(29,115,232,0.1)]"
          required
        />
        {error && (
          <div className="flex items-start gap-3 rounded-[1.2rem] border border-[rgba(197,74,70,0.14)] bg-[rgba(197,74,70,0.06)] px-4 py-3 text-sm text-[color:var(--auth-danger)]">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="leading-6">{error}</span>
          </div>
        )}
        <Button type="submit" variant="brand" size="lg" className="h-[3.25rem] w-full rounded-[1.15rem]" loading={loading}>
          进入控制台
        </Button>
      </form>
    </AuthShell>
  )
}
