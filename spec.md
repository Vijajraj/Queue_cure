# Queue Cure '26 — Full Product Spec
**Target**: Works on every device — smartphone, KaiOS phone, basic feature phone

---

## 1. The Core Problem

76% of India's 1.5 million small clinics run on paper token slips.
Patients wait 2–3 hours with zero visibility. Receptionists manage from memory.
Doctors have no dashboard.

This system fixes that — and works whether the receptionist has an Android phone
or a JioBharat, and whether the patient has a smartphone or gets an SMS.

---

## 2. Device Tiers

| Tier | Device Examples | Capability | Experience |
|------|----------------|------------|------------|
| **T1** | Android/iPhone with Chrome | Full browser + JS | React PWA — live WebSocket updates |
| **T2** | JioBharat, JioPhone Prima (KaiOS) | Basic browser, limited JS | Lite HTML — auto-refresh every 5s |
| **T3** | Nokia 105/225, itel, Lava, Samsung Guru | No browser / 2G only | SMS fallback |

The same backend serves all three tiers. Device capability determines which
frontend layer responds.

---

## 3. User Roles

### 3.1 Receptionist
Manages the queue from her phone at the counter.

| Action | T1 (React PWA) | T2 (Lite HTML) | T3 (SMS) |
|--------|---------------|---------------|----------|
| Add patient | Tap name field → Add button | HTML form → Submit | Text: `ADD Ramesh` |
| Call next | One big green button | HTML button → page reloads | Text: `NEXT` |
| Skip token | Tap Skip on any token | Skip link per row | Text: `SKIP 7` |
| Set avg time | Inline editable field | HTML number input | Text: `TIME 8` |
| View queue | Live list, no refresh | Page refreshes every 5s | Text: `STATUS` → SMS reply |

### 3.2 Patient
Views their position from their own phone while waiting.

| Action | T1 (React PWA) | T2 (Lite HTML) | T3 (SMS) |
|--------|---------------|---------------|----------|
| See current token | Live, no refresh | Auto-refresh every 5s | Receives SMS when 2 tokens away |
| See tokens ahead | Live number | Refreshed number | In SMS: "2 people ahead" |
| See estimated wait | Live, updates on each call | Refreshed | In SMS: "~16 mins" |
| Get notified | Browser tab updates live | Must keep tab open | Automatic SMS push |

---

## 4. System Architecture

```
┌─────────────────────────────────────────────────────┐
│                   CLIENTS                           │
│                                                     │
│  [T1: React PWA]   [T2: Lite HTML]   [T3: SMS]     │
│       |                  |               |          │
│  WebSocket          HTTP Polling     MSG91 API      │
└────────┬─────────────────┬───────────────┬──────────┘
         │                 │               │
         ▼                 ▼               ▼
┌─────────────────────────────────────────────────────┐
│              FastAPI Backend (Python)               │
│                                                     │
│  /ws          — WebSocket endpoint (T1)             │
│  /lite        — Lite HTML pages (T2)                │
│  /sms/receive — Incoming SMS webhook (T3)           │
│  /sms/send    — Outgoing SMS trigger (T3)           │
│  /api/queue   — REST fallback for polling           │
└──────────────────────────┬──────────────────────────┘
                           │
                    In-Memory Queue
                 (Python dict — no DB)
                           │
                    MSG91 SMS Gateway
                  (India — ₹0.15/SMS)
```

---

## 5. In-Memory Queue State

```python
state = {
    "queue": [
        {
            "token_id": 5,
            "patient_name": "Ramesh",
            "phone": "9876543210",   # optional — for SMS tier
            "joined_at": "10:32 AM"
        }
    ],
    "current_token": 4,
    "current_patient_name": "Priya",
    "call_log": [],          # list of consultation durations in minutes
    "last_called_at": None,  # datetime — for rolling avg calculation
    "avg_time_override": None,  # set by receptionist manually
    "next_token_counter": 1  # auto-increment, never repeats in a session
}
```

No database. Queue is ephemeral — resets when server restarts or receptionist
clicks "New Day". This is correct behaviour for a clinic queue.

