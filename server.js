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

// Helper to fetch live data directly from Les Ludophiles d'Asnières Discord channels
async function fetchLudophilesData() {
  if (!DISCORD_TOKEN) {
    console.log('[LudoMeter] ⚠️ No DISCORD_TOKEN found in .env.');
    return null;
  }

  try {
    console.log(`[LudoMeter] 🌐 Fetching live data from Ludophiles channels (Org: ${ORG_CHANNEL_ID}, Agenda: ${AGENDA_CHANNEL_ID})...`);
    const headers = {
      'Authorization': DISCORD_TOKEN,
      'Content-Type': 'application/json'
    };

    const fetchOrg = fetch(`https://discord.com/api/v10/channels/${ORG_CHANNEL_ID}/messages?limit=50`, { headers }).then(r => r.ok ? r.json() : []);
    const fetchAgenda = fetch(`https://discord.com/api/v10/channels/${AGENDA_CHANNEL_ID}/messages?limit=50`, { headers }).then(r => r.ok ? r.json() : []);
    const fetchThreads = fetch(`https://discord.com/api/v10/channels/${AGENDA_CHANNEL_ID}/threads/active`, { headers }).then(r => r.ok ? r.json() : { threads: [] });

    const [orgMessages, agendaMessages, activeThreadsData] = await Promise.all([fetchOrg, fetchAgenda, fetchThreads]);

    console.log(`[LudoMeter] ✅ Fetched ${orgMessages.length} org messages, ${agendaMessages.length} agenda messages, and ${activeThreadsData.threads?.length || 0} active threads.`);

    const sessionsMap = {};
    const gameCounts = {};
    const allItems = [...(activeThreadsData.threads || []), ...agendaMessages, ...orgMessages];
    
    allItems.forEach(item => {
      // Extract raw texts from content, name, and embeds
      let rawTexts = [];
      if (item.content) rawTexts.push(item.content);
      if (item.name) rawTexts.push(item.name);
      if (item.embeds && Array.isArray(item.embeds)) {
        item.embeds.forEach(emb => {
          if (emb.title) rawTexts.push(emb.title);
          if (emb.description) rawTexts.push(emb.description);
          if (emb.fields && Array.isArray(emb.fields)) {
            emb.fields.forEach(f => {
              if (f.name) rawTexts.push(f.name);
              if (f.value) rawTexts.push(f.value);
            });
          }
        });
      }

      const content = rawTexts.join('\n').trim();
      if (content.length > 2 && !content.toLowerCase().includes('http')) {
        const dateStr = item.timestamp ? new Date(item.timestamp).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : "Prochainement";
        const threadId = item.id || item.thread_id || Math.random().toString();

        const lines = content.split('\n');
        const sessionTitle = lines[0].replace(/\*\*/g, '').trim();

        const tables = [];
        let currentTable = { table_num: 1, game_name: sessionTitle, mj: "👑 MJ: Association", participants: [] };

        lines.slice(1).forEach(line => {
          const cleanLine = line.replace(/\*\*/g, '').trim();
          if (cleanLine.length > 2) {
            if (cleanLine.toLowerCase().includes('mj') || cleanLine.includes('👑')) {
              currentTable.mj = cleanLine;
            } else if (cleanLine.startsWith('-') || cleanLine.startsWith('•') || cleanLine.toLowerCase().includes('table')) {
              if (currentTable.game_name && currentTable.game_name !== sessionTitle) {
                tables.push(currentTable);
                currentTable = { table_num: tables.length + 1, game_name: cleanLine, mj: "👑 MJ: Association", participants: [] };
              } else {
                currentTable.game_name = cleanLine;
              }
            } else {
              currentTable.participants.push(cleanLine);
            }
          }
        });

        if (tables.length === 0) {
          tables.push(currentTable);
        }

        if (!sessionsMap[threadId]) {
          sessionsMap[threadId] = {
            title: sessionTitle || "Session JDR",
            date: dateStr,
            thread_id: threadId,
            tables
          };
        }

        if (sessionTitle && sessionTitle.length > 2) {
          gameCounts[sessionTitle] = (gameCounts[sessionTitle] || 0) + 1;
        }
      }
    });

    const sessionsList = Object.values(sessionsMap);
    const gamesArray = Object.keys(gameCounts).map(name => ({
      name,
      sessions: gameCounts[name],
      players: 4
    })).sort((a, b) => b.sessions - a.sessions);

    return {
      success: true,
      source: 'discord-live-ludophiles',
      lastSync: lastSyncStatus.time || '13:00',
      association: "Les Ludophiles d'Asnières et d'ailleurs",
      kpis: {
        totalSessions: sessionsList.length,
        totalGames: gamesArray.length || 1,
        activeMembers: 32,
        topGame: gamesArray.length > 0 ? gamesArray[0].name : "JDR Asnières"
      },
      games: gamesArray.length > 0 ? gamesArray : [{ name: "Tables JDR & Plateau", sessions: sessionsList.length, players: 4 }],
      wednesdaySessions: sessionsList.map(s => ({
        title: s.title,
        date: s.date,
        tablesCount: s.tables.length,
        tables: s.tables
      })),
      recentSessions: sessionsList.map(s => ({
        title: s.title,
        date: s.date,
        tablesCount: s.tables.length,
        tables: s.tables
      }))
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
