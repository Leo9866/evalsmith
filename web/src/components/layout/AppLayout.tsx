import { Outlet } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import Header from './Header'
import Sidebar from './Sidebar'

export default function AppLayout() {
  const collapsed = useAppStore((state) => state.sidebarCollapsed)

  return (
    <div className="min-h-screen bg-transparent text-[color:var(--color-text)]">
      <Sidebar />
      <div
        className={cn(
          'min-h-screen transition-[padding] duration-300 ease-out',
          collapsed ? 'lg:pl-24' : 'lg:pl-72'
        )}
      >
        <Header />
        <main className="px-5 pb-8 pt-5 sm:px-6 lg:px-10 lg:pb-10">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