---

## 6. Wait Time Formula (Real Data — Not Hardcoded)

### How it works

Every time "Call Next" is clicked, the server records how long the previous
consultation actually took. The average of the last 10 consultations becomes
the estimated time per patient.

```python
from collections import deque
from datetime import datetime

call_log = deque(maxlen=10)   # rolling window — last 10 consultations only
last_called_at = None

def on_call_next():
    global last_called_at
    now = datetime.now()

    # Record actual duration of the consultation just completed
    if last_called_at is not None:
        actual_duration_mins = (now - last_called_at).seconds / 60
        call_log.append(round(actual_duration_mins, 1))

    last_called_at = now
    # ... advance queue

def get_avg_time():
    # Priority 1: receptionist has set a manual override
    if state["avg_time_override"]:
        return state["avg_time_override"]
    # Priority 2: rolling average from real call history
    if len(call_log) >= 2:
        return round(sum(call_log) / len(call_log), 1)
    # Priority 3: fallback until enough data exists
    return 10

def get_estimated_wait(tokens_ahead):
    return round(tokens_ahead * get_avg_time(), 1)
```

### Why rolling window of 10?

Resistant to outliers (one 45-minute consultation shouldn't ruin estimates for
the next 20 patients). Adapts to the actual pace of today's session.

### Manual override

Early morning, before any calls have been made, the receptionist sets
"Doctor usually takes 8 mins per patient." System uses that until real data
takes over.

---

## 7. Socket Event Diagram (T1 — WebSocket Layer)

### Client → Server

| Event | Payload | Sent by |
|-------|---------|---------|
| `add_patient` | `{name, phone (optional)}` | Receptionist |
| `call_next` | `{}` | Receptionist |
| `skip_token` | `{token_id}` | Receptionist |
| `set_avg_time` | `{minutes}` | Receptionist |
| `reset_queue` | `{}` | Receptionist (new day) |
| `sync_request` | `{}` | Any client on reconnect |

### Server → All Clients (broadcast)

| Event | Payload |
|-------|---------|
| `queue_update` | Full queue state (see below) |
| `patient_called` | `{token_id, patient_name}` |
| `queue_empty` | `{}` |

### `queue_update` payload

```json
{
  "current_token": 4,
  "current_patient_name": "Priya",
  "avg_consultation_mins": 8.2,
  "queue": [
    {
      "token_id": 5,
      "name": "Ramesh",
      "tokens_ahead": 1,
      "est_wait_mins": 8.2
    },
    {
      "token_id": 6,
      "name": "Kavitha",
      "tokens_ahead": 2,
      "est_wait_mins": 16.4
    }
  ]
}
```

---

## 8. SMS Commands (T3 — Feature Phone Layer)

### Receptionist SMS commands (she texts a registered number)

| She texts | System does |
|-----------|-------------|
| `ADD Ramesh` | Adds Ramesh to queue, replies "Token 7 added for Ramesh" |
| `ADD Ramesh 9876543210` | Adds with phone — patient gets SMS alerts |
| `NEXT` | Infers Token N is done → sends thank-you SMS to Token N → advances queue → notifies Token N+1 → replies "Calling Token 8 — Priya" |
| `SKIP 7` | Removes token 7 from queue |
| `TIME 8` | Sets average consultation time to 8 mins |
| `STATUS` | Replies "Current: Token 7. Waiting: 4 patients. Next: Token 8 — Priya" |
| `RESET` | Clears queue, starts new session |

### Patient SMS alerts (automatic — no action needed)

Triggered automatically by the server when the queue advances:

| Trigger | Patient receives |
|---------|-----------------|
| 3 tokens away | "Queue Cure: 3 people ahead of you. Est. wait: 24 mins." |
| 1 token away | "Queue Cure: You're next! Please return to the clinic." |
| Token called | "Queue Cure: Token 12 — your turn now. Please see the doctor." |
| Next token called (consultation complete) | "Queue Cure: Your visit is complete. Thank you. Get well soon!" |

SMS gateway: **Fast2SMS** (India, ₹0.10–0.15/SMS, no DLT hassle for transactional).
Fallback: **MSG91**.

