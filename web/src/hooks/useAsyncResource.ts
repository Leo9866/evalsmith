import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'

interface AsyncResourceState<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => Promise<void>
}

export function useAsyncResource<T>(
  loader: () => Promise<T>,
  deps: DependencyList
): AsyncResourceState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loaderRef = useRef(loader)

  useEffect(() => {
    loaderRef.current = loader
  }, [loader])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await loaderRef.current()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    // The dependency list is supplied by callers so this hook can mirror useEffect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return {
    data,
    loading,
    error,
    reload: load,
  }
}
