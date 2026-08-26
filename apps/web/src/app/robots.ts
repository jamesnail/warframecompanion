import type { MetadataRoute } from 'next'

import { site } from '@/config/site'

/**
 * robots.txt.
 *
 * Everything is allowed: the whole site is public, static and safe to index, which is the
 * stated goal. The one exclusion is /data/, which holds the multi-megabyte JSON chunks the
 * client fetches. They are content-addressed build output, not pages — crawling them wastes
 * a budget better spent on the 6,500 item and source pages, and they would rank for nothing.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: '/data/' }],
    sitemap: `${site.url}/sitemap.xml`,
  }
}
