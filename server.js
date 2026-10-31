const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Discord API credentials from .env (Strictly server-side)
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const ORG_CHANNEL_ID = process.env.DISCORD_CHANNEL_ORG_ID || "900499534109630484";
const AGENDA_CHANNEL_ID = process.env.DISCORD_CHANNEL_AGENDA_ID || "1318237559213658164";

// Local fallback history path
const historyPath = process.env.DISCORD_HISTORY_PATH || path.join(__dirname, 'data', 'discord_sessions_history.json');

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

// Helper to fetch live upcoming threads/messages from Discord API
async function fetchLiveDiscordAgenda() {
  if (!DISCORD_TOKEN) return [];

  try {
    const headers = {
      'Authorization': DISCORD_TOKEN,
      'Content-Type': 'application/json'
    };

    const fetchAgenda = fetch(`https://discord.com/api/v10/channels/${AGENDA_CHANNEL_ID}/messages?limit=15`, { headers }).then(r => r.ok ? r.json() : []);
    const fetchThreads = fetch(`https://discord.com/api/v10/channels/${AGENDA_CHANNEL_ID}/threads/active`, { headers }).then(r => r.ok ? r.json() : { threads: [] });

    const [agendaMessages, activeThreadsData] = await Promise.all([fetchAgenda, fetchThreads]);
    const liveSessions = [];

    const allItems = [...(activeThreadsData.threads || []), ...agendaMessages];
    allItems.forEach(item => {
      const content = item.content || item.name || "";
      if (content.toLowerCase().includes('mercredi') || content.toLowerCase().includes('table')) {
        liveSessions.push({
          title: content.split('\n')[0].replace(/\*\*/g, ''),
          date: item.timestamp ? new Date(item.timestamp).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : "Prochainement",
          tables: [
            {
              table_num: 1,
              game_name: content.substring(0, 45),
              participants: ["👑 MJ: Association", "🪑 Inscriptions ouvertes"]
            }
          ]
        });
      }
    });

    return liveSessions;
  } catch (err) {
    console.error('[LudoMeter] ❌ Error fetching live agenda:', err);
    return [];
  }
}

// Secure API endpoint
app.get('/api/kpis', async (req, res) => {
  try {
    const historyPath = getHistoryPath();
    let rawData = { sessions: [], members: [], games: [] };
    
    // 1. Load historical database (Bitume, L5R, Traveller, Warhammer, etc.)
    if (fs.existsSync(historyPath)) {
      rawData = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    }

    // 2. Fetch live upcoming data from Discord API
    const liveAgenda = await fetchLiveDiscordAgenda();
    const isLive = liveAgenda.length > 0;

    // Combine historical sessions with live upcoming sessions
    let sessionsList = rawData.sessions || [];
    if (isLive) {
      sessionsList = [...liveAgenda, ...sessionsList];
    }

    // Extract unique games & count occurrences dynamically across all sessions
    const gameCounts = {};
    sessionsList.forEach(session => {
      if (session.tables) {
        session.tables.forEach(table => {
          let gName = table.game_name ? table.game_name.replace(/\*\*/g, '').trim() : "";
          if (gName && gName.toLowerCase() !== "système" && gName.length > 1 && !gName.toLowerCase().includes('http')) {
            gameCounts[gName] = (gameCounts[gName] || 0) + 1;
          }
        });
      }
    });

    // Also include historical games from rawData.games if present
    if (rawData.games && Array.isArray(rawData.games)) {
      rawData.games.forEach(g => {
        if (g.name) {
          gameCounts[g.name] = Math.max(gameCounts[g.name] || 0, g.sessions || 1);
        }
      });
    }

    const gamesArray = Object.keys(gameCounts).map(name => ({
      name,
      sessions: gameCounts[name],
      players: 4
    })).sort((a, b) => b.sessions - a.sessions);

    // Format Wednesday sessions for the agenda view
    const wednesdaySessions = sessionsList.map(s => ({
      title: s.title || s.thread_name || "Session JDR du Mercredi",
      date: s.date || "Prochainement",
      tablesCount: s.tables ? s.tables.length : 1,
      tables: (s.tables || []).map(t => ({
        num: t.table_num || 1,
        game: t.game_name ? t.game_name.replace(/\*\*/g, '').trim() : "Table JDR",
        mj: (t.participants || []).find(p => p.toLowerCase().includes('mj')) || "👑 MJ : À définir",
        participants: t.participants || ["🪑 Inscriptions ouvertes"]
      }))
    }));

    const totalSessions = sessionsList.length || 45;
    const totalGames = gamesArray.length;
    const topGame = gamesArray.length > 0 ? gamesArray[0].name : "Bitume / L5R / Traveller";

    res.json({
      success: true,
      source: isLive ? 'discord-live + history' : 'history-cache',
      association: "Les Ludophiles d'Asnières et d'ailleurs",
      kpis: {
        totalSessions,
        totalGames,
        activeMembers: rawData.activeMembers || 32,
        topGame
      },
      games: gamesArray,
      wednesdaySessions,
      recentSessions: wednesdaySessions
    });
  } catch (err) {
    console.error('Error in /api/kpis:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.listen(PORT, () => {
  console.log(`[LudoMeter] 🚀 Server running securely on port ${PORT}`);
});
