import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { AccessToken } from "livekit-server-sdk";

dotenv.config();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.get("/", (_, res) => {
  res.json({
    ok: true,
    service: "VX-01 LiveKit Backend",
    livekitConfigured: Boolean(
      process.env.LIVEKIT_URL &&
      process.env.LIVEKIT_API_KEY &&
      process.env.LIVEKIT_API_SECRET
    ),
  });
});

app.get("/health", (_, res) => {
  res.json({ ok: true });
});

app.get("/token", async (req, res) => {
  try {
    const missing = [];
    if (!process.env.LIVEKIT_URL) missing.push("LIVEKIT_URL");
    if (!process.env.LIVEKIT_API_KEY) missing.push("LIVEKIT_API_KEY");
    if (!process.env.LIVEKIT_API_SECRET) missing.push("LIVEKIT_API_SECRET");

    if (missing.length) {
      return res.status(500).json({
        error: `Missing environment variables: ${missing.join(", ")}`,
      });
    }

    const room = String(req.query.room || "vx01-room").slice(0, 80);
    const identity = String(
      req.query.identity || `guest-${Math.random().toString(36).slice(2, 8)}`
    ).slice(0, 80);

    const token = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      { identity, name: identity }
    );

    token.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    res.json({
      token: await token.toJwt(),
      url: process.env.LIVEKIT_URL,
      room,
      identity,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "token_generation_failed" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`VX-01 backend running on port ${PORT}`);
});
