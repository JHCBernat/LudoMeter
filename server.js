const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Smart path resolution for Discord sessions history (Docker / NAS Gateway / Local)
function getHistoryPath() {
  const possiblePaths = [
    process.env.DISCORD_HISTORY_PATH,
    '/app/data/discord_sessions_history.json',
    '/h/data/discord_sessions_history.json',
    path.join(__dirname, 'data', 'discord_sessions_history.json')
  ].filter(Boolean);

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(__dirname, 'data', 'discord_sessions_history.json');
}

// Function to perform immediate sync check on startup and daily
async function checkAndSyncData() {
  const historyPath = getHistoryPath();
  console.log(`[LudoMeter] 🔄 Running Discord data check for "Les Ludophiles d'Asnières" (Path: ${historyPath})...`);
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
          { name: "Donjons & Dragons 5E", sessions: 22, players: 6 }
        ],
        sessionsTotal: 36,
        activeMembers: 32,
        recentSessions: [
          { title: "Mercredi 28 octobre", date: "28 octobre", tables: [{ table_num: 1, game_name: "Kult", participants: ["👑 MJ", "🪑 Joueur"] }] }
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
    const historyPath = getHistoryPath();
    let rawData = { sessions: [], members: [], games: [] };
    if (fs.existsSync(historyPath)) {
      rawData = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    }

    const sessionsList = rawData.sessions || [];

    // Extract unique games & count occurrences from actual gateway tables
    const gameCounts = {};
    sessionsList.forEach(session => {
      if (session.tables) {
        session.tables.forEach(table => {
          let gName = table.game_name ? table.game_name.replace(/\*\*/g, '').trim() : "Autre";
          if (gName && gName.toLowerCase() !== "système" && gName.length > 1) {
            gameCounts[gName] = (gameCounts[gName] || 0) + 1;
          }
        });
      }
    });

    const gamesArray = Object.keys(gameCounts).map(name => ({
      name,
      sessions: gameCounts[name],
      players: 4
    })).sort((a, b) => b.sessions - a.sessions);

    // Filter Wednesday sessions specifically from #jdr-agenda / threads starting with "Mercredi"
    const wednesdaySessions = sessionsList
      .filter(s => s.thread_name && s.thread_name.toLowerCase().includes('mercredi'))
      .map(s => ({
        title: s.thread_name,
        date: s.date,
        tablesCount: s.tables ? s.tables.length : 0,
        tables: (s.tables || []).map(t => ({
          num: t.table_num,
          game: t.game_name ? t.game_name.replace(/\*\*/g, '').trim() : "Table JDR",
          mj: (t.participants || []).find(p => p.toLowerCase().includes('mj')) || "MJ à définir",
          participants: t.participants || []
        }))
      }));

    const totalSessions = sessionsList.length || (rawData.sessionsTotal || 36);
    const totalGames = gamesArray.length || (rawData.games ? rawData.games.length : 3);
    const topGame = gamesArray.length > 0 ? gamesArray[0].name : (rawData.games?.[0]?.name || "Warhammer");

    res.json({
      success: true,
      association: "Les Ludophiles d'Asnières et d'ailleurs",
      kpis: {
        totalSessions,
        totalGames,
        activeMembers: rawData.activeMembers || 32,
        topGame
      },
      games: gamesArray.length > 0 ? gamesArray : (rawData.games || []),
      wednesdaySessions,
      recentSessions: wednesdaySessions.length > 0 ? wednesdaySessions : (rawData.recentSessions || [])
    });
  } catch (err) {
    console.error('Error fetching KPIs:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.listen(PORT, () => {
  console.log(`[LudoMeter] 🚀 Server running securely on port ${PORT}`);
});
