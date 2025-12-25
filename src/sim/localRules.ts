import type { AttemptKind, LocationId, LocationKind, SettlementSiteState } from "./types";
import type { FoodType, SettlementLocal } from "./types";

export function locationKindsForAttempt(kind: AttemptKind, site: SettlementSiteState): LocationKind[] | undefined {
  switch (kind) {
    case "recon":
      return ["streets", "tavern", "market"];
    case "work_farm":
      return ["fields"];
    case "work_fish":
      return site.id === "HumanCityPort" ? ["docks"] : ["market"];
    case "work_hunt":
      return ["gate"];
    case "heal":
      return ["clinic", "shrine"];
    case "preach_fixed_path":
      return ["shrine", "market"];
    case "trade":
      return ["market"];
    case "gossip":
      return ["tavern", "market", "streets"];
    case "patrol":
    case "investigate":
    case "arrest":
      return ["guardhouse", "streets"];
    case "steal":
      return ["market", "streets", "storage"];
    case "blackmail":
      return ["streets", "tavern", "market"];
    case "assault":
    case "kill":
    case "kidnap":
      return ["streets", "tavern", "market"];
    case "forced_eclipse":
    case "anchor_sever":
      return ["shrine", "guardhouse"];
    case "raid":
      return ["gate", "streets"];
    case "travel":
    case "idle":
    default:
      return undefined;
  }
}

export function pickLocationByKinds(site: SettlementSiteState, kinds: LocationKind[]): LocationId | undefined {
  const local = site.local;
  if (!local) return undefined;

  // Prefer first matching kind; stable order by id.
  for (const k of kinds) {
    const nodes = local.nodes.filter((n) => n.kind === k).sort((a, b) => a.id.localeCompare(b.id));
    if (nodes.length) return nodes[0]!.id;
  }
  return undefined;
}

export function addFoodToBuilding(site: SettlementSiteState, locationId: LocationId, type: FoodType, amount: number): SettlementLocal | undefined {
  const local = site.local;
  if (!local) return undefined;
  const b = local.buildings[locationId];
  if (!b) return undefined;
  if (!(amount > 0)) return local;

  const prevFood = b.inventory.food ?? {};
  const nextFood = { ...prevFood, [type]: (prevFood[type] ?? 0) + amount };
  return {
    ...local,
    buildings: {
      ...local.buildings,
      [locationId]: { ...b, inventory: { ...b.inventory, food: nextFood } }
    }
  };
}


