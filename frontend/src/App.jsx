import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { UserPlus, UserX, SkipForward, RefreshCw, Languages, Clock, UserCheck } from "lucide-react";

// Get Backend URL from environment variables, defaulting to local port 8000
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

// Language Translation Map
const translations = {
  en: {
    title: "Queue Cure",
    langToggle: "தமிழ்",
    current_token: "CURRENT TOKEN BEING SEEN",
    no_active: "No active patient",
    call_next: "CALL NEXT TOKEN",
    avg_time: "Avg Time per Patient (mins)",
    add_patient: "Add New Patient",
    name_placeholder: "Patient Name",
    phone_placeholder: "Phone Number (Optional)",
    add_btn: "Add Patient",
    waiting_list: "Waiting List",
    tokens_ahead: "ahead",
    est_wait: "Est. Wait",
    skip: "Skip",
    empty_queue: "No patients waiting",
    reset_btn: "New Day (Reset)",
    confirm_skip: "Skip Token {token_id} — {name}?",
    queue_empty_alert: "Queue is empty!",
    alert_title: "Notice",
  },
  ta: {
    title: "கியூ கியூர்",
    langToggle: "English",
    current_token: "தற்போதைய டோக்கன்",
    no_active: "நோயாளி யாரும் இல்லை",
    call_next: "அடுத்த டோக்கனை அழைக்கவும்",
    avg_time: "சராசரி நேரம் (நிமிடங்கள்)",
    add_patient: "புதிய நோயாளி சேர்க்கவும்",
    name_placeholder: "நோயாளி பெயர்",
    phone_placeholder: "தொலைபேசி எண் (விரும்பினால்)",
    add_btn: "நோயாளி சேர்க்க",
    waiting_list: "காத்திருப்போர் பட்டியல்",
    tokens_ahead: "முன்னால்",
    est_wait: "காத்திருப்பு நேரம்",
    skip: "தவிர்க்க",
    empty_queue: "நோயாளி யாரும் காத்திருக்கவில்லை",
    reset_btn: "புதிய நாள் (மீட்டமை)",
    confirm_skip: "டோக்கன் {token_id} — {name} தவிர்க்கவா?",
    queue_empty_alert: "வரிசை காலியாக உள்ளது!",
    alert_title: "அறிவிப்பு",
  }
};

