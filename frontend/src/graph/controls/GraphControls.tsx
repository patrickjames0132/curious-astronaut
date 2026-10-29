/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The declutter panel over the graph: layout toggle (Force / Timeline),
 * relation filter chips and the Surveys chip beside them, the dual-knob year range slider, the dual-knob
 * citation-count window slider, the visible-count readout, and the pin/fit
 * actions — all under a header bar that collapses the whole panel to a slim
 * strip (the find control's collapse-until-wanted idea, panel-sized), giving
 * the canvas its ~272px back when the user isn't filtering. That strip is
 * where the panel *starts*: a freshly built graph should be a graph, not a
 * canvas already covered by its own controls.
 *
 * Purely presentational — all state lives in GraphExplorer; this just renders
 * it and fires the callbacks. The one exception is the collapsed flag, which
 * is local like the find control's own open/closed: nothing else reads it.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { CHIP_TYPES, REL_COLOR, REL_LABEL, SURVEY_COLOR } from '../theme'
import { CITE_SLIDER_STEPS, citationThreshold } from '../model'
import '../graph.css'
import MarkIcon from '../../ui/MarkIcon'
import SlidersGlyph from '../../ui/SlidersGlyph'
import type { PaperLinksStatus } from '../hooks/usePaperLinks'
import { usePresence } from '../../ui/usePresence'

/** Props for {@link GraphControls}. */
export interface GraphControlsProps {
  /** Current layout mode. */
  layout: 'force' | 'timeline'
  /** Switch layout (pins/releases year columns as needed). */
  onLayout: (mode: 'force' | 'timeline') => void
  /** The relation types currently shown. */
  enabled: Set<string>
  /** Toggle one relation type on/off. */
  onToggleType: (type: string) => void
  /** The Surveys chip is on: surveys and reviews are ringed orange (off by
   *  default). Optional, like the caps: without `onToggleSurveys` the chip
   *  isn't rendered. */
  surveyRings?: boolean
  /** Turn the survey rings on or off. */
  onToggleSurveys?: () => void
  /** Show the per-chip count sliders — true only while the build is user-sized
   *  (the settings modal's automatic sizing turned off). An adaptive build is
   *  already trimmed by the backend, so the sliders stay out of the way.
   *  Optional, defaulting off: a caller with no interest in caps renders the
   *  plain chips it always did. */
  showRelCaps?: boolean
  /** How many papers of each relation to show; a missing key means all. */
  relCaps?: Record<string, number>
  /** How many papers each relation holds in the graph (the sliders' bounds). */
  relTotals?: Record<string, number>
  /** Set one relation's display cap (the full total means "no cap"). */
  onRelCap?: (type: string, cap: number) => void
  /** The base graph's year range (slider bounds). */
  minYear: number
  maxYear: number
  /** The selected year window. */
  yearLo: number
  yearHi: number
  onYearLo: (year: number) => void
  onYearHi: (year: number) => void
  /** The citation-count range in the graph (the citation slider's bounds). */
  minCitations: number
  maxCitations: number
  /** The citation window's knob positions (each 0…{@link CITE_SLIDER_STEPS}). */
  citeLo: number
  citeHi: number
  onCiteLo: (value: number) => void
  onCiteHi: (value: number) => void
  /** Visible vs. total node counts for the readout. */
  visibleCount: number
  totalCount: number
  /** How many nodes are hand-picked into the teacher's scope (0 = none). */
  selectedCount: number
  /** How many nodes the teacher currently lights up (0 = none). */
  litCount: number
  /** Drop every highlight at once — hand-picked selection and teacher glow
   *  alike (the same reset Esc runs). */
  onClearAll: () => void
  /** How many nodes the user has pinned (shown in the Release label). */
  pinnedCount: number
  /** Unpin every node and reheat the simulation so the layout re-settles —
   *  useful bare (nothing pinned) to re-condense a drifted force graph. */
  onReleaseAll: () => void
  /** Re-center the graph (zoomToFit). */
  onFit: () => void
  /** Bust this seed's cached snapshot and re-fetch it from the provider. */
  onRefresh: () => void
  /** A graph load/refresh is in flight (disables Refresh). */
  refreshing: boolean
  /** A provider-specific caveat to surface below the controls (e.g. S2's ~10k
   *  citer-offset limit), or null when the active provider has none. */
  providerNote?: string | null
  /** The interconnected links (the citations among the papers on the graph,
   *  not just the ones to the seed): whether they're wanted. Optional, like
   *  the caps: without `onLinks` the button isn't rendered (Timeline). */
  linksOn?: boolean
  /** Ask for the links (true) or hide them (false); true again after a
   *  failed lookup retries it. */
  onLinks?: (on: boolean) => void
  /** The links are being looked up or the graph is still settling around
   *  them: the button spins and holds until it's done. */
  linksBusy?: boolean
  /** Where the links lookup stands (for the error line). */
  linksStatus?: PaperLinksStatus
  /** How many links are drawn. */
  linksCount?: number
  /** The guided tour is walking the panel's stops — expand a collapsed panel
   *  so its targets can be spotlighted (it never re-collapses; no tidy-up). */
  stagedOpen?: boolean
}

/**
 * Render the graph's control panel.
 *
 * @returns The declutter panel (toggle, chips, sliders, actions, hint).
 */
export default function GraphControls({
  layout,
  onLayout,
  enabled,
  onToggleType,
  surveyRings = false,
  onToggleSurveys,
  showRelCaps = false,
  relCaps = {},
  relTotals = {},
  onRelCap,
  minYear,
  maxYear,
  yearLo,
  yearHi,
  onYearLo,
  onYearHi,
  minCitations,
  maxCitations,
  citeLo,
  citeHi,
  onCiteLo,
  onCiteHi,
  visibleCount,
  totalCount,
  selectedCount,
  litCount,
  onClearAll,
  pinnedCount,
  onReleaseAll,
  onFit,
  onRefresh,
  refreshing,
  providerNote,
  linksOn = false,
  onLinks,
  linksBusy = false,
  linksStatus = 'off',
  linksCount = 0,
  stagedOpen,
}: GraphControlsProps) {
  // The interconnected-links button names what's on screen once the graph has
  // settled: while it's busy (loading, then reheating), it keeps the label it
  // had, with a spinner beside it, and only then turns from Show to Hide (or
  // back). Flipping at the click claimed links that weren't drawn yet.
  const linksFailed = linksOn && linksStatus === 'error'
  const linksShown = linksOn && !linksFailed && linksCount > 0
  const [settledShown, setSettledShown] = useState(linksShown)
  useEffect(() => {
    if (!linksBusy) setSettledShown(linksShown)
  }, [linksBusy, linksShown])
  const linksLabelShown = linksBusy ? settledShown : linksShown

  // Collapsed to the slim header bar? Local, like the find control's own
  // open/closed — nothing else needs to know.
  //
  // Starts COLLAPSED: a graph should open onto the graph, not onto its
  // chrome, and the reader who wants to declutter opens the panel by its
  // header. Only the initial value — re-seeding while the explorer is up
  // leaves the panel however the reader left it, because that expansion was
  // a choice and a re-seed isn't a reason to undo it.
  const [collapsed, setCollapsed] = useState(true)
  // The tour staging 'controls' expands a collapsed panel so its stops have
  // something to spotlight. It never re-collapses on the way out — the same
  // no-tidy-up call as the detail panel's staged seed selection.
  useEffect(() => {
    if (stagedOpen) setCollapsed(false)
  }, [stagedOpen])

  // The year slider only makes sense when the graph spans more than one year.
  const showYears = maxYear > minYear
  const yearSpan = maxYear - minYear
  /**
   * Position of a year along the range track, for the fill + knobs.
   *
   * @param year The year to place.
   * @returns The position as a 0–100 percentage.
   */
  // Clamped to the track: a saved year window can reach past the graph's
  // current span (an undone expansion took its oldest papers with it), and
  // the range inputs clamp their thumbs, but an unclamped fill ran off the
  // panel's edge into the sidebar.
  const yearPct = (year: number) =>
    yearSpan ? Math.min(100, Math.max(0, ((year - minYear) / yearSpan) * 100)) : 0

  // The citation slider only earns its space when the neighbors span a citation
  // range to bound a window against (a flat/empty range gives nothing to trim).
  const showCitations = maxCitations > minCitations
  // The knob positions are linear (0…STEPS); the counts they read out are the
  // log-mapped thresholds across the graph's min…max. The fill/knobs sit at the
  // raw position percentage.
  const loCitations = citationThreshold(citeLo, minCitations, maxCitations)
  const hiCitations = citationThreshold(citeHi, minCitations, maxCitations)
  const citePct = (position: number) => (position / CITE_SLIDER_STEPS) * 100

  // The panel never shrinks into a bar any more: collapsing fades it out
  // toward its corner and a round sliders button pops in where it was (the
  // find bar's 🔍 pattern). It stays mounted behind `hidden` once the fade
  // has played (ui/usePresence), so the tour's existence checks still see
  // the year and citation stops on a collapsed panel. Collapsing used to
  // switch the panel to `width: auto` while its body was still folding, and
  // for a few frames auto meant the widest unwrapped row — the panel
  // ballooned before it closed. No width ever changes now.
  const panel = usePresence(!collapsed)
  // The Surveys chip, beside the relation chips in either layout. It looks
  // like one and toggles like one, but it marks rather than filters: on, the
  // surveys are ringed orange; off, they look like any paper. Never hidden,
  // so it never heads a count slider.
  const surveyChip = onToggleSurveys && (
    <button
      key="survey"
      className={`rel-toggle ${surveyRings ? 'on' : ''}`}
      onClick={onToggleSurveys}
      style={{ '--c': SURVEY_COLOR } as CSSProperties}
      title={
        surveyRings
          ? 'Stop ringing the surveys and reviews'
          : 'Ring the surveys and reviews in orange: the field’s own overviews of a period'
      }
    >
      <i />
      Surveys
    </button>
  )

  // The readout string for the panel's footer: a hand-pick wins over the
  // plain filter count. No denominator on the pick
  // since v7.24.0 — the selection outranks the filters (`scope/README.md`),
  // so it is not "out of the shown papers": a selected paper the filters
  // hide is still in scope, still drawn, and would make "5 / 3" a lie.
  const countReadout =
    selectedCount > 0
      ? `${selectedCount} paper${selectedCount === 1 ? '' : 's'} selected`
      : `${visibleCount} / ${totalCount} papers shown`

  return (
    <>
      {collapsed && !panel.present && (
        <button
          type="button"
          className="ctrl-icon"
          // The tour's first stop: only ever on the control that's visible.
          data-tour="controls-head"
          aria-expanded={false}
          onClick={() => setCollapsed(false)}
          title="Open the graph controls — layout, filters, and the map’s actions"
          aria-label="Open the graph controls"
        >
          <SlidersGlyph />
        </button>
      )}
      <div
        className={`controls${panel.closing ? ' closing' : ''}`}
        hidden={!panel.present}
        onAnimationEnd={panel.onAnimationEnd}
      >
        <button
          className="ctrl-head"
          data-tour={panel.present ? 'controls-head' : undefined}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(true)}
          title="Fold the controls away into the sliders button and free up the canvas"
        >
          <span>Graph controls</span>
          <span className="ctrl-head-caret" aria-hidden="true">
            ▴
          </span>
        </button>

        <div className="ctrl-body">
          <div className="layout-toggle" data-tour="layout">
            <button className={layout === 'force' ? 'on' : ''} onClick={() => onLayout('force')}>
              Force
            </button>
            <button
              className={layout === 'timeline' ? 'on' : ''}
              onClick={() => onLayout('timeline')}
            >
              Timeline
            </button>
          </div>
          {/* Two layouts, one control. With automatic sizing on it's the plain
            wrapping pill row it has always been. With it off, each chip becomes
            the label atop its own count slider — the chip is still the on/off
            toggle (highlighted while on), it just now heads a slider that trims
            how many of that relation show. */}
          {showRelCaps ? (
            <div className="rel-caps" data-tour="relations">
              {CHIP_TYPES.map((type) => {
                const on = enabled.has(type)
                const total = relTotals[type] ?? 0
                // A slider only under a chip that's on and has more than one paper
                // to trim; otherwise the chip stands alone (still a toggle).
                const showSlider = on && total > 1
                const cap = relCaps[type] ?? total
                return (
                  <div
                    key={type}
                    className="rel-cap-group"
                    style={{ '--c': REL_COLOR[type] } as CSSProperties}
                  >
                    <div className="rel-cap-head">
                      <button
                        className={`rel-toggle ${on ? 'on' : ''}`}
                        onClick={() => onToggleType(type)}
                        title={on ? `Hide ${REL_LABEL[type]}` : `Show ${REL_LABEL[type]}`}
                      >
                        <i />
                        {REL_LABEL[type]}
                      </button>
                      {showSlider && (
                        <span className="rel-cap-count">
                          {cap}/{total}
                        </span>
                      )}
                    </div>
                    {showSlider && (
                      <input
                        className="rel-cap-slider"
                        type="range"
                        min={1}
                        max={total}
                        value={cap}
                        // The filled portion up to the thumb, as a CSS var the
                        // track gradient reads — the single-knob analog of the
                        // range sliders' `.range-fill`.
                        style={{ '--fill': `${(cap / total) * 100}%` } as CSSProperties}
                        onChange={(event) => onRelCap?.(type, Number(event.target.value))}
                        title={`Show the ${cap} most-cited of ${total} ${REL_LABEL[type]}`}
                        aria-label={`${REL_LABEL[type]} shown`}
                      />
                    )}
                  </div>
                )
              })}
              {surveyChip && (
                <div className="rel-cap-group" style={{ '--c': SURVEY_COLOR } as CSSProperties}>
                  <div className="rel-cap-head">{surveyChip}</div>
                </div>
              )}
            </div>
          ) : (
            <div className="ctrl-rels" data-tour="relations">
              {CHIP_TYPES.map((type) => {
                const on = enabled.has(type)
                return (
                  <button
                    key={type}
                    className={`rel-toggle ${on ? 'on' : ''}`}
                    onClick={() => onToggleType(type)}
                    style={{ '--c': REL_COLOR[type] } as CSSProperties}
                    title={on ? `Hide ${REL_LABEL[type]}` : `Show ${REL_LABEL[type]}`}
                  >
                    <i />
                    {REL_LABEL[type]}
                  </button>
                )
              })}
              {surveyChip}
            </div>
          )}

          {onLinks && (
            <div className="ctrl-links" data-tour="links">
              <button
                type="button"
                className="ctrl-links-btn btn-marked"
                aria-label={
                  linksLabelShown ? 'Hide interconnected links' : 'Show interconnected links'
                }
                disabled={linksBusy}
                aria-busy={linksBusy}
                aria-pressed={linksLabelShown}
                onClick={() => onLinks(linksFailed ? true : !linksOn)}
                title={
                  linksLabelShown
                    ? 'Hide the citations among the papers on the graph'
                    : 'Link up the papers on the graph by their citations, not just to the seed, the way Connected Papers does'
                }
              >
                {linksBusy ? (
                  // Busy: the spinner alone, where the label was.
                  <span className="btn-label" aria-hidden="true">
                    <span className="spin" />
                  </span>
                ) : (
                  <>
                    <span className="btn-mark" aria-hidden="true">
                      <MarkIcon kind={linksLabelShown ? 'minus' : 'plus'} />
                    </span>
                    <span className="btn-label">
                      {linksLabelShown ? 'Hide interconnected links' : 'Show interconnected links'}
                    </span>
                  </>
                )}
              </button>
              {(linksBusy || linksFailed || linksShown) && (
                <div className={`ctrl-links-status${linksFailed ? ' error' : ''}`} role="status">
                  {linksFailed
                    ? 'Couldn’t load the links. Click to try again.'
                    : linksBusy
                      ? 'Linking up the papers…'
                      : `${linksCount} links between papers`}
                </div>
              )}
            </div>
          )}

          {showYears && (
            <div className="years" data-tour="years">
              <div className="years-label">
                Years <b>{yearLo}</b> – <b>{yearHi}</b>
              </div>
              <div className="range-dual">
                <div className="range-track" />
                <div
                  className="range-fill"
                  style={{
                    left: `${yearPct(yearLo)}%`,
                    width: `${yearPct(yearHi) - yearPct(yearLo)}%`,
                  }}
                />
                <input
                  type="range"
                  min={minYear}
                  max={maxYear}
                  value={yearLo}
                  aria-label="Earliest year"
                  onChange={(event) => onYearLo(Math.min(Number(event.target.value), yearHi))}
                />
                <input
                  type="range"
                  min={minYear}
                  max={maxYear}
                  value={yearHi}
                  aria-label="Latest year"
                  onChange={(event) => onYearHi(Math.max(Number(event.target.value), yearLo))}
                />
              </div>
            </div>
          )}

          {showCitations && (
            <div className="cites" data-tour="citations">
              <div className="cites-label">
                Citations <b>{loCitations.toLocaleString()}</b> –{' '}
                <b>{hiCitations.toLocaleString()}</b>
              </div>
              <div className="range-dual">
                <div className="range-track" />
                <div
                  className="range-fill"
                  style={{
                    left: `${citePct(citeLo)}%`,
                    width: `${citePct(citeHi) - citePct(citeLo)}%`,
                  }}
                />
                <input
                  type="range"
                  min={0}
                  max={CITE_SLIDER_STEPS}
                  value={citeLo}
                  aria-label="Fewest citations"
                  onChange={(event) => onCiteLo(Math.min(Number(event.target.value), citeHi))}
                />
                <input
                  type="range"
                  min={0}
                  max={CITE_SLIDER_STEPS}
                  value={citeHi}
                  aria-label="Most citations"
                  onChange={(event) => onCiteHi(Math.max(Number(event.target.value), citeLo))}
                />
              </div>
            </div>
          )}

          <div className="ctrl-foot">
            <span className="count-readout">{countReadout}</span>
            <div className="ctrl-btns" data-tour="actions">
              <button
                className="mini-btn"
                onClick={onReleaseAll}
                title="Unpin every node and re-settle the layout"
              >
                Release {pinnedCount || ''}
              </button>
              <button className="mini-btn" onClick={onFit} title="Re-center the graph">
                Fit
              </button>
              <button
                className="mini-btn"
                onClick={onRefresh}
                disabled={refreshing}
                title="Bust this paper's cached snapshot and re-fetch from Semantic Scholar"
              >
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
              <button
                className="mini-btn"
                onClick={onClearAll}
                disabled={selectedCount === 0 && litCount === 0}
                title="Clear every highlight and hand-picked selection (Esc does the same)"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="ctrl-select" data-tour="selector">
            <span
              className="select-hint"
              title="Hand-pick papers to scope Nova's lectures and answers to them"
            >
              ⌥ alt-drag to add papers to Nova's scope · ⇧ shift-click one · esc clears all
              highlights
            </span>
          </div>

          <div className="ctrl-hint" data-tour="hint">
            {layout === 'timeline'
              ? 'papers placed left→right by year · click to focus, again to let go · double-click to explore'
              : 'drag to pin · click to focus, again to let go · double-click to explore'}
          </div>

          {providerNote && <div className="provider-note">ⓘ {providerNote}</div>}
        </div>
      </div>
    </>
  )
}
