import { expect, test, type Page, type Route } from '@playwright/test'

type SmokeOptions = {
  authenticated: boolean
  dashboardEdgeCases?: boolean
}

const session = {
  user: {
    id: 'user_1',
    email: 'smoke@example.com',
    name: 'Smoke User',
    created_at: '2026-04-03T00:00:00Z',
    updated_at: '2026-04-03T00:00:00Z',
  },
  projects: [
    {
      id: 'proj_alpha',
      name: 'Alpha Project',
      description: 'Alpha',
      role: 'owner',
      created_at: '2026-04-03T00:00:00Z',
      updated_at: '2026-04-03T00:00:00Z',
    },
    {
      id: 'proj_beta',
      name: 'Beta Project',
      description: 'Beta',
      role: 'developer',
      created_at: '2026-04-03T00:00:00Z',
      updated_at: '2026-04-03T00:00:00Z',
    },
  ],
}

test('login and register smoke flow works', async ({ page }) => {
  await mockApi(page, { authenticated: false })

  await page.goto('/login')
  await expect(page.getByText('登录控制台')).toBeVisible()

  await page.goto('/register')
  await expect(page.getByText('创建账号')).toBeVisible()

  await page.goto('/login')
  await page.getByPlaceholder('you@company.com').fill('smoke@example.com')
  await page.getByPlaceholder('请输入密码').fill('password123')
  await page.getByRole('button', { name: '登录' }).click()

  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { name: '总览控制台' })).toBeVisible()
})

test('dashboard stays usable when stats is empty and trace list is null', async ({ page }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => {
    pageErrors.push(error)
  })

  await mockApi(page, { authenticated: true, dashboardEdgeCases: true })

  await page.goto('/dashboard')

  await expect(page.getByRole('heading', { name: '总览控制台' })).toBeVisible()
  await expect(page.getByText('暂无 Trace 历史')).toBeVisible()
  await expect(page.getByText('暂无 Dataset')).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('tracing pages stay usable when trace stats is empty and trace list is null', async ({ page }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => {
    pageErrors.push(error)
  })

  await mockApi(page, { authenticated: true, dashboardEdgeCases: true })

  await page.goto('/tracing')
  await expect(page.getByRole('heading', { name: 'Trace', exact: true })).toBeVisible()
  await expect(page.getByText('暂无 Trace')).toBeVisible()

  await page.goto('/tracing/stats')
  await expect(page.getByRole('heading', { name: 'Trace 分析' })).toBeVisible()
  await expect(page.getByText('暂无 Trace 序列')).toBeVisible()

  expect(pageErrors).toEqual([])
})

test('project switch and core pages render through mocked APIs', async ({ page }) => {
  await mockApi(page, { authenticated: true })

  await page.goto('/tracing')
  await expect(page.getByRole('heading', { name: 'Trace' })).toBeVisible()

  const projectSelect = page.getByRole('combobox', { name: '选择项目' })
  await projectSelect.selectOption('proj_beta')
  await expect(projectSelect).toHaveValue('proj_beta')

  await page.goto('/datasets/ds_1')
  await expect(page.getByRole('heading', { name: 'Beta Dataset' })).toBeVisible()

  await page.goto('/experiments/exp_1')
  await expect(page.getByRole('heading', { name: 'Beta Experiment' })).toBeVisible()

  await page.goto('/monitoring')
  await expect(page.getByRole('heading', { name: '在线监控' })).toBeVisible()

  await page.goto('/annotation/task_1')
  await expect(page.getByRole('heading', { name: '标注工作台' })).toBeVisible()
})

test('pagination and URL state stay usable across tracing, experiment results, and annotation', async ({ page }) => {
  await mockApi(page, { authenticated: true })

  await page.goto('/tracing?search=alpha&min_duration_ms=10&page=2')
  await expect(page.locator('input[placeholder="搜索 Trace"]')).toHaveValue('alpha')
  await expect(page.locator('input[placeholder="最小时延(ms)"]')).toHaveValue('10')
  await expect(page.getByText('alpha-trace-page-2')).toBeVisible()
  await expect(page.getByText('第 21-21 条，共 21 条')).toBeVisible()

  await page.goto('/experiments/exp_1?tab=results&sort_by=score_desc&max_score=0.5&page=2')
  await expect(page.getByText('样本 ex_result_21')).toBeVisible()
  await expect(page.locator('code').filter({ hasText: 'candidate-low-score-page-2' }).first()).toBeVisible()
  await expect(page.getByText('第 21-21 条，共 21 条')).toBeVisible()

  await page.goto('/annotation?status=pending&page=2')
  await expect(page.locator('main select').last()).toHaveValue('pending')
  await expect(page.getByText('trace_page_2')).toBeVisible()
  await expect(page.getByText('第 21-21 条，共 21 条')).toBeVisible()
  await page.getByRole('button', { name: '上一页' }).click()
  await expect(page).toHaveURL(/\/annotation\?status=pending&page=1$/)
  await expect(page.getByText('tr_1')).toBeVisible()
})

