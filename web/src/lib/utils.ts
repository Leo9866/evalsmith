import clsx, { type ClassValue } from 'clsx'
import type { JsonValue } from '@/types'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

export function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

export function formatTokens(value: number): string {
  if (value < 1000) return `${value}`
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}K`
  return `${(value / 1_000_000).toFixed(1)}M`
}

export function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

export function formatDate(iso: string | undefined | null): string {
  if (!iso) return '暂无'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function formatRelativeTime(iso: string | undefined | null): string {
  if (!iso) return '暂无'
  const deltaMs = Date.now() - new Date(iso).getTime()
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (deltaMs < minute) return '刚刚'
  if (deltaMs < hour) return `${Math.floor(deltaMs / minute)} 分钟前`
  if (deltaMs < day) return `${Math.floor(deltaMs / hour)} 小时前`
  return `${Math.floor(deltaMs / day)} 天前`
}

export function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`
}

export function truncate(value: string | undefined | null, limit = 120): string {
  if (!value) return ''
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}...`
}

export function parseJsonLike(value: unknown): JsonValue | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return value as JsonValue
  if (typeof value !== 'string' || value.trim() === '') return null
  try {
    return JSON.parse(value) as JsonValue
  } catch {
    return null
  }
}

export function toPrettyJson(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') {
    const parsed = parseJsonLike(value)
    if (parsed !== null) {
      return JSON.stringify(parsed, null, 2)
    }
    return value
  }
  return JSON.stringify(value, null, 2)
}

export function getStatusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'ok':
    case 'completed':
      return 'success'
    case 'running':
    case 'pending':
      return 'warning'
    case 'error':
    case 'failed':
      return 'danger'
    default:
      return 'neutral'
  }
}

export function getScoreTone(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 0.85) return 'success'
  if (score >= 0.5) return 'warning'
  return 'danger'
}
