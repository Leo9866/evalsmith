import { useAppStore } from '@/stores/app'
import type { ApiEnvelope } from '@/types'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1'

export class ApiError extends Error {
  status: number
  statusText: string
  body?: unknown

  constructor(status: number, statusText: string, body?: unknown) {
    super(resolveApiErrorMessage(status, statusText, body))
    this.name = 'ApiError'
    this.status = status
    this.statusText = statusText
    this.body = body
  }
}

function resolveApiErrorMessage(status: number, statusText: string, body?: unknown) {
  const statusMessage = resolveStatusMessage(status, statusText)
  const detailMessage = resolveBodyMessage(body)
  if (!detailMessage) {
    return statusMessage
  }
  if (detailMessage === statusMessage) {
    return detailMessage
  }
  return `${statusMessage}：${detailMessage}`
}

function resolveStatusMessage(status: number, statusText: string) {
  switch (status) {
    case 400:
      return '请求参数不完整或格式不正确'
    case 401:
      return '登录状态已失效，请重新登录'
    case 403:
      return '你当前没有权限执行该操作'
    case 404:
      return '请求的资源不存在，或当前项目无权访问'
    case 409:
      return '资源状态发生冲突，请刷新后重试'
    case 422:
      return '提交内容校验失败，请检查输入后重试'
    case 500:
      return '服务暂时不可用，请稍后再试'
    case 502:
      return '目标服务当前不可达或返回异常，请稍后重试'
    case 504:
      return '目标服务处理超时，请稍后重试'
    default:
      return `请求失败：${status} ${statusText}`
  }
}

function resolveBodyMessage(body?: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null
  }

  const payload = body as {
    message?: unknown
    details?: unknown
    detail?: unknown
  }

  if (typeof payload.message === 'string' && payload.message.trim()) {
    const detailSuffix = resolveDetailsSuffix(payload.details)
    return detailSuffix ? `${payload.message}：${detailSuffix}` : payload.message
  }

  if (payload.detail && typeof payload.detail === 'object') {
    const detail = payload.detail as { message?: unknown; details?: unknown }
    if (typeof detail.message === 'string' && detail.message.trim()) {
      const detailSuffix = resolveDetailsSuffix(detail.details)
      return detailSuffix ? `${detail.message}：${detailSuffix}` : detail.message
    }
  }

  if (typeof payload.detail === 'string' && payload.detail.trim()) {
    return payload.detail
  }

  return null
}

function resolveDetailsSuffix(details: unknown): string | null {
  if (!details) {
    return null
  }
  if (typeof details === 'string' && details.trim()) {
    return details
  }
  if (typeof details === 'object') {
    if ('error' in details && typeof details.error === 'string' && details.error.trim()) {
      return details.error
    }
    const serialized = JSON.stringify(details)
    if (serialized && serialized !== '{}' && serialized !== '[]') {
      return serialized
    }
  }
  return null
}

function resolveEnvelopeErrorStatus(status: number, envelopeCode: number) {
  if (status >= 400) {
    return status
  }
  if (envelopeCode >= 400 && envelopeCode <= 599) {
    return envelopeCode
  }
  return 400
}

interface RequestOptions {
  params?: Record<string, string | number | undefined | null>
  body?: BodyInit | FormData | object
  headers?: Record<string, string>
}

function buildUrl(path: string, params?: RequestOptions['params']) {
  const url = new URL(`${BASE_URL}${path}`, window.location.origin)
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })
  return `${url.pathname}${url.search}`
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const projectId = useAppStore.getState().currentProject
  const headers = new Headers(options.headers)
  const isFormData = options.body instanceof FormData

  if (projectId) {
    headers.set('X-Project-ID', projectId)
  }
  if (!isFormData && options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const requestBody: BodyInit | undefined =
    options.body === undefined
      ? undefined
      : isFormData || typeof options.body === 'string' || options.body instanceof Blob
        ? (options.body as BodyInit)
        : JSON.stringify(options.body)

  const response = await fetch(buildUrl(path, options.params), {
    method,
    headers,
    body: requestBody,
    credentials: 'include',
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    if (response.status === 401) {
      useAppStore.getState().clearAuth()
    }
    throw new ApiError(response.status, response.statusText, payload)
  }

  if (!payload) {
    return undefined as T
  }

  const envelope = payload as ApiEnvelope<T>
  if (typeof envelope.code === 'number' && envelope.code !== 0) {
    throw new ApiError(resolveEnvelopeErrorStatus(response.status, envelope.code), envelope.message, envelope)
  }

  return envelope.data
}

export const api = {
  get: <T>(path: string, params?: RequestOptions['params']) => request<T>('GET', path, { params }),
  post: <T>(path: string, body?: RequestOptions['body'], headers?: RequestOptions['headers']) =>
    request<T>('POST', path, { body, headers }),
  put: <T>(path: string, body?: RequestOptions['body'], headers?: RequestOptions['headers']) =>
    request<T>('PUT', path, { body, headers }),
  del: <T>(path: string) => request<T>('DELETE', path),
}