test('dataset creation and target preview flows stay usable', async ({ page }) => {
  await mockApi(page, { authenticated: true })

  await page.goto('/datasets/new')
  await page.getByPlaceholder('例如 customer-support-v1').fill('Smoke Dataset')
  await page.getByRole('button', { name: /下一步/ }).click()
  await page.getByRole('button', { name: /下一步/ }).click()
  await page.getByRole('button', { name: /下一步/ }).click()
  await page.getByRole('button', { name: '创建 Dataset' }).click()

  await expect(page).toHaveURL(/\/datasets\/ds_new$/)
  await expect(page.getByRole('heading', { name: 'Smoke Dataset' })).toBeVisible()

  await page.goto('/experiments/new')
  await page.getByRole('button', { name: '测试目标' }).click()

  await expect(page.getByRole('heading', { name: '已完成 endpoint 试调' })).toBeVisible()
  await expect(page.getByText('trace_preview_1', { exact: true })).toBeVisible()
})

test('experiment creation and annotation submit flows stay usable', async ({ page }) => {
  await mockApi(page, { authenticated: true })

  await page.goto('/experiments/new')
  await page.getByRole('textbox').first().fill('Smoke Experiment')
  await page.getByRole('button', { name: '启动 Experiment' }).click()

  await expect(page).toHaveURL(/\/experiments\/exp_new$/)
  await expect(page.getByText('Smoke Experiment')).toBeVisible()

  await page.goto('/annotation/task_1')
  await page.locator('textarea').first().fill('Looks good')
  await page.getByRole('button', { name: /提交并下一条/ }).click()

  await expect(page).toHaveURL(/\/annotation$/)
  await expect(page.getByRole('heading', { name: '标注队列' })).toBeVisible()
})

test('dataset import summary and version description editing stay usable', async ({ page }) => {
  await mockApi(page, { authenticated: true })

  await page.goto('/datasets/ds_1')
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'samples.jsonl',
    mimeType: 'application/jsonl',
    buffer: Buffer.from('{"inputs":{"query":"hello"}}\n{"inputs":{"query":"hello"}}\n{"split":"default"}\n'),
  })

  await expect(page.getByText('最近一次导入摘要')).toBeVisible()
  await expect(page.getByRole('main').getByText('新增 1 条样本，跳过 1 条重复，发现 1 条无效，生成 v2')).toBeVisible()
  await expect(page.getByText('第 3 行')).toBeVisible()

  await page.getByRole('button', { name: '版本' }).click()
  await page.getByRole('button', { name: '编辑说明' }).click()
  await page.getByRole('dialog', { name: '编辑 v1 版本说明' }).getByRole('textbox').fill('Updated from smoke test')
  await page.getByRole('button', { name: '保存说明' }).click()

  await expect(page.getByText('Updated from smoke test')).toBeVisible()
})

test('evaluator version history and clone flow stay usable', async ({ page }) => {
  await mockApi(page, { authenticated: true })

  await page.goto('/evaluators')
  await page.getByRole('button', { name: '查看版本' }).first().click()

  await expect(page.getByRole('dialog', { name: 'exact_match 版本历史' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Current built-in version/ })).toBeVisible()

  await page.getByRole('button', { name: '基于当前版本克隆' }).click()

  await expect(page).toHaveURL(/\/evaluators\/new\?clone=/)
  await expect(page.getByRole('heading', { name: '克隆 Evaluator' })).toBeVisible()
  await expect(page.getByPlaceholder('support_quality_guard')).toHaveValue('exact_match_copy')
  await expect(page.locator('textarea').first()).toHaveValue(/Cloned from exact_match v1/)
  await expect(page.getByText('"kind": "exact_match"')).toBeVisible()
})

test('evaluator diff and regression flow stay usable', async ({ page }) => {
  await mockApi(page, { authenticated: true })

  await page.goto('/evaluators')
  await page.getByRole('button', { name: '查看版本' }).nth(2).click()

  await expect(page.getByRole('dialog', { name: 'custom_guard 版本历史' })).toBeVisible()
  await expect(page.getByText('v3 对比 v2')).toBeVisible()
  await expect(page.getByText('rule_config.keywords')).toBeVisible()

  await page.getByRole('button', { name: '运行回归' }).click()

  await expect(page.getByText('平均分 0.90')).toBeVisible()
  await expect(page.getByText('平均分 0.45')).toBeVisible()
  await expect(page.getByText('Looks strong')).toBeVisible()
})

