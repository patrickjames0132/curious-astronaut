/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The launcher astronaut's frames, and which one follows which (v9.9.0,
 * Patrick). Hovered, Nova turns to face you and bobs up and down for as long
 * as the pointer stays; let go, he finishes the drop he is in and turns back
 * to where he started. A turn that is let go of half way unwinds from where
 * it got to, and a turn back that is hovered again runs back into the bob, so
 * no change of mind ever jumps a frame.
 *
 * The frames are one sprite sheet (`public/astronaut-frames.webp`), cut from
 * Patrick's video in three runs laid end to end:
 *
 * - `0–12` the turn in. Frame 0 is the resting pose, the same picture as
 *   `public/astronaut-still.png`, so swapping still for sheet doesn't jump.
 * - `13–62` the bob: the rise, the video's half-second hang at the top (kept
 *   whole — Patrick tried it cut to a beat and preferred the pause), the drop
 *   and its dip below rest, then a rebound (Patrick asked for more bounce and
 *   momentum at the bottom): from the frame where the video's spring-back is
 *   rising fastest, a damped spring takes over, so he whips past rest, swings
 *   back below it, wobbles once more and settles — his settled frame shifted
 *   along the spring's path. (Earlier tries, and why they went, are in the
 *   package README.) Settled, he **rests a second before rising again**
 *   (Patrick) — held on the bob's last frame, and only while hovered, so a
 *   pointer leaving mid-rest turns him back at once.
 *   Its last frame is closer to its first than most neighbouring frames are
 *   to each other, so it loops without a seam.
 * - `63–75` the turn back, whose last frame is the resting pose again.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

/** The sprite sheet, and how it is laid out: 192px frames, left to right, top to bottom. */
export const SHEET = '/astronaut-frames.webp'
export const SHEET_COLUMNS = 8
export const SHEET_ROWS = 10
/** The video's own rate, 23.976 frames a second. */
export const FRAME_MS = 1001 / 24

/** How long he rests between bobs, once the rebound settles. */
export const BOB_REST_MS = 1000

/** The resting pose: the sheet's first frame, and the still. */
export const REST = 0
const TURN_IN_END = 12
const BOB_START = 13
const BOB_END = 62
const TURN_BACK_END = 75

/**
 * The frame after this one.
 *
 * @param frame The frame showing now.
 * @param hovered Whether the pointer is (still) over him.
 * @returns The next frame, or null once he is at rest and should stay there.
 */
export function nextFrame(frame: number, hovered: boolean): number | null {
  if (hovered) {
    // The turn in, then the bob, round and round. Caught turning back, he
    // runs the turn back in reverse into the bottom of the bob.
    if (frame < BOB_END) return frame + 1
    if (frame === BOB_END) return BOB_START
    return frame - 1
  }
  // Let go: a turn in unwinds; a bob finishes its drop, then turns back.
  if (frame === REST) return null
  if (frame <= TURN_IN_END) return frame - 1
  if (frame < TURN_BACK_END) return frame + 1
  return REST
}

/**
 * How long a frame stays up before the next.
 *
 * @param frame The frame showing now.
 * @param hovered Whether the pointer is (still) over him.
 * @returns Its time on screen, in milliseconds.
 */
export function frameDuration(frame: number, hovered: boolean): number {
  return frame === BOB_END && hovered ? BOB_REST_MS : FRAME_MS
}

/**
 * Where a frame sits on the sheet, as a CSS `background-position`.
 *
 * @param frame The frame.
 * @returns Its position, in percent of the sheet.
 */
export function framePosition(frame: number): string {
  const column = frame % SHEET_COLUMNS
  const row = Math.floor(frame / SHEET_COLUMNS)
  return `${(column * 100) / (SHEET_COLUMNS - 1)}% ${(row * 100) / (SHEET_ROWS - 1)}%`
}
