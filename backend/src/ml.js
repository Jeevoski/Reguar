const CONFIG = require('./config');
const { classifyByRul } = require('./simulator');

let regressionWeights = [0, 0, 0, 0, 0, 0];
let modelStats = {
  trained: false,
  regressionPseudoAccuracy: 0,
  regressionMae: 0,
  classificationAccuracy: 0,
  blendWeight: 0,
  samples: 0,
  trainedAt: null,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function featureRow(point) {
  return [
    1,
    clamp(point.cycle_count / 100000, 0, 1.5),
    clamp((point.temp_mean || 35) * (point.load_pct || 50) / 4500, 0, 2),
    clamp(point.peak_rms_ratio || point.arc_ratio / 2.5, 0, 3),
    clamp((point.humidity_factor || point.humidity_pct / 100), 0.2, 1.3),
    clamp(point.damage_cumsum || point.damage_index, 0, 3),
  ];
}

function syntheticPoint(baseDamage) {
  const cycleCount = Math.floor(clamp(baseDamage + Math.random() * 0.15, 0, 1.2) * 100000);
  const tempIntegral = clamp(1800 + baseDamage * 120000 + Math.random() * 12000, 0, 200000);
  const arcRatio = clamp(1.1 + baseDamage * 1.2 + Math.random() * 0.35, 1, 3.2);
  const loadPct = clamp(42 + baseDamage * 48 + Math.random() * 12, 40, 95);
  const humidityPct = clamp(40 + Math.random() * 45, 35, 90);
  const damageIndex = clamp(0.45 * (cycleCount / 100000) + 0.25 * (tempIntegral / 150000) + 0.3 * (arcRatio / 2.5), 0, 2);
  const stressFactor = clamp(0.9 + baseDamage * 3.8 + Math.random() * 0.6, 0.5, 6.5);
  const tempMean = clamp(28 + baseDamage * 35 + Math.random() * 5, 25, 82);
  const humidityFactor = clamp(humidityPct / 100, 0.3, 1.2);
  const damageCumsum = clamp(damageIndex * (1.2 + baseDamage), 0, 3);

  const ratedCycles = 100000;
  const shape = 2;
  const scale = ratedCycles / Math.max(stressFactor, 0.3);
  const survival = Math.exp(-Math.pow(cycleCount / Math.max(scale, 1), shape));
  const rul = ratedCycles * survival;
  const rulPct = clamp((rul / ratedCycles) * 100, 0, 100);

  return {
    cycle_count: cycleCount,
    temp_integral: tempIntegral,
    temp_mean: tempMean,
    arc_ratio: arcRatio,
    peak_rms_ratio: arcRatio,
    humidity_pct: humidityPct,
    humidity_factor: humidityFactor,
    load_pct: loadPct,
    damage_index: damageIndex,
    damage_cumsum: damageCumsum,
    stress_factor: stressFactor,
    rulPct,
  };
}

function createTrainingData(sampleCount) {
  const samples = [];
  for (let i = 0; i < sampleCount; i += 1) {
    samples.push(syntheticPoint(Math.random()));
  }
  return samples;
}

function dot(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) {
    total += a[i] * b[i];
  }
  return total;
}

function predictRegression(features) {
  return clamp(dot(regressionWeights, features), 0, 100);
}

function classifyFromPrediction(rulPct) {
  if (rulPct < 25) {
    return 'critical';
  }
  if (rulPct < 50) {
    return 'warning';
  }
  return 'healthy';
}