async function mockApi(page: Page, options: SmokeOptions) {
  let versionDescription = 'Initial version'
  let createdEvaluator: Record<string, unknown> | null = null

  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    const projectId = route.request().headers()['x-project-id'] || 'proj_alpha'

    if (url.pathname === '/api/v1/auth/me') {
      if (!options.authenticated) {
        await fulfill(route, 401, {
          code: -1,
          message: 'missing session',
        })
        return
      }
      await fulfill(route, 200, envelope(session))
      return
    }

    if (url.pathname === '/api/v1/auth/login' || url.pathname === '/api/v1/auth/register') {
      await fulfill(route, 200, envelope(session))
      return
    }

    if (url.pathname === '/api/v1/auth/logout') {
      await fulfill(route, 200, envelope({ logged_out: true }))
      return
    }

    if (url.pathname === `/api/v1/projects/${projectId}/llm-config`) {
      await fulfill(route, 200, envelope({
        protocol: 'openai',
        protocol_config: {
          base_url: 'https://api.openai.com/v1',
          api_key: '__REDACTED_SECRET__',
          model: 'smoke-model',
        },
      }))
      return
    }

    if (url.pathname === '/api/v1/traces/stats') {
      if (options.dashboardEdgeCases) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: '',
        })
        return
      }
      await fulfill(route, 200, envelope(traceStats()))
      return
    }

    if (url.pathname === '/api/v1/traces' && method === 'GET') {
      const page = Number.parseInt(url.searchParams.get('page') ?? '1', 10)
      const pageSize = Number.parseInt(url.searchParams.get('page_size') ?? '20', 10)
      if (options.dashboardEdgeCases) {
        await fulfill(route, 200, envelope({
          traces: null,
          total: 0,
          page,
          page_size: pageSize,
        }))
        return
      }
      await fulfill(route, 200, envelope(traceList(projectId, page, pageSize)))
      return
    }

    if (url.pathname === '/api/v1/traces/batch/dataset' && method === 'POST') {
      await fulfill(route, 200, envelope({ dataset_id: 'ds_1', trace_ids: ['tr_1'], added: 1, new_version: 2, example_ids: ['ex_2'] }))
      return
    }

    if (url.pathname === '/api/v1/traces/batch/annotation' && method === 'POST') {
      await fulfill(route, 200, envelope({ trace_ids: ['tr_1'], added: 1, task_ids: ['task_1'] }))
      return
    }

    if (url.pathname === '/api/v1/traces/tr_1' && method === 'GET') {
      await fulfill(route, 200, envelope(traceDetail(projectId)))
      return
    }

    if (url.pathname === '/api/v1/traces/tr_1/feedback' && method === 'POST') {
      await fulfill(route, 200, envelope(null))
      return
    }

    if (url.pathname === '/api/v1/datasets' && method === 'GET') {
      if (options.dashboardEdgeCases) {
        await fulfill(route, 200, envelope(paginated([], 1, 6, 0)))
        return
      }
      await fulfill(route, 200, envelope(paginated([dataset(projectId)], 1, 100)))
      return
    }

    if (url.pathname === '/api/v1/datasets' && method === 'POST') {
      await fulfill(route, 200, envelope(createdDataset(projectId)))
      return
    }

    if (url.pathname === '/api/v1/datasets/ds_1' && method === 'GET') {
      await fulfill(route, 200, envelope(dataset(projectId)))
      return
    }

    if (url.pathname === '/api/v1/datasets/ds_new' && method === 'GET') {
      await fulfill(route, 200, envelope(createdDataset(projectId)))
      return
    }

    if (url.pathname === '/api/v1/datasets/ds_1' && method === 'PUT') {
      await fulfill(route, 200, envelope(dataset(projectId)))
      return
    }

    if (url.pathname === '/api/v1/datasets/ds_1/examples' && method === 'GET') {
      await fulfill(route, 200, envelope(paginated([example(projectId)], 1, 100)))
      return
    }

    if (url.pathname === '/api/v1/datasets/ds_new/examples' && method === 'GET') {
      await fulfill(route, 200, envelope(paginated([createdExample(projectId)], 1, 100)))
      return
    }

    if (url.pathname === '/api/v1/datasets/ds_1/examples' && method === 'POST') {
      await fulfill(route, 200, envelope({ added: 1, new_version: 2, example_ids: ['ex_2'] }))
      return
    }

    if (url.pathname === '/api/v1/datasets/ds_new/examples' && method === 'POST') {
      await fulfill(route, 200, envelope({ added: 1, new_version: 1, example_ids: ['ex_new_1'] }))
      return
    }

    if (url.pathname === '/api/v1/datasets/ds_1/import' && method === 'POST') {
      await fulfill(route, 200, envelope({
        total_rows: 3,
        added: 1,
        duplicate_count: 1,
        invalid_count: 1,
        duplicates: [
          {
            row: 2,
            scope: 'file',
            message: 'row duplicates import row 1',
            inputs_preview: '{"query":"hello"}',
            duplicate_of_row: 1,
          },
        ],
        invalid_examples: [
          {
            row: 3,
            message: "example missing required 'inputs' field",
            raw_preview: '{"split":"default"}',
          },
        ],
        new_version: 2,
        example_ids: ['ex_2'],
        version_description: 'Imported 1 examples; skipped 1 duplicates, 1 invalid',
      }))
      return
    }

    if (url.pathname === '/api/v1/experiments/target-preview' && method === 'POST') {
      await fulfill(route, 200, envelope({
        request_method: 'POST',
        request_url: 'http://127.0.0.1:8010/answer',
        request_body: { input: 'hello from smoke' },
        response_status_code: 200,
        response_path_used: 'data.answer',
        latency_ms: 32,
        trace_id: 'trace_preview_1',
        output: 'pong',
        raw_response: { data: { answer: 'pong' }, trace_id: 'trace_preview_1' },
      }))
      return
    }

    if (url.pathname === '/api/v1/datasets/ds_1/versions') {
      await fulfill(route, 200, envelope([{ id: 'ver_1', dataset_id: 'ds_1', version: 1, description: versionDescription, created_at: '2026-04-03T00:00:00Z' }]))
      return
    }

    if (url.pathname === '/api/v1/datasets/ds_1/versions/1' && method === 'PUT') {
      const body = route.request().postDataJSON() as { description?: string }
      versionDescription = body.description ?? versionDescription
      await fulfill(route, 200, envelope({ id: 'ver_1', dataset_id: 'ds_1', version: 1, description: versionDescription, created_at: '2026-04-03T00:00:00Z' }))
      return
    }

    if (url.pathname === '/api/v1/datasets/ds_new/versions') {
      await fulfill(route, 200, envelope([{ id: 'ver_new_1', dataset_id: 'ds_new', version: 1, description: 'Smoke version', created_at: '2026-04-03T00:00:00Z' }]))
      return
    }

    if (url.pathname === '/api/v1/datasets/ds_1/splits') {
      await fulfill(route, 200, envelope([{ split: 'default', count: 1 }]))
      return
    }

    if (url.pathname === '/api/v1/datasets/ds_new/splits') {
      await fulfill(route, 200, envelope([{ split: 'default', count: 1 }]))
      return
    }

    if (url.pathname === '/api/v1/prompts' && method === 'GET') {
      await fulfill(route, 200, envelope(paginated([], 1, 100, 0)))
      return
    }

    if (url.pathname.match(/^\/api\/v1\/prompts\/[^/]+\/versions$/) && method === 'GET') {
      await fulfill(route, 200, envelope([]))
      return
    }

    if (url.pathname === '/api/v1/evaluators' && method === 'GET') {
      if (options.dashboardEdgeCases) {
        await fulfill(route, 200, envelope(paginated([], 1, 100, 0)))
        return
      }
      await fulfill(route, 200, envelope(evaluators(projectId, createdEvaluator)))
      return
    }

    if (url.pathname === '/api/v1/evaluators' && method === 'POST') {
      const body = route.request().postDataJSON() as { name: string; description: string; config: Record<string, unknown> }
      createdEvaluator = {
        id: 'ev_smoke',
        name: body.name,
        description: body.description,
        config: body.config,
        type: body.config.type,
        is_builtin: false,
        version: 1,
        project_id: projectId,
      }
      await fulfill(route, 200, envelope(createdEvaluator))
      return
    }

    if (url.pathname.match(/^\/api\/v1\/evaluators\/[^/]+$/) && method === 'GET') {
      const evaluatorId = decodeURIComponent(url.pathname.split('/').at(-1) ?? '')
      await fulfill(route, 200, envelope(evaluatorDetail(projectId, evaluatorId, createdEvaluator)))
      return
    }

    if (url.pathname.match(/^\/api\/v1\/evaluators\/[^/]+\/versions$/) && method === 'GET') {
      const segments = url.pathname.split('/')
      const evaluatorId = decodeURIComponent(segments[segments.length - 2] ?? '')
      await fulfill(route, 200, envelope(evaluatorVersions(projectId, evaluatorId, createdEvaluator)))
      return
    }

    if (url.pathname.match(/^\/api\/v1\/evaluators\/[^/]+\/versions\/\d+\/diff$/) && method === 'GET') {
      const segments = url.pathname.split('/')
      const evaluatorId = decodeURIComponent(segments[segments.length - 4] ?? '')
      const version = Number.parseInt(segments[segments.length - 2] ?? '1', 10)
      const baseVersion = Number.parseInt(url.searchParams.get('base_version') ?? '0', 10)
      await fulfill(route, 200, envelope(evaluatorVersionDiff(evaluatorId, version, baseVersion)))
      return
    }

    if (url.pathname.match(/^\/api\/v1\/evaluators\/[^/]+\/regression-test$/) && method === 'POST') {
      const segments = url.pathname.split('/')
      const evaluatorId = decodeURIComponent(segments[segments.length - 2] ?? '')
      await fulfill(route, 200, envelope(evaluatorRegressionResult(evaluatorId)))
      return
    }

    if (url.pathname === '/api/v1/evaluators/test-config' && method === 'POST') {
      await fulfill(route, 200, envelope({ score: 1, reasoning: 'ok', metadata: {}, evaluator_name: 'not_empty', evaluator_type: 'rule', latency_ms: 1 }))
      return
    }

    if (url.pathname.match(/^\/api\/v1\/evaluators\/[^/]+\/test$/) && method === 'POST') {
      await fulfill(route, 200, envelope({ score: 0.92, reasoning: 'healthy', metadata: {}, evaluator_name: 'not_empty', evaluator_type: 'rule', latency_ms: 3 }))
      return
    }

    if (url.pathname === '/api/v1/experiments' && method === 'GET') {
      if (options.dashboardEdgeCases) {
        await fulfill(route, 200, envelope(paginated([], 1, 8, 0)))
        return
      }
      await fulfill(route, 200, envelope([experiment(projectId)]))
      return
    }

    if (url.pathname === '/api/v1/experiments' && method === 'POST') {
      await fulfill(route, 200, envelope({ ...experiment(projectId), id: 'exp_new', name: 'Smoke Experiment' }))
      return
    }

    if (url.pathname === '/api/v1/experiments/exp_1' && method === 'GET') {
      await fulfill(route, 200, envelope(experiment(projectId)))
      return
    }

    if (url.pathname === '/api/v1/experiments/exp_new' && method === 'GET') {
      await fulfill(route, 200, envelope({ ...experiment(projectId), id: 'exp_new', name: 'Smoke Experiment' }))
      return
    }

    if (url.pathname.match(/^\/api\/v1\/experiments\/[^/]+\/results$/)) {
      const page = Number.parseInt(url.searchParams.get('page') ?? '1', 10)
      const pageSize = Number.parseInt(url.searchParams.get('page_size') ?? '20', 10)
      const maxScore = url.searchParams.get('max_score')
      await fulfill(route, 200, envelope(experimentResults(projectId, page, pageSize, maxScore)))
      return
    }

    if (url.pathname.match(/^\/api\/v1\/experiments\/[^/]+\/baseline$/) && method === 'POST') {
      await fulfill(route, 200, envelope({ project_id: projectId, dataset_id: 'ds_1', experiment_id: 'exp_1' }))
      return
    }

    if (url.pathname.match(/^\/api\/v1\/experiments\/[^/]+\/cancel$/) && method === 'POST') {
      await fulfill(route, 200, envelope({ canceled: true }))
      return
    }

    if (url.pathname === '/api/v1/experiments/compare' && method === 'POST') {
      await fulfill(route, 200, envelope({
        experiments: [
          { experiment_id: 'exp_1', name: 'Beta Experiment', summary: experiment(projectId).summary, dataset_id: 'ds_1', status: 'completed' },
          { experiment_id: 'exp_2', name: 'Candidate Experiment', summary: experiment(projectId).summary, dataset_id: 'ds_1', status: 'completed' },
        ],
        baseline_experiment_id: 'exp_1',
        evaluator_deltas: [],
        sample_diffs: [],
      }))
      return
    }

    if (url.pathname === '/api/v1/experiments/baselines' && method === 'GET') {
      await fulfill(route, 200, envelope({ project_id: projectId, dataset_id: 'ds_1', experiment_id: 'exp_1' }))
      return
    }

    if (url.pathname === '/api/v1/annotation/stats') {
      await fulfill(route, 200, envelope({ total: 1, pending: 1, in_progress: 0, completed: 0 }))
      return
    }

    if (url.pathname === '/api/v1/annotation/tasks' && method === 'GET') {
      const page = Number.parseInt(url.searchParams.get('page') ?? '1', 10)
      const pageSize = Number.parseInt(url.searchParams.get('page_size') ?? '20', 10)
      const status = url.searchParams.get('status') ?? undefined
      await fulfill(route, 200, envelope(annotationTaskList(projectId, page, pageSize, status)))
      return
    }

    if (url.pathname === '/api/v1/annotation/tasks' && method === 'POST') {
      await fulfill(route, 200, envelope({ added: 1, task_ids: ['task_1'] }))
      return
    }

    if (url.pathname === '/api/v1/annotation/tasks/task_1' && method === 'GET') {
      await fulfill(route, 200, envelope(annotationTask(projectId)))
      return
    }

    if (url.pathname === '/api/v1/annotation/tasks/task_1/claim' && method === 'POST') {
      await fulfill(route, 200, envelope(null))
      return
    }

    if (url.pathname === '/api/v1/annotation/tasks/task_1/submit' && method === 'POST') {
      await fulfill(route, 200, envelope(null))
      return
    }

    if (url.pathname === '/api/v1/monitoring/overview') {
      await fulfill(route, 200, envelope(monitoringOverview(projectId)))
      return
    }

    if (url.pathname === '/api/v1/monitoring/rules' && method === 'GET') {
      await fulfill(route, 200, envelope([monitoringRule(projectId)]))
      return
    }

    if (url.pathname === '/api/v1/monitoring/rules' && method === 'POST') {
      await fulfill(route, 200, envelope(monitoringRule(projectId)))
      return
    }

    if (url.pathname.match(/^\/api\/v1\/monitoring\/rules\/[^/]+$/) && method === 'PUT') {
      await fulfill(route, 200, envelope(monitoringRule(projectId)))
      return
    }

    if (url.pathname.match(/^\/api\/v1\/monitoring\/rules\/[^/]+\/run$/) && method === 'POST') {
      await fulfill(route, 200, envelope({ processed: 1, alerts: 0, runs: [] }))
      return
    }

    if (url.pathname === '/api/v1/monitoring/alerts') {
      if (options.dashboardEdgeCases) {
        await fulfill(route, 200, envelope(paginated([], 1, 5, 0)))
        return
      }
      await fulfill(route, 200, envelope([monitorAlert(projectId)]))
      return
    }

    if (url.pathname === '/api/v1/monitoring/runs') {
      await fulfill(route, 200, envelope([monitorRun(projectId)]))
      return
    }

    if (url.pathname.match(/^\/api\/v1\/monitoring\/alerts\/[^/]+\/resolve$/) && method === 'POST') {
      await fulfill(route, 200, envelope({ ...monitorAlert(projectId), status: 'resolved' }))
      return
    }

    throw new Error(`Unhandled API route: ${method} ${url.pathname}`)
  })
}

