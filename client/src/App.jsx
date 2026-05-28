
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useTracks,
  useParticipants,
  useLocalParticipant,
  useConnectionState,
  VideoTrack,
  AudioTrack
} from "@livekit/components-react";
import { Track } from "livekit-client";

const OWNER = "Mohammad Mahdi Mahdizadeh";
const ACCESS_CODE = "Mohammad Mahdi Mahdizadeh";
const TOKEN_SERVER = import.meta.env.VITE_TOKEN_SERVER_URL || "http://localhost:3001/token";

function normalize(x) {
  return String(x || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function safeRoomName(value) {
  const clean = String(value || "vx-main")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 48);
  return clean || "vx-main";
}

function useNetworkStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

function useServerHealth() {
  const [health, setHealth] = useState("unknown");

  async function check() {
    try {
      const base = TOKEN_SERVER.replace(/\/token\/?$/, "");
      const res = await fetch(`${base}/health`, { cache: "no-store" });
      if (!res.ok) throw new Error("bad health");
      setHealth("online");
      return true;
    } catch {
      setHealth("offline");
      return false;
    }
  }

  useEffect(() => {
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, []);

  return { health, check };
}

function ErrorBoundaryFallback({ message, reset }) {
  return (
    <div className="fatalBox">
      <h2>VX-01 recovered from a UI fault.</h2>
      <p>{message || "Unknown interface error."}</p>
      <button onClick={reset}>reset interface</button>
    </div>
  );
}

class VXErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.warn("VX boundary", error, info);
  }
  render() {
    if (this.state.error) {
      return <ErrorBoundaryFallback message={this.state.error.message} reset={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}

function useClock() {
  const [clock, setClock] = useState("00:00:00");
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-GB"));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return clock;
}

function useTimer(active) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  return [seconds, () => setSeconds(0)];
}

function useCamera(active, videoRef, onStatus, onStream) {
  const streamRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!active) return;
      if (streamRef.current) return;

      onStatus("requesting");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        onStream(stream);

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.muted = true;
          videoRef.current.playsInline = true;
          await videoRef.current.play().catch(() => {});
        }
        onStatus("ready");
      } catch (e) {
        console.warn(e);
        onStatus("blocked");
        onStream(null);
      }
    }

    function stop() {
      streamRef.current?.getTracks?.().forEach((t) => t.stop());
      streamRef.current = null;
      onStream(null);
      if (videoRef.current) videoRef.current.srcObject = null;
      if (!active) onStatus("idle");
    }

    if (active) start();
    else stop();

    return () => {
      cancelled = true;
      stop();
    };
  }, [active, videoRef, onStatus, onStream]);
}

function useVoiceActivity(stream, enabled) {
  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (!stream || !enabled) {
      setLevel(0);
      setSpeaking(false);
      return;
    }

    let ctx;
    let raf;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const loop = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        const normalized = Math.min(100, Math.round(avg * 1.45));
        setLevel(normalized);
        setSpeaking(normalized > 18);
        raf = requestAnimationFrame(loop);
      };
      loop();
    } catch (e) {
      console.warn(e);
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ctx?.close?.().catch(() => {});
    };
  }, [stream, enabled]);

  return { level, speaking };
}

