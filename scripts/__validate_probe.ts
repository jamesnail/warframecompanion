import { readFileSync } from 'node:fs'
import { Item, Source, DropEdge, RelicDetail, Manifest } from '@provenance/core'
import { z } from 'zod'

const D = 'apps/web/public/data/'
const m = JSON.parse(readFileSync(D + 'manifest.json', 'utf8'))
console.log('Manifest parse:', Manifest.safeParse(m).success, JSON.stringify(Manifest.safeParse(m).error?.issues?.slice(0,3)))

const load = (n: string) => JSON.parse(readFileSync(D + m.files[n], 'utf8'))
const check = (name: string, schema: z.ZodTypeAny, arr: unknown[]) => {
  const r = z.array(schema).safeParse(arr)
  if (r.success) { console.log(name, 'OK', arr.length); return }
  const issues = r.error.issues
  console.log(name, 'FAIL', issues.length, 'issues; first 5:')
  for (const i of issues.slice(0, 5)) console.log('   ', i.path.join('.'), i.code, i.message)
  const paths = new Map<string, number>()
  for (const i of issues) { const k = i.path.filter(p => typeof p !== 'number').join('.') + ':' + i.code; paths.set(k, (paths.get(k) ?? 0) + 1) }
  console.log('   grouped:', [...paths.entries()].slice(0, 12))
}
check('items', Item, load('items'))
check('sources', Source, load('sources'))
check('edges', DropEdge, load('edges'))
check('relics', RelicDetail, load('relics'))
