#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

function parseArgs(argv) {
  const options = {
    artifact: path.join(repoRoot, 'logs/e2e-runs/test-env-e2e-latest.json'),
    headless: true,
    outputDir: path.join(repoRoot, 'logs/e2e-runs'),
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--artifact' && argv[index + 1]) {
      options.artifact = path.resolve(argv[index + 1])
      index += 1
    } else if (arg === '--output-dir' && argv[index + 1]) {
      options.outputDir = path.resolve(argv[index + 1])
      index += 1
    } else if (arg === '--headed') {
      options.headless = false
    } else if (arg === '--headless') {
      options.headless = true
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return options
}

function consoleLog(event, payload = null) {
  if (payload === null) {
    process.stdout.write(`[test-env-ui] ${event}\n`)
    return
  }
  process.stdout.write(`[test-env-ui] ${event}: ${JSON.stringify(payload)}\n`)
}

function requirePath(value, message) {
  if (!value) {
    throw new Error(message)
  }
  return value
}

async function loadPlaywright() {
  const playwrightPath = path.resolve(repoRoot, 'web/node_modules/playwright/index.mjs')
  return import(pathToFileURL(playwrightPath).href)
}

async function expectVisible(page, locator, description, report) {
  await locator.waitFor({ state: 'visible', timeout: 30000 })
  report.checks.push({ description, status: 'passed' })
  consoleLog('check passed', { description })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const artifact = JSON.parse(await fs.readFile(options.artifact, 'utf8'))
  const outputDir = path.resolve(options.outputDir)
  await fs.mkdir(outputDir, { recursive: true })

  const report = {
    started_at: new Date().toISOString(),
    artifact: options.artifact,
    checks: [],
  }

  const { chromium } = await loadPlaywright()
  const browser = await chromium.launch({ headless: options.headless })
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } })
  const screenshotPath = path.join(outputDir, `test-env-ui-failure-${Date.now()}.png`)
  const reportPath = path.join(outputDir, `test-env-ui-check-${artifact.run_id}.json`)
  const latestReportPath = path.join(outputDir, 'test-env-ui-check-latest.json')

  try {
    const projectId = requirePath(artifact.project?.id, 'artifact.project.id is required')
    const baseUrl = requirePath(artifact.base_url, 'artifact.base_url is required')
    const email = requirePath(artifact.user?.email, 'artifact.user.email is required')
    const password = requirePath(artifact.user?.password, 'artifact.user.password is required')
    const datasetName = requirePath(artifact.dataset?.name, 'artifact.dataset.name is required')
    const baselineName = requirePath(artifact.baseline_experiment?.name, 'artifact.baseline_experiment.name is required')
    const candidateName = requirePath(artifact.candidate_experiment?.name, 'artifact.candidate_experiment.name is required')
    const monitoringRuleName = requirePath(artifact.monitoring_rule?.name, 'artifact.monitoring_rule.name is required')
    const annotationTaskId = requirePath(
      artifact.steps?.manual_trace_backfill?.annotation?.task_ids?.[0],
      'artifact.steps.manual_trace_backfill.annotation.task_ids[0] is required',
    )
    const searchableTraceId = requirePath(
      artifact.steps?.manual_trace_backfill?.dataset?.trace_ids?.[0],
      'artifact.steps.manual_trace_backfill.dataset.trace_ids[0] is required',
    )
    const candidateTraceId = requirePath(
      artifact.steps?.candidate_results?.trace_ids?.[0],
      'artifact.steps.candidate_results.trace_ids[0] is required',
    )

    await context.addInitScript((currentProjectId) => {
      window.localStorage.setItem('evalsmith.currentProject', currentProjectId)
    }, projectId)
    const page = await context.newPage()

    consoleLog('login page', { baseUrl, email, projectId })
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
    await page.getByPlaceholder('you@company.com').fill(email)
    await page.getByPlaceholder('请输入密码').fill(password)
    await page.getByRole('button', { name: '登录' }).click()
    await page.waitForURL(/\/dashboard$/, { timeout: 30000 })
    await expectVisible(page, page.getByRole('heading', { name: '总览控制台' }), 'dashboard heading visible', report)

    const projectSelect = page.getByRole('combobox', { name: '选择项目' })
    await projectSelect.selectOption(projectId)
    const selectedProject = await projectSelect.inputValue()
    if (selectedProject !== projectId) {
      throw new Error(`project switcher did not select expected project: expected ${projectId}, got ${selectedProject}`)
    }
    report.checks.push({ description: 'project switcher selected target project', status: 'passed' })
    consoleLog('check passed', { description: 'project switcher selected target project' })

    consoleLog('verify dataset detail', { dataset: artifact.urls?.dataset })
    await page.goto(artifact.urls.dataset, { waitUntil: 'domcontentloaded' })
    await expectVisible(page, page.getByRole('heading', { name: datasetName }), 'dataset detail heading visible', report)
    await expectVisible(page, page.getByText('版本').first(), 'dataset versions tab visible', report)

    consoleLog('verify baseline experiment detail', { experiment: artifact.urls?.baseline_experiment })
    await page.goto(artifact.urls.baseline_experiment, { waitUntil: 'domcontentloaded' })
    await expectVisible(page, page.getByRole('heading', { name: baselineName }), 'baseline experiment heading visible', report)
    await expectVisible(page, page.getByText('平均分数'), 'baseline experiment summary visible', report)

    consoleLog('verify candidate experiment detail', { experiment: artifact.urls?.candidate_experiment })
    await page.goto(artifact.urls.candidate_experiment, { waitUntil: 'domcontentloaded' })
    await expectVisible(page, page.getByRole('heading', { name: candidateName }), 'candidate experiment heading visible', report)
    await expectVisible(page, page.getByText('平均分数'), 'candidate experiment summary visible', report)

    consoleLog('verify trace search list', { traceId: searchableTraceId })
    await page.goto(`${baseUrl}/tracing?search=${encodeURIComponent(searchableTraceId)}`, { waitUntil: 'domcontentloaded' })
    await expectVisible(page, page.getByRole('heading', { name: 'Trace', exact: true }), 'trace list heading visible', report)
    await expectVisible(page, page.getByText(searchableTraceId, { exact: true }), 'trace search result visible', report)

    consoleLog('verify trace detail', { traceId: candidateTraceId })
    await page.goto(`${baseUrl}/tracing/${candidateTraceId}`, { waitUntil: 'domcontentloaded' })
    await expectVisible(page, page.getByRole('heading', { name: 'verification_agent_request' }), 'trace detail heading visible', report)
    await expectVisible(page, page.getByRole('button', { name: '原始载荷' }), 'trace detail raw tab visible', report)

    consoleLog('verify annotation detail', { taskId: annotationTaskId })
    await page.goto(`${baseUrl}/annotation/${annotationTaskId}`, { waitUntil: 'domcontentloaded' })
    await expectVisible(page, page.getByRole('heading', { name: '标注工作台' }), 'annotation detail heading visible', report)
    await expectVisible(page, page.getByText(`任务 ${annotationTaskId}`), 'annotation task detail visible', report)

    consoleLog('verify monitoring page', { url: artifact.urls?.monitoring, rule: monitoringRuleName })
    await page.goto(artifact.urls.monitoring, { waitUntil: 'domcontentloaded' })
    await expectVisible(page, page.getByRole('heading', { name: '在线监控' }), 'monitoring heading visible', report)
    await expectVisible(page, page.getByText(monitoringRuleName, { exact: true }), 'monitoring rule visible', report)

    report.completed_at = new Date().toISOString()
    report.status = 'ok'
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2))
    await fs.writeFile(latestReportPath, JSON.stringify(report, null, 2))
    consoleLog('completed', { report: reportPath, checks: report.checks.length })
    process.stdout.write(`${JSON.stringify({ status: 'ok', report: reportPath, checks: report.checks.length })}\n`)
  } catch (error) {
    const pages = context.pages()
    const activePage = pages[pages.length - 1]
    if (activePage) {
      await activePage.screenshot({ path: screenshotPath, fullPage: true })
    }
    report.completed_at = new Date().toISOString()
    report.status = 'failed'
    report.error = error instanceof Error ? error.message : String(error)
    report.failure_screenshot = screenshotPath
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2))
    await fs.writeFile(latestReportPath, JSON.stringify(report, null, 2))
    consoleLog('failed', { report: reportPath, screenshot: screenshotPath, error: report.error })
    process.stdout.write(`${JSON.stringify({ status: 'failed', report: reportPath, screenshot: screenshotPath, error: report.error })}\n`)
    process.exitCode = 1
  } finally {
    await context.close()
    await browser.close()
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exit(1)
})
