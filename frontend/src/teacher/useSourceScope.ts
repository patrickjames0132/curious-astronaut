/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Which of the uploaded sources an assistant may search, for the 📚 picker
 * under its ask bar. Shared by both assistants since v8.25.0 (the Knowledge
 * Graph's had no picker at first). Each panel keeps its own choice.
 *
 * Tracked by **exclusion**, so a source uploaded after the reader last
 * touched the picker is searchable by default; a deleted source's lingering
 * id is inert. The library itself is read live from the store, so the picker
 * appears the moment a source lands.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../store'
import { loadLibrary, selectLibrary } from '../store/library'

/**
 * Hold an assistant's library scope.
 *
 * @returns The library, the checked ids, the scope to send (undefined for
 *   "everything", else the checked ids, empty for none), and the picker's
 *   handlers.
 */
export function useSourceScope() {
  const dispatch = useAppDispatch()
  const { sources: items, loaded } = useAppSelector(selectLibrary)
  const [excluded, setExcluded] = useState<string[]>([])
  // The first reader fetches; the loaded flag keeps remounts from re-fetching.
  useEffect(() => {
    if (!loaded) dispatch(loadLibrary())
  }, [loaded, dispatch])
  const checkedIds = items
    .filter((source) => !excluded.includes(source.id))
    .map((source) => source.id)
  const all = items.length === 0 || checkedIds.length === items.length
  return {
    items,
    checkedIds,
    scope: all ? undefined : checkedIds,
    toggle: (id: string) =>
      setExcluded((previous) =>
        previous.includes(id) ? previous.filter((other) => other !== id) : [...previous, id],
      ),
    selectAll: () => setExcluded([]),
    deselectAll: () => setExcluded(items.map((source) => source.id)),
  }
}
