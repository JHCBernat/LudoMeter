const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Secure API endpoint: Credentials stay 100% server-side
app.get('/api/kpis', (req, res) => {
  try {
    // Path to shared Discord sessions history on NAS volume or local test
    const historyPath = path.join(__dirname, 'data', 'discord_sessions_history.json');
    
    let rawData = { sessions: [], members: [], games: [] };
    if (fs.existsSync(historyPath)) {
      rawData = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    } else {
      // Default sample data matching JdR92 context if file doesn't exist yet
      rawData = {
        games: [
          { name: "Fading Suns", sessions: 12, players: 5 },
          { name: "Traveller", sessions: 8, players: 4 },
          { name: "Alien", sessions: 6, players: 4 },
          { name: "Daggerheart", sessions: 10, players: 6 },
          { name: "L5R", sessions: 7, players: 5 }
        ],
        sessionsTotal: 43,
        activeMembers: 24,
        recentSessions: [
          { title: "Fading Suns: La Grande Menace #12", date: "2026-10-28", gm: "Julien", game: "Fading Suns" },
          { title: "Traveller: Les Étoiles Mortes #8", date: "2026-10-25", gm: "Marc", game: "Traveller" },
          { title: "Alien: Isolation Lunaire #6", date: "2026-10-22", gm: "Thomas", game: "Alien" }
        ]
      };
    }

    // Compute KPIs securely on server
    const totalSessions = rawData.sessionsTotal || rawData.games.reduce((acc, g) => acc + (g.sessions || 0), 0);
    const totalGames = rawData.games.length;
    const activeMembers = rawData.activeMembers || 22;

    res.json({
      success: true,
      kpis: {
        totalSessions,
        totalGames,
        activeMembers,
        topGame: rawData.games.sort((a,b) => b.sessions - a.sessions)[0]?.name || "Fading Suns"
      },
      games: rawData.games,
      recentSessions: rawData.recentSessions || []
    });
  } catch (err) {
    console.error('Error fetching KPIs:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.listen(PORT, () => {
  console.log(`JdR92 KPI Dashboard running on port ${PORT}`);
});
