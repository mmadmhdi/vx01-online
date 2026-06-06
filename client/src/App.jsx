import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  AudioTrack,
  useTracks,
  useParticipants,
  useLocalParticipant,
  useConnectionState,
} from "@livekit/components-react";
import { Track } from "livekit-client";

const ACCESS_CODE = "Mohammad Mahdi Mahdizadeh";
const TOKEN_SERVER = import.meta.env.VITE_TOKEN_SERVER_URL || "http://localhost:3001/token";

function clean(value, fallback = "vx-main") {
  const text = String(value || fallback).trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 48);
  return text || fallback;
}

function sameText(a, b) {
  return String(a || "").trim().replace(/\s+/g, " ").toLowerCase() === String(b || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
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

function Gate({ onUnlock }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  function submit(e) {
    e.preventDefault();
    if (sameText(code, ACCESS_CODE)) onUnlock();
    else setError("Wrong code");
  }

  return (
    <div className="screen centerScreen">
      <form className="gate" onSubmit={submit}>
        <span className="eyebrow">VX-01 Rainbow Private</span>
        <h1>Identify owner</h1>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Access code" autoFocus />
        {error && <p className="error">{error}</p>}
        <button className="primary">Enter</button>
      </form>
    </div>
  );
}

function FXLayer({ enabled, rabbit, aura, speaking, label = "VX" }) {
  if (!enabled) return null;
  return (
    <div className={`fxLayer ${speaking ? "speaking" : ""}`}>
      {aura && <div className="rainbowAura" />}
      {rabbit && (
        <div className={`rabbitFX ${speaking ? "awake" : ""}`}>
          <span className="ear left" />
          <span className="ear right" />
          <b>{speaking ? "R+" : "R"}</b>
        </div>
      )}
      <div className="fxTag">{label} / fx safe</div>
    </div>
  );
}

function LocalDemo({ fx }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus] = useState("off");
  const [speaking, setSpeaking] = useState(false);

  async function start() {
    try {
      setStatus("requesting");
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        videoRef.current.playsInline = true;
        await videoRef.current.play().catch(() => {});
      }
      setStatus("ready");

      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        const ctx = new AC();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        let alive = true;
        const loop = () => {
          if (!alive) return;
          analyser.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length;
          setSpeaking(avg > 12);
          requestAnimationFrame(loop);
        };
        loop();
        streamRef.current._vxAudioContext = ctx;
        streamRef.current._vxStopAudioLoop = () => { alive = false; ctx.close().catch(() => {}); };
      } catch {}
    } catch {
      setStatus("blocked");
    }
  }

  function stop() {
    streamRef.current?._vxStopAudioLoop?.();
    streamRef.current?.getTracks?.().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setSpeaking(false);
    setStatus("off");
  }

  useEffect(() => stop, []);

  return (
    <section className="card">
      <div className="sectionHead">
        <div>
          <span className="eyebrow">Demo Lab</span>
          <h2>Camera + FX test</h2>
        </div>
        <b className="pill">{status}</b>
      </div>

      <div className={`demoVideo ${speaking ? "voice" : ""}`}>
        <video ref={videoRef} autoPlay muted playsInline />
        <FXLayer enabled={fx.enabled && status === "ready"} rabbit={fx.rabbit} aura={fx.aura} speaking={speaking} label="demo" />
        {status !== "ready" && <div className="placeholder">Camera preview</div>}
      </div>

      <div className="twoButtons">
        <button className="primary" onClick={start}>Start camera</button>
        <button className="secondary" onClick={stop}>Stop</button>
      </div>
    </section>
  );
}

function LiveCall({ token, serverUrl, onExit, fx }) {
  return (
    <LiveKitRoom token={token} serverUrl={serverUrl} connect video audio className="lkRoom">
      <RoomAudioRenderer />
      <CallUI onExit={onExit} fx={fx} />
    </LiveKitRoom>
  );
}

