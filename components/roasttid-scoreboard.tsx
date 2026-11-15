'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, Braces, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

type Side = 'human' | 'ai'

type RoastTidProbabilities = number[] | Record<string, number>

type RoastTidBrutality = {
  type: 'score'
  score: number
  probabilities: RoastTidProbabilities
  confidence?: number | null
}

type RoastTidTeam = {
  type: 'choice'
  choice: 'THE_HUMAN' | 'THE_AI'
  probabilities: Record<'THE_HUMAN' | 'THE_AI', number>
}

export type RoastTidEvent = {
  roast_id: string
  roast_event: string
  speaker: 'THE_HUMAN' | 'THE_AI'
  transcript: string
  timestamp?: string
  answers: {
    team: RoastTidTeam
    brutality: RoastTidBrutality
  }
}

type ScoreTransaction = {
  eventId: string
  timestamp: string
  opponent: Side
  score: number
  confidence?: number | null
  transcripts: string
  probabilities: number[]
  source: RoastTidEvent
}

type ScoreboardProps = {
  transactions?: RoastTidEvent[] | RoastTidEvent | null
}

type ScoreColumn = {
  key: keyof ScoreTransaction
  label: string
  className?: string
}

type ColumnResize = {
  index: number
  startX: number
  tableWidth: number
  startWidths: number[]
}

const minColumnWidth = 8

const scoreColumns: ScoreColumn[] = [
  { key: 'eventId', label: 'Event ID', className: 'event-id' },
  { key: 'opponent', label: 'Opponent' },
  { key: 'score', label: 'Score', className: 'score-cell' },
  { key: 'confidence', label: 'Confidence' },
  { key: 'transcripts', label: 'Transcripts', className: 'transcript-cell' },
  { key: 'timestamp', label: 'Timestamp' },
]