### How the system knows a consultation is complete

The system does not have a "patient walked out" sensor. It **infers** completion.

When `NEXT` is received (or Call Next is tapped), the server assumes the
previous patient is done — because in a real clinic, the receptionist only
calls the next patient after the doctor signals they are ready for the next one.

The gap between "patient actually done" and "NEXT triggered" is typically
under 30 seconds. Close enough for SMS purposes.

**Critically: button phone and smartphone trigger the exact same backend function.**

```python
def on_call_next():
    # Triggered by: WebSocket event (T1) OR SMS "NEXT" (T3) OR HTML form (T2)
    # All three paths call this same function — device doesn't matter

    prev_token = state["current_token"]
    prev_phone = get_phone_for_token(prev_token)

    # Step 1 — infer previous consultation is done
    if prev_phone:
        send_sms(prev_phone, "Queue Cure: Your visit is complete. Thank you. Get well soon!")

    # Step 2 — record consultation duration for rolling avg
    record_duration()

    # Step 3 — advance queue
    state["current_token"] = state["queue"].pop(0)

    # Step 4 — notify next patient
    next_phone = state["current_token"].get("phone")
    if next_phone:
        send_sms(next_phone, f"Queue Cure: Token {state['current_token']['token_id']} — your turn now.")

    # Step 5 — broadcast updated state to all T1/T2 screens
    broadcast_queue_update()
```

### Full SMS chain when receptionist texts NEXT

```
Receptionist texts: NEXT
        ↓
Server receives /sms/receive webhook
        ↓
Calls on_call_next() — same function as button tap
        ↓
① Sends "Thank you, get well soon" SMS to Token 7's number (if registered)
        ↓
② Records Token 7's consultation duration → updates rolling average
        ↓
③ Advances queue → Token 8 is now current
        ↓
④ Sends "You're next" SMS to Token 8's number (if registered)
        ↓
⑤ Broadcasts queue_update to all open browser screens
        ↓
⑥ Replies to receptionist: "Calling Token 8 — Priya. 3 patients waiting."
```

Everything happens in one text. No browser needed. No app needed.
If a patient has no registered number, steps ① and ④ are silently skipped.

---

## 9. T2 — Lite HTML Pages (KaiOS / Old Browsers)

No React. No WebSockets. Pure server-rendered HTML with a meta refresh tag.

```html
<!-- Patient lite view — /lite/patient?token=12 -->
<meta http-equiv="refresh" content="5">

<h1>Your Token: 12</h1>
<h2>People Ahead: 3</h2>
<h2>Est. Wait: 24 mins</h2>
<p>Current token being seen: 9</p>
<p>Last updated: 10:45 AM</p>
```

```html
<!-- Receptionist lite view — /lite/receptionist -->
<meta http-equiv="refresh" content="5">

<h2>Current Token: 9 — Priya</h2>
<form method="POST" action="/lite/add">
  <input name="name" placeholder="Patient name">
  <button type="submit">Add Patient</button>
</form>
<form method="POST" action="/lite/next">
  <button type="submit">CALL NEXT TOKEN</button>
</form>
<ul>
  <li>Token 10 — Ramesh | 2 ahead | ~16 mins</li>
  <li>Token 11 — Kavitha | 3 ahead | ~24 mins</li>
</ul>
```

Page auto-refreshes every 5 seconds via meta tag. No JS needed. Works on
Nokia 225, KaiOS browser, UC Browser Mini, anything.

---

## 10. PWA Config (T1 — Add to Home Screen)

