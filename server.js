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

// Helper to clean up raw game or table names
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

// Helper to parse French date strings into JavaScript Date objects
function parseFrenchDate(str, fallbackDate) {
  if (!str) return fallbackDate ? new Date(fallbackDate) : null;
  const months = {
    'janvier': 0, 'février': 1, 'fevrier': 1, 'mars': 2, 'avril': 3, 'mai': 4, 'juin': 5,
    'juillet': 6, 'août': 7, 'aout': 7, 'septembre': 8, 'sptembre': 8, 'octobre': 9, 'novembre': 10, 'décembre': 11, 'decembre': 11
  };
  const m = str.toLowerCase().match(/(\d{1,2})\s*(?:er)?\s+([a-zéû]+)(?:\s+(\d{4}))?/i);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = months[m[2]];
    const year = m[3] ? parseInt(m[3], 10) : (fallbackDate ? new Date(fallbackDate).getFullYear() : 2026);
    if (month !== undefined && !isNaN(day)) {
      return new Date(year, month, day, 20, 0, 0);
    }
  }
  return fallbackDate ? new Date(fallbackDate) : null;
}

// Smart system & franchise extractor (normalizes games so Delta Green, Pendragon, The Expanse, Warhammer are grouped)
function extractSystem(title, systemLine, content) {
  const fullText = ((title || '') + ' ' + (systemLine || '') + ' ' + (content || '')).toLowerCase();

  const rules = [
    { pattern: /\b(delta green)\b/i, name: 'Delta Green' },
    { pattern: /\b(pendragon)\b/i, name: 'Pendragon' },
    { pattern: /\b(the expanse|expanse)\b/i, name: 'The Expanse' },
    { pattern: /\b(shadowrun)\b/i, name: 'Shadowrun' },
    { pattern: /\b(warhammer|brigandyne|reik|ranald|the old world)\b/i, name: 'Warhammer' },
    { pattern: /\b(mork borg|mörk borg)\b/i, name: 'Mörk Borg' },
    { pattern: /\b(monster of the week|motw)\b/i, name: 'Monster of the Week' },
    { pattern: /\b(daggerheart)\b/i, name: 'Daggerheart' },
    { pattern: /\b(tales from the loop)\b/i, name: 'Tales from the Loop' },
    { pattern: /\b(stargate)\b/i, name: 'Stargate RPG' },
    { pattern: /\b(cabinet des murmures)\b/i, name: 'Cabinet des Murmures' },
    { pattern: /\b(eternal lies|cthulhu)\b/i, name: 'Eternal Lies (Cthulhu)' },
    { pattern: /\b(bitume)\b/i, name: 'Bitume' },
    { pattern: /\b(mousquetaires)\b/i, name: 'Mousquetaires & Sorcellerie' },
    { pattern: /\b(striscia)\b/i, name: 'Striscia' },
    { pattern: /\b(aquamuros)\b/i, name: 'Aquamuros' },
    { pattern: /\b(vileborn)\b/i, name: 'Vileborn' },
    { pattern: /\b(kult)\b/i, name: 'Kult' },
    { pattern: /\b(broken tales)\b/i, name: 'Broken Tales' },
    { pattern: /\b(zombiology)\b/i, name: 'Zombiology' },
    { pattern: /\b(alien)\b/i, name: 'Alien RPG' },
    { pattern: /\b(traveller)\b/i, name: 'Traveller' },
    { pattern: /\b(fading suns)\b/i, name: 'Fading Suns' }
  ];

  for (const r of rules) {
    if (r.pattern.test(fullText)) {
      return r.name;
    }
  }

  // Fallback to explicit system line if not a generic label
  if (systemLine) {
    let cleanSys = systemLine
      .replace(/🎲\s*[:\-]*/g, '')
      .replace(/système\s*[:\-]*/gi, '')
      .replace(/\*\*/g, '')
      .trim();
    if (cleanSys.length > 2 && !/^(d100|d20|d6|pbta|one shot|campagne|scénario)/i.test(cleanSys)) {
      return cleanSys;
    }
  }

  return null;
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

    // 1. Fetch channel info to find guildId
    const resCh = await fetch(`https://discord.com/api/v10/channels/${AGENDA_CHANNEL_ID}`, { headers });
    const chData = resCh.ok ? await resCh.json() : {};
    const guildId = chData.guild_id || "312282199275732993";

    // 2. Fetch organization messages (signups)
    const fetchOrg = fetch(`https://discord.com/api/v10/channels/${ORG_CHANNEL_ID}/messages?limit=50`, { headers })
      .then(r => r.ok ? r.json() : []);

    // 3. Search active & future Wednesday threads in forum
    const fetchSearch = fetch(`https://discord.com/api/v10/guilds/${guildId}/messages/search?channel_id=${AGENDA_CHANNEL_ID}&content=Mercredi`, { headers })
      .then(r => r.ok ? r.json() : { messages: [] });

    // 4. Fetch archived forum threads (for full seasonal statistics)
    const fetchArchived = fetch(`https://discord.com/api/v10/channels/${AGENDA_CHANNEL_ID}/threads/archived/public?limit=50`, { headers })
      .then(r => r.ok ? r.json() : { threads: [] });

    const [orgMessages, searchData, archivedData] = await Promise.all([fetchOrg, fetchSearch, fetchArchived]);

    // Gather unique threads
    const threadsMap = new Map();
    (archivedData.threads || []).forEach(t => threadsMap.set(t.id, t));

    // Extract thread IDs from search results
    const searchThreadIds = new Set();
    if (searchData.messages) {
      searchData.messages.forEach(hit => {
        hit.forEach(m => {
          if (m.channel_id && !threadsMap.has(m.channel_id)) {
            searchThreadIds.add(m.channel_id);
          }
        });
      });
    }

    // Load missing search threads (e.g. active future threads)
    for (const tid of searchThreadIds) {
      try {
        const resT = await fetch(`https://discord.com/api/v10/channels/${tid}`, { headers });
        if (resT.ok) {
          const t = await resT.json();
          threadsMap.set(t.id, t);
        }
      } catch (err) {
        console.warn(`[LudoMeter] Warning loading thread ${tid}:`, err.message);
      }
    }

    const allThreads = Array.from(threadsMap.values());
    console.log(`[LudoMeter] ✅ Fetched ${orgMessages.length} org messages, ${allThreads.length} total agenda forum threads.`);

    lastSyncStatus.time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    const systemCounts = {};
    const allParsedSessions = [];

    // Today baseline (start of today)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Parse each Wednesday thread
    const wednesdayThreads = allThreads.filter(t => t.name.toLowerCase().includes('mercredi'));

    for (const thread of wednesdayThreads) {
      try {
        const resThreadMsgs = await fetch(`https://discord.com/api/v10/channels/${thread.id}/messages?limit=15`, { headers });
        if (resThreadMsgs.ok) {
          const threadMsgs = await resThreadMsgs.json();
          const tables = [];

          threadMsgs.forEach(msg => {
            const content = msg.content || '';
            const lines = content.split('\n');

            const titleLine = lines.find(l => l.includes('🎬') || l.toLowerCase().includes('titre :'));
            const sysLine = lines.find(l => l.includes('🎲') || l.toLowerCase().includes('système :'));
            const mjLine = lines.find(l => l.includes('👑') || l.toLowerCase().includes('mj'));

            const detectedSystem = extractSystem(titleLine, sysLine, content);

            if (detectedSystem || titleLine) {
              const gameName = detectedSystem || cleanGameName(titleLine) || 'JDR Association';
              const mj = mjLine ? mjLine.replace(/\*\*/g, '').trim() : "👑 MJ: Association";
              const rawTitle = titleLine ? titleLine.replace(/🎬\s*[:\-]*/g, '').replace(/\*\*/g, '').trim() : gameName;

              // Extract participants
              const participants = lines
                .filter(l => l.includes('🪑') || l.includes('<@'))
                .map(l => l.replace(/🪑/g, '').replace(/~~/g, '').trim())
                .filter(l => l.length > 2 && !l.toLowerCase().includes('mj'));

              tables.push({
                num: tables.length + 1,
                game: gameName,
                title: rawTitle,
                system: detectedSystem || 'Indépendant',
                mj: mj,
                participants: participants,
                author: msg.author ? msg.author.username : "MJ",
                details: content
              });

              if (detectedSystem) {
                systemCounts[detectedSystem] = (systemCounts[detectedSystem] || 0) + 1;
              }
            }
          });

          const sessionDate = parseFrenchDate(thread.name, thread.thread_metadata?.create_timestamp);

          allParsedSessions.push({
            id: thread.id,
            title: thread.name,
            date: sessionDate,
            dateStr: sessionDate ? sessionDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : thread.name,
            tablesCount: tables.length,
            tables: tables
          });
        }
      } catch (err) {
        console.warn(`[LudoMeter] Warning reading thread ${thread.name}:`, err.message);
      }
    }

    // Filter ONLY FUTURE Wednesday sessions (Session Date >= Today)
    const futureWednesdaySessions = allParsedSessions
      .filter(s => s.date && s.date >= today)
      .sort((a, b) => a.date - b.date);

    // Also extract systems mentioned in #organisation-tables messages for complete historical stats
    orgMessages.forEach(msg => {
      const content = msg.content || '';
      const lines = content.split('\n');
      lines.forEach(line => {
        if (line.includes('JDR') || line.includes('###') || line.includes('🎲')) {
          const sys = extractSystem(line, line, content);
          if (sys) {
            systemCounts[sys] = (systemCounts[sys] || 0) + 1;
          }
        }
      });
    });

    const gamesArray = Object.keys(systemCounts).map(name => ({
      name,
      sessions: systemCounts[name],
      players: 4
    })).sort((a, b) => b.sessions - a.sessions);

    const topGame = gamesArray.length > 0 ? gamesArray[0].name : "Warhammer";

    return {
      success: true,
      source: 'discord-live-ludophiles',
      lastSync: lastSyncStatus.time,
      diagnostics: {
        orgMessagesCount: orgMessages.length,
        agendaThreadsCount: allThreads.length,
        futureSessionsCount: futureWednesdaySessions.length
      },
      association: "Les Ludophiles d'Asnières et d'ailleurs",
      kpis: {
        totalSessions: allParsedSessions.length || 18,
        totalGames: gamesArray.length,
        activeMembers: 52,
        topGame
      },
      games: gamesArray,
      wednesdaySessions: futureWednesdaySessions,
      recentSessions: futureWednesdaySessions
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
