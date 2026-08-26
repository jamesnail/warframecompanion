'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'

import { Panel, PanelHeader } from '@/components/Primitives'
import { clearAll, mergeIn, normalizeIds, replaceAll, toExport } from '@/lib/client/collection'
import { useCollection } from '@/lib/client/use-collection'
import { byClosest, progressOf } from '@/lib/collection'

/**
 * The collection: what you own, what it completes, and the export/import that is the entire
 * backup story (CLAUDE.md constraint 1).
 *
 * The sets are passed in from the server as plain data — they are build-time facts. Only the
 * owned ids come from the browser.
 */

export interface SetSummary {
  id: string
  name: string
  category: string
  components: { itemId: string; count: number }[]
  /** Component ids with no live source right now. */
  vaultedComponents: string[]
}

type Notice = { tone: 'ok' | 'bad'; text: string } | undefined

export function CollectionManager({ sets, names }: { sets: SetSummary[]; names: Record<string, string> }) {
  const { owned, ready, toggle } = useCollection()
  const [notice, setNotice] = useState<Notice>(undefined)
  const fileRef = useRef<HTMLInputElement>(null)

  const tracked = sets
    .map((set) => ({ ...set, progress: progressOf(set.components, owned) }))
    .filter((set) => set.progress.owned > 0)
    .sort(byClosest)

  const complete = tracked.filter((set) => set.progress.complete).length
  // Blocked only counts parts you still NEED: a vaulted part already in hand is not a
  // problem, and saying otherwise would nag about something already solved.
  const blockedOf = (set: SetSummary): number =>
    set.vaultedComponents.filter((id) => !owned.has(id)).length

  function download(): void {
    const file = toExport(owned, new Date().toISOString())
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `provenance-collection-${file.exportedAt.slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function importFile(file: File, mode: 'replace' | 'merge'): Promise<void> {
    try {
      const ids = normalizeIds(JSON.parse(await file.text()))
      if (ids.length === 0) {
        setNotice({ tone: 'bad', text: 'That file has no items in it. Nothing was changed.' })
        return
      }
      if (mode === 'replace') await replaceAll(ids)
      else await mergeIn(ids)
      setNotice({
        tone: 'ok',
        text: `${mode === 'replace' ? 'Replaced with' : 'Merged in'} ${ids.length.toLocaleString()} items.`,
      })
    } catch {
      // States what happened and what to do, and does not apologise (CLAUDE.md § Copy).
      setNotice({ tone: 'bad', text: 'That file is not valid JSON. Nothing was changed.' })
    }
  }

  return (
    <>
      <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3">
        <Stat label="Items owned" value={ready ? owned.size.toLocaleString() : '—'} />
        <Stat label="Sets in progress" value={ready ? tracked.length.toLocaleString() : '—'} />
        <Stat label="Sets complete" value={ready ? complete.toLocaleString() : '—'} accent />
      </div>

      <Panel className="mt-8">
        <PanelHeader title="Backup" aside="JSON" />
        <div className="px-3 py-4 sm:px-5">
          <p className="max-w-prose text-sm text-text-dim">
            This collection lives in this browser and nowhere else. There is no account and
            nothing is uploaded. Clearing site data deletes it — export a file to keep it.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={download} disabled={!ready} className={BUTTON}>
              Export
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={!ready}
              className={BUTTON}
            >
              Import
            </button>
            {ready && owned.size > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Clear the whole collection? This cannot be undone.')) {
                    void clearAll()
                    setNotice({ tone: 'ok', text: 'Collection cleared.' })
                  }
                }}
                className={BUTTON}
              >
                Clear
              </button>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            // Visually replaced by the Import button, but still reachable by a screen reader,
            // so it needs a name of its own rather than being announced as "file, button".
            aria-label="Choose a collection file to import"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file === undefined) return
              // Merge, not replace: importing on a device that already has a collection and
              // silently discarding it is the one mistake this feature must not make. A
              // replace is available, but it is the deliberate choice, not the default.
              const mode = window.confirm(
                'Merge this file into the current collection?\n\nOK to merge, Cancel to replace everything.',
              )
                ? 'merge'
                : 'replace'
              void importFile(file, mode)
              event.target.value = ''
            }}
          />

          {notice !== undefined && (
            <p
              role="status"
              className={`mt-3 text-sm ${notice.tone === 'ok' ? 'text-orokin' : 'text-text'}`}
            >
              {notice.text}
            </p>
          )}
        </div>
      </Panel>

      {ready && tracked.length === 0 ? (
        <p className="mt-8 max-w-prose text-sm text-text-dim">
          Nothing tracked yet. Open a set — <Link href="/item/braton-prime" className={LINK}>Braton Prime</Link>{' '}
          for instance — and tick off the parts you already have.
        </p>
      ) : (
        ready && (
          <Panel className="mt-8">
            <PanelHeader
              title="In progress"
              aside={`${tracked.length.toLocaleString()} · closest first`}
            />
            <ul>
              {tracked.map((set) => (
                <li key={set.id} className="border-b border-hairline/50 px-3 py-3 last:border-0 sm:px-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <Link href={`/item/${set.id}`} className={`text-sm ${LINK}`}>
                      {set.name}
                    </Link>
                    <span
                      className={`data-num text-xs ${
                        set.progress.complete ? 'text-orokin' : 'text-text-faint'
                      }`}
                    >
                      {set.progress.owned}/{set.progress.total}
                    </span>
                  </div>
                  {/* A bar, not a chart: it is a typographic object showing one ratio
                      (DESIGN.md § Charts). Hidden from assistive tech because the
                      numbers beside it already say the same thing. */}
                  <div className="mt-2 h-0.5 w-full bg-void-700" aria-hidden="true">
                    <div
                      className={set.progress.complete ? 'h-full bg-orokin' : 'h-full bg-hairline-strong'}
                      style={{ width: `${String(Math.round(set.progress.fraction * 100))}%` }}
                    />
                  </div>
                  {!set.progress.complete && blockedOf(set) > 0 && (
                    <p className="mt-1.5 text-xs text-r-legendary">
                      {blockedOf(set) === 1
                        ? 'One part still needed is vaulted — not farmable until it returns'
                        : `${String(blockedOf(set))} parts still needed are vaulted — not farmable until they return`}
                    </p>
                  )}
                  {!set.progress.complete && (
                    <p className="mt-1.5 text-xs text-text-faint">
                      Needs{' '}
                      {set.progress.missing
                        .slice(0, 3)
                        .map((id) => names[id] ?? id)
                        .join(', ')}
                      {set.progress.missing.length > 3 &&
                        ` and ${String(set.progress.missing.length - 3)} more`}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {set.components.map((component) => {
                      const have = owned.has(component.itemId)
                      return (
                        <button
                          key={component.itemId}
                          type="button"
                          aria-pressed={have}
                          onClick={() => {
                            toggle(component.itemId, !have)
                          }}
                          className={`chamfer-sm border px-2 py-0.5 text-xs transition-colors ${
                            have
                              ? 'border-orokin bg-void-700 text-orokin'
                              : 'border-hairline text-text-faint hover:border-hairline-strong hover:text-text'
                          }`}
                        >
                          {names[component.itemId] ?? component.itemId}
                        </button>
                      )
                    })}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )
      )}
    </>
  )
}

const BUTTON =
  'chamfer-sm border border-hairline px-3 py-1.5 text-sm text-text-dim transition-colors hover:border-hairline-strong hover:text-text disabled:opacity-40'
const LINK = 'text-text transition-colors hover:text-orokin'

/** Local copy rather than the shared Stat: this one shows an em dash before hydration, and
 *  the shared component takes a plain string value. */
function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="mt-1">
        <span className={`data-num text-lg ${accent ? 'text-orokin' : 'text-text'}`}>{value}</span>
      </div>
    </div>
  )
}
