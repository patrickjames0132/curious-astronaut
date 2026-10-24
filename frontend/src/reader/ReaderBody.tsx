/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Render the Reader's parsed document: blocks (paragraphs, equations,
 * figures, tables, lists) and the inline runs inside them. Citations, figure
 * and equation refs, and footnotes are live: a ref jumps within the page, a
 * citation opens the cited paper's card (`CitationCard`, v8.43.0), and a
 * footnote opens in place.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useContext, useState, type ReactNode } from 'react'
import type { ReaderBlock, ReaderCell, ReaderInline } from '../api'
import { TeX } from '../notation/MathText'
import { ReaderLinksContext, mathTextOf, readerDomId } from './links'

/**
 * A footnote: its mark, which opens the note's text in place.
 *
 * @param props Component props.
 * @param props.mark The footnote's number.
 * @param props.inlines The note's runs.
 * @returns The mark, and the note when open.
 */
function Note({ mark, inlines }: { mark: string; inlines: ReaderInline[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className={`reader-note-mark${open ? ' open' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        title={open ? 'Hide this footnote' : 'Show this footnote'}
      >
        {mark || '*'}
      </button>
      {open && (
        <span className="reader-note">
          <Inlines inlines={inlines} />
        </span>
      )}
    </>
  )
}

/**
 * One run.
 *
 * @param props Component props.
 * @param props.run The run.
 * @returns Its rendering.
 */
function Inline({ run }: { run: ReaderInline }) {
  const { cite, jump } = useContext(ReaderLinksContext)
  switch (run.kind) {
    case 'text':
      if (run.style === 'italic') return <em>{run.text}</em>
      if (run.style === 'bold') return <strong>{run.text}</strong>
      if (run.style === 'code') return <code>{run.text}</code>
      if (run.style === 'sup') return <sup>{run.text}</sup>
      if (run.style === 'sub') return <sub>{run.text}</sub>
      return <>{run.text}</>
    case 'math':
      return <TeX latex={run.latex} display={run.display} />
    case 'cite':
      // Hover previews the cited paper's card, a click pins it (v8.43.0);
      // going to the reference list is one of the card's buttons.
      return (
        <a
          className="reader-cite"
          href={`#${readerDomId(run.bib)}`}
          aria-haspopup="dialog"
          aria-expanded={cite.open === run.bib}
          onPointerEnter={(event) => cite.hover(run.bib, event.currentTarget)}
          onPointerLeave={() => cite.leave()}
          onClick={(event) => {
            event.preventDefault()
            cite.pin(run.bib, event.currentTarget)
          }}
        >
          {run.text}
        </a>
      )
    case 'ref':
      return (
        <a
          className="reader-ref"
          href={`#${readerDomId(run.target)}`}
          onClick={(event) => {
            event.preventDefault()
            jump(run.target)
          }}
        >
          {run.text}
        </a>
      )
    case 'link':
      return (
        <a className="reader-link" href={run.href} target="_blank" rel="noreferrer noopener">
          {run.text}
        </a>
      )
    case 'note':
      return <Note mark={run.mark} inlines={run.inlines} />
  }
}

/**
 * A run list.
 *
 * @param props Component props.
 * @param props.inlines The runs.
 * @returns Their renderings, in order.
 */
export function Inlines({ inlines }: { inlines: ReaderInline[] }) {
  return (
    <>
      {inlines.map((run, index) => (
        <Inline key={index} run={run} />
      ))}
    </>
  )
}

/**
 * A table's rows.
 *
 * @param props Component props.
 * @param props.rows The rows.
 * @returns The table, scrolling sideways on its own when wider than the page.
 */
function Table({ rows }: { rows: ReaderCell[][] }) {
  return (
    <div className="reader-table-scroll">
      <table className="reader-table">
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => {
                const content = <Inlines inlines={cell.inlines} />
                return cell.header ? (
                  <th key={cellIndex} colSpan={cell.colspan}>
                    {content}
                  </th>
                ) : (
                  <td key={cellIndex} colSpan={cell.colspan}>
                    {content}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * A figure's panels, each opening in the lightbox with the figure's caption.
 *
 * @param props Component props.
 * @param props.block The figure.
 * @returns The panels.
 */
function FigurePanels({ block }: { block: Extract<ReaderBlock, { kind: 'figure' }> }) {
  const { enlarge } = useContext(ReaderLinksContext)
  return (
    <div className="reader-figure-panels">
      {block.images.map((image, index) => (
        <button
          key={index}
          type="button"
          className="reader-figure-panel"
          title="Enlarge"
          onClick={() =>
            enlarge({
              image: image.src,
              caption: mathTextOf(block.caption),
              title: null,
              label: block.tag || null,
            })
          }
        >
          <img
            src={image.src}
            alt={image.alt && image.alt !== 'Refer to caption' ? image.alt : block.tag}
            width={image.width ?? undefined}
            height={image.height ?? undefined}
            loading="lazy"
          />
        </button>
      ))}
    </div>
  )
}

/**
 * One block.
 *
 * @param props Component props.
 * @param props.block The block.
 * @returns Its rendering.
 */
function Block({ block }: { block: ReaderBlock }): ReactNode {
  switch (block.kind) {
    case 'paragraph':
      return (
        <p className="reader-paragraph">
          <Inlines inlines={block.inlines} />
        </p>
      )
    case 'heading':
      return (
        <p className="reader-inline-heading">
          <Inlines inlines={block.inlines} />
        </p>
      )
    case 'equation':
      return (
        <div className="reader-equation" id={block.id ? readerDomId(block.id) : undefined}>
          <div className="reader-equation-body">
            <TeX latex={block.latex} display />
          </div>
          {block.tag && <span className="reader-equation-tag">{block.tag}</span>}
        </div>
      )
    case 'table':
      return (
        <div id={block.id ? readerDomId(block.id) : undefined}>
          <Table rows={block.rows} />
        </div>
      )
    case 'list': {
      const items = block.items.map((item, index) => (
        <li key={index}>
          <Blocks blocks={item} />
        </li>
      ))
      return block.ordered ? (
        <ol className="reader-list">{items}</ol>
      ) : (
        <ul className="reader-list">{items}</ul>
      )
    }
    case 'listing':
      return (
        <div className="reader-listing" id={block.id ? readerDomId(block.id) : undefined}>
          {block.lines.map((line, index) => (
            <div key={index} className="reader-listing-line">
              <span className="reader-listing-number">{line.number}</span>
              <span style={{ paddingLeft: `${line.indent}em` }}>
                <Inlines inlines={line.inlines} />
              </span>
            </div>
          ))}
        </div>
      )
    case 'figure':
      return (
        <figure className="reader-figure" id={block.id ? readerDomId(block.id) : undefined}>
          {block.images.length > 0 && <FigurePanels block={block} />}
          {block.rows && <Table rows={block.rows} />}
          {block.blocks && <Blocks blocks={block.blocks} />}
          {(block.tag || block.caption.length > 0) && (
            <figcaption>
              {block.tag && <span className="reader-figure-tag">{block.tag}.</span>}{' '}
              <Inlines inlines={block.caption} />
            </figcaption>
          )}
        </figure>
      )
  }
}

/**
 * A list of blocks.
 *
 * @param props Component props.
 * @param props.blocks The blocks.
 * @returns Their renderings, in order.
 */
export function Blocks({ blocks }: { blocks: ReaderBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </>
  )
}
