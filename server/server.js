import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { AccessToken } from "livekit-server-sdk";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (_, res) => {
  res.json({
    ok: true,
    service: "VX-01 LiveKit Backend"
  });
});

app.get("/health", (_, res) => {
  res.json({
    ok: true
  });
});

app.get("/token", async (req, res) => {
  try {
    const room = req.query.room || "vx01-room";

    const identity =
      req.query.identity ||
      `guest-${Math.random().toString(36).slice(2, 8)}`;

    const token = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      {
        identity,
        name: identity,
      }
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
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "token_generation_failed",
    });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`VX-01 backend running on port ${PORT}`);
});
