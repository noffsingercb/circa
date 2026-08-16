import crypto from "node:crypto"
import { Worker, WebhookVerificationError } from "@notionhq/workers"

// ===================== Circa feedback capture worker =====================
// Receives thumbs votes forwarded by geohistory-api (see GeoHistory
// feedback.ts) and writes one row per vote into "Circa — Feedback Signals".
//
// Nothing here is user-facing. Circa's browser never talks to this endpoint:
// the vote goes browser -> Render -> here, so that the signing key stays
// server-side and abuse is rejected at the edge rather than after Notion has
// already accepted it.
//
// Deploy:  ntn workers exec --local
//
// Environment:
//   NOTION_API_TOKEN       context.notion is NOT auto-authenticated inside a
//                          webhook the way it is inside a tool.
//   FEEDBACK_DB_ID         f2693559-9f3f-4af5-8313-d632680d4a10
//   CIRCA_FEEDBACK_SECRET  same hex string Render signs with

const SECRET = process.env.CIRCA_FEEDBACK_SECRET ?? ""
const FEEDBACK_DB_ID = process.env.FEEDBACK_DB_ID ?? ""

const worker = new Worker()

// ===================== Signature =====================

/**
 * Constant-time compare of the forwarded signature against the raw body.
 *
 * timingSafeEqual throws on length mismatch rather than returning false, so the
 * lengths are checked first -- an attacker learning "your signature is the
 * wrong length" costs nothing, but an unhandled throw here would surface as a
 * verification failure and count toward the five-strike block.
 */
function verify(rawBody: string, signature: string): boolean {
  if (!SECRET) return false
  const expected = `sha256=${crypto.createHmac("sha256", SECRET).update(rawBody, "utf8").digest("hex")}`
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

// ===================== Payload =====================

const VERDICTS = new Set(["up", "down"])
const SCOPES = new Set(["local", "regional", "national", "global", "unclassified"])
const BUCKETS = new Set([
  "0-25", "25-50", "50-100", "100-250", "250-500",
  "500-1000", "1000-1500", "1500-2500", "2500+",
])

type Vote = {
  voteId: string
  eventId: string
  eventTitle: string
  verdict: string
  scope: string
  significance: number
  reachKm: number
  headroom: number
  relaxed: boolean
  distanceBucket: string
  segmentDecade: string
  datasetVersion: string
  buildId: string
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/**
 * Second line of defence. Render already validates strictly, so anything that
 * fails here is either a Render bug or a forgery with a valid signature -- both
 * of which mean "drop it", never "retry it".
 *
 * The decade check is deliberately duplicated from the Render side. It is the
 * one field where a loosened client could leak an exact year into a durable
 * row, and this is the last place to catch that before it is written.
 */
function isValidVote(v: any): v is Vote {
  return (
    v && typeof v === "object" &&
    isStr(v.voteId) && isStr(v.eventId) && isStr(v.eventTitle) &&
    isStr(v.verdict) && VERDICTS.has(v.verdict) &&
    isStr(v.scope) && SCOPES.has(v.scope) &&
    isStr(v.distanceBucket) && BUCKETS.has(v.distanceBucket) &&
    isStr(v.segmentDecade) && /^\d{3,4}0s$/.test(v.segmentDecade) &&
    isStr(v.datasetVersion) && isStr(v.buildId) &&
    isNum(v.significance) && isNum(v.reachKm) && isNum(v.headroom) &&
    typeof v.relaxed === "boolean"
  )
}

const text = (s: string) => ({ rich_text: [{ text: { content: s.slice(0, 2000) } }] })

/** Property names must match the database exactly; they are case-sensitive. */
function toProperties(v: Vote): Record<string, unknown> {
  return {
    "Event": { title: [{ text: { content: v.eventTitle.slice(0, 2000) } }] },
    "Event ID": text(v.eventId),
    "Verdict": { select: { name: v.verdict } },
    "Scope": { select: { name: v.scope } },
    "Distance bucket": { select: { name: v.distanceBucket } },
    "Reach km": { number: v.reachKm },
    "Significance": { number: v.significance },
    "Headroom": { number: v.headroom },
    "Relaxed": { checkbox: v.relaxed },
    "Segment decade": text(v.segmentDecade),
    "Dataset version": text(v.datasetVersion),
    "Build ID": text(v.buildId),
    "Vote ID": text(v.voteId),
    // "Received" is a created_time property and is filled by Notion.
  }
}

// ===================== Handler =====================

worker.webhook("onCircaFeedback", {
  title: "Circa feedback capture",
  description: "Receives HMAC-signed thumbs votes forwarded by geohistory-api.",
  execute: async (events: any[], { notion }: any) => {
    for (const event of events) {
      // Verify BEFORE parsing. The signature covers the raw bytes, so parsing
      // first would authenticate a re-serialization rather than what was sent.
      const signature = event.headers?.["x-circa-signature"]
      if (!signature || !verify(event.rawBody, signature)) {
        // The ONLY throw in this handler. Five consecutive failures block the
        // webhook, which is the intended abuse brake -- and the reason nothing
        // below is allowed to throw.
        throw new WebhookVerificationError("bad signature")
      }

      let vote: unknown
      try {
        vote = JSON.parse(event.rawBody)
      } catch {
        console.warn("circa-feedback: signed payload was not JSON; dropped")
        continue
      }

      if (!isValidVote(vote)) {
        // Signed, so it came from us, but malformed. Dropping silently is
        // deliberate: throwing would spend a strike against the five-failure
        // block and let a bad Circa deploy take the endpoint offline.
        console.warn("circa-feedback: signed payload failed validation; dropped")
        continue
      }

      // Idempotency. deliveryId covers Notion's own retries; voteId covers
      // everything upstream -- a client retry, a double-click, a Render replay.
      try {
        const existing = await notion.databases.query({
          database_id: FEEDBACK_DB_ID,
          filter: { property: "Vote ID", rich_text: { equals: vote.voteId } },
          page_size: 1,
        })
        if (existing?.results?.length > 0) {
          console.log("circa-feedback: duplicate voteId; skipped")
          continue
        }
      } catch (e: any) {
        // A failed dedupe check must not lose the vote. Worst case is a
        // duplicate row, which is recoverable; a dropped vote is not.
        console.warn(`circa-feedback: dedupe check failed, writing anyway: ${e?.message ?? e}`)
      }

      try {
        await notion.pages.create({
          parent: { database_id: FEEDBACK_DB_ID },
          properties: toProperties(vote),
        })
      } catch (e: any) {
        // Nobody is waiting on this. The browser was answered 204 long ago and
        // the thumb is already filled, so a failed write is logged, not raised.
        console.error(`circa-feedback: pages.create failed: ${e?.message ?? e}`)
      }
    }
  },
})

export default worker
