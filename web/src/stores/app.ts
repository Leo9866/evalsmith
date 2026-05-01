import { create } from 'zustand'
import type { AuthSession, Project, ProjectRole, User } from '@/types'

const CURRENT_PROJECT_STORAGE_KEY = 'evalsmith.currentProject'

interface AppState {
  currentProject: string
  currentProjectRole: ProjectRole | string | null
  projects: Project[]
  currentUser: User | null
  authInitialized: boolean
  sidebarCollapsed: boolean
  mobileNavOpen: boolean
  setAuthSession: (session: AuthSession) => void
  clearAuth: () => void
  setProjects: (projects: Project[]) => void
  setProject: (id: string) => void
  toggleSidebar: () => void
  toggleMobileNav: () => void
  closeMobileNav: () => void
}

function readStoredProject() {
  if (typeof window === 'undefined') {
    return ''
  }
  try {
    return window.localStorage.getItem(CURRENT_PROJECT_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function persistProject(projectId: string) {
  if (typeof window === 'undefined') {
    return
  }
  try {
    if (projectId) {
      window.localStorage.setItem(CURRENT_PROJECT_STORAGE_KEY, projectId)
    } else {
      window.localStorage.removeItem(CURRENT_PROJECT_STORAGE_KEY)
    }
  } catch {
    // Ignore localStorage failures and keep the in-memory selection.
  }
}

function resolveProjectState(projects: Project[], requestedProject?: string) {
  const currentProject = projects.some((project) => project.id === requestedProject)
    ? (requestedProject as string)
    : (projects[0]?.id ?? '')
  const currentProjectRole = projects.find((project) => project.id === currentProject)?.role ?? null
  return { currentProject, currentProjectRole }
}

export const useAppStore = create<AppState>((set) => ({
  currentProject: readStoredProject(),
  currentProjectRole: null,
  projects: [],
  currentUser: null,
  authInitialized: false,
  sidebarCollapsed: false,
  mobileNavOpen: false,
  setAuthSession: (session) =>
    set((state) => {
      const projectState = resolveProjectState(session.projects, state.currentProject || readStoredProject())
      persistProject(projectState.currentProject)
      return {
        currentUser: session.user,
        projects: session.projects,
        authInitialized: true,
        ...projectState,
      }
    }),
  clearAuth: () =>
    set((state) => ({
      currentUser: null,
      projects: [],
      currentProject: '',
      currentProjectRole: null,
      authInitialized: true,
      sidebarCollapsed: state.sidebarCollapsed,
      mobileNavOpen: false,
    })),
  setProjects: (projects) =>
    set((state) => {
      const projectState = resolveProjectState(projects, state.currentProject || readStoredProject())
      persistProject(projectState.currentProject)
      return {
        projects,
        ...projectState,
      }
    }),
  setProject: (id) =>
    set((state) => {
      persistProject(id)
      return {
        currentProject: id,
        currentProjectRole: state.projects.find((project) => project.id === id)?.role ?? null,
      }
    }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleMobileNav: () => set((s) => ({ mobileNavOpen: !s.mobileNavOpen })),
  closeMobileNav: () => set({ mobileNavOpen: false }),
}))