function CallUI({ onExit, fx }) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.Microphone, withPlaceholder: false },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  const participants = useParticipants();
  const connection = useConnectionState();
  const { localParticipant } = useLocalParticipant();

  const cameras = tracks.filter((track) => track.source === Track.Source.Camera && track.publication);
  const audios = tracks.filter((track) => track.source === Track.Source.Microphone && track.publication);
  const screens = tracks.filter((track) => track.source === Track.Source.ScreenShare && track.publication);

  const remoteCamera = cameras.find((track) => !track.participant?.isLocal);
  const localCamera = cameras.find((track) => track.participant?.isLocal);
  const screen = screens[0];

  const mainTrack = screen || remoteCamera || localCamera;
  const smallTrack = remoteCamera ? localCamera : null;
  const remoteCount = participants.filter((person) => !person.isLocal).length;
  const anySpeaking = participants.some((person) => person.isSpeaking);

  async function toggleMic() {
    await localParticipant?.setMicrophoneEnabled(!localParticipant.isMicrophoneEnabled);
  }

  async function toggleCamera() {
    await localParticipant?.setCameraEnabled(!localParticipant.isCameraEnabled);
  }

  async function toggleScreen() {
    await localParticipant?.setScreenShareEnabled(!localParticipant.isScreenShareEnabled);
  }

  return (
    <main className="callPage">
      <header className="callHeader">
        <div>
          <span className="eyebrow">VX-01 live</span>
          <h1>{connection}</h1>
        </div>
        <div className="callStats">
          <span>{participants.length} inside</span>
          <span>{remoteCount ? "remote online" : "waiting"}</span>
          <span>{anySpeaking ? "speaking" : "quiet"}</span>
        </div>
      </header>

      <section className={`videoStage ${anySpeaking ? "voice" : ""}`}>
        {mainTrack ? <VideoTrack trackRef={mainTrack} /> : <div className="placeholder">Waiting for video</div>}
        <FXLayer enabled={fx.enabled} rabbit={fx.rabbit} aura={fx.aura} speaking={anySpeaking} label={mainTrack?.participant?.identity || "live"} />
        <div className="videoBadge">
          <span>{mainTrack?.participant?.identity || "no video"}</span>
          <b>{remoteCount ? "connected" : "solo preview"}</b>
        </div>

        {smallTrack && (
          <div className="smallVideo">
            <VideoTrack trackRef={smallTrack} />
          </div>
        )}
      </section>

      <section className="presence">
        <h2>Presence</h2>
        <div>
          {participants.map((person) => (
            <article key={person.sid} className={person.isSpeaking ? "talking" : ""}>
              <b>{person.identity}</b>
              <span>{person.isLocal ? "you" : "remote"} · {person.isSpeaking ? "speaking" : "quiet"}</span>
            </article>
          ))}
        </div>
      </section>

      <nav className="callControls">
        <button onClick={toggleMic}>{localParticipant?.isMicrophoneEnabled ? "Mute" : "Unmute"}</button>
        <button onClick={toggleCamera}>{localParticipant?.isCameraEnabled ? "Cam off" : "Cam on"}</button>
        <button onClick={toggleScreen}>Screen</button>
        <button onClick={() => document.documentElement.requestFullscreen?.()}>Full</button>
        <button className="danger" onClick={onExit}>Exit</button>
      </nav>

      {audios.map((audio) => <AudioTrack key={audio.publication.trackSid} trackRef={audio} />)}
    </main>
  );
}

function FXControls({ fx, setFx }) {
  return (
    <section className="card fxCard">
      <div className="sectionHead">
        <div>
          <span className="eyebrow">Rainbow FX</span>
          <h2>Safe effects</h2>
        </div>
        <b className="pill">{fx.enabled ? "on" : "off"}</b>
      </div>

      <div className="switchGrid">
        <button className={fx.enabled ? "activeSwitch" : ""} onClick={() => setFx((v) => ({ ...v, enabled: !v.enabled }))}>FX</button>
        <button className={fx.rabbit ? "activeSwitch" : ""} onClick={() => setFx((v) => ({ ...v, rabbit: !v.rabbit }))}>Rabbit</button>
        <button className={fx.aura ? "activeSwitch" : ""} onClick={() => setFx((v) => ({ ...v, aura: !v.aura }))}>Aura</button>
      </div>

      <p className="note">FX is isolated. If effects fail, the call still works.</p>
    </section>
  );
}

