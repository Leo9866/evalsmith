import { api } from './client'
import type { AuthSession } from '@/types'

export function login(data: { email: string; password: string }) {
  return api.post<AuthSession>('/auth/login', data)
}

export function register(data: { email: string; name: string; password: string }) {
  return api.post<AuthSession>('/auth/register', data)
}

export function getCurrentSession() {
  return api.get<AuthSession>('/auth/me')
}

export function logout() {
  return api.post<{ logged_out: boolean }>('/auth/logout')
}
