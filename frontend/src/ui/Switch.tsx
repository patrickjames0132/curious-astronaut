/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * A boolean as a switch: a real checkbox stays in the markup for keyboard and
 * screen readers, visually hidden, with the track and knob painted from
 * `:checked` / `:focus-visible`. Born in the settings modal; shared since
 * v8.17.0, when the knowledge panel's "I know this" became one. A caller can
 * recolour the "on" track by setting `--switch-on` on an ancestor, and style
 * the visible text (`.switch-label`, after the input, so
 * `input:checked ~ .switch-label` reaches it).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import type { ReactNode } from 'react'
import './switch.css'

/**
 * Render a switch, optionally with visible text after it.
 *
 * @param props Component props.
 * @param props.checked Whether it is on.
 * @param props.label The accessible name: what a screen reader calls it.
 * @param props.onChange Called with the new state.
 * @param props.children Visible text to the right of the switch, if any.
 * @returns The labelled checkbox.
 */
export default function Switch({
  checked,
  label,
  onChange,
  children,
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
  children?: ReactNode
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={label}
      />
      <span className="switch-track" aria-hidden="true">
        <span className="switch-knob" />
      </span>
      {children && <span className="switch-label">{children}</span>}
    </label>
  )
}
