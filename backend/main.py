import asyncio
from collections import deque
from datetime import datetime
import os
import re
from typing import Dict, List, Optional, Any
import uvicorn
from fastapi import FastAPI, Request, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, RedirectResponse
import socketio
import httpx

# Shared HTTP client for outgoing SMS requests (reuses connections)
http_client = httpx.AsyncClient(timeout=10.0)

# Lock to prevent concurrent execution of call_next / race conditions
_call_next_lock = asyncio.Lock()

app = FastAPI(
    title="Queue Cure Backend",
    description="Backend API for Queue Cure Clinic Queue Management System",
    version="1.0.0",
)

# Enable CORS for all origins (fastapi endpoints)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Setup Socket.IO Server with ASGI support and CORS allowed for all origins
sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
sio_app = socketio.ASGIApp(sio, socketio_path="")
app.mount("/ws", sio_app)

# Initialize Jinja2 templates
templates = Jinja2Templates(directory="templates")

# Load environment variables from .env file if it exists
if os.path.exists(".env"):
    with open(".env") as f:
        for line in f:
            if line.strip() and not line.strip().startswith("#"):
                parts = line.strip().split("=", 1)
                if len(parts) == 2:
                    os.environ[parts[0].strip()] = parts[1].strip()

# Fast2SMS API Key from Environment
FAST2SMS_API_KEY = os.getenv("FAST2SMS_API_KEY", "YOUR_FAST2SMS_API_KEY")

def normalize_phone(phone: Optional[str]) -> Optional[str]:
    if not phone:
        return None
    # Extract digits only
    phone_clean = re.sub(r"\D", "", str(phone))
    if len(phone_clean) >= 10:
        return phone_clean[-10:]
    return phone_clean if phone_clean else None

# In-memory queue state
state: Dict[str, Any] = {
    "queue": [],  # list of tokens: { token_id, patient_name, phone (optional), joined_at }
    "current_token": None,
    "current_patient_name": None,
    "current_phone": None,
    "call_log": deque(maxlen=10),
    "last_called_at": None,
    "avg_time_override": None,
    "next_token_counter": 1,
}

def get_avg_time() -> float:
    # Priority 1: receptionist has set a manual override
    if state["avg_time_override"] is not None:
        return float(state["avg_time_override"])
    # Priority 2: rolling average from real call history
    if len(state["call_log"]) >= 2:
        return round(sum(state["call_log"]) / len(state["call_log"]), 1)
    # Priority 3: fallback until enough data exists
    return 10.0

def get_queue_update_payload() -> Dict[str, Any]:
    avg_time = get_avg_time()
    queue_payload = []
    for idx, item in enumerate(state["queue"]):
        tokens_ahead = idx + 1
        queue_payload.append({
            "token_id": item["token_id"],
            "name": item["patient_name"],
            "tokens_ahead": tokens_ahead,
            "est_wait_mins": round(tokens_ahead * avg_time, 1)
        })
    return {
        "current_token": state["current_token"],
        "current_patient_name": state["current_patient_name"],
        "avg_consultation_mins": avg_time,
        "queue": queue_payload
    }

async def broadcast_queue_update():
    payload = get_queue_update_payload()
    await sio.emit("queue_update", payload)

async def send_sms(phone: str, message: str):
    phone_clean = normalize_phone(phone)
    if not phone_clean:
        return
        
    print(f"[SMS OUT] Sending to {phone_clean}: {message}")
    
    # Check if Fast2SMS key is set to a real key
    if not FAST2SMS_API_KEY or FAST2SMS_API_KEY == "YOUR_FAST2SMS_API_KEY":
        print("[SMS OUT] Fast2SMS API Key not set. Skipping real API call.")
        return
        
    url = "https://www.fast2sms.com/dev/bulkV2"
    headers = {
        "authorization": FAST2SMS_API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
    }
    payload = {
        "route": "q",
        "message": message,
        "language": "english",
        "numbers": phone_clean,
    }
    
    try:
        response = await http_client.post(url, data=payload, headers=headers)
        print(f"[SMS OUT] Fast2SMS Response: {response.status_code} - {response.text}")
    except Exception as e:
        print(f"[SMS OUT] Error sending SMS: {e}")