async function trainModels(sampleCount = CONFIG.trainingSamples) {
  const totalSamples = Math.max(5000, Math.min(Number(sampleCount) || CONFIG.trainingSamples, 120000));
  const trainingData = createTrainingData(totalSamples);
  const split = Math.floor(trainingData.length * 0.8);
  const train = trainingData.slice(0, split);
  const test = trainingData.slice(split);

  const learningRate = 0.04;
  const epochs = 36;
  regressionWeights = [95, -35, -14, -6, -30, -16];

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const grad = [0, 0, 0, 0, 0, 0];

    for (let i = 0; i < train.length; i += 1) {
      const x = featureRow(train[i]);
      const y = train[i].rulPct;
      const yHat = predictRegression(x);
      const error = yHat - y;

      for (let j = 0; j < grad.length; j += 1) {
        grad[j] += error * x[j];
      }
    }

    for (let j = 0; j < regressionWeights.length; j += 1) {
      regressionWeights[j] -= (learningRate * grad[j]) / train.length;
    }

    if (epoch % 4 === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  let mae = 0;
  let classCorrect = 0;

  for (let i = 0; i < test.length; i += 1) {
    const sample = test[i];
    const pred = predictRegression(featureRow(sample));
    mae += Math.abs(pred - sample.rulPct);

    const classPred = classifyFromPrediction(pred);
    const classTrue = classifyByRul(sample.rulPct);
    if (classPred === classTrue) {
      classCorrect += 1;
    }
  }

  mae /= test.length;
  const pseudoAccuracy = Math.max(0, 100 - mae);
  const classAccuracy = (classCorrect / test.length) * 100;

  modelStats = {
    trained: true,
    regressionPseudoAccuracy: Number(pseudoAccuracy.toFixed(2)),
    regressionMae: Number(mae.toFixed(2)),
    classificationAccuracy: Number(classAccuracy.toFixed(2)),
    blendWeight: Number((classAccuracy >= 92 ? 0.82 : classAccuracy >= 85 ? 0.74 : 0.66).toFixed(2)),
    samples: totalSamples,
    trainedAt: new Date().toISOString(),
  };
}

function estimatePhysicsRulPct(point) {
  const cycleImpact = clamp((point.cycle_count || 0) / 120000, 0, 1.2);
  const tempImpact = clamp((point.temp_mean || point.temp_c || 35) / 85, 0.2, 1.2);
  const loadImpact = clamp((point.load_pct || 55) / 100, 0.2, 1.2);
  const arcImpact = clamp((point.arc_ratio || 1.2) / 2.6, 0.2, 1.4);
  const humidityImpact = clamp((point.humidity_pct || 60) / 100, 0.2, 1.2);
  const damageImpact = clamp(point.damage_cumsum || point.damage_index || 0.4, 0, 2.4);

  const stress = clamp(
    0.34 * cycleImpact +
      0.22 * tempImpact +
      0.16 * loadImpact +
      0.14 * arcImpact +
      0.06 * humidityImpact +
      0.08 * damageImpact,
    0,
    1.4
  );

  return clamp((1 - stress) * 100, 0, 100);
}

function aggregateRecentRows(rows) {
  const recent = rows.slice(-100);
  const latest = recent[recent.length - 1];
  const avgTempIntegral = recent.reduce((acc, r) => acc + (r.temp_integral || 0), 0) / Math.max(recent.length, 1);
  const avgTemp = recent.reduce((acc, r) => acc + (r.temp_c || 0), 0) / Math.max(recent.length, 1);
  const avgLoad = recent.reduce((acc, r) => acc + (r.load_pct || 0), 0) / Math.max(recent.length, 1);
  const avgHumidity = recent.reduce((acc, r) => acc + (r.humidity_pct || 0), 0) / Math.max(recent.length, 1);
  const damageCumsum = recent.reduce((acc, r) => acc + (r.damage_index || 0), 0) / Math.max(recent.length, 1);

  return {
    cycle_count: latest.cycle_count,
    temp_integral: avgTempIntegral,
    temp_mean: avgTemp,
    load_pct: avgLoad,
    humidity_pct: avgHumidity,
    humidity_factor: avgHumidity / 100,
    arc_ratio: latest.arc_ratio,
    peak_rms_ratio: latest.arc_ratio,
    damage_index: latest.damage_index,
    damage_cumsum: damageCumsum,
    stress_factor: latest.stress_factor,
  };
}

async function predictFromRecentRows(rows) {
  if (!rows.length || !modelStats.trained) {
    return {
      predictedRulPct: rows.length ? rows[rows.length - 1].rul_pct_true : 100,
      predictedStatus: 'healthy',
    };
  }

  const point = aggregateRecentRows(rows);
  const latest = rows[rows.length - 1];
  const regressionPred = predictRegression(featureRow(point));
  const physicsPred = estimatePhysicsRulPct(point);
  const blendWeight = clamp(modelStats.blendWeight || 0.72, 0.6, 0.9);
  const predictedRulPct = blendWeight * regressionPred + (1 - blendWeight) * physicsPred;

  return {
    predictedRulPct: Number(predictedRulPct.toFixed(2)),
    predictedStatus: latest.temp_c > 70 ? 'critical' : classifyFromPrediction(predictedRulPct),
    confidence: Number(clamp(0.62 + (rows.length / 220), 0.62, 0.95).toFixed(2)),
  };
}

function getModelStats() {
  return modelStats;
}

module.exports = {
  trainModels,
  predictFromRecentRows,
  getModelStats,
};
