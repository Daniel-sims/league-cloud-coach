// Strict allowlist: a companion can never accidentally publish raw Riot identity data.
import type { ReviewPayload } from "../riot/timeline.ts";
type Check = (v: unknown) => boolean;
const integer =
  (min = 0, max = Number.MAX_SAFE_INTEGER): Check =>
  (v) =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const text =
  (max: number): Check =>
  (v) =>
    typeof v === "string" && v.length <= max;
const one =
  (...values: unknown[]): Check =>
  (v) =>
    values.includes(v);
const nullable =
  (check: Check): Check =>
  (v) =>
    v === null || check(v);
const array =
  (check: Check, max = 20000): Check =>
  (v) =>
    Array.isArray(v) && v.length <= max && v.every(check);
const object =
  (shape: Record<string, Check>, optional: string[] = []): Check =>
  (v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return false;
    const row = v as Record<string, unknown>;
    return (
      Object.keys(row).every((k) => Object.hasOwn(shape, k)) &&
      Object.entries(shape).every(
        ([k, check]) => (optional.includes(k) && !(k in row)) || check(row[k]),
      )
    );
  };
const id = integer(1, 10),
  participant = integer(0, 10),
  t = integer(0, 86_400_000);
const lane = one("top", "mid", "bot");
const snapshot = object({
  x: integer(-1000, 20000),
  y: integer(-1000, 20000),
  gold: integer(),
  cs: integer(),
  jungleCs: integer(),
  health: integer(),
  xp: integer(),
  level: integer(0, 30),
});
const snapshots: Check = (v) =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.entries(v).every(
    ([k, value]) => /^(10|[1-9])$/.test(k) && snapshot(value),
  );
export type CompanionReview = ReviewPayload & {
  ultimates: { detectorVersion: number; videoTimestampsMs: number[] };
};
const review = object({
  version: one(1),
  matchId: (v) =>
    typeof v === "string" && /^[A-Z0-9]+_[0-9]+$/.test(v) && v.length <= 40,
  queueId: integer(0, 10000),
  gameVersion: text(60),
  gameCreation: integer(),
  gameDuration: integer(1, 14400),
  playerId: id,
  participants: array(
    object({
      id,
      championId: integer(1, 10000),
      championName: text(80),
      teamId: one(100, 200),
      position: text(20),
    }),
    10,
  ),
  frames: array(object({ t, snapshots }), 300),
  kills: array(
    object({
      t,
      killer: participant,
      victim: id,
      assists: array(id, 10),
      x: integer(-1000, 20000),
      y: integer(-1000, 20000),
      turretDamage: integer(),
    }),
  ),
  items: array(
    object(
      {
        t,
        participant,
        item: integer(),
        kind: one("purchased", "sold", "undone", "destroyed"),
        restored: integer(),
      },
      ["restored"],
    ),
  ),
  plates: array(object({ t, team: one(100, 200), lane, killer: participant })),
  buildings: array(
    object({
      t,
      team: one(100, 200),
      tower: nullable(text(60)),
      lane: nullable(lane),
      x: integer(-1000, 20000),
      y: integer(-1000, 20000),
      killer: participant,
    }),
  ),
  monsters: array(
    object({
      t,
      killer: participant,
      team: one(0, 100, 200, 300),
      assists: array(id, 10),
      type: text(60),
      subType: nullable(text(60)),
    }),
  ),
  ultimates: object({
    detectorVersion: integer(1, 1000),
    videoTimestampsMs: array(t, 500),
  }),
});
export function validReview(value: unknown): value is CompanionReview {
  if (!review(value)) return false;
  const payload = value as CompanionReview;
  const ids = payload.participants.map((p) => p.id);
  return (
    ids.length > 0 &&
    new Set(ids).size === ids.length &&
    ids.includes(payload.playerId)
  );
}