async def on_call_next() -> str:
    if not state["queue"]:
        # Guard: if queue is empty
        await sio.emit("queue_empty", {})
        return "Queue is empty."
        
    now = datetime.now()
    
    # 1. Previous token consultation ends -> Send SMS to previous patient
    prev_phone = state.get("current_phone")
    if prev_phone:
        await send_sms(prev_phone, "Your visit is complete. Thank you. Get well soon!")
        
    # 2. Record actual duration of previous consultation
    if state["last_called_at"] is not None:
        actual_duration_mins = (now - state["last_called_at"]).total_seconds() / 60
        state["call_log"].append(round(actual_duration_mins, 1))
        
    state["last_called_at"] = now
    
    # 3. Re-check queue after awaits (another event may have drained it)
    if not state["queue"]:
        await sio.emit("queue_empty", {})
        return "Queue is empty."
    
    # 4. Advance queue
    next_patient = state["queue"].pop(0)
    state["current_token"] = next_patient["token_id"]
    state["current_patient_name"] = next_patient["patient_name"]
    state["current_phone"] = next_patient.get("phone")
    
    # 4. Notify new current patient
    curr_phone = next_patient.get("phone")
    if curr_phone:
        await send_sms(curr_phone, f"Token {next_patient['token_id']} — your turn now. Please see the doctor.")
        
    # 5. Notify new next patient (1 token away, now at index 0 of queue)
    if len(state["queue"]) > 0:
        next_in_line = state["queue"][0]
        nil_phone = next_in_line.get("phone")
        if nil_phone:
            await send_sms(nil_phone, "You're next! Please return to clinic.")
            
    # 6. Notify patient who is 3 tokens away (now at index 2 of queue)
    if len(state["queue"]) > 2:
        three_away = state["queue"][2]
        three_phone = three_away.get("phone")
        if three_phone:
            avg_time = get_avg_time()
            est_wait = round(3 * avg_time, 1)
            await send_sms(three_phone, f"3 people ahead. Est. wait: {est_wait} mins.")
            
    # Broadcast queue_update and patient_called
    await broadcast_queue_update()
    await sio.emit("patient_called", {
        "token_id": next_patient["token_id"],
        "patient_name": next_patient["patient_name"]
    })
    
    waiting_count = len(state["queue"])
    return f"Calling Token {next_patient['token_id']} — {next_patient['patient_name']}. {waiting_count} patients waiting."

