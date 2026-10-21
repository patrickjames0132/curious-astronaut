/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * An ⓘ that holds text there isn't room to show: hover or focus previews
 * it, a click pins it open, and clicking away or Esc closes it. Born as the 3D course's
 * navigation help on narrow panels (`knowledge/KnowledgeControls`), shared
 * since v8.25.0, when the assistants' composers started folding the lines
 * above their ask bar into one when the panel is too narrow for them.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import './infoTip.css'

/**
 * Render the ⓘ and, while previewed or pinned, its tooltip.
 *
 * @param props Component props.
 * @param props.label The button's accessible name.
 * @param props.className Extra classes on the wrapper, for a variant's size
 *   and where its tooltip opens.
 * @param props.children What the tooltip says.
 * @returns The button and its tooltip.
 */
export default function InfoTip({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: ReactNode
}) {
  const [pinned, setPinned] = useState(false)
  const [preview, setPreview] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const tooltipId = useId()
  const visible = pinned || preview

  useEffect(() => {
    if (!visible) return
    /**
     * Close on outside pointer presses, including non-focusable canvas areas.
     * @param event The pointer press to check against the wrapper.
     */
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target)) {
        setPinned(false)
        setPreview(false)
      }
    }
    document.addEventListener('pointerdown', dismissOutside, true)
    return () => document.removeEventListener('pointerdown', dismissOutside, true)
  }, [visible])

  return (
    <div
      ref={wrapper}
      className={`info-tip${className ? ` ${className}` : ''}`}
      onMouseEnter={() => setPreview(true)}
      onMouseLeave={() => setPreview(false)}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        setPinned(false)
        setPreview(false)
      }}
    >
      <button
        type="button"
        className="info-tip-button"
        aria-label={label}
        aria-expanded={visible}
        aria-describedby={visible ? tooltipId : undefined}
        onFocus={() => setPreview(true)}
        onBlur={() => setPreview(false)}
        onClick={() => {
          setPinned(!pinned)
          setPreview(false)
        }}
      >
        ⓘ
      </button>
      {visible && (
        <div className="info-tip-pop" role="tooltip" id={tooltipId}>
          {children}
        </div>
      )}
    </div>
  )
}
