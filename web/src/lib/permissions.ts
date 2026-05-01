import type { ProjectRole } from '@/types'

export function canManageProjectMembers(role: ProjectRole | string | null | undefined) {
  return role === 'owner' || role === 'admin'
}

export function canManageApiKeys(role: ProjectRole | string | null | undefined) {
  return role === 'owner' || role === 'admin' || role === 'developer'
}

export function canManageLLMConfig(role: ProjectRole | string | null | undefined) {
  return role === 'owner' || role === 'admin' || role === 'developer'
}

export function canManageEvaluationAssets(role: ProjectRole | string | null | undefined) {
  return role === 'owner' || role === 'admin' || role === 'developer'
}