function Lab({ fx, setFx }) {
  return (
    <>
      <FXControls fx={fx} setFx={setFx} />
      <section className="card">
        <div className="sectionHead">
          <div>
            <span className="eyebrow">Lab</span>
            <h2>Advanced features</h2>
          </div>
          <b className="pill">modular</b>
        </div>

        <div className="labList">
          <article>
            <b>Rabbit FX</b>
            <span>Safe overlay, voice-reactive, separated from call engine.</span>
          </article>
          <article>
            <b>Rainbow Aura</b>
            <span>Visual layer only. Does not touch LiveKit transport.</span>
          </article>
          <article>
            <b>AI Companion</b>
            <span>Parked for a later backend/API module.</span>
          </article>
        </div>
      </section>
    </>
  );
}

export default function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState("home");
  const [room, setRoom] = useState("vx-main");
  const [identity, setIdentity] = useState("MM");
  const [live, setLive] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fx, setFx] = useState({ enabled: true, rabbit: true, aura: true });
  const online = useOnline();

  async function startLive() {
    setError("");
    setBusy(true);

    const finalRoom = clean(room);
    const finalIdentity = clean(identity, "guest");
    setRoom(finalRoom);
    setIdentity(finalIdentity);

    try {
      const res = await fetch(`${TOKEN_SERVER}?room=${encodeURIComponent(finalRoom)}&identity=${encodeURIComponent(finalIdentity)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error || !data.token || !data.url) throw new Error(data.error || "Could not start LiveKit");
      setLive(data);
      setTab("live");
    } catch (err) {
      setError(err.message || "Connection failed");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {}
  }

  if (!unlocked) return <Gate onUnlock={() => setUnlocked(true)} />;

  return (
    <div className="screen">
      <header className="topbar">
        <div>
          <span className="eyebrow">MM / VX-01</span>
          <h1>Rainbow Final</h1>
        </div>
        <nav>
          <button className={tab === "home" ? "active" : ""} onClick={() => setTab("home")}>Home</button>
          <button className={tab === "demo" ? "active" : ""} onClick={() => setTab("demo")}>Demo</button>
          <button className={tab === "live" ? "active" : ""} onClick={() => setTab("live")}>Live</button>
          <button className={tab === "lab" ? "active" : ""} onClick={() => setTab("lab")}>Lab</button>
        </nav>
      </header>

      <div className="statusStrip">
        <span>{online ? "online" : "offline"}</span>
        <span>room / {room}</span>
        <span>fx / {fx.enabled ? "on" : "off"}</span>
      </div>

      {tab === "home" && (
        <section className="home">
          <div className="heroText">
            <span className="eyebrow">Private rainbow video room</span>
            <h2>Call, but prettier.</h2>
            <p>Mobile-first LiveKit call with isolated rainbow FX, Rabbit overlay and aura layer. Core call stays stable even if FX is off.</p>
          </div>

          <div className="card setupCard">
            <label>Room</label>
            <input value={room} onChange={(e) => setRoom(e.target.value)} onBlur={() => setRoom(clean(room))} />
            <small>Both people must enter the same room.</small>

            <label>Identity</label>
            <input value={identity} onChange={(e) => setIdentity(e.target.value)} onBlur={() => setIdentity(clean(identity, "guest"))} />

            {error && <p className="error">{error}</p>}

            <div className="twoButtons">
              <button className="primary" disabled={busy} onClick={startLive}>{busy ? "Connecting..." : "Start call"}</button>
              <button className="secondary" onClick={copyLink}>Copy link</button>
            </div>
          </div>

          <FXControls fx={fx} setFx={setFx} />
        </section>
      )}

      {tab === "demo" && <LocalDemo fx={fx} />}
      {tab === "live" && (
        live ? <LiveCall token={live.token} serverUrl={live.url} onExit={() => { setLive(null); setTab("home"); }} fx={fx} />
             : <section className="card centerCard"><h2>Live is not started</h2><button className="primary" onClick={startLive}>Start call</button>{error && <p className="error">{error}</p>}</section>
      )}
      {tab === "lab" && <Lab fx={fx} setFx={setFx} />}
    </div>
  );
}
