#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const DEFAULT_PROJECT_ID = 'proj_5e988d19-3d27-4ee8-92e7-6eda35d07471'
const DEFAULT_EMAIL = 'demo@evalsmith.local'

const FALLBACK_IDS = {
  trace: 'tr_071833f7f250',
  dataset: 'ds_0d31c26e-b04',
  experiment: '8274330d-4a3f-4742-8900-e35c318cb75a',
  annotation: 'ann_0b13f04f-fa4',
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function parseArgs(argv) {
  const options = {
    baseUrl: 'http://127.0.0.1:8080',
    projectId: process.env.EVALSMITH_SCREENSHOT_PROJECT_ID || DEFAULT_PROJECT_ID,
    email: process.env.EVALSMITH_SCREENSHOT_EMAIL || DEFAULT_EMAIL,
    password: process.env.EVALSMITH_SCREENSHOT_PASSWORD || '',
    headless: true,
    outputDir: path.join(repoRoot, 'out/screenshots', `evalsmith-ui-${timestamp()}`),
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--base-url' && argv[index + 1]) {
      options.baseUrl = argv[++index].replace(/\/$/, '')
    } else if (arg === '--project-id' && argv[index + 1]) {
      options.projectId = argv[++index]
    } else if (arg === '--email' && argv[index + 1]) {
      options.email = argv[++index]
    } else if (arg === '--password' && argv[index + 1]) {
      options.password = argv[++index]
    } else if (arg === '--output-dir' && argv[index + 1]) {
      options.outputDir = path.resolve(argv[++index])
    } else if (arg === '--headed') {
      options.headless = false
    } else if (arg === '--headless') {
      options.headless = true
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }

  if (!options.password) {
    throw new Error('demo password is required; pass --password or set EVALSMITH_SCREENSHOT_PASSWORD')
  }

  return options
}

function log(event, payload = null) {
  const suffix = payload ? ` ${JSON.stringify(payload)}` : ''
  process.stdout.write(`[screenshots] ${event}${suffix}\n`)
}

async function loadPlaywright() {
  const playwrightPath = path.resolve(repoRoot, 'web/node_modules/playwright/index.mjs')
  return import(pathToFileURL(playwrightPath).href)
}

function unwrap(payload) {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return payload.data
  }
  return payload
}

function firstItem(payload, keys = ['items']) {
  const data = unwrap(payload)
  if (Array.isArray(data)) {
    return data[0] ?? null
  }
  if (!data || typeof data !== 'object') {
    return null
  }
  for (const key of keys) {
    if (Array.isArray(data[key])) {
      return data[key][0] ?? null
    }
  }
  return null
}

async function apiJson(context, baseUrl, projectId, pathValue, options = {}) {
  const attempts = options.attempts ?? 3
  const timeout = options.timeout ?? 70000
  let lastError = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await context.request.fetch(`${baseUrl}${pathValue}`, {
        method: options.method ?? 'GET',
        data: options.data,
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': projectId,
          ...(options.headers ?? {}),
        },
        timeout,
      })
      const text = await response.text()
      if (!response.ok()) {
        throw new Error(`${pathValue} returned ${response.status()}: ${text.slice(0, 160)}`)
      }
      return JSON.parse(text)
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt))
    }
  }

  throw lastError
}

async function ensureDemoPrompt(context, options) {
  const response = await apiJson(context, options.baseUrl, options.projectId, '/api/v1/prompts?page_size=100', { attempts: 2 })
  const prompts = unwrap(response)?.items ?? []
  const existing = prompts.find((item) => item.name === 'EvalSmith Demo Support Prompt')
  if (existing) {
    return existing
  }

  const created = await apiJson(context, options.baseUrl, options.projectId, '/api/v1/prompts', {
    method: 'POST',
    data: {
      name: 'EvalSmith Demo Support Prompt',
      description: 'Demo prompt for open-source screenshots and local walkthroughs.',
      status: 'active',
      system_prompt: 'You are a careful evaluation assistant. Answer concisely and explain confidence when needed.',
      user_prompt_template: 'User question: {{inputs.input}}\nExpected style: {{metadata.style}}',
      variables_schema: {
        inputs: { type: 'object', properties: { input: { type: 'string' } } },
        metadata: { type: 'object', properties: { style: { type: 'string' } } },
      },
      render_config: { temperature: 0.2 },
      change_note: 'Initial demo prompt for screenshots',
    },
  })
  return unwrap(created)
}

