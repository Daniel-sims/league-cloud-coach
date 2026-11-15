// Reduces a MATCH-V5 timeline to what the review timeline needs, mirroring the
// native RiotClient/TimelineMapping.swift. Shared with anonymous watch links, so
// it carries champions and team slots only: no puuids, Riot IDs or summoner names.
export type Lane = "top" | "mid" | "bot";
export type ReviewSnapshot = {
  x: number;
  y: number;
  gold: number;
  cs: number;
  jungleCs: number;
  health: number;
  xp: number;
  level: number;
};
export type ReviewPayload = {
  version: 1;
  matchId: string;
  queueId: number;
  gameVersion: string;
  gameCreation: number;
  gameDuration: number;
  playerId: number;
  participants: {
    id: number;
    championId: number;
    championName: string;
    teamId: number;
    position: string;
    /** End-of-game item0–item6 from the match summary (0 = empty slot). */
    finalItems?: number[];
    /** Summoner spell ids [D, F], as in the match summary. */
    spells?: number[];
    /** Keystone rune id and secondary rune tree id. */
    runes?: number[];
  }[];
  frames: { t: number; snapshots: Record<string, ReviewSnapshot> }[];
  kills: {
    t: number;
    killer: number;
    victim: number;
    assists: number[];
    x: number;
    y: number;
    turretDamage: number;
  }[];
  items: {
    t: number;
    participant: number;
    item: number;
    kind: "purchased" | "sold" | "undone" | "destroyed";
    restored?: number;
  }[];
  plates: { t: number; team: number; lane: Lane; killer: number }[];
  buildings: {
    t: number;
    team: number;
    tower: string | null;
    lane: Lane | null;
    x: number;
    y: number;
    killer: number;
  }[];
  monsters: {
    t: number;
    killer: number;
    team: number;
    assists: number[];
    type: string;
    subType: string | null;
  }[];
};

type Json = Record<string, unknown>;
type MatchSummary = {
  id: string;
  queueId: number;
  gameVersion: string;
  gameCreation: number;
  gameDuration: number;
  participants: {
    puuid: string;
    teamId: number;
    championId: number;
    championName: string;
    teamPosition?: string;
    item0?: number;
    item1?: number;
    item2?: number;
    item3?: number;
    item4?: number;
    item5?: number;
    item6?: number;
    summoner1Id?: number;
    summoner2Id?: number;
    perks?: { styles?: { style?: number; selections?: { perk?: number }[] }[] };
  }[];
};

const int = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : null;
const ids = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((x): x is number => Number.isInteger(x) && x >= 1 && x <= 10)
    : [];
const lanes: Record<string, Lane> = {
  TOP_LANE: "top",
  MID_LANE: "mid",
  BOT_LANE: "bot",
};

export class TimelineError extends Error {}

// Lets the review replay check (and name) item changes Riot never logs.
function finalItems(p: MatchSummary["participants"][number]) {
  const items = [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6];
  return items.every((i) => Number.isInteger(i) && i! >= 0)
    ? { finalItems: items as number[] }
    : {};
}

const positive = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) > 0;
// Summoner spells, keystone and secondary tree, as the in-game scoreboard shows them.
function loadout(p: MatchSummary["participants"][number]) {
  const spells = [p.summoner1Id, p.summoner2Id];
  const runes = [
    p.perks?.styles?.[0]?.selections?.[0]?.perk,
    p.perks?.styles?.[1]?.style,
  ];
  return {
    ...(spells.every(positive) ? { spells: spells as number[] } : {}),
    ...(runes.every(positive) ? { runes: runes as number[] } : {}),
  };
}

