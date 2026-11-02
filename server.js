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

let lastSyncStatus = {
  time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
};

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

// Helper to clean up game titles from Discord formatting
function cleanGameName(rawName) {
  if (!rawName) return null;
  let name = rawName
    .replace(/^#+\s*/g, '')
    .replace(/\*\*/g, '')
    .replace(/🎬\s*[:\-]*/g, '')
    .replace(/jdr\s*\d*\s*[:\-]/gi, '')
    .replace(/table\s*\d*\s*[:\-]/gi, '')
    .replace(/\(complet\)/gi, '')
    .replace(/<@&?\d+>/g, '')
    .replace(/titre\s*[:\-]/gi, '')
    .trim();

  if (name.length < 3 || name.toLowerCase().startsWith('séance') || name.toLowerCase().includes('http') || name.toLowerCase().startsWith('responsable')) {
    return null;
  }
  return name;
}

// Scraper for Ludophiles Discord (#organisation-tables & #jdr-agenda forum threads)
async function fetchLudophilesData() {
  if (!DISCORD_TOKEN) {
    console.log('[LudoMeter] ⚠️ No DISCORD_TOKEN found in .env.');
    return null;
  }

  try {
    console.log(`[LudoMeter] 🌐 Fetching live data from Ludophiles channels...`);
    const headers = {
      'Authorization': DISCORD_TOKEN,
      'Content-Type': 'application/json'
    };

    // 1. Fetch organization messages (signups)
    const fetchOrg = fetch(`https://discord.com/api/v10/channels/${ORG_CHANNEL_ID}/messages?limit=50`, { headers })
      .then(r => r.ok ? r.json() : []);

    // 2. Fetch agenda forum threads
    const fetchAgendaThreads = fetch(`https://discord.com/api/v10/channels/${AGENDA_CHANNEL_ID}/threads/archived/public?limit=30`, { headers })
      .then(r => r.ok ? r.json() : { threads: [] });

    const [orgMessages, agendaData] = await Promise.all([fetchOrg, fetchAgendaThreads]);
    const agendaThreads = agendaData.threads || [];

    console.log(`[LudoMeter] ✅ Fetched ${orgMessages.length} org messages, ${agendaThreads.length} agenda forum threads.`);

    lastSyncStatus.time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    const gameCounts = {};
    const wednesdaySessions = [];

    // Filter Wednesday threads in #jdr-agenda
    const wednesdayThreads = agendaThreads.filter(t => t.name.toLowerCase().includes('mercredi'));

    // Fetch messages for each Wednesday thread (up to 7 most recent)
    for (const thread of wednesdayThreads.slice(0, 7)) {
      try {
        const resThreadMsgs = await fetch(`https://discord.com/api/v10/channels/${thread.id}/messages?limit=10`, { headers });
        if (resThreadMsgs.ok) {
          const threadMsgs = await resThreadMsgs.json();
          const tables = [];

          threadMsgs.forEach(msg => {
            const content = msg.content || '';
            const lines = content.split('\n');

            const titleLine = lines.find(l => l.includes('🎬') || l.toLowerCase().includes('titre :') || l.toLowerCase().includes('jdr'));
            const mjLine = lines.find(l => l.includes('👑') || l.toLowerCase().includes('mj'));
            const systemLine = lines.find(l => l.includes('🎲') || l.toLowerCase().includes('système'));

            const rawGame = titleLine || (lines[0] && !lines[0].includes('chanson') ? lines[0] : null);
            const cleanedGame = cleanGameName(rawGame);

            if (cleanedGame) {
              const mj = mjLine ? mjLine.replace(/\*\*/g, '').trim() : "👑 MJ: Association";
              const system = systemLine ? systemLine.replace(/\*\*/g, '').trim() : null;

              tables.push({
                num: tables.length + 1,
                game: cleanedGame,
                system: system,
                mj: mj,
                author: msg.author ? msg.author.username : "MJ",
                details: content
              });

              gameCounts[cleanedGame] = (gameCounts[cleanedGame] || 0) + 1;
            }
          });

          const createDate = thread.thread_metadata?.create_timestamp
            ? new Date(thread.thread_metadata.create_timestamp).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
            : thread.name;

          wednesdaySessions.push({
            id: thread.id,
            title: thread.name,
            date: createDate,
            tablesCount: tables.length,
            tables: tables
          });
        }
      } catch (err) {
        console.warn(`[LudoMeter] Warning reading thread ${thread.name}:`, err.message);
      }
    }

    // Also extract games from #organisation-tables messages
    orgMessages.forEach(msg => {
      const content = msg.content || '';
      const lines = content.split('\n');
      lines.forEach(line => {
        if (line.includes('JDR') || line.includes('###') || line.includes('🎲')) {
          const game = cleanGameName(line);
          if (game) {
            gameCounts[game] = (gameCounts[game] || 0) + 1;
          }
        }
      });
    });

    const gamesArray = Object.keys(gameCounts).map(name => ({
      name,
      sessions: gameCounts[name],
      players: 4
    })).sort((a, b) => b.sessions - a.sessions);

    const topGame = gamesArray.length > 0 ? gamesArray[0].name : "Warhammer / Delta Green";
    const totalSessions = wednesdaySessions.length || orgMessages.length;

    return {
      success: true,
      source: 'discord-live-ludophiles',
      lastSync: lastSyncStatus.time,
      diagnostics: {
        orgMessagesCount: orgMessages.length,
        agendaThreadsCount: agendaThreads.length
      },
      association: "Les Ludophiles d'Asnières et d'ailleurs",
      kpis: {
        totalSessions,
        totalGames: gamesArray.length,
        activeMembers: 52,
        topGame
      },
      games: gamesArray,
      wednesdaySessions,
      recentSessions: wednesdaySessions
    };
  } catch (err) {
    console.error('[LudoMeter] ❌ Error fetching live Ludophiles Discord API:', err);
    return null;
  }
}

// Secure API endpoint
app.get('/api/kpis', async (req, res) => {
  try {
    const liveData = await fetchLudophilesData();

    if (liveData && liveData.wednesdaySessions.length > 0) {
      res.json(liveData);
    } else {
      res.json({
        success: true,
        source: 'discord-live-empty',
        association: "Les Ludophiles d'Asnières et d'ailleurs",
        kpis: {
          totalSessions: 0,
          totalGames: 0,
          activeMembers: 32,
          topGame: "En attente de messages"
        },
        games: [],
        wednesdaySessions: [
          {
            title: "Aucune session récupérée des salons Discord",
            date: "Vérifiez les IDs dans .env",
            tablesCount: 0,
            tables: []
          }
        ],
        recentSessions: []
      });
    }
  } catch (err) {
    console.error('Error in /api/kpis:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.listen(PORT, () => {
  console.log(`[LudoMeter] 🚀 Server running securely on port ${PORT}`);
});
