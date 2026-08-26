# Assets

`provenance_logo.png` — the source logo. 1408×768, 95.5% transparent; the artwork itself
occupies x 455–952, y 88–673 and is dark slate (rgb 48, 64, 64) on transparency.

The site icons under `apps/web/src/app/` are derived from it and committed:

| File | Size | Content |
|---|---|---|
| `icon.png` | 512×512 | Monogram only. At 16px the wordmark is an unreadable smudge. |
| `apple-icon.png` | 180×180 | Monogram only. |
| `opengraph-image.png` | 1200×630 | The full lockup, which reads at this size. |

Regenerate after changing the logo:

```
node scripts/build-icons.mjs \
  "$(ls -d node_modules/.pnpm/sharp@*/node_modules/sharp | head -1)" \
  assets/provenance_logo.png \
  apps/web/src/app
```

All three sit on a light plate. The artwork is dark on transparency, so left as-is it would
be invisible against this site's near-black background — see the note in DESIGN.md § 8.
