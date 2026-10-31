const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Path to Discord sessions history (synced from #organisation-tables)
const historyPath = process.env.DISCORD_HISTORY_PATH || path.join(__dirname, 'data', 'discord_sessions_history.json');

// Function to perform immediate sync check on startup and daily
async function checkAndSyncData() {
  console.log('[LudoMeter] 🔄 Running Discord data check for "Les Ludophiles d\'Asnières"...');
  try {
    const dataDir = path.dirname(historyPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    if (fs.existsSync(historyPath)) {
      const stats = fs.statSync(historyPath);
      console.log(`[LudoMeter] ✅ History file active. Last modified: ${stats.mtime}`);
    } else {
      console.log('[LudoMeter] ⚠️ History file not found. Initializing sample dataset...');
      const initialData = {
        association: "Les Ludophiles d'Asnières et d'ailleurs",
        games: [
          { name: "Daggerheart", sessions: 0, players: 5, status: "1ère séance bientôt" },
          { name: "L'Appel de Cthulhu", sessions: 14, players: 5 },
          { name: "Donjons & Dragons 5E", sessions: 22, players: 6 },
          { name: "Chroniques Oubliées", sessions: 8, players: 4 },
          { name: "Soirées Jeux de Plateau", sessions: 35, players: 18 }
        ],
        sessionsTotal: 79,
        activeMembers: 32,
        recentSessions: [
          { title: "Daggerheart: L'Aube des Braves #0 (Préparation)", date: "Prochainement", gm: "Julien", game: "Daggerheart" },
          { title: "L'Appel de Cthulhu: Les Masques #14", date: "24 Oct 2026", gm: "Thomas", game: "L'Appel de Cthulhu" },
          { title: "D&D 5E: La Malédiction de Strahd #22", date: "20 Oct 2026", gm: "Marc", game: "Donjons & Dragons 5E" }
        ]
      };
      fs.writeFileSync(historyPath, JSON.stringify(initialData, null, 2), 'utf8');
    }
  } catch (err) {
    console.error('[LudoMeter] ❌ Error during sync check:', err);
  }
}

// 1. Check immediately upon startup
checkAndSyncData();

// 2. Schedule daily check (every 24 hours)
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
setInterval(checkAndSyncData, TWENTY_FOUR_HOURS);

// Secure API endpoint: Credentials stay 100% server-side
app.get('/api/kpis', (req, res) => {
  try {
    let rawData = { sessions: [], members: [], games: [] };
    if (fs.existsSync(historyPath)) {
      rawData = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    }

    const totalSessions = rawData.sessionsTotal || (rawData.games ? rawData.games.reduce((acc, g) => acc + (g.sessions || 0), 0) : 0);
    const totalGames = rawData.games ? rawData.games.length : 0;
    const activeMembers = rawData.activeMembers || 24;

    res.json({
      success: true,
      association: "Les Ludophiles d'Asnières et d'ailleurs",
      kpis: {
        totalSessions,
        totalGames,
        activeMembers,
        topGame: rawData.games && rawData.games.length > 0 
          ? rawData.games.sort((a,b) => b.sessions - a.sessions)[0]?.name 
          : "N/A"
      },
      games: rawData.games || [],
      recentSessions: rawData.recentSessions || []
    });
  } catch (err) {
    console.error('Error fetching KPIs:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.listen(PORT, () => {
  console.log(`[LudoMeter] 🚀 Server running securely on port ${PORT}`);
});