`manifest.json`:
```json
{
  "name": "Queue Cure",
  "short_name": "QCure",
  "start_url": "/receptionist",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#16a34a",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

Service worker caches the shell so the app loads instantly even on slow 4G.
Receptionist taps "Add to Home Screen" once. After that it behaves like an app.

---

## 11. Receptionist UI Rules (Mobile-First)

- Call Next button: full width, minimum 56px height, green (#16a34a)
- Current token: minimum 72px font, center of screen
- Add Patient: name field auto-focuses on load, Enter key submits
- Skip: requires confirmation dialog ("Skip Token 7 — Ramesh?") — prevents accidents
- Tamil language toggle in top-right corner (all labels switchable to Tamil)
- Color system: Green = active consultation, Yellow = patients waiting, Grey = empty
- Sound: soft beep on "Call Next" (Web Audio API, one line of code)
- No tables, no multi-column layouts — single column only

---

## 12. Concurrency & Edge Cases

| Scenario | Handling |
|----------|----------|
| Double-tap on "Call Next" | Frontend debounce 500ms + server guard: if queue empty, call_next is no-op |
| Two receptionist tabs open | Server state is single source of truth. Both tabs receive same broadcast. Last action wins. |
| Patient disconnects and reconnects | Server holds full state. On reconnect, client emits `sync_request`, server responds with full `queue_update` |
| Doctor takes a long break | Rolling avg will naturally increase as next consultation duration is recorded |
| Queue empties mid-session | `queue_empty` event fired. Receptionist sees "No patients waiting." Call Next button disabled. |
| SMS received with unknown command | Server replies "Unknown command. Send HELP for list of commands." |
| Phone number not registered for a token | SMS alerts simply skipped for that token. No error. |
| Server restart | Queue resets. Acceptable — clinic queue is a daily ephemeral structure. |
| New day | Receptionist sends RESET or clicks "New Day" — clears queue and call log. |

---

## 13. Tech Stack Summary

| Layer | Technology | Why |
|-------|-----------|-----|
| Backend | FastAPI + python-socketio | Familiar from CampusWash, handles both HTTP and WS |
| T1 Frontend | React + Vite + Tailwind + socket.io-client | Fast build, responsive |
| T2 Frontend | Jinja2 HTML templates (served by FastAPI) | Zero JS, works on KaiOS |
| T3 SMS | Fast2SMS API (India) | Cheapest India SMS, no DLT for transactional |
| Queue state | Python in-memory dict | No DB latency, clinic queue is ephemeral |
| PWA | manifest.json + service worker | One-tap install, works offline shell |
| Deploy | Render (backend) + Vercel (frontend) | Free tier, same as CampusWash |
| Keep-alive | UptimeRobot (free) | Pings Render URL every 5 mins — prevents cold start on judge's first click |

---

## 14. API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Redirect to /receptionist |
| GET | `/receptionist` | React PWA shell (T1) |
| GET | `/patient` | React PWA shell (T1) |
| GET | `/lite/receptionist` | Lite HTML view (T2) |
| POST | `/lite/add` | Add patient — form submit (T2) |
| POST | `/lite/next` | Call next — form submit (T2) |
| GET | `/lite/patient` | Lite patient view (T2) |
| GET | `/api/queue` | JSON queue state — for polling |
| POST | `/sms/receive` | Incoming SMS webhook (T3) |
| WS | `/ws` | WebSocket connection (T1) |

---

## 15. Submission Checklist

- [ ] Working prototype deployed (Render + Vercel)
- [ ] UptimeRobot monitor set up pointing to Render backend URL (free at uptimerobot.com — prevents cold start)
- [ ] Demo video recorded on mobile (not laptop)
- [ ] GitHub repo with README explaining all 3 tiers
- [ ] Socket event diagram (use Excalidraw, export as PNG)
- [ ] Thought process sheet covering: rolling avg formula, concurrency handling,
      device tier rationale, SMS fallback design, edge cases table

---

## 16. What Makes This Submission Stand Out

Most submissions will build one React app that works on smartphones and stop
there. This spec covers:

1. **Three device tiers** — the only submission that actually works for India's
   real device distribution, not just urban smartphone users
2. **Rolling average formula** — real data, not hardcoded, with a manual override
   for early-morning sessions
3. **Tamil language support** — one toggle, all labels switch
4. **SMS fallback** — patients on Nokia 105s get notified automatically
5. **Thought process sheet** with specific concurrency scenarios and explicit
   design decision rationale

The problem statement says 76% of clinics run on paper. Many of those receptionists
don't have smartphones. This spec actually solves that.
