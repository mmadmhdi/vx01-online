# VX-01 Clean Deploy

Correct clean structure:

vx01-clean-deploy/
├── client/
│   ├── src/
│   ├── package.json
│   ├── index.html
│   └── vite.config.js
└── server/
    ├── package.json
    ├── server.js
    └── .env.example

## Render server settings

Root Directory:
server

Build Command:
npm install

Start Command:
npm start

Environment Variables:
LIVEKIT_URL=wss://vc-a1pcsord.livekit.cloud
LIVEKIT_API_KEY=APIHu2tgjzrsveh
LIVEKIT_API_SECRET=095Gcgf6F5xEANGPhuiucJhfeJKlec21BpuGiIos3oDB

## Vercel client settings

Root Directory:
client

Build Command:
npm run build

Output Directory:
dist

Environment Variable after Render:
VITE_TOKEN_SERVER_URL=https://YOUR_RENDER_URL.onrender.com/token

Access code:
Mohammad Mahdi Mahdizadeh