export default function App() {
  const [socket, setSocket] = useState(null);
  const [queueState, setQueueState] = useState({
    current_token: null,
    current_patient_name: null,
    avg_consultation_mins: 10.0,
    queue: [],
  });

  const [lang, setLang] = useState("en");
  const [nameInput, setNameInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [avgTimeInput, setAvgTimeInput] = useState("10");
  const [isDebouncing, setIsDebouncing] = useState(false);
  const nameInputRef = useRef(null);

  const t = translations[lang];

  // Soft beep sound generator using Web Audio API
  const playBeep = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = "sine";
      osc.frequency.setValueAtTime(600, ctx.currentTime); // soft 600Hz frequency
      gain.gain.setValueAtTime(0.1, ctx.currentTime); // quiet volume
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.15); // play for 150ms
    } catch (err) {
      console.warn("Audio Context could not start:", err);
    }
  };

  useEffect(() => {
    // Connect to python-socketio server at mount
    const socketInstance = io(BACKEND_URL, {
      path: "/ws/socket.io", // Matches FastAPI mounted /ws path
      transports: ["websocket", "polling"],
    });

    socketInstance.on("connect", () => {
      console.log("Connected to WebSocket Server");
      socketInstance.emit("sync_request");
    });

    socketInstance.on("queue_update", (data) => {
      console.log("Received queue_update:", data);
      setQueueState(data);
      setAvgTimeInput(data.avg_consultation_mins.toString());
    });

    socketInstance.on("queue_empty", () => {
      alert(t.queue_empty_alert);
    });

    socketInstance.on("patient_called", (data) => {
      console.log("Patient called:", data);
      playBeep();
    });

    setSocket(socketInstance);

    // Auto focus name field on load
    if (nameInputRef.current) {
      nameInputRef.current.focus();
    }

    return () => {
      socketInstance.disconnect();
    };
  }, [lang]);

  // Debounced Call Next
  const handleCallNext = () => {
    if (isDebouncing) return;
    setIsDebouncing(true);
    
    // Play a local beep immediately for receptionist feedback
    playBeep();
    
    socket.emit("call_next");
    
    setTimeout(() => {
      setIsDebouncing(false);
    }, 500); // 500ms debounce
  };

  // Add Patient
  const handleAddPatient = (e) => {
    e.preventDefault();
    if (!nameInput.trim()) return;

    socket.emit("add_patient", {
      name: nameInput.trim(),
      phone: phoneInput.trim() || null,
    });

    setNameInput("");
    setPhoneInput("");
    if (nameInputRef.current) {
      nameInputRef.current.focus();
    }
  };

  // Skip Patient
  const handleSkip = (tokenId, patientName) => {
    const confirmationMsg = t.confirm_skip
      .replace("{token_id}", tokenId)
      .replace("{name}", patientName);

    if (window.confirm(confirmationMsg)) {
      socket.emit("skip_token", { token_id: tokenId });
    }
  };

  // Set Average Consultation Time
  const handleAvgTimeChange = (e) => {
    const value = e.target.value;
    setAvgTimeInput(value);
    const floatVal = parseFloat(value);
    if (!isNaN(floatVal) && floatVal > 0) {
      socket.emit("set_avg_time", { minutes: floatVal });
    }
  };

  // Reset Queue
  const handleReset = () => {
    if (window.confirm("Are you sure you want to reset the queue? (New Day)")) {
      socket.emit("reset_queue");
    }
  };

  const hasPatients = queueState.queue.length > 0;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10 px-4 py-3 flex justify-between items-center shadow-xs">
        <h1 className="text-2xl font-extrabold text-green-600 flex items-center gap-2 m-0">
          <Clock className="w-6 h-6 text-green-600 animate-pulse" />
          {t.title}
        </h1>
        <button
          onClick={() => setLang(lang === "en" ? "ta" : "en")}
          className="bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-lg px-3 py-1.5 font-bold flex items-center gap-1.5 transition-colors cursor-pointer text-sm"
        >
          <Languages className="w-4 h-4 text-gray-600" />
          {t.langToggle}
        </button>
      </header>

      {/* Main Single Column Layout */}
      <main className="flex-1 max-w-md w-full mx-auto p-4 space-y-6">
        
        {/* Top: Current Token Card */}
        <div
          className={`p-6 rounded-2xl border text-center transition-all duration-300 ${
            queueState.current_token
              ? "bg-emerald-50 border-emerald-300 shadow-md shadow-emerald-100/50"
              : "bg-gray-100 border-gray-300"
          }`}
        >
          <span className="text-xs tracking-widest font-extrabold text-gray-500 uppercase block mb-1">
            {t.current_token}
          </span>
          <span
            className={`text-7xl font-black block my-2 transition-all ${
              queueState.current_token ? "text-emerald-600" : "text-gray-500"
            }`}
          >
            {queueState.current_token || "—"}
          </span>
          <span className="text-xl font-bold text-gray-800 flex items-center justify-center gap-1.5">
            {queueState.current_token ? (
              <>
                <UserCheck className="w-5 h-5 text-emerald-600" />
                {queueState.current_patient_name}
              </>
            ) : (
              t.no_active
            )}
          </span>
        </div>

        {/* Call Next Button */}
        <div>
          <button
            onClick={handleCallNext}
            disabled={!hasPatients || isDebouncing}
            className="w-full h-14 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-extrabold text-lg rounded-xl shadow-lg shadow-emerald-600/20 disabled:opacity-50 disabled:pointer-events-none transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            {t.call_next}
          </button>
        </div>

        {/* Avg Consultation Time Field */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between shadow-xs">
          <label className="text-sm font-bold text-gray-600 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-gray-400" />
            {t.avg_time}
          </label>
          <input
            type="number"
            value={avgTimeInput}
            onChange={handleAvgTimeChange}
            min="1"
            max="120"
            step="0.5"
            className="w-20 h-10 text-center font-extrabold text-lg border-2 border-gray-200 focus:border-green-500 focus:ring-0 rounded-lg outline-hidden"
          />
        </div>

        {/* Add Patient Form */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-xs">
          <h2 className="text-lg font-extrabold text-gray-800 mb-4 flex items-center gap-2 mt-0">
            <UserPlus className="w-5 h-5 text-blue-500" />
            {t.add_patient}
          </h2>
          <form onSubmit={handleAddPatient} className="space-y-4">
            <input
              type="text"
              ref={nameInputRef}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder={t.name_placeholder}
              required
              className="w-full h-12 px-4 border-2 border-gray-200 focus:border-green-500 focus:ring-0 rounded-xl outline-hidden text-base font-medium"
            />
            <input
              type="tel"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder={t.phone_placeholder}
              className="w-full h-12 px-4 border-2 border-gray-200 focus:border-green-500 focus:ring-0 rounded-xl outline-hidden text-base font-medium"
            />
            <button
              type="submit"
              className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-extrabold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              {t.add_btn}
            </button>
          </form>
        </div>

        {/* Waiting List Queue */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-xs">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-extrabold text-gray-800 m-0">
              {t.waiting_list} ({queueState.queue.length})
            </h2>
            <button
              onClick={handleReset}
              className="text-red-500 hover:text-red-700 font-bold text-xs flex items-center gap-1 px-2.5 py-1.5 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              {t.reset_btn}
            </button>
          </div>

          {hasPatients ? (
            <div className="space-y-3">
              {queueState.queue.map((item) => (
                <div
                  key={item.token_id}
                  className="flex items-center justify-between p-4 bg-amber-50/50 border border-amber-200 rounded-xl"
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-extrabold text-amber-700">
                      Token {item.token_id}
                    </span>
                    <span className="text-base font-bold text-gray-800">
                      {item.name}
                    </span>
                    <span className="text-xs text-gray-500 mt-0.5">
                      {item.tokens_ahead} {t.tokens_ahead} • {t.est_wait}: ~{item.est_wait_mins} min
                    </span>
                  </div>
                  <button
                    onClick={() => handleSkip(item.token_id, item.name)}
                    className="h-9 px-3 bg-white border border-gray-300 hover:bg-red-50 hover:text-red-500 hover:border-red-200 text-gray-600 font-bold text-sm rounded-lg flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                  >
                    <SkipForward className="w-3.5 h-3.5" />
                    {t.skip}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-xl">
              <UserX className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <span className="text-gray-400 font-medium">{t.empty_queue}</span>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