const humanColor = '#b7ff36'
const aiColor = '#a78bfa'
const normalizeSide = (side: ScoreTransaction['opponent']): Side => side
const displaySide = (side: Side) => side === 'human' ? 'The Human' : 'The AI'
const probabilityValues = (values: RoastTidProbabilities) => {
  const orderedValues = Array.isArray(values)
    ? values
    : Array.from({ length: 6 }, (_, index) => values[String(index)] ?? 0)
  return Array.from({ length: 6 }, (_, index) => Math.min(Math.max(Number(orderedValues[index]) || 0, 0), 1))
}
const normalizeEvent = (event: RoastTidEvent): ScoreTransaction => ({
  eventId: event.roast_event,
  timestamp: event.timestamp ?? new Date().toISOString(),
  opponent: event.speaker === 'THE_HUMAN' ? 'human' : 'ai',
  score: event.answers.brutality.score,
  confidence: event.answers.brutality.confidence ?? null,
  transcripts: event.transcript,
  probabilities: probabilityValues(event.answers.brutality.probabilities),
  source: event,
})
const formatScore = (score: number) => score === 0 ? '0.00' : (Math.round(score * 10000) / 10000).toFixed(4).replace(/\.?0+$/, '')
const dateLabel = (value: string) => {
  if (/^\d{2}:\d{2}:\d{2}$/.test(value)) return value
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`
}

const detailLabel = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())
const detailValue = (value: unknown) => {
  if (value == null || value === '') return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value, null, 2)
}

function downloadFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function csvValue(value: unknown) {
  const text = value == null ? '' : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

export function RoasTTidScoreboard({ transactions }: ScoreboardProps) {
  const incomingEvents = useMemo(
    () => transactions == null ? [] : Array.isArray(transactions) ? transactions : [transactions],
    [transactions],
  )
  const [shareMessage, setShareMessage] = useState('')
  const [rows, setRows] = useState<ScoreTransaction[]>([])
  const [selectedTransaction, setSelectedTransaction] = useState<ScoreTransaction | null>(null)
  const [columnWidths, setColumnWidths] = useState(() => scoreColumns.map(() => 100 / scoreColumns.length))
  const lastInputRows = useRef<RoastTidEvent[]>([])
  const columnResize = useRef<ColumnResize | null>(null)

  const resizeColumnPair = (index: number, delta: number) => {
    setColumnWidths((current) => {
      const pairWidth = current[index] + current[index + 1]
      const leftWidth = Math.min(Math.max(current[index] + delta, minColumnWidth), pairWidth - minColumnWidth)
      const next = [...current]
      next[index] = leftWidth
      next[index + 1] = pairWidth - leftWidth
      return next
    })
  }

  const handleResizeStart = (event: React.PointerEvent<HTMLSpanElement>, index: number) => {
    event.preventDefault()
    const tableWidth = event.currentTarget.closest('table')?.getBoundingClientRect().width ?? 0
    if (!tableWidth) return
    columnResize.current = { index, startX: event.clientX, tableWidth, startWidths: columnWidths }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleResizeMove = (event: React.PointerEvent<HTMLSpanElement>) => {
    const resize = columnResize.current
    if (!resize) return
    const delta = (event.clientX - resize.startX) / resize.tableWidth * 100
    const pairWidth = resize.startWidths[resize.index] + resize.startWidths[resize.index + 1]
    const leftWidth = Math.min(Math.max(resize.startWidths[resize.index] + delta, minColumnWidth), pairWidth - minColumnWidth)
    setColumnWidths((current) => {
      const next = [...current]
      next[resize.index] = leftWidth
      next[resize.index + 1] = pairWidth - leftWidth
      return next
    })
  }

  const handleResizeKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>, index: number) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    resizeColumnPair(index, event.key === 'ArrowLeft' ? -1 : 1)
  }

  useEffect(() => {
    const unseenEvents = incomingEvents.filter((transaction) =>
      !lastInputRows.current.some((previous) => previous.roast_event === transaction.roast_event),
    )
    lastInputRows.current = incomingEvents
    if (unseenEvents.length === 0) return
    setRows((currentRows) => {
      const currentIds = new Set(currentRows.map((row) => row.eventId))
      const newRows = unseenEvents.map(normalizeEvent).filter((row) => !currentIds.has(row.eventId))
      return [...currentRows, ...newRows]
    })
  }, [incomingEvents])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data
      if (
        !data ||
        typeof data !== 'object' ||
        typeof data.roast_event !== 'string' ||
        !data.answers?.brutality
      ) {
        return
      }

      const incoming = normalizeEvent(data as RoastTidEvent)
      setRows((currentRows) => {
        if (currentRows.some((row) => row.eventId === incoming.eventId)) {
          return currentRows
        }
        return [...currentRows, incoming]
      })
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  const totals = useMemo(() => (['human', 'ai'] as const).map((side) => {
    const sideRows = rows.filter((row) => normalizeSide(row.opponent) === side)
    const scoreUnits = sideRows.reduce((sum, row) => sum + Math.round((Number(row.score) || 0) * 10000), 0)
    return { side, count: sideRows.length, score: scoreUnits / 10000 }
  }), [rows])
  const probabilities = useMemo(() => {
    const latest: Record<Side, number[]> = { human: [0, 0, 0, 0, 0, 0], ai: [0, 0, 0, 0, 0, 0] }
    rows.forEach((row) => { latest[row.opponent] = probabilityValues(row.probabilities) })
    return latest
  }, [rows])

  const downloadCsv = () => {
    const headers = ['Event ID', 'Timestamp', 'Opponent', 'Score', 'Confidence', 'Transcripts']
    const body = rows.map((row) => [row.eventId, row.timestamp, displaySide(normalizeSide(row.opponent)), row.score, row.confidence, row.transcripts].map(csvValue).join(','))
    downloadFile('roasttid-scoreboard.csv', [headers.map(csvValue).join(','), ...body].join('\r\n'), 'text/csv;charset=utf-8')
  }
  const downloadJson = () => downloadFile('roasttid-scoreboard.json', JSON.stringify(rows.map((row) => row.source), null, 2), 'application/json')
  const shareScore = async () => {
    const text = 'Yo Check Out My Score On RoasTTid.com'
    try {
      if (navigator.share) await navigator.share({ title: 'RoasTTid Scoreboard', text, url: 'https://roasttid.com' })
      else if (navigator.clipboard) {
        await navigator.clipboard.writeText(`${text} https://roasttid.com`)
        setShareMessage('Score link copied')
      } else setShareMessage('Sharing is not available on this device')
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') setShareMessage('Unable to share right now')
    }
  }

  return (
    <section className="scoreboard-shell" aria-label="RoasTTid live scoreboard">
      <header className="scoreboard-header">
        <div>
          <h2>RoasTTid Scoreboard</h2>
          <p className="scoreboard-subtitle">Every Shit Talking, Scored LIVE!</p>
        </div>
        <div className="scoreboard-actions">
          <Button variant="outline" className="scoreboard-button" onClick={downloadCsv}><ArrowDownToLine /> Download CSV</Button>
          <Button variant="outline" className="scoreboard-button" onClick={downloadJson}><Braces /> Download JSON</Button>
          <Button className="scoreboard-button scoreboard-share" onClick={shareScore}><Share2 /> Share score</Button>
        </div>
      </header>
      {shareMessage && <p role="status" className="scoreboard-status">{shareMessage}</p>}

      <div className="score-cards">
        {totals.map(({ side, score }) => (
          <article className="score-card" key={side} style={{ '--side-color': side === 'human' ? humanColor : aiColor } as React.CSSProperties}>
            <div className="score-card-heading"><span className="side-dot" /><span>{displaySide(side)}</span></div>
            <div className="score-number">{formatScore(score)}<span>pts</span></div>
            <div className="score-card-meta"><span>Total score</span></div>
            <div className="score-track" role="img" aria-label={`${displaySide(side)} total score ${score}`}><span style={{ width: `${Math.max(...totals.map((item) => item.score), 1) ? score / Math.max(...totals.map((item) => item.score), 1) * 100 : 0}%` }} /></div>
          </article>
        ))}
      </div>

      <section className="probability-card" aria-label="Latest score probabilities">
        <div className="probability-heading"><span>PROBABILITIES</span><span>Scored by:  0–5</span></div>
        <div className="probability-sides">
          {(['human', 'ai'] as const).map((side) => {
            const values = probabilities[side]
            return <div className="probability-side" key={side} style={{ '--side-color': side === 'human' ? humanColor : aiColor } as React.CSSProperties}>
              <div className="probability-grid">{values.map((value, index) => <div className="probability-item" key={index}><span className="probability-label">{index}</span><strong>{(value * 100).toFixed(1)}%</strong><span className="probability-track"><span style={{ width: `${Math.min(Math.max(value, 0), 1) * 100}%` }} /></span></div>)}</div>
            </div>
          })}
        </div>
      </section>

      <div className="feed-heading"><h3>Roast Board</h3></div>
      <div className="table-frame">
        <div className="table-scroll" role="region" aria-label="Transaction event feed" tabIndex={0}>
          <table>
            <colgroup>{scoreColumns.map((column, index) => <col key={column.key} style={{ width: `${columnWidths[index]}%` }} />)}</colgroup>
            <thead><tr>{scoreColumns.map((column, index) => <th key={column.key}>
              <div className="table-heading">
                <span>{column.label}</span>
                {index < scoreColumns.length - 1 && <span
                  className="column-resizer"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Resize ${column.label} column`}
                  aria-valuemin={minColumnWidth}
                  aria-valuemax={Math.max(columnWidths[index] + columnWidths[index + 1] - minColumnWidth, minColumnWidth)}
                  aria-valuenow={Math.round(columnWidths[index])}
                  tabIndex={0}
                  onPointerDown={(event) => handleResizeStart(event, index)}
                  onPointerMove={handleResizeMove}
                  onPointerUp={() => { columnResize.current = null }}
                  onPointerCancel={() => { columnResize.current = null }}
                  onKeyDown={(event) => handleResizeKeyDown(event, index)}
                />}
              </div>
            </th>)}</tr></thead>
            <tbody>{rows.map((row, index) => <tr
              className="transaction-row"
              key={`${row.eventId}-${index}`}
              tabIndex={0}
              aria-haspopup="dialog"
              aria-label={`Open details for event ${row.eventId}`}
              onClick={() => setSelectedTransaction(row)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setSelectedTransaction(row)
                }
              }}
            >
              {scoreColumns.map((column) => {
                const value = row[column.key]
                let content: React.ReactNode = detailValue(value)
                if (column.key === 'opponent') {
                  const side = normalizeSide(row.opponent)
                  content = <span className={`opponent-pill ${side}`}>{displaySide(side)}</span>
                } else if (column.key === 'confidence') {
                  content = row.confidence == null ? '—' : `${(Number(row.confidence) * 100).toFixed(1)}%`
                } else if (column.key === 'timestamp') {
                  content = <time dateTime={row.timestamp}>{dateLabel(row.timestamp)}</time>
                }
                return <td className={column.className} key={column.key} title={column.key === 'transcripts' ? row.transcripts : undefined}>{content}</td>
              })}
            </tr>)}</tbody>
          </table>
        </div>
      </div>

      <Dialog open={selectedTransaction !== null} onOpenChange={(open) => { if (!open) setSelectedTransaction(null) }}>
        {selectedTransaction && (
          <DialogContent>
            <div className="transaction-dialog-header">
              <p className="scoreboard-kicker">EVENT DETAILS</p>
              <DialogTitle>{selectedTransaction.eventId || 'Transaction details'}</DialogTitle>
              <DialogDescription>Complete event data and transcript.</DialogDescription>
            </div>
            <dl className="transaction-details">
              {Object.entries(selectedTransaction.source).map(([key, value]) => (
                <div className="transaction-detail" key={key}>
                  <dt>{detailLabel(key)}</dt>
                  <dd className={key.toLowerCase().includes('transcript') || (value !== null && typeof value === 'object') ? 'transaction-detail-long' : undefined}>
                    {key === 'timestamp' ? dateLabel(String(value)) : detailValue(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </DialogContent>
        )}
      </Dialog>
    </section>
  )
}