export function reduceTimeline(
  raw: unknown,
  match: MatchSummary,
  playerPuuid: string,
): ReviewPayload {
  const info = (raw as { info?: Json } | null)?.info;
  const frames = info?.frames;
  const people = info?.participants;
  if (!Array.isArray(frames) || !Array.isArray(people))
    throw new TimelineError("Riot returned an incomplete timeline.");
  const idByPuuid = new Map<string, number>();
  for (const p of people as Json[]) {
    const id = int(p.participantId);
    if (typeof p.puuid === "string" && id && id >= 1 && id <= 10)
      idByPuuid.set(p.puuid, id);
  }
  const playerId = idByPuuid.get(playerPuuid);
  if (!playerId)
    throw new TimelineError(
      "This account wasn't in that game, so there's no timeline to review from its seat.",
    );
  const participants = match.participants.flatMap((p) => {
    const id = idByPuuid.get(p.puuid);
    return id
      ? [
          {
            id,
            championId: p.championId,
            championName: p.championName,
            teamId: p.teamId,
            position: p.teamPosition ?? "",
            ...finalItems(p),
            ...loadout(p),
          },
        ]
      : [];
  });

  const payload: ReviewPayload = {
    version: 1,
    matchId: match.id,
    queueId: match.queueId,
    gameVersion: match.gameVersion,
    gameCreation: match.gameCreation,
    gameDuration: match.gameDuration,
    playerId,
    participants: participants.sort((a, b) => a.id - b.id),
    frames: [],
    kills: [],
    items: [],
    plates: [],
    buildings: [],
    monsters: [],
  };
  for (const frame of frames as Json[]) {
    const t = int(frame.timestamp);
    if (t === null) continue;
    const snapshots: Record<string, ReviewSnapshot> = {};
    for (const value of Object.values(
      (frame.participantFrames ?? {}) as Record<string, Json>,
    )) {
      const id = int(value.participantId);
      const position = value.position as Json | undefined;
      const champion = value.championStats as Json | undefined;
      const x = int(position?.x),
        y = int(position?.y),
        health = int(champion?.health);
      // Snapshots without the full stat block are omitted, not faked.
      if (!id || x === null || y === null || health === null) continue;
      snapshots[id] = {
        x,
        y,
        gold: int(value.totalGold) ?? 0,
        cs: int(value.minionsKilled) ?? 0,
        jungleCs: int(value.jungleMinionsKilled) ?? 0,
        health,
        xp: int(value.xp) ?? 0,
        level: int(value.level) ?? 0,
      };
    }
    payload.frames.push({ t, snapshots });
    for (const event of (Array.isArray(frame.events)
      ? frame.events
      : []) as Json[])
      consume(event, payload);
  }
  return payload;
}

function consume(event: Json, payload: ReviewPayload) {
  const t = int(event.timestamp);
  if (t === null) return;
  const position = event.position as Json | undefined;
  const x = int(position?.x),
    y = int(position?.y);
  switch (event.type) {
    case "CHAMPION_KILL": {
      const victim = int(event.victimId);
      if (!victim || x === null || y === null) return;
      const received = Array.isArray(event.victimDamageReceived)
        ? (event.victimDamageReceived as Json[])
        : [];
      payload.kills.push({
        t,
        killer: int(event.killerId) ?? 0,
        victim,
        assists: ids(event.assistingParticipantIds),
        x,
        y,
        turretDamage: received
          .filter((row) => row.type === "TOWER")
          .reduce(
            (sum, row) =>
              sum +
              (int(row.physicalDamage) ?? 0) +
              (int(row.magicDamage) ?? 0) +
              (int(row.trueDamage) ?? 0),
            0,
          ),
      });
      return;
    }
    case "ITEM_PURCHASED":
    case "ITEM_SOLD":
    case "ITEM_DESTROYED": {
      const participant = int(event.participantId),
        item = int(event.itemId);
      // participantId 0 rows (support quest quirk) are filtered per player later.
      if (participant === null || !item) return;
      payload.items.push({
        t,
        participant,
        item,
        kind:
          event.type === "ITEM_SOLD"
            ? "sold"
            : event.type === "ITEM_DESTROYED"
              ? "destroyed"
              : "purchased",
      });
      return;
    }
    case "ITEM_UNDO": {
      // The reverted purchase lives in beforeId (0 for an undone sale); an
      // undone sale gives back afterId.
      const participant = int(event.participantId),
        before = int(event.beforeId) ?? 0,
        after = int(event.afterId) ?? 0;
      if (participant === null || (before <= 0 && after <= 0)) return;
      payload.items.push({
        t,
        participant,
        item: Math.max(0, before),
        kind: "undone",
        ...(after && after > 0 ? { restored: after } : {}),
      });
      return;
    }
    case "TURRET_PLATE_DESTROYED": {
      const team = int(event.teamId),
        lane = lanes[String(event.laneType)];
      if (!team || !lane) return;
      payload.plates.push({ t, team, lane, killer: int(event.killerId) ?? 0 });
      return;
    }
    case "BUILDING_KILL": {
      const team = int(event.teamId);
      if (
        !team ||
        typeof event.buildingType !== "string" ||
        x === null ||
        y === null
      )
        return;
      payload.buildings.push({
        t,
        team,
        tower: typeof event.towerType === "string" ? event.towerType : null,
        lane: lanes[String(event.laneType)] ?? null,
        x,
        y,
        killer: int(event.killerId) ?? 0,
      });
      return;
    }
    case "ELITE_MONSTER_KILL": {
      if (typeof event.monsterType !== "string") return;
      payload.monsters.push({
        t,
        killer: int(event.killerId) ?? 0,
        team: int(event.killerTeamId) ?? 0,
        assists: ids(event.assistingParticipantIds),
        type: event.monsterType,
        subType:
          typeof event.monsterSubType === "string"
            ? event.monsterSubType
            : null,
      });
      return;
    }
  }
}