async function discoverResources(context, options) {
  const resources = {
    traceId: FALLBACK_IDS.trace,
    datasetId: FALLBACK_IDS.dataset,
    experimentId: FALLBACK_IDS.experiment,
    annotationId: FALLBACK_IDS.annotation,
    promptId: null,
  }

  const discovery = [
    ['traces', '/api/v1/traces?page_size=5', ['traces'], 'traceId', 'trace_id'],
    ['datasets', '/api/v1/datasets?page_size=5', ['items'], 'datasetId', 'id'],
    ['experiments', '/api/v1/experiments?page_size=5', ['items'], 'experimentId', 'id'],
    ['annotations', '/api/v1/annotation/tasks?page_size=5', ['items'], 'annotationId', 'id'],
  ]

  for (const [name, apiPath, keys, targetKey, idKey] of discovery) {
    try {
      const payload = await apiJson(context, options.baseUrl, options.projectId, apiPath)
      const item = firstItem(payload, keys)
      if (item?.[idKey]) {
        resources[targetKey] = item[idKey]
      }
      log('discovered', { name, id: resources[targetKey] })
    } catch (error) {
      log('discovery fallback', { name, id: resources[targetKey], error: error instanceof Error ? error.message : String(error) })
    }
  }

  try {
    const prompt = await ensureDemoPrompt(context, options)
    resources.promptId = prompt?.id ?? null
    log('discovered', { name: 'prompts', id: resources.promptId })
  } catch (error) {
    log('discovery fallback', { name: 'prompts', error: error instanceof Error ? error.message : String(error) })
  }

  return resources
}

async function waitForApp(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 18000 }).catch(() => {})
  await page.waitForFunction(() => !document.body.innerText.includes('正在检查登录状态'), null, { timeout: 18000 }).catch(() => {})
  await page.waitForTimeout(1200)
}

async function pageText(page) {
  return page.locator('body').innerText({ timeout: 7000 }).catch(() => '')
}

function hasErrorState(text) {
  return [
    'Gateway Time-out',
    '无法加载',
    '目标服务当前不可达',
    '服务暂时不可用',
    '登录状态已失效',
    '请求失败',
  ].some((marker) => text.includes(marker))
}

async function capture(page, item, outputDir, options = {}) {
  const attempts = item.retries ?? 3
  let lastResult = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await page.goto(`${options.baseUrl}${item.path}`, { waitUntil: 'domcontentloaded', timeout: 70000 })
    await waitForApp(page)
    if (item.afterNavigate) {
      await item.afterNavigate(page)
      await waitForApp(page)
    }

    const text = await pageText(page)
    const error = hasErrorState(text)
    const fileName = `${item.slug}.png`
    const filePath = path.join(outputDir, fileName)
    await page.screenshot({ path: filePath, fullPage: false })

    lastResult = {
      slug: item.slug,
      title: item.title,
      path: item.path,
      screenshot: filePath,
      status: error ? 'error' : 'ok',
      attempt,
    }

    if (!error) {
      log('captured', { slug: item.slug, status: 'ok' })
      return lastResult
    }

    log('retrying page', { slug: item.slug, attempt, reason: 'visible error state' })
    await page.waitForTimeout(1800 * attempt)
  }

  log('captured', { slug: item.slug, status: lastResult?.status ?? 'unknown' })
  return lastResult
}

