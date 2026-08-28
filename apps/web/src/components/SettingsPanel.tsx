'use client'

import {
  MAX_MASTERY_RANK,
  THEMES,
  isDefaultSettings,
  type Density,
  type Motion,
} from '@provenance/core'

import { Panel, PanelHeader } from '@/components/Primitives'
import { useSettings } from '@/lib/client/use-settings'

/**
 * Every preference in the app, on one page.
 *
 * A page rather than a popover: there are enough controls here that a menu would scroll, and
 * a page is a URL you can send someone — "turn on high contrast" is a link. It is prerendered
 * like everything else; only the values come from IndexedDB, inside this client island.
 *
 * Nothing here filters anything. Filter state lives in the URL and only in the URL (CLAUDE.md
 * constraint 5), so a preference that quietly narrowed a table would be a filter nobody could
 * see, share or clear. These change what is SHOWN around the data, never which rows there are.
 */
export function SettingsPanel() {
  const { settings, ready, set, reset } = useSettings()

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader title="Appearance" />
        <div className="space-y-6 px-3 py-4 sm:px-5">
          <Field
            label="Theme"
            hint="Colour only. Rarity colours stay put in every theme — they encode a measurement, not a mood."
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {THEMES.map((theme) => (
                <Choice
                  key={theme.id}
                  name="theme"
                  checked={settings.theme === theme.id}
                  onSelect={() => {
                    set({ theme: theme.id })
                  }}
                  title={theme.name}
                  note={theme.note}
                  swatch={theme.id}
                />
              ))}
            </div>
          </Field>

          <Field label="Density" hint="Compact tightens table rows. It does not shrink the type.">
            <Segmented<Density>
              value={settings.density}
              onChange={(density) => {
                set({ density })
              }}
              options={[
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'compact', label: 'Compact' },
              ]}
            />
          </Field>

          <Field
            label="Motion"
            hint="Follow system respects your device setting. There is no option to force motion on against it."
          >
            <Segmented<Motion>
              value={settings.motion}
              onChange={(motion) => {
                set({ motion })
              }}
              options={[
                { value: 'system', label: 'Follow system' },
                { value: 'reduced', label: 'Reduce motion' },
              ]}
            />
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="What you see" />
        <div className="space-y-6 px-3 py-4 sm:px-5">
          <Toggle
            label="Drops only"
            hint="Hides trading — riven prices, market links, the market column. It never changes a row count; filters live in the URL where you can see them."
            checked={settings.dropsOnly}
            onChange={(dropsOnly) => {
              set({ dropsOnly })
            }}
          />

          <Toggle
            label="New player mode"
            hint="Explains the jargon in place: what refinement does, what vaulted means, how rotations work."
            checked={settings.newPlayer}
            onChange={(newPlayer) => {
              set({ newPlayer })
            }}
          />

          <Field
            label="Mastery rank"
            hint="Items above your rank get marked, never hidden — you can still farm the parts."
          >
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-text-dim">
                <input
                  type="checkbox"
                  checked={settings.masteryRank !== null}
                  onChange={(event) => {
                    set({ masteryRank: event.target.checked ? 0 : null })
                  }}
                  className="size-4 accent-gold"
                />
                Track it
              </label>

              {settings.masteryRank !== null && (
                <label className="flex items-center gap-2 text-sm text-text-dim">
                  <span className="sr-only">Your mastery rank</span>
                  <input
                    type="number"
                    min={0}
                    max={MAX_MASTERY_RANK}
                    value={settings.masteryRank}
                    onChange={(event) => {
                      const next = Number(event.target.value)
                      if (!Number.isFinite(next)) return
                      set({
                        masteryRank: Math.min(MAX_MASTERY_RANK, Math.max(0, Math.round(next))),
                      })
                    }}
                    className="chamfer-sm data-num w-20 border border-hairline bg-void-900 px-2 py-1.5 text-base text-text outline-none focus:border-gold sm:text-sm"
                  />
                </label>
              )}
            </div>
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Where this lives" />
        <div className="space-y-3 px-3 py-4 text-sm text-text-dim sm:px-5">
          <p>
            In this browser, and nowhere else. There is no account and no server — these
            settings are stored alongside your collection and travel with it in the same export
            file. Clearing site data clears them.
          </p>
          <p className="text-text-faint">
            Back them up from <a className="text-gold-dim underline underline-offset-4 transition-colors hover:text-gold" href="/collection">Collection</a>.
          </p>
          {!isDefaultSettings(settings) && ready && (
            <button
              type="button"
              onClick={reset}
              className="chamfer-sm border border-hairline px-3 py-1.5 text-sm text-text-dim transition-colors hover:border-gold-dim hover:text-text"
            >
              Reset to defaults
            </button>
          )}
        </div>
      </Panel>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      {hint !== undefined && <p className="mt-1 max-w-prose text-xs text-text-faint">{hint}</p>}
      <div className="mt-2.5">{children}</div>
    </fieldset>
  )
}

/**
 * A theme option, previewing itself.
 *
 * The swatch is rendered inside a `data-theme` scope, so each option is painted with its own
 * tokens — the preview cannot drift from the theme because it IS the theme.
 */
function Choice({
  name,
  checked,
  onSelect,
  title,
  note,
  swatch,
}: {
  name: string
  checked: boolean
  onSelect: () => void
  title: string
  note: string
  swatch: string
}) {
  return (
    <label
      className={`chamfer-sm flex cursor-pointer items-start gap-3 border p-3 transition-colors ${
        checked ? 'border-gold bg-void-700' : 'border-hairline hover:border-hairline-strong'
      }`}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="mt-0.5 size-4 shrink-0 accent-gold"
      />
      <span className="min-w-0 flex-1">
        <span className={`block text-sm ${checked ? 'text-gold' : 'text-text'}`}>{title}</span>
        <span className="mt-0.5 block text-xs text-text-faint">{note}</span>
      </span>
      <span data-theme={swatch} className="flex shrink-0 gap-1" aria-hidden="true">
        <span className="size-4 border border-hairline bg-void-900" />
        <span className="size-4 border border-hairline bg-void-700" />
        <span className="size-4 bg-gold" />
      </span>
    </label>
  )
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (next: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const on = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => {
              onChange(option.value)
            }}
            className={`chamfer-sm border px-3 py-1.5 text-sm transition-colors ${
              on
                ? 'border-gold bg-void-700 text-gold'
                : 'border-hairline text-text-dim hover:border-hairline-strong hover:text-text'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked)
        }}
        className="mt-0.5 size-4 shrink-0 accent-gold"
      />
      <span className="min-w-0">
        <span className="block text-sm text-text">{label}</span>
        <span className="mt-0.5 block max-w-prose text-xs text-text-faint">{hint}</span>
      </span>
    </label>
  )
}
