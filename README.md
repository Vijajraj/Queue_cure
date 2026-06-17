# Queue Cure '26 — Full Product Spec & Documentation

Queue Cure is a multi-tiered, real-time clinic queue management system designed to eliminate long waiting times and improve queue transparency at small Indian clinics. It is built to run on **every device** — from advanced smartphones to KaiOS feature phones (JioBharat) and basic 2G button phones (Nokia 105).

---

## 1. Device Tiers (Multi-Tier Architecture)

| Tier | Target Devices | Capabilities | Client Implementation & Communication |
| :--- | :--- | :--- | :--- |
| **T1** | Android, iOS, Modern Desktop | HTML5, CSS3, ES6, WebSockets | **React PWA**: Uses `socket.io-client` for real-time WebSocket state synchronizations, Audio Cues via Web Audio API, and PWA manifest + Service Worker caching. |
| **T2** | JioBharat, JioPhone Prima (KaiOS), UC Browser Mini | HTML, Form POST, no JS or limited JS | **Lite HTML**: Served as Jinja2 HTML templates from FastAPI with zero Javascript. Pages use `<meta http-equiv="refresh" content="5">` to poll state updates. |
| **T3** | Nokia 105/225, itel, Samsung Guru | No browser / 2G connection | **SMS Fallback**: Triggered via Fast2SMS SMS gateway API. Webhook `POST /sms/receive` parses commands (`ADD`, `NEXT`, `STATUS`, `RESET`, `SKIP`, `TIME`) and replies to receptionists/patients automatically. |

---

## 2. Technical Stack Summary

- **Backend**: FastAPI (Python) + python-socketio + Jinja2 (HTML rendering) + httpx (outgoing SMS calls)
- **T1 Frontend**: React + Vite + Tailwind CSS v4.0 + socket.io-client + Lucide Icons
- **SMS Gateway**: Fast2SMS API (India, transactional route `q`)
- **Queue State**: Ephemeral in-memory queue (Python dict) with rolling average wait calculations (last 10 called durations).

---

## 3. Local Setup Instructions

### 3.1 Backend Setup (FastAPI)

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Create and activate a Python virtual environment:
   ```bash
   uv venv
   .venv\Scripts\activate
   ```
3. Install dependencies:
   ```bash
   uv pip install -r requirements.txt
   ```
4. Create a `.env` file in the `backend/` directory to store your Fast2SMS API key:
   ```env
   FAST2SMS_API_KEY=your_fast2sms_api_key_here
   ```
5. Run the server using Uvicorn:
   ```bash
   .venv\Scripts\python main.py
   ```
   *The backend will run on `http://127.0.0.1:8000`.*

### 3.2 Frontend Setup (React PWA)

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install Node dependencies:
   ```bash
   npm install
   ```
3. Configure the environment variables. Create a `.env.local` file:
   ```env
   VITE_BACKEND_URL=http://localhost:8000
   ```
4. Start the Vite development server:
   ```bash
   npm run dev
   ```
   *The frontend will run on `http://localhost:5173`.*

---

## 4. Deployment Instructions

### 4.1 Backend Deployment (Render)

1. Push the repository to GitHub.
2. Sign in to [Render](https://render.com) and create a new **Web Service**.
3. Link your GitHub repository and set:
   - **Environment**: `Python`
   - **Build Command**: `pip install -r backend/requirements.txt`
   - **Start Command**: `uvicorn backend.main:app --host 0.0.0.5 --port $PORT` (Wait, since we mounted socketio on the app, running uvicorn on the file `backend.main:app` is correct).
4. Add Environment Variable:
   - `FAST2SMS_API_KEY`: Your Fast2SMS API key.

### 4.2 Frontend Deployment (Vercel)

1. Sign in to [Vercel](https://vercel.com) and click **Add New Project**.
2. Connect your GitHub repository and set the root directory to `frontend`.
3. Add Environment Variable:
   - `VITE_BACKEND_URL`: Set to the deployed Render backend URL (e.g. `https://queue-cure-backend.onrender.com`).
4. Click **Deploy**.

### 4.3 Keep-Alive (UptimeRobot Setup)

Render's free tier spins down web services after 15 minutes of inactivity. To prevent a "cold start" wait on the judge's first click:
1. Sign up for a free account at [UptimeRobot](https://uptimerobot.com).
2. Click **Add New Monitor**.
3. Select **HTTP(s)** monitor type.
4. Set the friendly name as `Queue Cure Backend` and paste your Render `/health` endpoint (e.g., `https://queue-cure-backend.onrender.com/health`).
5. Set the monitoring interval to **5 minutes**.

---

## 5. System Architecture & Event Diagrams

### 5.1 Architecture Flow

```
┌─────────────────────────────────────────────────────┐
│                   CLIENTS                           │
│                                                     │
│  [T1: React PWA]   [T2: Lite HTML]   [T3: SMS]     │
│       |                  |               |          │
│  WebSocket          HTTP Polling     Fast2SMS API   │
└────────┬─────────────────┬───────────────┬──────────┘
         │                 │               │
         ▼                 ▼               ▼
┌─────────────────────────────────────────────────────┐
│              FastAPI Backend (Python)               │
│                                                     │
│  /ws          — WebSocket endpoint (T1)             │
│  /lite        — Lite HTML pages (T2)                │
│  /sms/receive — Incoming SMS webhook (T3)           │
│  /api/queue   — REST fallback for polling           │
└──────────────────────────┬──────────────────────────┘
                           │
                    In-Memory Queue
                           │
                    Fast2SMS Gateway
```

### 5.2 Socket Events Map

- **Client → Server Events**:
  - `add_patient`: `{name, phone (optional)}`
  - `call_next`: `{}`
  - `skip_token`: `{token_id}`
  - `set_avg_time`: `{minutes}`
  - `reset_queue`: `{}`
  - `sync_request`: `{}`
- **Server → Client Broadcasts**:
  - `queue_update`: `{ current_token, current_patient_name, avg_consultation_mins, queue: [...] }`
  - `queue_empty`: `{}`
  - `patient_called`: `{ token_id, patient_name }`