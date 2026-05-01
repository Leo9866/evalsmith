import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CheckSquare } from 'lucide-react'
import { claimAnnotationTask, getAnnotationTask, listAnnotationTasks, submitAnnotationTask } from '@/api/annotation'
import PageContainer from '@/components/layout/PageContainer'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import CodeBlock from '@/components/ui/CodeBlock'
import EmptyState from '@/components/ui/EmptyState'
import Textarea from '@/components/ui/Textarea'
import { useAsyncResource } from '@/hooks/useAsyncResource'
import { formatStatus } from '@/lib/labels'
import { toast } from '@/stores/toast'

const SCORING_DIMENSIONS = [
  { key: 'correctness', label: '正确性', max: 5 },
  { key: 'fluency', label: '流畅性', max: 5 },
  { key: 'safety', label: '安全性', max: 1 },
]

export default function AnnotationDetailPage() {
  const navigate = useNavigate()
  const { id = '' } = useParams()
  const { data, loading, error, reload } = useAsyncResource(() => getAnnotationTask(id), [id])
  const { data: allTasks } = useAsyncResource(() => listAnnotationTasks({ page_size: 100, status: 'pending' }), [])
  const [scores, setScores] = useState<Record<string, number>>({ correctness: 3, fluency: 3, safety: 1 })
  const [pairwiseChoice, setPairwiseChoice] = useState<'a' | 'b' | 'tie' | 'both_bad'>('a')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!data || data.status !== 'pending') return
    void claimAnnotationTask(data.id).catch(() => undefined)
  }, [data])

  const isPairwise = data?.mode === 'pairwise'

  const taskIds = (allTasks?.items ?? []).map((t) => t.id)
  const currentIndex = taskIds.indexOf(id)

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const overallScore = isPairwise
        ? (pairwiseChoice === 'a' ? 1.0 : pairwiseChoice === 'b' ? 0.0 : 0.5)
        : Object.values(scores).reduce((a, b) => a + b, 0) / (Object.values(scores).length * 5)

      await submitAnnotationTask(id, {
        label: isPairwise ? pairwiseChoice : (overallScore >= 0.6 ? 'accept' : 'reject'),
        score: Math.round(overallScore * 100) / 100,
        note,
        metadata: isPairwise ? { preference: pairwiseChoice } : { dimension_scores: scores },
      })

      const nextIndex = currentIndex + 1
      if (nextIndex < taskIds.length) {
        navigate(`/annotation/${taskIds[nextIndex]}`)
      } else {
        navigate('/annotation')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交标注失败', '提交标注失败')
    } finally {
      setSubmitting(false)
    }
  }

  if (error) {
    return (
      <PageContainer title="标注工作台" description="审核 Agent 输出。">
        <EmptyState
          icon={<CheckSquare className="h-6 w-6" />}
          title="无法加载标注任务"
          description={error}
          action={<Button variant="secondary" onClick={() => void reload()}>重试</Button>}
        />
      </PageContainer>
    )
  }

  return (
    <PageContainer
      title={isPairwise ? '对比标注' : '标注工作台'}
      description={data ? `任务 ${data.id} · ${formatStatus(data.status)}` : '审核 Agent 输出。'}
      actions={
        <>
          <span className="text-sm text-[color:var(--color-text-soft)]">
            {currentIndex >= 0 ? `${currentIndex + 1}/${taskIds.length}` : ''}
          </span>
          <Button variant="ghost" onClick={() => navigate('/annotation')}>返回列表</Button>
        </>
      }
    >
      {loading && !data ? (
        <Card className="p-6 text-center text-sm text-[color:var(--color-text-soft)]">正在加载标注任务...</Card>
      ) : data ? (
        <div className="space-y-4">
          {(data.source_trace_id || data.backfill_action_id) && (
            <Card className="p-4">
              <div className="flex flex-wrap gap-4 text-sm text-[color:var(--color-text-soft)]">
                {data.source_trace_id ? (
                  <Link to={`/tracing/${data.source_trace_id}`} className="text-[color:var(--color-accent-strong)] hover:underline">
                    查看来源 Trace
                  </Link>
                ) : null}
                {data.backfill_action_id ? (
                  <span>回流 Action {data.backfill_action_id}</span>
                ) : null}
              </div>
            </Card>
          )}

          <Card className="p-6">
            <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">用户输入</p>
            <div className="mt-3">
              <CodeBlock>{data.input_payload}</CodeBlock>
            </div>
          </Card>

          {isPairwise ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card
                className={`cursor-pointer p-6 transition ${pairwiseChoice === 'a' ? 'ring-2 ring-[rgba(193,109,58,0.5)]' : ''}`}
                onClick={() => setPairwiseChoice('a')}
              >
                <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">输出 A（候选）</p>
                <div className="mt-3"><CodeBlock>{data.candidate_output ?? null}</CodeBlock></div>
              </Card>
              <Card
                className={`cursor-pointer p-6 transition ${pairwiseChoice === 'b' ? 'ring-2 ring-[rgba(193,109,58,0.5)]' : ''}`}
                onClick={() => setPairwiseChoice('b')}
              >
                <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">输出 B（参考）</p>
                <div className="mt-3"><CodeBlock>{data.reference_output ?? null}</CodeBlock></div>
              </Card>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-6">
                <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">Agent 输出</p>
                <div className="mt-3"><CodeBlock>{data.candidate_output ?? null}</CodeBlock></div>
              </Card>
              <Card className="p-6">
                <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">参考答案</p>
                <div className="mt-3"><CodeBlock>{data.reference_output ?? null}</CodeBlock></div>
              </Card>
            </div>
          )}

          <Card className="p-6">
            <p className="text-[0.72rem] uppercase tracking-[0.24em] text-[color:rgba(93,83,73,0.68)]">评分</p>

            {isPairwise ? (
              <div className="mt-4 flex flex-wrap gap-3">
                {(['a', 'b', 'tie', 'both_bad'] as const).map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    onClick={() => setPairwiseChoice(choice)}
                    className={`rounded-[1rem] border px-5 py-2.5 text-sm font-medium transition ${
                      pairwiseChoice === choice
                        ? 'border-[color:rgba(193,109,58,0.4)] bg-[rgba(193,109,58,0.12)] text-[color:var(--color-text)]'
                        : 'border-[color:var(--color-line)] text-[color:var(--color-text-soft)] hover:border-[color:var(--color-line-strong)]'
                    }`}
                  >
                    {{ a: 'A 更好', b: 'B 更好', tie: '差不多', both_bad: '都不好' }[choice]}
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                {SCORING_DIMENSIONS.map((dim) => (
                  <div key={dim.key}>
                    <p className="text-sm font-medium text-[color:var(--color-text)]">{dim.label}</p>
                    <div className="mt-2 flex gap-1.5">
                      {Array.from({ length: dim.max }, (_, i) => i + 1).map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setScores((prev) => ({ ...prev, [dim.key]: val }))}
                          className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium transition ${
                            (scores[dim.key] ?? 0) >= val
                              ? 'bg-[rgba(193,109,58,0.18)] text-[color:var(--color-accent-strong)]'
                              : 'border border-[color:var(--color-line)] text-[color:var(--color-text-soft)] hover:border-[color:var(--color-line-strong)]'
                          }`}
                        >
                          {val}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-5">
              <Textarea
                label="备注（可选）"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="记录评分理由。"
              />
            </div>

            <div className="mt-5 flex items-center justify-between">
              <Button
                variant="ghost"
                disabled={currentIndex <= 0}
                onClick={() => currentIndex > 0 && navigate(`/annotation/${taskIds[currentIndex - 1]}`)}
              >
                <ArrowLeft className="mr-1 h-4 w-4" /> 上一条
              </Button>
              <div className="flex gap-3">
                <Button
                  variant="ghost"
                  onClick={() => {
                    const next = currentIndex + 1
                    if (next < taskIds.length) navigate(`/annotation/${taskIds[next]}`)
                    else navigate('/annotation')
                  }}
                >
                  跳过
                </Button>
                <Button loading={submitting} onClick={() => void handleSubmit()}>
                  提交并下一条 <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>
        </div>
      ) : null}
    </PageContainer>
  )
}
