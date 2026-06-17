import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { UserPlus, UserX, SkipForward, RefreshCw, Languages, Clock, UserCheck, QrCode, Clipboard } from "lucide-react";

// Get Backend URL from environment variables, defaulting to local port 8000
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

// Language Translation Map
const translations = {
  en: {
    title: "Queue Cure",
    langToggle: "தமிழ்",
    current_token: "CURRENT TOKEN BEING SEEN",
    no_active: "No active patient",
    call_next: "Call Next Token",
    avg_time: "Avg Time per Patient (mins)",
    add_patient_title: "Add Patient",
    name_placeholder: "Patient Name",
    phone_placeholder: "Phone Number (Optional)",
    add_btn: "Add Patient",
    people_waiting: "People Waiting",
    tokens_ahead: "ahead",
    est_wait: "Est. Wait",
    skip: "Skip",
    empty_queue: "No patients waiting",
    reset_btn: "New Day / Reset",
    confirm_skip: "Skip Token {token_id} — {name}?",
    confirm_reset: "Are you sure you want to reset the queue? (New Day)",
    queue_empty_alert: "Queue is empty!",
    alert_title: "Notice",
    
    // Patient Screen
    patient_title: "Patient Queue Status",
    enter_token: "Enter Your Token Number",
    token_placeholder: "e.g. 5",
    your_status: "YOUR STATUS",
    status_current: "YOUR TURN NOW! Please see the doctor.",
    status_completed: "Your visit is complete. Get well soon!",
    status_waiting: "Waiting in Line",
    people_ahead: "People Ahead",
    current_seen: "Current Token Being Seen",
    scan_lite: "Scan for Lite HTML (Auto-refresh)",
    no_smartphone: "No smartphone? Note down this link for basic phones:",
    view_receptionist: "View Receptionist Screen"
  },
  ta: {
    title: "கியூ கியூர்",
    langToggle: "English",
    current_token: "செயலில் உள்ள டோக்கன்",
    no_active: "நோயாளி யாரும் இல்லை",
    call_next: "அடுத்த டோக்கன்",
    avg_time: "சராசரி நேரம் (நிமிடங்கள்)",
    add_patient_title: "நோயாளியை சேர்",
    name_placeholder: "நோயாளியின் பெயர்",
    phone_placeholder: "தொலைபேசி எண் (விருப்பம்)",
    add_btn: "நோயாளியை சேர்",
    people_waiting: "காத்திருக்கும் நோயாளிகள்",
    tokens_ahead: "முன்னால்",
    est_wait: "காத்திருப்பு நேரம்",
    skip: "தவிர்",
    empty_queue: "நோயாளி யாரும் காத்திருக்கவில்லை",
    reset_btn: "புதிய நாள் / மீட்டமை",
    confirm_skip: "டோக்கன் {token_id} — {name} தவிர்க்கவா?",
    confirm_reset: "டோக்கன் வரிசையை மீட்டமைக்க விரும்புகிறீர்களா?",
    queue_empty_alert: "வரிசை காலியாக உள்ளது!",
    alert_title: "அறிவிப்பு",
    
    // Patient Screen
    patient_title: "நோயாளி வரிசை நிலை",
    enter_token: "உங்கள் டோக்கன் எண்ணை உள்ளிடவும்",
    token_placeholder: "உதாரணமாக: 5",
    your_status: "உங்கள் நிலை",
    status_current: "உங்கள் முறை! தயவுசெய்து மருத்துவரை பார்க்கவும்.",
    status_completed: "உங்கள் வருகை முடிந்தது. நலம் பெற வாழ்த்துக்கள்!",
    status_waiting: "வரிசையில் காத்திருக்கிறது",
    people_ahead: "காத்திருப்போர் எண்ணிக்கை",
    current_seen: "இப்போது பார்க்கப்படும் டோக்கன்",
    scan_lite: "லைட் பதிப்பிற்கு ஸ்கேன் செய்யவும் (தானியங்கி புதுப்பிப்பு)",
    no_smartphone: "ஸ்மார்ட்போன் இல்லையா? பொத்தான் போன்களுக்கு இந்த இணைப்பை எழுதவும்:",
    view_receptionist: "வரவேற்பாளர் திரையைக் காட்டு"
  }
};