async function login(page, options) {
  await page.goto(`${options.baseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByPlaceholder('you@company.com').fill(options.email)
  await page.getByPlaceholder('请输入密码').fill(options.password)
  await page.getByRole('button', { name: '进入控制台' }).click()
  await page.waitForURL('**/dashboard', { timeout: 60000 })
  await waitForApp(page)

  const projectSelect = page.getByRole('combobox', { name: '选择项目' })
  if (await projectSelect.count()) {
    await projectSelect.selectOption(options.projectId)
    await page.waitForTimeout(800)
  }
}

function buildPages(resources) {
  const pages = [
    { slug: '03-dashboard', title: 'Dashboard', path: '/dashboard' },
    { slug: '04-tracing-list', title: 'Trace List', path: '/tracing', retries: 5 },
    { slug: '05-tracing-stats', title: 'Trace Analytics', path: '/tracing/stats', retries: 5 },
    { slug: '06-trace-detail', title: 'Trace Detail', path: `/tracing/${resources.traceId}`, retries: 5 },
    { slug: '07-datasets-list', title: 'Datasets', path: '/datasets' },
    { slug: '08-dataset-new', title: 'New Dataset', path: '/datasets/new' },
    { slug: '09-dataset-detail', title: 'Dataset Detail', path: `/datasets/${resources.datasetId}` },
    { slug: '10-evaluators-list', title: 'Evaluators', path: '/evaluators' },
    { slug: '11-evaluator-new', title: 'New Evaluator', path: '/evaluators/new' },
    { slug: '12-prompts-list', title: 'Prompts', path: '/prompts' },
    ...(resources.promptId ? [{ slug: '13-prompt-detail', title: 'Prompt Detail', path: `/prompts/${resources.promptId}` }] : []),
    { slug: '14-experiments-list', title: 'Experiments', path: '/experiments' },
    { slug: '15-experiment-new', title: 'New Experiment', path: '/experiments/new' },
    { slug: '16-experiment-compare', title: 'Experiment Compare', path: '/experiments/compare' },
    { slug: '17-experiment-detail', title: 'Experiment Detail', path: `/experiments/${resources.experimentId}` },
    { slug: '18-annotation-list', title: 'Annotation Queue', path: '/annotation' },
    { slug: '19-annotation-detail', title: 'Annotation Detail', path: `/annotation/${resources.annotationId}` },
    { slug: '20-monitoring', title: 'Monitoring', path: '/monitoring', retries: 4 },
    { slug: '21-settings-projects', title: 'Settings Projects', path: '/settings' },
    {
      slug: '22-settings-members',
      title: 'Settings Members',
      path: '/settings',
      afterNavigate: async (page) => {
        await page.getByRole('button', { name: /成员与权限/ }).click()
      },
    },
    {
      slug: '23-settings-api-keys',
      title: 'Settings API Keys',
      path: '/settings',
      afterNavigate: async (page) => {
        await page.getByRole('button', { name: /API Key/ }).click()
      },
    },
    {
      slug: '24-settings-llm',
      title: 'Settings LLM',
      path: '/settings',
      afterNavigate: async (page) => {
        await page.getByRole('button', { name: /模型与 LLM/ }).click()
      },
    },
  ]
  return pages
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const outputDir = path.resolve(options.outputDir)
  await fs.mkdir(outputDir, { recursive: true })

  const { chromium } = await loadPlaywright()
  const browser = await chromium.launch({ headless: options.headless })
  const viewport = { width: 1600, height: 1000 }
  const results = []

  try {
    const publicContext = await browser.newContext({ viewport })
    const publicPage = await publicContext.newPage()
    for (const item of [
      { slug: '01-login', title: 'Login', path: '/login', retries: 1 },
      { slug: '02-register', title: 'Register', path: '/register', retries: 1 },
    ]) {
      results.push(await capture(publicPage, item, outputDir, options))
    }
    await publicContext.close()

    const context = await browser.newContext({ viewport })
    await context.addInitScript((projectId) => {
      window.localStorage.setItem('evalsmith.currentProject', projectId)
    }, options.projectId)
    const page = await context.newPage()
    await login(page, options)
    const resources = await discoverResources(context, options)

    for (const item of buildPages(resources)) {
      results.push(await capture(page, item, outputDir, options))
    }

    const report = {
      status: results.some((item) => item.status === 'error') ? 'partial' : 'ok',
      base_url: options.baseUrl,
      project_id: options.projectId,
      output_dir: outputDir,
      captured_at: new Date().toISOString(),
      resources,
      screenshots: results,
    }
    const reportPath = path.join(outputDir, 'capture-report.json')
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2))
    log('completed', { report: reportPath, status: report.status, screenshots: results.length })
    process.stdout.write(`${JSON.stringify({ status: report.status, outputDir, report: reportPath, screenshots: results.length })}\n`)
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exit(1)
})
