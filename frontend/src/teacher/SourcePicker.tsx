/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The 📚 picker under an assistant's ask bar: which uploaded sources its
 * answers may search. `ScopePicker` with the library's wording, shared by
 * both assistants since v8.25.0; the choice lives in `useSourceScope`.
 * Renders nothing without a library, but shows at one source: "use it or
 * don't" is a choice too.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import ScopePicker from './ScopePicker'
import type { useSourceScope } from './useSourceScope'

/**
 * Render the picker.
 *
 * @param props Component props.
 * @param props.scope The assistant's `useSourceScope`.
 * @param props.open Whether its popover is open.
 * @param props.onOpenChange Open or close it.
 * @param props.dataTour The tour's anchor, on the Citation Graph's alone.
 * @returns The picker, or nothing with no library.
 */
export default function SourcePicker({
  scope,
  open,
  onOpenChange,
  dataTour,
}: {
  scope: ReturnType<typeof useSourceScope>
  open: boolean
  onOpenChange: (open: boolean) => void
  dataTour?: string
}) {
  if (!scope.items.length) return null
  return (
    <ScopePicker
      items={scope.items}
      checkedIds={scope.checkedIds}
      dataTour={dataTour}
      open={open}
      onOpenChange={onOpenChange}
      onToggle={scope.toggle}
      onSelectAll={scope.selectAll}
      onDeselectAll={scope.deselectAll}
      labels={{
        icon: '📚',
        unit: 'source',
        heading: 'Search in',
        allHint: 'All sources are searched.',
        someHint: 'Only the checked sources are searched.',
        noneHint: "No sources selected — the assistant won't search your library.",
        buttonTitle: 'Choose which of your sources the assistant may search',
      }}
    />
  )
}
