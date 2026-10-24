/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Where an enlarged figure goes (v8.38.0): the shell's middle, the tool or
 * the landing chat, never the side panels. The shell renders an empty layer
 * over that area and provides it here; `Lightbox` portals into it, whichever
 * component opened the figure (a tool, or an assistant's answer). Outside the
 * shell (a test, a modal) there is no layer and the lightbox covers the
 * window as it always did.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { createContext } from 'react'

/** The element enlarged figures render into, or null for the whole window. */
export const FigureLayerContext = createContext<HTMLElement | null>(null)