function useLightFaceAI(active, enabled, videoRef) {
  const [status, setStatus] = useState("off");
  const [face, setFace] = useState(false);

  useEffect(() => {
    if (!active || !enabled) {
      setStatus("off");
      setFace(false);
      return;
    }

    let cancelled = false;
    let timer;

    async function run() {
      if (!("FaceDetector" in window)) {
        setStatus("fallback");
        setFace(false);
        return;
      }

      try {
        const detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
        setStatus("tracking");

        timer = setInterval(async () => {
          if (cancelled || !videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const faces = await detector.detect(videoRef.current);
            setFace(Boolean(faces && faces.length));
          } catch {
            setFace(false);
          }
        }, 650);
      } catch {
        setStatus("fallback");
      }
    }

    run();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [active, enabled, videoRef]);

  return { status, face };
}


function useRabbitFaceLab(active, enabled, videoRef) {
  const [state, setState] = useState("off");
  const [rabbit, setRabbit] = useState({
    detected: false,
    mouthOpen: false,
    smile: false,
    blink: false,
    x: 50,
    y: 36,
    scale: 1,
    tilt: 0,
  });

  useEffect(() => {
    if (!active || !enabled) {
      setState("off");
      setRabbit((r) => ({ ...r, detected: false, mouthOpen: false, smile: false, blink: false }));
      return;
    }

    let cancelled = false;
    let raf = 0;
    let faceLandmarker = null;

    async function start() {
      try {
        setState("loading");
        const vision = await import("@mediapipe/tasks-vision");
        const { FaceLandmarker, FilesetResolver } = vision;
        const fileset = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");

        faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
        });

        if (cancelled) return;
        setState("tracking");

        const loop = () => {
          if (cancelled) return;
          const video = videoRef.current;
          if (!video || video.readyState < 2) {
            raf = requestAnimationFrame(loop);
            return;
          }

          try {
            const res = faceLandmarker.detectForVideo(video, performance.now());
            const landmarks = res.faceLandmarks?.[0];
            const blend = res.faceBlendshapes?.[0]?.categories || [];
            const get = (name) => blend.find((x) => x.categoryName === name)?.score || 0;

            if (!landmarks || !landmarks.length) {
              setRabbit((r) => ({ ...r, detected: false }));
              raf = requestAnimationFrame(loop);
              return;
            }

            const nose = landmarks[1] || landmarks[4] || landmarks[0];
            const leftEye = landmarks[33] || landmarks[159] || nose;
            const rightEye = landmarks[263] || landmarks[386] || nose;
            const dx = rightEye.x - leftEye.x;
            const dy = rightEye.y - leftEye.y;
            const tilt = Math.max(-18, Math.min(18, Math.atan2(dy, dx) * 180 / Math.PI));
            const eyeDistance = Math.hypot(dx, dy);
            const scale = Math.max(.78, Math.min(1.65, eyeDistance * 7.2));
            const jaw = get("jawOpen");
            const smile = Math.max(get("mouthSmileLeft"), get("mouthSmileRight"));
            const blink = Math.max(get("eyeBlinkLeft"), get("eyeBlinkRight"));

            setRabbit({
              detected: true,
              mouthOpen: jaw > 0.34,
              smile: smile > 0.32,
              blink: blink > 0.55,
              x: Math.round(nose.x * 100),
              y: Math.round(Math.max(0, (nose.y * 100) - 18)),
              scale,
              tilt,
            });
          } catch (error) {
            console.warn("rabbit lab loop", error);
          }

          raf = requestAnimationFrame(loop);
        };

        raf = requestAnimationFrame(loop);
      } catch (error) {
        console.warn("rabbit lab fallback", error);
        setState("fallback");
      }
    }

    start();

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      try { faceLandmarker?.close?.(); } catch {}
    };
  }, [active, enabled, videoRef]);

  return { state, rabbit };
}

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className="toast">
      <i />
      <div>
        <b>{toast.title}</b>
        <small>{toast.sub}</small>
      </div>
    </div>
  );
}