async def process_sms_command(sender: str, message_body: str) -> str:
    message_body = message_body.strip()
    words = message_body.split()
    if not words:
        return "Unknown command. Send HELP for commands."
        
    cmd = words[0].upper()
    
    if cmd == "ADD":
        match = re.match(r"^ADD\s+(.+)$", message_body, re.IGNORECASE)
        if not match:
            return "Command error. Format: ADD <name> [phone]"
        content = match.group(1).strip()
        cmd_words = content.split()
        phone = None
        if len(cmd_words) > 1 and re.match(r"^\+?\d{10,12}$", cmd_words[-1]):
            phone = normalize_phone(cmd_words[-1])
            name = " ".join(cmd_words[:-1])
        else:
            name = content
            
        token_id = state["next_token_counter"]
        state["next_token_counter"] += 1
        joined_at = datetime.now().strftime("%I:%M %p")
        
        new_patient = {
            "token_id": token_id,
            "patient_name": name,
            "phone": phone,
            "joined_at": joined_at
        }
        state["queue"].append(new_patient)
        
        await broadcast_queue_update()
        
        # If they registered a phone, send confirmation
        if phone:
            await send_sms(phone, f"Token {token_id} added for {name}")
            
        return f"Token {token_id} added for {name}"
        
    elif cmd == "NEXT":
        if _call_next_lock.locked():
            return "Another call is in progress. Try again."
        async with _call_next_lock:
            return await on_call_next()
        
    elif cmd == "SKIP":
        if len(words) < 2:
            return "Command error. Format: SKIP <token_id>"
        try:
            token_id = int(words[1])
        except ValueError:
            return f"Invalid token ID: {words[1]}"
            
        initial_len = len(state["queue"])
        state["queue"] = [t for t in state["queue"] if t["token_id"] != token_id]
        new_len = len(state["queue"])
        
        if new_len < initial_len:
            await broadcast_queue_update()
            return f"Token {token_id} skipped."
        else:
            return f"Token {token_id} not found in queue."
            
    elif cmd == "TIME":
        if len(words) < 2:
            return "Command error. Format: TIME <minutes>"
        try:
            minutes = float(words[1])
        except ValueError:
            return f"Invalid minutes value: {words[1]}"
            
        if minutes <= 0:
            return "Invalid minutes value. Must be greater than 0."
            
        state["avg_time_override"] = minutes
        await broadcast_queue_update()
        return f"Average time override set to {minutes} minutes."
        
    elif cmd == "STATUS":
        current_token = state["current_token"]
        current_name = state["current_patient_name"] or "None"
        waiting_count = len(state["queue"])
        
        next_patient_str = "None"
        if state["queue"]:
            next_p = state["queue"][0]
            next_patient_str = f"Token {next_p['token_id']} — {next_p['patient_name']}"
            
        current_str = f"Token {current_token} — {current_name}" if current_token else "None"
        return f"Current: {current_str}. Waiting: {waiting_count} patients. Next: {next_patient_str}"
        
    elif cmd == "RESET":
        state["queue"] = []
        state["current_token"] = None
        state["current_patient_name"] = None
        state["current_phone"] = None
        state["call_log"].clear()
        state["last_called_at"] = None
        state["avg_time_override"] = None
        # Token counter keeps incrementing across resets to prevent ID collision
        # with stale patient pages still open from the previous session
        await broadcast_queue_update()
        return "Queue reset. Ready for new session."
        
    elif cmd == "HELP":
        return "Commands: ADD <name> [phone], NEXT, SKIP <token_id>, TIME <minutes>, STATUS, RESET"
        
    else:
        return "Unknown command. Send HELP for commands."

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.get("/api/queue")
def get_queue():
    return get_queue_update_payload()

# --- Jinja2 Lite HTML Routes for Feature Phones & KaiOS ---

@app.get("/lite/receptionist", response_class=HTMLResponse)
async def lite_receptionist(request: Request):
    payload = get_queue_update_payload()
    return templates.TemplateResponse(
        "receptionist.html",
        {
            "request": request,
            "state": state,
            "queue_payload": payload["queue"]
        }
    )

@app.post("/lite/add")
async def lite_add(request: Request, name: str = Form(...), phone: Optional[str] = Form(None)):
    name = name.strip()
    if name:
        token_id = state["next_token_counter"]
        state["next_token_counter"] += 1
        joined_at = datetime.now().strftime("%I:%M %p")
        
        phone_val = normalize_phone(phone)
        
        new_patient = {
            "token_id": token_id,
            "patient_name": name,
            "phone": phone_val,
            "joined_at": joined_at
        }
        state["queue"].append(new_patient)
        
        await broadcast_queue_update()
        
        if phone_val:
            await send_sms(phone_val, f"Token {token_id} added for {name}")
            
    return RedirectResponse(url="/lite/receptionist", status_code=303)

@app.post("/lite/next")
async def lite_next(request: Request):
    if _call_next_lock.locked():
        return RedirectResponse(url="/lite/receptionist", status_code=303)
    async with _call_next_lock:
        await on_call_next()
    return RedirectResponse(url="/lite/receptionist", status_code=303)

