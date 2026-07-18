// Environmental-impact model for the "Battery, not Blood" pitch.
// Assumptions documented in docs/DATA.md - keep these two files in sync.

// Average edible mass per fruit (kg). Sources: USDA average medium apple ~182 g,
// medium banana ~118 g. Rounded for the demo counter.
export const KG_PER_FRUIT = {
  apple: 0.18,
  banana: 0.12,
};

// kg CO2e emitted per kg of food wasted (production + decomposition).
// FAO food-wastage-footprint figures land in the 2-4 range; we use a
// conservative 2.5 and say so on the dashboard.
export const CO2E_PER_KG_WASTE = 2.5;

// A successful pick+sort = one fruit correctly graded at the point of harvest
// instead of lost in the 30-40% post-harvest gap. We claim the fruit's mass as
// waste avoided only for successful picks.
export function computeImpact(successesByFruit) {
  let wasteKg = 0;
  for (const [fruit, count] of Object.entries(successesByFruit)) {
    wasteKg += (KG_PER_FRUIT[fruit] ?? 0.15) * count;
  }
  const wasteAvoidedKg = round2(wasteKg);
  return {
    waste_avoided_kg: wasteAvoidedKg,
    co2e_avoided_kg: round2(wasteAvoidedKg * CO2E_PER_KG_WASTE),
  };
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}

// Edible mass (kg) claimed as waste-avoided for one pick: the fruit's mass on a
// success, zero on a failure. Single source of truth so getStats, getTimeSeries
// and getSessions never disagree on the impact math.
export function pickKg(pick) {
  return pick && pick.success ? KG_PER_FRUIT[pick.fruit] ?? 0.15 : 0;
}

// Picks-per-hour / kg-per-hour over an elapsed span. Rate is meaningless for a
// zero-length span (0 or 1 events), so we report 0 rather than Infinity/NaN.
export function throughput({ picks = 0, kg = 0, spanMs = 0 }) {
  const hours = spanMs / 3_600_000;
  return {
    picks_per_hour: hours > 0 ? round2(picks / hours) : 0,
    kg_per_hour: hours > 0 ? round2(kg / hours) : 0,
  };
}