function Gate({ onUnlock }) {
  const [code, setCode] = useState("");
  const [bad, setBad] = useState(false);

  function submit(e) {
    e.preventDefault();
    if (normalize(code) === normalize(ACCESS_CODE)) {
      onUnlock();
    } else {
      setBad(true);
      setTimeout(() => setBad(false), 800);
    }
  }

  return (
    <div className="gate">
      <form className={`gateBox ${bad ? "bad" : ""}`} onSubmit={submit}>
        <p>VX-01 private access</p>
        <h1>Identify owner.</h1>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="access code" autoFocus />
        <button>enter</button>
        <small>asks every time / no saved login</small>
      </form>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function CommandLayer({ open, close, actions }) {
  if (!open) return null;
  return (
    <div className="cmdBack" onClick={close}>
      <div className="cmd" onClick={(e) => e.stopPropagation()}>
        <div className="cmdHead">COMMAND LAYER</div>
        {actions.map((a) => (
          <button type="button" key={a.label} onClick={() => { a.run(); close(); }}>
            <b>{a.label}</b>
            <small>{a.sub}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function Stream({ label, local, active, visual, muted, cameraStatus, videoRef, secret, mood, aiOn, face, speaking, rabbit, rabbitLab, rabbitFace }) {
  const showVideo = local && active && visual && cameraStatus === "ready";

  return (
    <div className={`stream mood-${mood} ${face ? "faceDetected" : ""} ${speaking ? "speaking" : ""}`}>
      <div className="streamTop">
        <span>{label}</span>
        <span>{active ? (showVideo ? "camera" : "proxy") : "standby"}</span>
      </div>

      {local && <video ref={videoRef} className={showVideo ? "cameraVideo" : "hiddenVideo"} autoPlay muted playsInline />}

      {!showVideo && (
        <div className="proxy">
          <div className="orb">
            {local ? "MM" : "VX"}
            {rabbit && <div className="ears"><span/><span/></div>}
          </div>
          <p>{active ? (visual ? "presence proxy" : "visual masked") : "waiting"}</p>
        </div>
      )}

      {showVideo && (
        <>
          <div className="videoOverlay">
            <span>{rabbit ? "RABBIT MODE" : face ? "FACE DETECTED" : speaking ? "VOICE ACTIVE" : "LIVE CAMERA"}</span>
          </div>
          {aiOn && <div className={`faceBadge ${rabbit ? "rabbit" : ""}`}>{rabbit ? "🐰" : face ? "AI" : "FX"}</div>}
          {rabbitLab && rabbitFace?.rabbit?.detected && (
            <div
              className={`trackedRabbit ${rabbitFace.rabbit.mouthOpen ? "mouthOpen" : ""} ${rabbitFace.rabbit.smile ? "smiling" : ""} ${rabbitFace.rabbit.blink ? "blinking" : ""}`}
              style={{
                left: `${rabbitFace.rabbit.x}%`,
                top: `${rabbitFace.rabbit.y}%`,
                transform: `translate(-50%, -50%) rotate(${rabbitFace.rabbit.tilt}deg) scale(${rabbitFace.rabbit.scale})`
              }}
            >
              <span className="trackedEar earL" />
              <span className="trackedEar earR" />
              <span className="trackedCore">{rabbitFace.rabbit.mouthOpen ? "R+" : "R"}</span>
            </div>
          )}
        </>
      )}

      <div className="streamBottom">
        <span className={muted ? "bad" : "good"}>{muted ? "silent" : "voice"}</span>
        <span className={visual ? "good" : "bad"}>{visual ? "visual" : "masked"}</span>
        {local && <span className={cameraStatus === "ready" ? "good" : "bad"}>{cameraStatus}</span>}
        {aiOn && <span className={face ? "good" : "bad"}>{face ? "face" : "ai"}</span>}
        {rabbitLab && <span className={rabbitFace?.state === "tracking" ? "good" : "bad"}>{rabbitFace?.state || "lab"}</span>}
      </div>

      {secret && (
        <div className="secret">
          <small>private system message</small>
          <strong>غزل خوشگل‌ترین دختر دنیاست</strong>
        </div>
      )}
    </div>
  );
}

function Companion({ active, speaking, face, aiOn, mood, seconds }) {
  const text = useMemo(() => {
    if (!active) return "waiting under the black surface.";
    if (aiOn && face && speaking) return "face and voice detected. presence field is alive.";
    if (aiOn && face) return "face detected. visual intelligence online.";
    if (speaking) return "voice activity detected. aura responding.";
    if (seconds > 90) return "long presence detected. atmosphere stabilized.";
    if (mood === "romantic") return "soft private atmosphere engaged.";
    if (mood === "hacker") return "terminal pulse increased.";
    return "stable presence field online.";
  }, [active, speaking, face, aiOn, mood, seconds]);

  return <div className="companion"><span>AI COMPANION</span><b>{text}</b></div>;
}



function useVXPresence(localParticipant, participants) {
  const [tick, setTick] = useState(0);
  const [mood, setMood] = useState("void");

  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 900);
    return () => clearInterval(id);
  }, []);

  const speaking = participants.some((p) => p.isSpeaking);
  const remoteCount = participants.filter((p) => !p.isLocal).length;
  const localSpeaking = Boolean(localParticipant?.isSpeaking);
  const camOn = Boolean(localParticipant?.isCameraEnabled);
  const micOn = Boolean(localParticipant?.isMicrophoneEnabled);

  useEffect(() => {
    if (!remoteCount) setMood("void");
    else if (speaking && remoteCount) setMood("hyper");
    else if (!speaking && remoteCount) setMood("intimate");
    else setMood("calm");
  }, [speaking, remoteCount, tick]);

  const energy = Math.min(100, Math.max(12, 
    (speaking ? 82 : 34) +
    (remoteCount * 10) +
    (localSpeaking ? 12 : 0) -
    (!micOn ? 12 : 0) -
    (!camOn ? 8 : 0)
  ));

  const rabbitLevel = energy > 80 ? "evolved" : energy > 55 ? "awake" : "sleeping";
  const scene = !remoteCount ? "solo-signal" : speaking ? "active-link" : "quiet-link";
  const intensity = energy > 80 ? "high" : energy > 55 ? "medium" : "low";

  return {
    energy,
    mood,
    speaking,
    localSpeaking,
    remoteCount,
    camOn,
    micOn,
    rabbitLevel,
    scene,
    intensity,
  };
}



function useVXEventFeed(presence, participants, connection) {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    const line = `${new Date().toLocaleTimeString("en-GB")} / ${connection} / ${presence.scene} / ${participants.length} node`;
    setEvents((prev) => [line, ...prev].slice(0, 5));
  }, [presence.scene, participants.length, connection]);

  useEffect(() => {
    if (presence.speaking) {
      const line = `${new Date().toLocaleTimeString("en-GB")} / voice activity detected`;
      setEvents((prev) => [line, ...prev.filter((x) => x !== line)].slice(0, 5));
    }
  }, [presence.speaking]);

  return events;
}

function VXInvitePanel({ roomName }) {
  const [copied, setCopied] = useState(false);
  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <div className="vxInvitePanel">
      <span>invite node</span>
      <b>{roomName || "current room"}</b>
      <button onClick={copyInvite}>{copied ? "copied" : "copy link"}</button>
    </div>
  );
}

function VXLiveRabbitOverlay({ presence, mainTrack }) {
  const identity = mainTrack?.participant?.identity || "signal";
  const isRemote = mainTrack && !mainTrack.participant?.isLocal;
  const active = Boolean(mainTrack?.publication);

  return (
    <div className={`liveRabbitOverlay ${presence.speaking ? "voice" : ""} ${presence.rabbitLevel}`}>
      <div className="liveRabbitMask">
        <span className="liveEar liveEarL" />
        <span className="liveEar liveEarR" />
        <b>{presence.rabbitLevel === "evolved" ? "R+" : "R"}</b>
      </div>
      <div className="liveRabbitMeta">
        <span>{isRemote ? "remote rabbit layer" : "local rabbit layer"}</span>
        <small>{identity} / {active ? presence.rabbitLevel : "standby"}</small>
      </div>
    </div>
  );
}

function VXLiveRoom({ onExit }) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
      { source: Track.Source.Microphone, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  const participants = useParticipants();
  const connection = useConnectionState();
  const { localParticipant } = useLocalParticipant();
  const presence = useVXPresence(localParticipant, participants);
  const events = useVXEventFeed(presence, participants, connection);

  const cameraTracks = tracks.filter((t) => t.source === Track.Source.Camera);
  const audioTracks = tracks.filter((t) => t.source === Track.Source.Microphone);
  const localTracks = cameraTracks.filter((t) => t.participant?.isLocal);
  const remoteTracks = cameraTracks.filter((t) => !t.participant?.isLocal);
  const screenTracks = tracks.filter((t) => t.source === Track.Source.ScreenShare);
  const mainTrack = screenTracks[0] || remoteTracks[0] || localTracks[0] || cameraTracks[0];
  const miniTrack = screenTracks[0] ? (remoteTracks[0] || localTracks[0]) : (remoteTracks[0] ? localTracks[0] : remoteTracks[1]);

  async function toggleMic() {
    await localParticipant?.setMicrophoneEnabled(!localParticipant.isMicrophoneEnabled);
  }

  async function toggleCam() {
    await localParticipant?.setCameraEnabled(!localParticipant.isCameraEnabled);
  }

  async function shareScreen() {
    await localParticipant?.setScreenShareEnabled(!localParticipant.isScreenShareEnabled);
  }

  return (
    <div className={`vxLive vxMood-${presence.mood} rabbit-${presence.rabbitLevel} intensity-${presence.intensity}`} style={{ "--energy": `${presence.energy}%` }}>
      <div className="presenceAura" />
      <div className="rabbitSpirit">
        <div className="rabbitEar left" />
        <div className="rabbitEar right" />
        <div className="rabbitCore">{presence.rabbitLevel === "evolved" ? "R+" : "R"}</div>
      </div>

      <div className="vxLiveTop">
        <div>
          <small>VX-01 LIVE SIGNAL</small>
          <h2>{connection}</h2>
        </div>
        <div className="vxLiveStats">
          <span>{participants.length} inside</span>
          <span>{presence.scene}</span>
          <span>{presence.mood}</span>
          <span>{presence.energy}% energy</span>
        </div>
      </div>

      <div className="vxCinematicHUD">
        <span>REC / VX-01</span>
        <span>{presence.remoteCount ? "REMOTE LOCK" : "AWAITING REMOTE"}</span>
        <span>{presence.micOn ? "MIC OPEN" : "MIC SEALED"}</span>
        <span>{presence.camOn ? "CAM OPEN" : "CAM SEALED"}</span>
      </div>

      <div className="vxLiveStage">
        <div className={`vxMainVideo ${presence.speaking ? "voiceActive" : ""}`}>
          {mainTrack && mainTrack.publication ? (
            <VideoTrack trackRef={mainTrack} />
          ) : (
            <div className="vxNoVideo">
              <div className="orb">VX</div>
              <p>waiting for remote signal</p>
            </div>
          )}

          <div className="scanLines" />
          <VXLiveRabbitOverlay presence={presence} mainTrack={mainTrack} />
          <div className="vxVideoHud">
            <span>{mainTrack?.participant?.identity || "waiting"}</span>
            <b>{presence.remoteCount ? "remote presence locked" : "local preview / waiting"}</b>
          </div>
        </div>

        <div className="vxSidePanel">
          <div className={`vxMiniVideo ${presence.localSpeaking ? "localSpeaking" : ""}`}>
            {miniTrack && miniTrack.publication ? (
              <VideoTrack trackRef={miniTrack} />
            ) : (
              <div className="vxNoMini">NO SECOND SIGNAL</div>
            )}
          </div>

          <div className="vxParticipantList">
            <b>presence field</b>
            {participants.map((p) => (
              <div key={p.sid} className={`vxPerson ${p.isSpeaking ? "isSpeaking" : ""}`}>
                <span>{p.identity}</span>
                <small>{p.isLocal ? "you" : "remote"} / {p.isSpeaking ? "voice" : "quiet"}</small>
                <i style={{ width: p.isSpeaking ? "88%" : "22%" }} />
              </div>
            ))}
          </div>

          <VXInvitePanel roomName={mainTrack?.participant?.metadata || "VX room"} />

          <div className="vxEventFeed">
            <b>event feed</b>
            {events.map((event, index) => (
              <span key={`${event}-${index}`}>{event}</span>
            ))}
          </div>

          <div className="vxLiveNote">
            <span>rabbit engine</span>
            <b>{presence.rabbitLevel} / {presence.intensity} intensity / {presence.speaking ? "voice reactive" : "listening"}</b>
          </div>
        </div>
      </div>

      <div className="vxLiveDock">
        <button onClick={toggleMic}>{localParticipant?.isMicrophoneEnabled ? "mute" : "unmute"}</button>
        <button onClick={toggleCam}>{localParticipant?.isCameraEnabled ? "camera off" : "camera on"}</button>
        <button onClick={shareScreen}>screen</button>
        <button onClick={async () => { try { await document.documentElement.requestFullscreen?.(); } catch {} }}>full</button>
        <button className="danger" onClick={onExit}>exit</button>
      </div>

      {audioTracks.map((trackRef) => (
        trackRef.publication ? <AudioTrack key={trackRef.publication.trackSid} trackRef={trackRef} /> : null
      ))}
    </div>
  );
}

function LiveKitCall({ token, serverUrl, onExit }) {
  return (
    <div className="liveWrap vxLiveWrap">
      <LiveKitRoom
        token={token}
        serverUrl={serverUrl}
        connect
        video
        audio
        data-lk-theme="default"
        className="lkRoom"
        onDisconnected={() => console.warn("LiveKit disconnected")}
        onError={(error) => console.warn("LiveKit error", error)}
      >
        <RoomAudioRenderer />
        <VXLiveRoom onExit={onExit} />
      </LiveKitRoom>
    </div>
  );
}


export default function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [page, setPage] = useState("entry");
  const [room, setRoom] = useState(`vx-${Math.random().toString(36).slice(2,6).toUpperCase()}`);
  const [active, setActive] = useState(false);
  const [mic, setMic] = useState(true);
  const [visual, setVisual] = useState(true);
  const [mood, setMood] = useState("calm");
  const [cmd, setCmd] = useState(false);
  const [toast, setToast] = useState(null);
  const [cameraStatus, setCameraStatus] = useState("idle");
  const [stream, setStream] = useState(null);
  const [aiOn, setAiOn] = useState(false);
  const [rabbit, setRabbit] = useState(false);
  const [rabbitLab, setRabbitLab] = useState(false);
  const [identity, setIdentity] = useState(`MMM-${Math.random().toString(36).slice(2,5).toUpperCase()}`);
  const [live, setLive] = useState(null);
  const [qualityMode, setQualityMode] = useState("cinematic");
  const [debugOpen, setDebugOpen] = useState(false);
  const online = useNetworkStatus();
  const serverHealth = useServerHealth();
  const [seconds, resetSeconds] = useTimer(active);
  const clock = useClock();
  const videoRef = useRef(null);

  useCamera(active, videoRef, setCameraStatus, setStream);
  const voice = useVoiceActivity(stream, active && mic);
  const faceAI = useLightFaceAI(active, aiOn, videoRef);
  const rabbitFace = useRabbitFaceLab(active, rabbitLab, videoRef);

  const uptime = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const secret = seconds >= 420 && seconds < 428;

  function notify(title, sub) {
    setToast({ title, sub });
    setTimeout(() => setToast(null), 2600);
  }

  function startDemo() {
    setActive(true);
    resetSeconds();
    setPage("call");
    notify("signal entered", "camera layer warming");
  }

  function kill() {
    setActive(false);
    resetSeconds();
    notify("signal killed", "returned to standby");
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${location.origin}${location.pathname}?room=${room}`);
      notify("copied", "node link copied");
    } catch {
      notify("copy blocked", "browser denied clipboard");
    }
  }

  async function fullscreen() {
    try {
      if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    } catch {}
  }

  async function beginLiveKit() {
    try {
      notify("requesting token", "checking local server");
      const url = `${TOKEN_SERVER}?room=${encodeURIComponent(room)}&identity=${encodeURIComponent(identity)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "token error");
      setLive({ token: data.token, url: data.url });
      setActive(true);
      setPage("livekit");
      notify("live room ready", "LiveKit connected");
    } catch (error) {
      console.warn(error);
      notify("LiveKit offline", "run server and fill .env keys");
    }
  }

  useEffect(() => {
    const handler = (e) => {
      const key = e.key.toLowerCase();
      const tag = document.activeElement?.tagName?.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === "k") {
        e.preventDefault();
        setCmd((v) => !v);
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && key === "c" && tag !== "input" && tag !== "textarea") {
        setCmd((v) => !v);
      }
      if (key === "escape") setCmd(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (voice.speaking && active) setMood((m) => m === "calm" ? "hacker" : m);
  }, [voice.speaking, active]);

  const actions = [
    { label: "Start demo signal", sub: "open local camera", run: startDemo },
    { label: "Start LiveKit room", sub: "real online video call", run: beginLiveKit },
    { label: "Toggle voice", sub: "mute/unmute state", run: () => { setMic((v) => !v); notify("voice changed", "state updated"); } },
    { label: "Toggle visual", sub: "hide/show local camera", run: () => { setVisual((v) => !v); notify("visual changed", "state updated"); } },
    { label: "Toggle light AI", sub: "face detector / voice companion", run: () => { setAiOn((v) => !v); notify("light AI toggled", "local browser AI layer changed"); } },
    { label: "Rabbit mode", sub: "manual face effect", run: () => { setRabbit((v) => !v); notify("rabbit mode", "manual FX changed"); } },
    { label: "Rabbit lab", sub: "tracked ears on local camera", run: () => { setRabbitLab((v) => !v); notify("rabbit lab", "tracked rabbit FX toggled"); } },
    { label: "Mood hacker", sub: "green terminal atmosphere", run: () => { setMood("hacker"); notify("mood hacker", "atmosphere changed"); } },
    { label: "Mood romantic", sub: "soft private atmosphere", run: () => { setMood("romantic"); notify("mood romantic", "atmosphere changed"); } },
    { label: "Copy node", sub: "copy invite URL", run: copyLink },
    { label: "Fullscreen", sub: "enter immersive mode", run: fullscreen },
    { label: "Quality mode", sub: "cinematic / performance", run: () => { setQualityMode((v) => v === "cinematic" ? "performance" : "cinematic"); notify("quality changed", "mode toggled"); } },
    { label: "Diagnostics", sub: "open debug panel", run: () => setDebugOpen(true) },
    { label: "Lock terminal", sub: "return to access gate", run: () => { setUnlocked(false); setActive(false); resetSeconds(); } },
  ];

  if (!unlocked) return (
    <div className={`app mood-${mood}`}>
      <Background active={false} mood={mood} />
      <Gate onUnlock={() => setUnlocked(true)} />
    </div>
  );

  return (
    <VXErrorBoundary>
    <div className={`app mood-${mood} quality-${qualityMode}`}>
      <Background active={active} mood={mood} />
      <Toast toast={toast} />

      <main>
        <header>
          <div>
            <small>MM / VX-01</small>
            <h1>rescue plus stable terminal</h1>
          </div>
          <nav>
            {["entry", "call", "livekit", "vault"].map((p) => (
              <button key={p} className={page === p ? "current" : ""} onClick={() => setPage(p)}>{p}</button>
            ))}
          </nav>
        </header>

        <SystemBar online={online} serverHealth={serverHealth.health} qualityMode={qualityMode} room={room} />

        {page === "entry" && (
          <section className="entry">
            <div>
              <p className="micro">private cinematic terminal</p>
              <h2>Stable first. Intelligence restored.</h2>
              <p className="desc">This version keeps the stable camera foundation and adds back light AI, voice activity, companion, rabbit mode, moods, command layer and mobile dock without the heavy modules that broke local.</p>
              <div className="entryActions">
                <button className="primary" onClick={startDemo}>demo signal</button>
                <button className="secondary" onClick={beginLiveKit}>livekit signal</button>
                <button className="secondary" onClick={() => setCmd(true)}>commands</button>
                <button className="secondary" onClick={() => setDebugOpen(true)}>diagnostics</button>
              </div>
            </div>

            <aside>
              <div className="node">
                <label>ghost node</label>
                <input value={room} onChange={(e) => setRoom(e.target.value)} onBlur={() => setRoom(safeRoomName(room))} />
                <small className="fieldHint">same room = same call</small>
                <label>identity</label>
                <input value={identity} onChange={(e) => setIdentity(e.target.value)} />
                <small className="fieldHint">shown inside the live room</small>
                <div>
                  <button onClick={() => setRoom(`vx-${Math.random().toString(36).slice(2,6).toUpperCase()}`)}>regen</button>
                  <button onClick={copyLink}>copy</button>
                </div>
              </div>
              <div className="metrics">
                <Metric label="time" value={clock} />
                <Metric label="camera" value={cameraStatus} />
                <Metric label="AI" value={aiOn ? faceAI.status : "off"} />
                <Metric label="mood" value={mood} />
              </div>
            </aside>
          </section>
        )}

        {page === "call" && (
          <section className="call">
            <div className="topMetrics">
              <Metric label="scene" value={active ? "active" : "standby"} />
              <Metric label="uptime" value={uptime} />
              <Metric label="voice" value={voice.speaking ? "speaking" : "quiet"} />
              <Metric label="AI" value={aiOn ? faceAI.status : "off"} />
            </div>

            <div className="stage">
              <Stream label="LOCAL" local active={active} visual={visual} muted={!mic} cameraStatus={cameraStatus} videoRef={videoRef} secret={secret} mood={mood} aiOn={aiOn || rabbitLab} face={faceAI.face || rabbitFace.rabbit.detected} speaking={voice.speaking} rabbit={rabbit || rabbitFace.rabbit.mouthOpen} rabbitLab={rabbitLab} rabbitFace={rabbitFace} />
              <Stream label="REMOTE" active={active} visual muted={false} cameraStatus="proxy" secret={secret} mood={mood} aiOn={false} face={false} speaking={false} rabbit={false} />
            </div>

            <Companion active={active} speaking={voice.speaking} face={faceAI.face} aiOn={aiOn} mood={mood} seconds={seconds} />

            <div className="strip">
              <span>{clock}</span>
              <b>{active ? "stable presence field" : "waiting for signal"}</b>
              <span>{!mic && active ? "silence mode" : `voice level ${voice.level}`}</span>
            </div>

            <div className="dock">
              <button className={mic ? "on" : "off"} onClick={() => setMic(!mic)}>{mic ? "voice" : "silent"}</button>
              <button className={visual ? "on" : "off"} onClick={() => setVisual(!visual)}>{visual ? "visual" : "masked"}</button>
              <button className={aiOn ? "on" : "off"} onClick={() => setAiOn(!aiOn)}>light ai</button>
              <button className={rabbit ? "on" : "off"} onClick={() => setRabbit(!rabbit)}>rabbit</button>
              <button className={rabbitLab ? "on" : "off"} onClick={() => setRabbitLab(!rabbitLab)}>lab</button>
              <button className="on" onClick={() => setCmd(true)}>cmd</button>
              <button className="on" onClick={() => setMood(mood === "hacker" ? "calm" : "hacker")}>mood</button>
              <button className="on" onClick={fullscreen}>full</button>
              <button className="danger" onClick={kill}>kill</button>
            </div>
          </section>
        )}


        {page === "livekit" && (
          <section className="livePage">
            {live ? (
              <LiveKitCall token={live.token} serverUrl={live.url} onExit={() => { setLive(null); setPage("entry"); notify("live room closed", "returned to terminal"); }} />
            ) : (
              <div className="liveEmpty">
                <h2>LiveKit is not connected.</h2>
                <p>Run the server, add LiveKit keys, then press LiveKit Signal.</p>
                <button className="primary" onClick={beginLiveKit}>connect livekit</button>
              </div>
            )}
          </section>
        )}

        {page === "vault" && (
          <section className="vault">
            {[
              ["Access", "asks for the owner code every page load"],
              ["Camera", "real visible local camera"],
              ["Command", "button + C + Ctrl/Cmd K"],
              ["Light AI", "browser FaceDetector if available, safe fallback if not"],
              ["Voice", "WebAudio voice activity / speaking detection"],
              ["Companion", "context-aware local AI-like messages"],
              ["Rabbit", "manual rabbit effect, stable and offline"],
              ["LiveKit", "real online rooms through local token server"],
              ["Backend", "server folder generates secure room tokens"],
              ["Next", "deploy client + server after local LiveKit works"],
            ].map(([a,b]) => <div className="vaultRow" key={a}><b>{a}</b><span>{b}</span></div>)}
          </section>
        )}
      </main>

      <CommandLayer open={cmd} close={() => setCmd(false)} actions={actions} />
      <DebugPanel
        open={debugOpen}
        close={() => setDebugOpen(false)}
        online={online}
        serverHealth={serverHealth.health}
        tokenServer={TOKEN_SERVER}
        room={room}
        identity={identity}
        qualityMode={qualityMode}
      />
    </div>
    </VXErrorBoundary>
  );
}