export default function App() {
  const [socket, setSocket] = useState(null);
  const [role, setRole] = useState("receptionist"); // "receptionist" or "patient"
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
  
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [alertDialog, setAlertDialog] = useState(null);

  // Patient Screen state
  const [patientToken, setPatientToken] = useState("");

  const nameInputRef = useRef(null);
  const t = translations[lang];
  const tRef = useRef(t);
  tRef.current = t;

  // Route/Role detection on mount
  useEffect(() => {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    if (path.includes("/patient") || params.get("role") === "patient") {
      setRole("patient");
    } else {
      setRole("receptionist");
    }
  }, []);

  // Soft beep sound using Web Audio API
  const playBeep = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = "sine";
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch (err) {
      console.warn("Audio Context could not start:", err);
    }
  };

  useEffect(() => {
    const socketInstance = io(BACKEND_URL, {
      path: "/ws/socket.io",
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
      setAlertDialog({
        title: tRef.current.alert_title || "Notice",
        message: tRef.current.queue_empty_alert
      });
    });

    socketInstance.on("patient_called", (data) => {
      console.log("Patient called:", data);
      playBeep();
    });

    setSocket(socketInstance);

    return () => {
      socketInstance.disconnect();
    };
  }, []);

  // Debounced Call Next
  const handleCallNext = () => {
    if (isDebouncing) return;
    setIsDebouncing(true);
    
    playBeep();
    socket.emit("call_next");
    
    setTimeout(() => {
      setIsDebouncing(false);
    }, 500);
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

    setConfirmDialog({
      title: t.alert_title || "Notice",
      message: confirmationMsg,
      confirmText: t.skip || "Skip",
      confirmType: "warning",
      onConfirm: () => {
        socket.emit("skip_token", { token_id: tokenId });
      }
    });
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
    setConfirmDialog({
      title: t.alert_title || "Notice",
      message: t.confirm_reset,
      confirmText: t.reset_btn || "Reset",
      confirmType: "danger",
      onConfirm: () => {
        socket.emit("reset_queue");
      }
    });
  };

  const hasPatients = queueState.queue.length > 0;

  // Determine Patient Queue Status
  const getPatientStatus = () => {
    const tokenNum = parseInt(patientToken);
    if (isNaN(tokenNum)) return { status: "none" };

    if (queueState.current_token === tokenNum) {
      return { status: "current" };
    }

    const index = queueState.queue.findIndex(item => item.token_id === tokenNum);
    if (index !== -1) {
      const tokensAhead = index + 1;
      const estWait = round(tokensAhead * queueState.avg_consultation_mins, 1);
      return {
        status: "waiting",
        tokensAhead,
        estWait,
      };
    }

    if (queueState.current_token !== null && tokenNum < queueState.current_token) {
      return { status: "completed" };
    }

    return { status: "not_found" };
  };

  const round = (value, precision) => {
    const multiplier = Math.pow(10, precision || 0);
    return Math.round(value * multiplier) / multiplier;
  };

  const pStatus = getPatientStatus();
  const targetTokenNum = parseInt(patientToken);
  const liteUrl = `${BACKEND_URL}/lite/patient?token=${isNaN(targetTokenNum) ? "" : targetTokenNum}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(liteUrl)}`;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10 px-4 py-3 flex justify-between items-center shadow-xs">
        <h1 
          className="text-2xl font-extrabold text-green-600 flex items-center gap-2 m-0 cursor-pointer"
          onClick={() => {
            window.history.pushState({}, "", "/receptionist");
            setRole("receptionist");
          }}
        >
          <Clock className="w-6 h-6 text-green-600 animate-pulse" />
          {t.title}
        </h1>
        <div className="flex items-center gap-2">
          {role === "receptionist" ? (
            <button
              onClick={() => {
                window.history.pushState({}, "", "/patient");
                setRole("patient");
              }}
              className="text-xs bg-gray-100 hover:bg-gray-200 font-bold px-3 py-1.5 rounded-lg border border-gray-300 transition-colors"
            >
              Patient Screen
            </button>
          ) : (
            <button
              onClick={() => {
                window.history.pushState({}, "", "/receptionist");
                setRole("receptionist");
              }}
              className="text-xs bg-gray-100 hover:bg-gray-200 font-bold px-3 py-1.5 rounded-lg border border-gray-300 transition-colors"
            >
              {t.view_receptionist}
            </button>
          )}
          <button
            onClick={() => setLang(lang === "en" ? "ta" : "en")}
            className="bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-lg px-3 py-1.5 font-bold flex items-center gap-1.5 transition-colors cursor-pointer text-sm"
          >
            <Languages className="w-4 h-4 text-gray-600" />
            {t.langToggle}
          </button>
        </div>
      </header>

      {role === "receptionist" ? (
        /* RECEPTIONIST SCREEN */
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
              {t.add_patient_title}
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
            <h2 className="text-lg font-extrabold text-gray-800 mb-4 mt-0">
              {t.people_waiting} ({queueState.queue.length})
            </h2>

            {hasPatients ? (
              <div className="space-y-3">
                {queueState.queue.map((item, idx) => (
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
                        {idx + 1} {t.tokens_ahead} • {t.est_wait}: ~{round((idx + 1) * queueState.avg_consultation_mins, 1)} min
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

          {/* Bottom: Red Outline New Day / Reset Button */}
          <div className="pt-4 flex justify-center">
            <button
              onClick={handleReset}
              className="text-red-500 hover:bg-red-50 border border-red-500 rounded-lg font-extrabold text-xs px-3.5 py-2 transition-all cursor-pointer flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {t.reset_btn}
            </button>
          </div>
        </main>
      ) : (
        /* PATIENT STATUS SCREEN */
        <main className="flex-1 max-w-md w-full mx-auto p-4 space-y-6">
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-xs text-center">
            <h2 className="text-xl font-extrabold text-gray-800 mb-4 mt-0">
              {t.patient_title}
            </h2>

            {/* Token Input Form */}
            <div className="mb-6">
              <label className="text-sm font-bold text-gray-600 block mb-2">
                {t.enter_token}
              </label>
              <input
                type="number"
                value={patientToken}
                onChange={(e) => setPatientToken(e.target.value)}
                placeholder={t.token_placeholder}
                className="w-24 h-12 text-center font-extrabold text-2xl border-2 border-gray-200 focus:border-green-500 focus:ring-0 rounded-xl outline-hidden"
              />
            </div>

            {/* Token Status Result */}
            {patientToken && (
              <div className="mb-6">
                <span className="text-xs tracking-widest font-extrabold text-gray-500 uppercase block mb-2">
                  {t.your_status}
                </span>

                {pStatus.status === "current" && (
                  <div className="p-5 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-700 font-extrabold text-lg">
                    {t.status_current}
                  </div>
                )}

                {pStatus.status === "completed" && (
                  <div className="p-5 bg-blue-50 border border-blue-300 rounded-xl text-blue-700 font-extrabold text-lg">
                    {t.status_completed}
                  </div>
                )}

                {pStatus.status === "waiting" && (
                  <div className="p-5 bg-amber-50 border border-amber-300 rounded-xl text-amber-700 space-y-2">
                    <div className="text-lg font-extrabold">{t.status_waiting}</div>
                    <div className="text-sm font-bold text-gray-600">
                      {t.people_ahead}: <span className="text-lg font-extrabold text-amber-800">{pStatus.tokensAhead}</span>
                    </div>
                    <div className="text-sm font-bold text-gray-600">
                      {t.est_wait}: <span className="text-lg font-extrabold text-amber-800">~{pStatus.estWait} mins</span>
                    </div>
                  </div>
                )}

                {pStatus.status === "not_found" && (
                  <div className="p-5 bg-red-50 border border-red-300 rounded-xl text-red-700 font-bold">
                    Token not found in active list.
                  </div>
                )}
              </div>
            )}

            {/* Current Token Being Seen */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6">
              <span className="text-xs tracking-widest font-extrabold text-gray-500 uppercase block mb-1">
                {t.current_seen}
              </span>
              <span className="text-3xl font-black text-gray-800 block">
                {queueState.current_token || "—"}
              </span>
              {queueState.current_patient_name && (
                <span className="text-sm text-gray-500 mt-1 block font-bold">
                  ({queueState.current_patient_name})
                </span>
              )}
            </div>

            {/* QR Code & Lite HTML Section */}
            {patientToken && (pStatus.status === "waiting" || pStatus.status === "current") && (
              <div className="border-t border-gray-200 pt-6 space-y-4">
                <div>
                  <span className="text-sm font-extrabold text-gray-700 block mb-2">
                    <QrCode className="w-5 h-5 text-gray-600 inline mr-1 align-text-bottom" />
                    {t.scan_lite}
                  </span>
                  <img
                    src={qrUrl}
                    alt="QR Code for Lite HTML"
                    className="mx-auto w-36 h-36 border border-gray-200 rounded-xl p-1.5 shadow-xs"
                  />
                </div>
                
                <div className="text-left bg-gray-50 rounded-xl p-3 border border-gray-200">
                  <span className="text-xs font-bold text-gray-500 block mb-1">
                    {t.no_smartphone}
                  </span>
                  <div className="flex items-center justify-between gap-2">
                    <input
                      type="text"
                      readOnly
                      value={liteUrl}
                      className="text-xs font-mono bg-transparent outline-hidden select-all text-gray-600 border-none p-0 flex-1"
                    />
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(liteUrl);
                        setAlertDialog({
                          title: t.alert_title || "Notice",
                          message: "Link copied to clipboard!"
                        });
                      }}
                      className="p-1 hover:bg-gray-200 rounded-md transition-colors cursor-pointer text-gray-500"
                    >
                      <Clipboard className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      )}

      {/* Custom Confirm Modal */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs transition-opacity duration-300">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full border border-gray-100 shadow-xl scale-in transition-all">
            <h3 className="text-lg font-extrabold text-gray-900 mt-0 mb-2">
              {confirmDialog.title}
            </h3>
            <p className="text-gray-600 text-sm mb-6 leading-relaxed">
              {confirmDialog.message}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold rounded-xl text-sm transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  confirmDialog.onConfirm();
                  setConfirmDialog(null);
                }}
                className={`px-4 py-2 text-white font-bold rounded-xl text-sm transition-colors cursor-pointer ${
                  confirmDialog.confirmType === "danger"
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-amber-600 hover:bg-amber-700"
                }`}
              >
                {confirmDialog.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Alert Modal */}
      {alertDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs transition-opacity duration-300">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full border border-gray-100 shadow-xl scale-in transition-all">
            <h3 className="text-lg font-extrabold text-gray-900 mt-0 mb-2">
              {alertDialog.title}
            </h3>
            <p className="text-gray-600 text-sm mb-6 leading-relaxed">
              {alertDialog.message}
            </p>
            <div className="flex justify-end">
              <button
                onClick={() => setAlertDialog(null)}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm transition-colors cursor-pointer"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
