# Relay Guardian - Predictive Maintenance Web App (Luminous APOGEE Simulation)

Hackathon-ready full-stack demo for relay/contactors in inverter/UPS systems.
No hardware is required today (simulation mode), but the backend is structured for hardware mode with MODBUS/sensor adapters.

## Stack

- Frontend: React + Vite + TypeScript + Material UI + Recharts + Socket.io client
- Backend: Node.js + Express + Socket.io + SQLite
- ML: Synthetic-data trained lightweight edge-style models (regression + failure classifier) on 20,000 generated samples
- Database: SQLite (`backend/relay_predictive.db`)

## Features

- Dual data source modes:
  - Simulation mode (default): realistic synthetic telemetry every 5s
  - Hardware-ready mode (stub): MODBUS register + sensor payloads through `/api/read-sensors`
- Simulated real-time telemetry every 5s:
  - cycle_count (0 -> rated with random jumps)
  - voltage_rms (220-240V with noise)
  - current_rms/current_peak with switching spikes
  - temp (25-80C influenced by load/cycles)
  - load_pct (20-100)
  - humidity_pct (40-90)
- Degradation model:
  - Weibull survival-based wear with stress-adjusted scale
  - stress includes thermal, load, humidity, and arcing effects
- Feature engineering:
  - `cycle_count`, `temp_integral`, `arc_ratio = peak/rms`, `damage_index`, `stress_factor`
- ML:
  - RUL regression model trained with gradient descent on synthetic degradation samples
  - failure classifier (`healthy`, `warning`, `critical`) from predicted RUL thresholds
  - critical alert when `RUL < 25%` or `temp > 70C`
  - edge-style inference from recent 100 points
- Dashboard:
  - live gauges (RUL/temp/load/cycles)
  - real-time trend chart (voltage/current/temp/RUL)
  - flashing critical alert banner
  - virtual buzzer (Web Audio API)
  - virtual LED indicator
  - fleet view for 8 inverters
  - controls: mode toggle, pause/play simulation, speed (1x-10x), induce failure (thermal/electrical/wear), reset inverter

## Project Structure

- `backend/src/server.js` - API + WebSocket + simulation scheduler
- `backend/src/simulator.js` - telemetry + degradation + failure induction
- `backend/src/hardwareAdapter.js` - dedicated hardware abstraction layer (MODBUS/sensor-ready)
- `backend/src/hardwareAdapterStub.js` - simulation-backed hardware adapter implementation
- `backend/src/hardwareAdapterReal.js` - real-hardware placeholder implementation (drop-in compatible)
- `backend/src/ml.js` - synthetic training and inference
- `backend/src/db.js` - SQLite schema + queries
- `frontend/src/App.tsx` - complete dashboard UI
- `screenshots/` - sample demo screenshots (SVG)

## Run Locally

### 1) Install dependencies

```bash
npm install
npm install --prefix backend
npm install --prefix frontend
```

### 2) Start app

```bash
npm run start
```

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:4000/api/health`

The backend starts immediately, then initializes model training + seeded history in the background.
During initialization, the UI shows an info banner and auto-refreshes until live data appears.

## Dev Mode

```bash
npm run dev
```

This runs:
- backend with nodemon
- frontend with Vite HMR

## Hardware Adapter Mode

Select adapter implementation with one environment flag:

```bash
HARDWARE_ADAPTER_MODE=stub   # default
HARDWARE_ADAPTER_MODE=real   # real-hardware placeholder implementation
```

Windows PowerShell example:

```powershell
$env:HARDWARE_ADAPTER_MODE='real'
npm run start --prefix backend
```

Both modes keep the same adapter interface, so server code does not need changes when swapping to real Raspberry Pi integrations.

## ML Metrics

Check live model metrics at:
- `GET /api/model-metrics`
- `GET /api/fleet` (includes model summary)

Target demo metrics:
- regression pseudo-accuracy typically `>= 85%`
- classification accuracy typically around `85%+` depending on random seed and synthetic distribution

Because training uses randomized synthetic data, values can vary per run.

## API Endpoints

- `GET /api/health`
- `GET /api/source`
- `GET /api/fleet`
- `GET /api/inverter/:id/history?limit=240`
- `POST /api/simulate` body: `{ "enabled": true|false, "speedMultiplier": 1..10 }`
- `POST /api/mode` body: `{ "mode": "simulation|hardware" }`
- `GET /api/read-sensors?id=INV-001` (MODBUS/sensor-ready stub response)
- `GET /api/modbus/registers?id=INV-001` (stubbed MODBUS register map)
- `POST /api/control/failure` body: `{ "id": "INV-001", "mode": "thermal|electrical|wear" }`
- `POST /api/control/reset` body: `{ "id": "INV-001" }`

## Sample Screenshots

- `screenshots/dashboard-normal.svg`
- `screenshots/dashboard-alert.svg`
- `screenshots/dashboard-fleet.svg`

## Deployment Notes

- Frontend (Vite build) can be deployed to Netlify/Vercel.
- Backend (Node + SQLite) can be deployed to Render/Railway/Fly.
- For cloud production:
  - move SQLite to PostgreSQL
  - set `VITE_SOCKET_URL` to backend URL
  - update CORS in backend

## Extension Ideas

- MODBUS ingestion adapter for real inverter telemetry
- Raspberry Pi hardware adapter: ACS712 + INA219 + DHT22 + hall/reed cycle counter
- per-relay model personalization
- anomaly explanation panel (feature contribution)
- maintenance work-order export and alert acknowledgements
- historical replay mode for demos.
