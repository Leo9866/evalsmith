import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CircleAlert, KeyRound, Mail, User2 } from 'lucide-react'
import { register } from '@/api/auth'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { useAppStore } from '@/stores/app'
import { toast } from '@/stores/toast'
import AuthShell from './AuthShell'

export default function RegisterPage() {
  const navigate = useNavigate()
  const setAuthSession = useAppStore((state) => state.setAuthSession)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const session = await register({ name, email, password })
      setAuthSession(session)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : '注册失败'
      setError(message)
      toast.error(message, '注册失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      variant="loginSplit"
      title="创建 EvalSmith 账号"
      description="注册后会自动加入默认项目，并获得可登录的团队身份。当前版本密码至少需要 8 位。"
      heroEyebrow="Operational by default"
      heroTitle="把评测、追踪与协作从第一天连起来"
      heroDescription="创建账号后，你可以直接进入同一套 Agent 质量系统，管理项目成员、配置远程评测目标，并把实验结果沉淀成可回看的团队资产。"
      highlights={[
        '创建团队身份后即可进入项目视角，不再以匿名或临时状态访问控制台。',
        '后续可继续扩展成员角色、API Key、私有部署和对外 OpenAPI / SDK 接入。',
        '从首个数据集开始建立版本、实验、监控与标注之间的完整留痕关系。',
      ]}
      signalTags={['OpenAPI-first', 'Enterprise-ready', 'Dataset to monitoring loop']}
      footer={
        <span>
          已有账号？{' '}
          <Link to="/login" className="font-medium text-[color:var(--auth-accent)] transition hover:text-[color:var(--auth-accent-strong)]">
            返回登录
          </Link>
        </span>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Input
          label="姓名"
          autoComplete="name"
          placeholder="例如：张三"
          value={name}
          onChange={(event) => setName(event.target.value)}
          icon={<User2 className="h-4 w-4" />}
          labelClassName="text-[0.72rem] tracking-[0.22em] text-[color:rgba(93,113,136,0.7)]"
          iconClassName="text-[color:rgba(93,113,136,0.66)]"
          className="h-[3.25rem] rounded-[1.15rem] border-[rgba(16,36,59,0.1)] bg-white/92 text-[color:var(--auth-text)] placeholder:text-[color:rgba(93,113,136,0.56)] focus:border-[color:rgba(29,115,232,0.34)] focus:shadow-[0_0_0_4px_rgba(29,115,232,0.1)]"
          required
        />
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
          autoComplete="new-password"
          placeholder="至少 8 位"
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
          创建并进入
        </Button>
      </form>
    </AuthShell>
  )
}
