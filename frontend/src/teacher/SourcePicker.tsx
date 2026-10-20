/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The 📚 Library picker: which uploaded sources an assistant's answers may
 * search. A labelled chip under the landing chat's bar, a round icon inside
 * the docked assistants' bars (v8.28.0). `ScopePicker` with the library's wording, shared by
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
        name: 'Library filters',
        unit: 'source',
        heading: 'Search in',
        allHint: 'All sources are searched.',
        someHint: 'Only the checked sources are searched.',
        noneHint: "No sources selected — the assistant won't search your library.",
        buttonTitle: 'choose which of your uploaded books, PDFs and pages the assistant may search',
      }}
    />
  )
}
