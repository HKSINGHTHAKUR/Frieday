# Frieday

Frieday connects to your GitHub account and helps you see your repository activity — repositories, commits, pull requests, and issues — through a personal dashboard with activity timelines and insights.

## Live Demo

Try Frieday: https://frieday.onrender.com

## Features

- **GitHub authentication** — sign in with GitHub OAuth and connect your account.
- **Repositories** — view your synced repositories and their metadata.
- **Activity timeline** — see commits, pull requests, and issues over time.
- **Insights** — deterministic summaries and metrics of your GitHub activity.
- **Sync** — manually sync your GitHub data and check sync status.
- **Account controls** — disconnect GitHub, sign out, or permanently delete all synced data.

## Tech Stack

- Frontend: React, Vite, Tailwind CSS
- Backend: Node.js, Express
- Database: MongoDB (Mongoose)
- GitHub integration: GitHub OAuth (@octokit/rest)
- Deployment: Render

## Getting Started

Frieday is a full-stack app with a React client (Vite) and a Node/Express server. Run them separately.

```bash
# Clone the repository
git clone https://github.com/HKSINGHTHAKUR/Frieday.git
cd Frieday

# Install dependencies for client and server
npm install
```

Create a `.env` for the server from `.env.example` and set the required variables (at minimum `JWT_SECRET`, `TOKEN_ENC_KEY`, and GitHub OAuth credentials `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`; `MONGO_URI` defaults to a local database).

```bash
# Server (terminal 1)
npm run dev -w server   # http://localhost:5000

# Client (terminal 2)
npm run dev -w client   # http://localhost:5173
```

The dev proxy forwards `/api` to `http://localhost:5000`. `npm run dev` at the root runs both together.

## Security note

Frieday requests `read:user` and `repo` GitHub OAuth scopes. The `repo` scope can authorize access to private repository information available to your account; Frieday does not distinguish between public and private data at collection time. Your GitHub access token is encrypted at rest and never sent to your browser. Disconnecting revokes the GitHub grant and clears the stored token; "Delete all data" permanently removes your synced data.

## Links

- Live application: https://frieday.onrender.com
- Source code: https://github.com/HKSINGHTHAKUR/Frieday
