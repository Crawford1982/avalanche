/**
 * Replicates index.html simulate() exactly for 1,000 UK-style debt scenarios.
 * Seeded RNG for reproducible published numbers.
 */
function simulate(debtList, extra, priorityFn) {
  const state = debtList.map((d) => ({
    balance: d.balance,
    rate: d.rate / 100 / 12,
    minPayment: d.minPayment,
    paidOffMonth: null,
  }));
  let totalInterest = 0;
  let month = 0;
  const MAX_MONTHS = 600;

  while (state.some((d) => d.balance > 0) && month < MAX_MONTHS) {
    month++;
    state.forEach((d) => {
      if (d.balance > 0) {
        const interest = d.balance * d.rate;
        totalInterest += interest;
        d.balance += interest;
      }
    });
    let remaining = extra;
    state.forEach((d) => {
      if (d.balance > 0) {
        const pay = Math.min(d.balance, d.minPayment);
        d.balance = Math.max(0, d.balance - pay);
        if (d.balance === 0 && d.paidOffMonth === null) d.paidOffMonth = month;
      }
    });
    const active = state.filter((d) => d.balance > 0).sort(priorityFn);
    if (active.length > 0 && remaining > 0) {
      const target = active[0];
      const pay = Math.min(target.balance, remaining);
      target.balance = Math.max(0, target.balance - pay);
      if (target.balance === 0 && target.paidOffMonth === null) target.paidOffMonth = month;
    }
  }
  return {
    months: month,
    totalInterest: Math.round(totalInterest),
    hitMax: month >= MAX_MONTHS,
  };
}

// Mulberry32
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

/** UK-style minimum: at least interest + small principal, floor £25 */
function minPaymentFor(balance, aprPercent) {
  const monthlyRate = aprPercent / 100 / 12;
  const interest = balance * monthlyRate;
  const onePercent = balance * 0.01;
  const raw = Math.max(25, interest + onePercent);
  return Math.min(balance + interest, Math.ceil(raw / 5) * 5);
}

function generateScenario(rng) {
  const nDebts = randInt(rng, 2, 6);
  const totalBalance = randInt(rng, 1500, 48000);
  const balances = [];
  let left = totalBalance;
  for (let i = 0; i < nDebts - 1; i++) {
    const share = rng() * (left * 0.65);
    const b = Math.max(200, Math.round(share / 50) * 50);
    balances.push(b);
    left -= b;
  }
  balances.push(Math.max(200, Math.round(left / 50) * 50));

  const debts = balances.map((balance) => {
    const apr = round2(6 + rng() * 34);
    const minPayment = minPaymentFor(balance, apr);
    return { balance, rate: apr, minPayment };
  });

  const sumMin = debts.reduce((s, d) => s + d.minPayment, 0);
  const extra = Math.max(50, Math.round((sumMin * (0.15 + rng() * 1.2)) / 10) * 10);

  return { debts, extra };
}

function viableScenario(debts) {
  return debts.every((d) => {
    const mi = d.balance * (d.rate / 100 / 12);
    return d.minPayment > mi + 0.01;
  });
}

const SEED = 20260402;
const rng = mulberry32(SEED);

const results = {
  n: 0,
  avalancheWinsInterest: 0,
  tieInterest: 0,
  snowballWinsInterest: 0,
  avalancheFasterOrEqual: 0,
  snowballFaster: 0,
  totalAvSaving: 0,
  maxSaving: 0,
  byDebtCount: {},
  savingsDiffs: [],
  snowballWinMonths: [],
};

for (let i = 0; i < 10000; i++) {
  let scenario = generateScenario(rng);
  let guard = 0;
  while (!viableScenario(scenario.debts) && guard < 50) {
    scenario = generateScenario(rng);
    guard++;
  }
  if (!viableScenario(scenario.debts)) continue;

  const av = simulate(scenario.debts, scenario.extra, (a, b) => b.rate - a.rate);
  const sn = simulate(scenario.debts, scenario.extra, (a, b) => a.balance - b.balance);

  if (av.hitMax || sn.hitMax) continue;

  results.n++;
  const diff = sn.totalInterest - av.totalInterest;
  results.savingsDiffs.push(diff);

  if (diff > 0) results.avalancheWinsInterest++;
  else if (diff < 0) results.snowballWinsInterest++;
  else results.tieInterest++;

  if (av.months <= sn.months) results.avalancheFasterOrEqual++;
  else {
    results.snowballFaster++;
    results.snowballWinMonths.push(sn.months - av.months);
  }

  results.totalAvSaving += Math.max(0, diff);
  results.maxSaving = Math.max(results.maxSaving, diff);

  const nc = scenario.debts.length;
  if (!results.byDebtCount[nc]) results.byDebtCount[nc] = { n: 0, avWin: 0, tie: 0, snWin: 0 };
  results.byDebtCount[nc].n++;
  if (diff > 0) results.byDebtCount[nc].avWin++;
  else if (diff === 0) results.byDebtCount[nc].tie++;
  else results.byDebtCount[nc].snWin++;

  if (results.n >= 1000) break;
}

results.savingsDiffs.sort((a, b) => a - b);
const pct = (p) => results.savingsDiffs[Math.floor((p / 100) * (results.savingsDiffs.length - 1))];

console.log(JSON.stringify({
  seed: SEED,
  scenariosRun: results.n,
  avalancheLowerInterest: results.avalancheWinsInterest,
  tieInterest: results.tieInterest,
  snowballLowerInterest: results.snowballWinsInterest,
  pctAvalancheCheaper: Math.round((results.avalancheWinsInterest / results.n) * 1000) / 10,
  avalancheFasterOrEqualMonths: results.avalancheFasterOrEqual,
  snowballFasterMonths: results.snowballFaster,
  medianInterestSavingSnowballVsAv: pct(50),
  p75Saving: pct(75),
  p90Saving: pct(90),
  maxSavingAvOverSnowball: results.maxSaving,
  byDebtCount: results.byDebtCount,
}, null, 2));
