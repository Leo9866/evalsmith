import { useEffect, useRef, useState } from 'react'

export function useDebouncedSearchInput(
  value: string,
  onCommit: (nextValue: string) => void,
  delay = 400
) {
  const [inputValue, setInputValue] = useState(value)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    setInputValue(value)
  }, [value])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (inputValue === value) {
      return () => clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(() => {
      onCommit(inputValue)
    }, delay)

    return () => clearTimeout(debounceRef.current)
  }, [delay, inputValue, onCommit, value])

  useEffect(() => () => clearTimeout(debounceRef.current), [])

  return [inputValue, setInputValue] as const
}
