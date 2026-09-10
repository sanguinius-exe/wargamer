import {
  GameFile,
  Division,
  Team,
  Identity,
  SCHEMA_VERSION,
  defaultStatus,
  uid,
} from "./types";

/**
 * Validate an incoming scenario object, migrating older versions in place.
 * Throws a human-readable Error if it cannot be understood.
 */
export function normalizeGame(obj: unknown): GameFile {
  if (!obj || typeof obj !== "object") {
    throw new Error("File is not a Wargamer scenario.");
  }
  const raw = obj as Record<string, unknown>;

  if (raw.version === 1) return migrateV1(raw);

  if (raw.version !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported scenario version: ${String(raw.version)} (expected ${SCHEMA_VERSION}).`,
    );
  }
  if (!Array.isArray(raw.teams) || !Array.isArray(raw.divisions)) {
    throw new Error("Scenario is missing its teams or divisions.");
  }
  const meta = raw.meta as GameFile["meta"] | undefined;
  if (!meta || typeof meta.name !== "string") {
    throw new Error("Scenario is missing its metadata.");
  }
  if (!meta.id) meta.id = uid();
  if (!("basemap" in raw)) raw.basemap = null;

  // Backfill any fields added after a scenario was first saved.
  raw.divisions = (raw.divisions as Division[]).map((d) => ({
    ...d,
    higherFormation: d.higherFormation ?? "",
    isHQ: d.isHQ ?? false,
    isTaskForce: d.isTaskForce ?? false,
    reinforced: d.reinforced ?? null,
    status: { ...defaultStatus(), ...d.status },
  }));

  return raw as unknown as GameFile;
}

function migrateV1(v1: Record<string, unknown>): GameFile {
  const now = new Date().toISOString();
  const identities: Identity[] = ["friend", "hostile", "neutral", "unknown"];

  const teams: Team[] = ((v1.teams as Array<Record<string, unknown>>) ?? []).map(
    (t, i) => ({
      id: String(t.id ?? uid()),
      name: String(t.name ?? `Team ${i + 1}`),
      identity: identities[i] ?? "neutral",
    }),
  );

  const divisions: Division[] = (
    (v1.divisions as Array<Record<string, unknown>>) ?? []
  ).map((d) => {
    const oldType = String(d.type ?? "infantry");
    const isHQ = oldType === "hq";
    return {
      id: String(d.id ?? uid()),
      teamId: String(d.teamId),
      name: String(d.name ?? "Division"),
      type: (isHQ ? "infantry" : oldType) as Division["type"],
      echelon: (d.echelon as Division["echelon"]) ?? "division",
      higherFormation: "",
      isHQ,
      isTaskForce: false,
      reinforced: null,
      position: (d.position as Division["position"]) ?? null,
      status: { ...defaultStatus(), ...(d.status as object) },
      notes: String(d.notes ?? ""),
    };
  });

  const m = (v1.meta as Record<string, unknown>) ?? {};
  return {
    version: SCHEMA_VERSION,
    meta: {
      id: uid(),
      name: String(m.name ?? "Imported Scenario"),
      createdAt: String(m.createdAt ?? now),
      updatedAt: now,
      notes: String(m.notes ?? ""),
    },
    theatre: (v1.theatre as GameFile["theatre"]) ?? null,
    basemap: null,
    teams,
    divisions,
  };
}
