import api from '#/lib/api/http'

/**
 * Every page of a paginated list endpoint, as one array.
 *
 * The delivery screens all want the whole table: a truck's split is only
 * visible if every sale against it is in hand, and the sales ledger groups
 * across the lot. They asked for it by passing no pagination at all — which
 * the server reads as its default page of 500. There are 1,363 sales, so 95 of
 * 233 loadings arrived with none of their sales attached, and each one fell
 * back to the customer named on the allocation carrying the whole load: a
 * split truck rendered as one customer taking all 45,000 litres.
 *
 * Nothing said so. A short page and a complete one look identical once they
 * are a JavaScript array.
 *
 * The server caps a page at 1,000, so the pages are walked to the end. Rows are
 * deduped by id because paging by OFFSET is only safe over a total order, and
 * a row inserted between two requests still shifts the window.
 */
export async function fetchAllPages<T extends { id?: string | number; _id?: string | number }>(
  url: string,
  params: Record<string, unknown>,
  pick: (body: any) => T[], // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<T[]> {
  const LIMIT = 1000
  const seen = new Set<string>()
  const out: T[] = []

  for (let page = 1; ; page++) {
    const res = await api.get(url, { params: { ...params, page, limit: LIMIT } })
    const body = res.data?.data
    const rows = pick(body) || []

    for (const row of rows) {
      const key = String(row?._id ?? row?.id ?? '')
      // A row with no id cannot be deduped, and dropping it would be worse
      // than keeping a possible duplicate.
      if (key && seen.has(key)) continue
      if (key) seen.add(key)
      out.push(row)
    }

    const pages = Number(body?.pagination?.pages ?? 1)
    if (!rows.length || page >= pages) break

    // The page count comes from the server, but a bad one must not spin
    // forever against a live API.
    if (page >= 50) {
      console.warn(`[fetchAllPages] stopped at 50 pages for ${url}`)
      break
    }
  }

  return out
}
