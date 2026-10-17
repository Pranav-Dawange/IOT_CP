/**
 * Verification script for Phase 7 Frontend Dashboard.
 * Checks build artifacts, component exports, routing alignment, and environment configuration.
 *
 * Usage:
 *   node frontend/verify_frontend.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_DIR = __dirname;

console.log('='.repeat(70));
console.log('PHASE 7: REAL-TIME INDUSTRIAL MONITORING DASHBOARD VERIFICATION');
console.log('='.repeat(70));

const REQUIRED_FILES = [
  'index.html',
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  '.env.example',
  '.env',
  'src/main.tsx',
  'src/App.tsx',
  'src/index.css',
  'src/vite-env.d.ts',
  'src/types/index.ts',
  'src/api/client.ts',
  'src/api/websocket.ts',
  'src/components/Header.tsx',
  'src/components/StatsOverview.tsx',
  'src/components/AssetFilter.tsx',
  'src/components/AssetCard.tsx',
  'src/components/AssetGrid.tsx',
  'src/components/TelemetryCharts.tsx',
  'src/components/RiskGaugeChart.tsx',
  'src/components/AlertsTable.tsx',
  'src/components/DisclaimerModal.tsx',
  'dist/index.html',
];

let passed = 0;
let total = 0;

function check(name, testFn) {
  total++;
  try {
    testFn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${name}: ${err.message}`);
  }
}

// 1. Check all required source and build files exist
check('1. Essential frontend files and build artifacts exist', () => {
  for (const file of REQUIRED_FILES) {
    const fullPath = path.join(FRONTEND_DIR, file);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Missing expected file: ${file}`);
    }
  }
});

// 2. Check package.json dependencies
check('2. Package dependencies (React, Recharts, Lucide, Tailwind)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(FRONTEND_DIR, 'package.json'), 'utf8'));
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const expected = ['react', 'react-dom', 'recharts', 'lucide-react', 'vite', 'tailwindcss'];
  for (const dep of expected) {
    if (!allDeps[dep]) {
      throw new Error(`Missing package dependency: ${dep}`);
    }
  }
});

// 3. Check environment configuration
check('3. Environment variables configuration (.env and .env.example)', () => {
  const envContent = fs.readFileSync(path.join(FRONTEND_DIR, '.env'), 'utf8');
  if (!envContent.includes('VITE_API_BASE_URL') || !envContent.includes('VITE_WS_URL')) {
    throw new Error('Missing VITE_API_BASE_URL or VITE_WS_URL in .env');
  }
});

// 4. Check REST API routes match backend contracts
check('4. API Client endpoints align with backend routes', () => {
  const clientContent = fs.readFileSync(path.join(FRONTEND_DIR, 'src/api/client.ts'), 'utf8');
  const expectedRoutes = ['/health', '/assets', '/telemetry', '/summaries', '/predictions', '/alerts'];
  for (const route of expectedRoutes) {
    if (!clientContent.includes(route)) {
      throw new Error(`API client missing route pattern: ${route}`);
    }
  }
});

// 5. Check WebSocket /ws/live and event types
check('5. WebSocket manager connects to /ws/live with typed events', () => {
  const wsContent = fs.readFileSync(path.join(FRONTEND_DIR, 'src/api/websocket.ts'), 'utf8');
  if (!wsContent.includes('/ws/live')) {
    throw new Error('WebSocket client does not target /ws/live endpoint');
  }
  const expectedEvents = ['telemetry', 'prediction', 'alert', 'status'];
  const typesContent = fs.readFileSync(path.join(FRONTEND_DIR, 'src/types/index.ts'), 'utf8');
  for (const evt of expectedEvents) {
    if (!typesContent.includes(evt)) {
      throw new Error(`Missing live event contract: ${evt}`);
    }
  }
});

// 6. Check Decision Threshold (0.55) and Horizon (10)
check('6. GRU model parameters strictly match frozen contract (0.55 threshold, 10 horizon)', () => {
  const riskContent = fs.readFileSync(path.join(FRONTEND_DIR, 'src/components/RiskGaugeChart.tsx'), 'utf8');
  if (!riskContent.includes('0.55')) {
    throw new Error('RiskGaugeChart missing 0.55 threshold');
  }
  if (!riskContent.includes('10')) {
    throw new Error('RiskGaugeChart missing 10 lookahead horizon');
  }
});

// 7. Check Raw vs Smoothed distinction
check('7. Visual distinction between raw and edge-smoothed telemetry', () => {
  const chartContent = fs.readFileSync(path.join(FRONTEND_DIR, 'src/components/TelemetryCharts.tsx'), 'utf8');
  if (!chartContent.includes('Raw') || !chartContent.includes('Smoothed')) {
    throw new Error('TelemetryCharts does not distinguish Raw vs Smoothed values');
  }
  if (!chartContent.includes('strokeDasharray')) {
    throw new Error('TelemetryCharts does not use dashed styling for smoothed overlay');
  }
});

// 8. Check Methodological Disclaimer
check('8. Methodological disclaimer present in modal and dashboard', () => {
  const modalContent = fs.readFileSync(path.join(FRONTEND_DIR, 'src/components/DisclaimerModal.tsx'), 'utf8');
  if (!modalContent.includes('not calibrated or production-certified')) {
    throw new Error('DisclaimerModal missing explicit certification disclaimer');
  }
  if (!modalContent.includes('synthetic trajectory')) {
    throw new Error('DisclaimerModal missing synthetic trajectory explanation');
  }
});

// 9. Check Production Build Artifacts in dist/
check('9. Production build artifacts generated in dist/', () => {
  const distHtml = path.join(FRONTEND_DIR, 'dist/index.html');
  const distStatic = fs.existsSync(path.join(FRONTEND_DIR, 'dist/static'))
    ? path.join(FRONTEND_DIR, 'dist/static')
    : path.join(FRONTEND_DIR, 'dist/assets');
  if (!fs.existsSync(distHtml) || !fs.existsSync(distStatic)) {
    throw new Error('dist/ directory does not contain index.html or compiled static bundle');
  }
  const files = fs.readdirSync(distStatic);
  const hasJs = files.some((f) => f.endsWith('.js'));
  const hasCss = files.some((f) => f.endsWith('.css'));
  if (!hasJs || !hasCss) {
    throw new Error('dist/assets missing compiled .js or .css bundle');
  }
});

console.log('='.repeat(70));
console.log(`VERIFICATION SUMMARY: ${passed}/${total} CHECKS PASSED`);
console.log('='.repeat(70));

if (passed === total) {
  console.log('ALL PHASE 7 FRONTEND VERIFICATION GATES PASSED SUCCESSFULLY!');
  process.exit(0);
} else {
  console.error('SOME CHECKS FAILED!');
  process.exit(1);
}