@app.get("/lite/patient", response_class=HTMLResponse)
async def lite_patient(request: Request, token: Optional[int] = None):
    last_updated = datetime.now().strftime("%I:%M %p")
    if token is None:
        return templates.TemplateResponse(
            "patient.html",
            {
                "request": request,
                "status": "error",
                "token": None,
                "last_updated": last_updated
            }
        )
        
    current_token = state["current_token"]
    current_patient_name = state["current_patient_name"]
    
    # 1. Check if token is currently being seen
    if current_token == token:
        status = "current"
        tokens_ahead = 0
        est_wait_mins = 0
    else:
        # 2. Check if token is in the waiting queue
        found_idx = -1
        for idx, item in enumerate(state["queue"]):
            if item["token_id"] == token:
                found_idx = idx
                break
                
        if found_idx != -1:
            status = "waiting"
            tokens_ahead = found_idx + 1
            avg_time = get_avg_time()
            est_wait_mins = round(tokens_ahead * avg_time, 1)
        else:
            # 3. Check if token is completed (already processed)
            if current_token is not None and token < current_token:
                status = "completed"
            else:
                status = "not_found"
            tokens_ahead = 0
            est_wait_mins = 0
            
    return templates.TemplateResponse(
        "patient.html",
        {
            "request": request,
            "status": status,
            "token": token,
            "tokens_ahead": tokens_ahead,
            "est_wait_mins": est_wait_mins,
            "current_token": current_token,
            "current_patient_name": current_patient_name,
            "last_updated": last_updated
        }
    )

@app.post("/sms/receive")
async def receive_sms_webhook(request: Request):
    # Try parsing body as JSON first, fallback to form-urlencoded
    data = {}
    try:
        data = await request.json()
    except Exception:
        try:
            form_data = await request.form()
            data = dict(form_data)
        except Exception:
            pass
            
    print(f"[SMS IN] Webhook payload: {data}")
    
    sender = (
        data.get("sender") or 
        data.get("number") or 
        data.get("phone") or 
        data.get("from") or 
        data.get("mobile") or 
        data.get("msisdn")
    )
    message_body = (
        data.get("message") or 
        data.get("text") or 
        data.get("body") or 
        data.get("msg") or 
        data.get("content")
    )
    
    if not sender or not message_body:
        return {"error": "Missing sender or message content"}
        
    reply_text = await process_sms_command(str(sender), str(message_body))
    
    # Send reply SMS back to the sender
    await send_sms(str(sender), reply_text)
    
    return {"reply": reply_text}

# --- Socket.IO Event Handlers ---

@sio.on("connect")
async def handle_connect(sid, environ):
    print(f"Client connected: {sid}")

@sio.on("disconnect")
async def handle_disconnect(sid):
    print(f"Client disconnected: {sid}")

@sio.on("add_patient")
async def handle_add_patient(sid, data):
    if not isinstance(data, dict):
        return
    name = data.get("name")
    phone = data.get("phone")
    phone = normalize_phone(phone)
    if not name:
        return
        
    token_id = state["next_token_counter"]
    state["next_token_counter"] += 1
    joined_at = datetime.now().strftime("%I:%M %p")
    
    new_patient = {
        "token_id": token_id,
        "patient_name": name,
        "phone": phone,
        "joined_at": joined_at
    }
    state["queue"].append(new_patient)
    await broadcast_queue_update()

@sio.on("call_next")
async def handle_call_next(sid, data=None):
    if _call_next_lock.locked():
        return
    async with _call_next_lock:
        await on_call_next()

@sio.on("skip_token")
async def handle_skip_token(sid, data):
    token_id = None
    if isinstance(data, dict):
        token_id = data.get("token_id")
    elif isinstance(data, (int, str)):
        token_id = int(data)
        
    if token_id is not None:
        state["queue"] = [t for t in state["queue"] if t["token_id"] != token_id]
        await broadcast_queue_update()

@sio.on("set_avg_time")
async def handle_set_avg_time(sid, data):
    minutes = None
    if isinstance(data, dict):
        minutes = data.get("minutes")
    elif isinstance(data, (int, float, str)):
        minutes = float(data)
        
    if minutes is not None and float(minutes) > 0:
        state["avg_time_override"] = float(minutes)
        await broadcast_queue_update()

@sio.on("reset_queue")
async def handle_reset_queue(sid, data=None):
    state["queue"] = []
    state["current_token"] = None
    state["current_patient_name"] = None
    state["current_phone"] = None
    state["call_log"].clear()
    state["last_called_at"] = None
    state["avg_time_override"] = None
    # Token counter keeps incrementing across resets to prevent ID collision
    await broadcast_queue_update()

@sio.on("sync_request")
async def handle_sync_request(sid, data=None):
    payload = get_queue_update_payload()
    await sio.emit("queue_update", payload, to=sid)

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