function SystemBar({ online, serverHealth, qualityMode, room }) {
  return (
    <div className="systemBar">
      <span className={online ? "good" : "bad"}>{online ? "network online" : "network offline"}</span>
      <span className={serverHealth === "online" ? "good" : serverHealth === "offline" ? "bad" : ""}>server {serverHealth}</span>
      <span>quality {qualityMode}</span>
      <span>room {safeRoomName(room)}</span>
    </div>
  );
}

function DebugPanel({ open, close, online, serverHealth, tokenServer, room, identity, qualityMode }) {
  if (!open) return null;

  const items = [
    ["network", online ? "online" : "offline"],
    ["server", serverHealth],
    ["token", tokenServer],
    ["room", safeRoomName(room)],
    ["identity", identity || "none"],
    ["quality", qualityMode],
  ];

  return (
    <div className="debugBack" onClick={close}>
      <div className="debugPanel" onClick={(e) => e.stopPropagation()}>
        <div className="debugHead">
          <b>VX diagnostics</b>
          <button onClick={close}>close</button>
        </div>
        {items.map(([k, v]) => (
          <div className="debugRow" key={k}>
            <span>{k}</span>
            <code>{v}</code>
          </div>
        ))}
        <p>
          If LiveKit fails, check: Render service is live, Vercel has VITE_TOKEN_SERVER_URL,
          and both users enter the same room.
        </p>
      </div>
    </div>
  );
}

function Background({ active }) {
  return (
    <>
      <div className="glow" />
      <div className="grid" />
      <div className={`pulse ${active ? "active" : ""}`} />
    </>
  );
}