async function fulfill(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

function envelope<T>(data: T) {
  return {
    code: 0,
    message: 'success',
    data,
  }
}

function paginated<T>(items: T[], page: number, pageSize: number, total = items.length) {
  return {
    items,
    total,
    page,
    page_size: pageSize,
    total_pages: Math.max(1, Math.ceil(total / Math.max(pageSize, 1))),
  }
}

function dataset(projectId: string) {
  const beta = projectId === 'proj_beta'
  return {
    id: 'ds_1',
    project_id: projectId,
    name: beta ? 'Beta Dataset' : 'Alpha Dataset',
    description: beta ? 'Dataset for beta project' : 'Dataset for alpha project',
    schema_def: { inputs: { type: 'object' }, expected_outputs: { type: 'string' } },
    current_version: 1,
    example_count: 1,
    created_at: '2026-04-03T00:00:00Z',
    updated_at: '2026-04-03T00:00:00Z',
  }
}

function createdDataset(projectId: string) {
  return {
    ...dataset(projectId),
    id: 'ds_new',
    name: 'Smoke Dataset',
    description: 'Created from smoke flow',
  }
}

function createdExample(projectId: string) {
  return {
    ...example(projectId),
    id: 'ex_new_1',
    dataset_id: 'ds_new',
  }
}

function example(projectId: string) {
  return {
    id: 'ex_1',
    dataset_id: 'ds_1',
    inputs: { query: `hello from ${projectId}` },
    expected_outputs: 'world',
    metadata: { project_id: projectId },
    source: 'manual',
    split: 'default',
    version_added: 1,
    created_at: '2026-04-03T00:00:00Z',
    updated_at: '2026-04-03T00:00:00Z',
  }
}

function traceList(projectId: string, page = 1, pageSize = 20) {
  const total = 21
  const index = page <= 1 ? 1 : 21
  return {
    traces: [traceListItem(projectId, index)],
    total,
    page,
    page_size: pageSize,
  }
}

function traceListItem(projectId: string, index = 1) {
  return {
    trace_id: `tr_${index}`,
    project_id: projectId,
    name: `${projectId === 'proj_beta' ? 'beta-trace' : 'alpha-trace'}${index > 1 ? `-page-${Math.ceil(index / 20)}` : ''}`,
    status: 'ok',
    start_time: '2026-04-03T00:00:00Z',
    end_time: '2026-04-03T00:00:01Z',
    duration_ms: 1000,
    total_tokens: 128,
    total_cost_usd: 0.01,
    span_count: 1,
    tags: ['smoke'],
    metadata: '{}',
    input_preview: 'hello',
    output_preview: 'world',
    payload_key: 'payload_1',
    created_at: '2026-04-03T00:00:00Z',
  }
}

function traceDetail(projectId: string) {
  return {
    ...traceListItem(projectId),
    input: { query: 'hello' },
    output: { answer: 'world' },
    metadata_json: { project_id: projectId },
    spans: [
      {
        span_id: 'sp_1',
        trace_id: 'tr_1',
        parent_span_id: null,
        project_id: projectId,
        name: 'root-span',
        span_type: 'llm',
        status: 'ok',
        start_time: '2026-04-03T00:00:00Z',
        end_time: '2026-04-03T00:00:01Z',
        duration_ms: 1000,
        model: 'smoke-model',
        token_input: 64,
        token_output: 64,
        cost_usd: 0.01,
        error_message: null,
        input_preview: 'hello',
        output_preview: 'world',
        payload_key: 'payload_1',
        metadata: '{}',
        input: { query: 'hello' },
        output: { answer: 'world' },
        metrics: {},
        metadata_json: { project_id: projectId },
        events: [],
        created_at: '2026-04-03T00:00:00Z',
        children: [],
      },
    ],
  }
}

function traceStats() {
  return {
    trace_count: 12,
    error_count: 1,
    avg_duration_ms: 900,
    p50_duration_ms: 850,
    p95_duration_ms: 1400,
    p99_duration_ms: 1600,
    total_tokens: 2048,
    total_cost_usd: 0.12,
  }
}

function evaluators(projectId: string, createdEvaluator: Record<string, unknown> | null = null) {
  return [
    {
      id: 'builtin:exact_match',
      name: 'exact_match',
      type: 'rule',
      description: `Built-in evaluator for ${projectId}`,
      config: { type: 'rule', rule_config: { kind: 'exact_match' } },
      is_builtin: true,
      version: 1,
      project_id: null,
    },
    {
      id: 'builtin:not_empty',
      name: 'not_empty',
      type: 'rule',
      description: 'Output should not be empty',
      config: { type: 'rule', rule_config: { kind: 'not_empty' } },
      is_builtin: true,
      version: 1,
      project_id: null,
    },
    defaultCustomEvaluator(projectId),
    ...(createdEvaluator ? [{ ...createdEvaluator, project_id: projectId }] : []),
  ]
}

function evaluatorDetail(projectId: string, evaluatorId: string, createdEvaluator: Record<string, unknown> | null = null) {
  return evaluators(projectId, createdEvaluator).find((item) => item.id === evaluatorId) ?? evaluators(projectId, createdEvaluator)[0]
}

function evaluatorVersions(projectId: string, evaluatorId: string, createdEvaluator: Record<string, unknown> | null = null) {
  if (evaluatorId === 'builtin:exact_match') {
    return [
      {
        id: 'builtin:exact_match:v1',
        evaluator_id: 'builtin:exact_match',
        version: 1,
        config: { type: 'rule', rule_config: { kind: 'exact_match' } },
        description: `Built-in evaluator for ${projectId}`,
        changelog: 'Current built-in version',
        created_at: null,
        is_current: true,
      },
    ]
  }

  if (evaluatorId === 'ev_custom') {
    return [
      {
        id: 'ev_custom:current',
        evaluator_id: 'ev_custom',
        version: 3,
        config: defaultCustomEvaluator(projectId).config,
        description: defaultCustomEvaluator(projectId).description,
        changelog: 'Current version',
        created_at: '2026-04-04T00:00:00Z',
        is_current: true,
      },
      {
        id: 'ev_custom:v2',
        evaluator_id: 'ev_custom',
        version: 2,
        config: { type: 'rule', rule_config: { kind: 'contains', keywords: ['safe'], mode: 'any' } },
        description: defaultCustomEvaluator(projectId).description,
        changelog: 'Superseded by v3',
        created_at: '2026-04-03T00:00:00Z',
        is_current: false,
      },
    ]
  }

  if (createdEvaluator && evaluatorId === createdEvaluator.id) {
    return [
      {
        id: 'ev_smoke:current',
        evaluator_id: 'ev_smoke',
        version: 1,
        config: createdEvaluator.config,
        description: createdEvaluator.description,
        changelog: 'Current version',
        created_at: '2026-04-03T00:00:00Z',
        is_current: true,
      },
    ]
  }

  return []
}

function evaluatorVersionDiff(evaluatorId: string, version: number, baseVersion: number) {
  if (evaluatorId === 'ev_custom' && version === 3 && baseVersion === 2) {
    return {
      evaluator_id: 'ev_custom',
      base_version: 2,
      target_version: 3,
      base_is_current: false,
      target_is_current: true,
      changes: [
        {
          path: 'rule_config.keywords',
          change_type: 'changed',
          before: ['safe'],
          after: ['safe', 'helpful'],
        },
        {
          path: 'rule_config.mode',
          change_type: 'changed',
          before: 'any',
          after: 'all',
        },
      ],
    }
  }

  return {
    evaluator_id: evaluatorId,
    base_version: baseVersion || version,
    target_version: version,
    base_is_current: false,
    target_is_current: true,
    changes: [],
  }
}

function evaluatorRegressionResult(evaluatorId: string) {
  if (evaluatorId === 'ev_custom') {
    return {
      evaluator_id: 'ev_custom',
      sample_count: 2,
      versions: [
        {
          version: 3,
          is_current: true,
          avg_score: 0.9,
          passed: 2,
          failed: 0,
          sample_results: [
            {
              index: 0,
              label: 'helpful_answer',
              result: {
                score: 0.95,
                reasoning: 'Looks strong',
                metadata: {},
                evaluator_name: 'custom_guard',
                evaluator_type: 'rule',
                latency_ms: 2,
              },
            },
            {
              index: 1,
              label: 'bad_answer',
              result: {
                score: 0.85,
                reasoning: 'Still acceptable',
                metadata: {},
                evaluator_name: 'custom_guard',
                evaluator_type: 'rule',
                latency_ms: 2,
              },
            },
          ],
        },
        {
          version: 2,
          is_current: false,
          avg_score: 0.45,
          passed: 0,
          failed: 2,
          sample_results: [
            {
              index: 0,
              label: 'helpful_answer',
              result: {
                score: 0.5,
                reasoning: 'Only partially matched',
                metadata: {},
                evaluator_name: 'custom_guard',
                evaluator_type: 'rule',
                latency_ms: 2,
              },
            },
            {
              index: 1,
              label: 'bad_answer',
              result: {
                score: 0.4,
                reasoning: 'Weak result',
                metadata: {},
                evaluator_name: 'custom_guard',
                evaluator_type: 'rule',
                latency_ms: 2,
              },
            },
          ],
        },
      ],
    }
  }

  return {
    evaluator_id: evaluatorId,
    sample_count: 1,
    versions: [],
  }
}

function defaultCustomEvaluator(projectId: string) {
  return {
    id: 'ev_custom',
    name: 'custom_guard',
    type: 'rule',
    description: 'Custom evaluator with recent history',
    config: { type: 'rule', rule_config: { kind: 'contains', keywords: ['safe', 'helpful'], mode: 'all' } },
    is_builtin: false,
    version: 3,
    project_id: projectId,
  }
}

function experiment(projectId: string) {
  return {
    id: 'exp_1',
    name: 'Beta Experiment',
    description: 'Experiment detail smoke',
    dataset_id: 'ds_1',
    dataset_version: 1,
    split: 'default',
    evaluator_ids: ['builtin:exact_match', 'builtin:not_empty'],
    target_url: 'http://127.0.0.1:8010/answer',
    target_headers: {},
    target_body_template: '{"input":"hello"}',
    concurrency: 2,
    status: 'completed',
    project_id: projectId,
    summary: {
      total_examples: 1,
      completed: 1,
      failed: 0,
      avg_scores: { exact_match: 1 },
      pass_rates: { exact_match: 1 },
      latency_p50_ms: 1000,
      latency_p90_ms: 1000,
      latency_p99_ms: 1000,
    },
    job_status: 'completed',
    last_error: null,
    is_baseline: true,
    created_at: '2026-04-03T00:00:00Z',
    started_at: '2026-04-03T00:00:01Z',
    completed_at: '2026-04-03T00:00:02Z',
  }
}

function experimentResults(projectId: string, page = 1, pageSize = 20, maxScore: string | null = null) {
  const total = 21
  const index = page <= 1 ? 1 : 21
  return paginated([experimentResult(projectId, index, maxScore)], page, pageSize, total)
}

function experimentResult(projectId: string, index = 1, maxScore: string | null = null) {
  const lowScore = maxScore != null && maxScore !== ''
  return {
    id: `res_${index}`,
    experiment_id: 'exp_1',
    example_id: `ex_result_${index}`,
    input: { query: `hello from ${projectId}`, page: index },
    expected_output: 'world',
    metadata: { project_id: projectId },
    split: 'default',
    actual_output: lowScore ? `candidate-low-score-page-${Math.ceil(index / 20)}` : `world-page-${Math.ceil(index / 20)}`,
    trace_id: `tr_${index}`,
    latency_ms: 1000,
    scores: [
      {
        score: lowScore ? 0.4 : 1,
        reasoning: lowScore ? 'Needs attention' : 'Matched',
        metadata: {},
        evaluator_name: 'exact_match',
        evaluator_type: 'rule',
        latency_ms: 1,
      },
    ],
    error: null,
    created_at: '2026-04-03T00:00:02Z',
  }
}

function annotationTaskList(projectId: string, page = 1, pageSize = 20, status?: string) {
  const total = 21
  const index = page <= 1 ? 1 : 21
  return paginated([annotationTask(projectId, index, status)], page, pageSize, total)
}

function annotationTask(projectId: string, index = 1, status = 'pending') {
  return {
    id: index === 1 ? 'task_1' : `task_${index}`,
    project_id: projectId,
    source_type: 'trace',
    source_id: index === 1 ? 'tr_1' : `trace_page_${Math.ceil(index / 20)}`,
    mode: 'single_run',
    status,
    trace_id: index === 1 ? 'tr_1' : `tr_${index}`,
    experiment_id: null,
    example_id: null,
    input_payload: { query: 'hello' },
    candidate_output: { answer: 'world' },
    reference_output: { answer: 'world' },
    metadata: { project_id: projectId },
    annotation: {},
    created_at: '2026-04-03T00:00:00Z',
    updated_at: '2026-04-03T00:00:00Z',
    completed_at: null,
  }
}

function monitoringRule(projectId: string) {
  return {
    id: 'rule_1',
    project_id: projectId,
    name: 'smoke rule',
    description: 'Alert on low score',
    status: 'active',
    sampling_rate: 1,
    evaluator_ids: ['builtin:not_empty'],
    threshold: 0.7,
    severity: 'warning',
    backfill_dataset_id: 'ds_1',
    backfill_split: 'regression',
    auto_annotation: true,
    guardrail_config: {
      blocked_keywords: [],
      blocked_regexes: [],
      max_output_chars: null,
      require_non_empty_output: true,
    },
    last_checked_at: '2026-04-03T00:00:00Z',
    created_at: '2026-04-03T00:00:00Z',
    updated_at: '2026-04-03T00:00:00Z',
  }
}

function monitorRun(projectId: string) {
  return {
    id: 'run_1',
    rule_id: 'rule_1',
    project_id: projectId,
    trace_id: 'tr_1',
    trace_status: 'ok',
    avg_score: 0.95,
    evaluator_scores: [],
    guardrail_hits: [],
    alert_triggered: false,
    dataset_backfilled: false,
    annotation_created: false,
    error_message: null,
    created_at: '2026-04-03T00:00:00Z',
  }
}

function monitorAlert(projectId: string) {
  return {
    id: 'alert_1',
    rule_id: 'rule_1',
    run_id: 'run_1',
    project_id: projectId,
    trace_id: 'tr_1',
    kind: 'score',
    severity: 'warning',
    status: 'open',
    title: 'Score dropped',
    summary: 'Score below threshold',
    details: { threshold: 0.7 },
    created_at: '2026-04-03T00:00:00Z',
    resolved_at: null,
  }
}

function monitoringOverview(projectId: string) {
  return {
    rule_count: 1,
    active_rule_count: 1,
    open_alert_count: 1,
    recent_run_count: 1,
    alert_rate: 0.1,
    avg_score: 0.95,
    latest_alerts: [monitorAlert(projectId)],
    latest_runs: [monitorRun(projectId)],
  }
}
