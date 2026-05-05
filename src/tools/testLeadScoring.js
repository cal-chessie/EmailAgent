/**
 * Lead Scoring Tests — run with: node src/tools/testLeadScoring.js
 */
import { scoreLead, SCORING_BANDS } from './leadScoring.js';

const TEST_CASES = [
  {
    label: 'Jane — domestic, high bill, eager, south-facing roof',
    data: { name: 'Jane', phone: '+447700900001', type: 'domestic', bill: '£180/month', timeline: 'eager', property: '3-bed semi, south-facing roof' },
    expectBand: 'hot',
    expectMin: 80,
  },
  {
    label: 'Warehouse — commercial, huge bill, considering',
    data: { name: 'Warehouse Ops', phone: null, type: 'commercial', bill: '£4,200/month', timeline: 'considering', property: '50,000 sq ft warehouse' },
    expectBand: 'hot',
    expectMin: 80,
  },
  {
    label: 'Dave — domestic, mid bill, browsing, no detail',
    data: { name: 'Dave Bloggs', phone: null, type: 'domestic', bill: '£110/month', timeline: 'browsing', property: '3-bed semi' },
    expectBand: 'warm',
    expectMin: 50,
  },
  {
    label: 'Minimal — no phone, no property, browsing, low bill',
    data: { name: 'Unknown', phone: null, type: 'unknown', bill: '£30/month', timeline: 'browsing', property: null },
    expectBand: 'cool',
    expectMin: 20,
  },
  {
    label: 'North-facing roof — negative property signal',
    data: { name: 'Bob', phone: null, type: 'domestic', bill: '£150/month', timeline: 'eager', property: '3-bed semi, north-facing roof' },
    expectBand: 'warm',
    expectMin: 50,
  },
];

// Score thresholds for bands: 0-19=cold, 20-49=cool, 50-79=warm, 80+=hot
const getBandFromScore = (score) => {
  if (score >= 80) return 'hot';
  if (score >= 50) return 'warm';
  if (score >= 20) return 'cool';
  return 'cold';
};

let passed = 0;
let failed = 0;

for (const tc of TEST_CASES) {
  const result = scoreLead(tc.data);

  // Use numeric band comparison so emojis/suffix don't break tests
  const actualBand = getBandFromScore(result.total);
  const bandOk = actualBand === tc.expectBand;
  const scoreOk = result.total >= tc.expectMin;

  if (bandOk && scoreOk) {
    console.log(`  ✅ ${tc.label}`);
    console.log(`       Score: ${result.total} ${result.band.label} | Breakdown: bill=${result.breakdown.billScore} timeline=${result.breakdown.timelineScore} type=${result.breakdown.typeScore}`);
    passed++;
  } else {
    console.error(`  ❌ ${tc.label}`);
    console.error(`       Expected: band=${tc.expectBand} score=${tc.expectMin}+ | Got: ${result.total} ${result.band.label}`);
    console.error(`       Breakdown:`, result.breakdown);
    console.error(`       Recommendation: ${result.recommendation}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);