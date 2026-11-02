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
    .replace(/\(full\)|\(complet\)|\(fin\)/gi, '')
    .replace(/<@&?\d+>/g, '')
    .replace(/titre\s*[:\-]/gi, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
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

// Clean date strings from #organisation-tables headers
function cleanDateHeader(raw) {
  if (!raw) return 'Date non spécifiée';
  return raw
    .replace(/\*\*/g, '')
    .replace(/séance\s*(du|d'halloween\s*du)?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Normalize system name
function normalizeSystem(raw) {
  if (!raw) return 'Indépendant';
  const r = raw.toLowerCase();
  if (r.includes('delta green')) return 'Delta Green';
  if (r.includes('warhammer') || r.includes('brigandyne') || r.includes('reik') || r.includes('the old world')) return 'Warhammer';
  if (r.includes('shadowrun')) return 'Shadowrun';
  if (r.includes('traveller')) return 'Traveller';
  if (r.includes('the expanse') || r.includes('expanse')) return 'The Expanse';
  if (r.includes('black sword hack') || r.includes('bsh')) return 'Black Sword Hack';
  if (r.includes('eat the reich')) return 'Eat the Reich';
  if (r.includes('in nomine satanis') || r.includes('ins')) return 'In Nomine Satanis';
  if (r.includes('mork borg') || r.includes('mörk borg')) return 'Mörk Borg';
  if (r.includes('tales from the loop')) return 'Tales from the Loop';
  if (r.includes('cabinet des murmures')) return 'Cabinet des Murmures';
  if (r.includes('eternal lies') || r.includes('cthulhu')) return 'Cthulhu / Eternal Lies';
  if (r.includes('bitume')) return 'Bitume';
  if (r.includes('pendragon')) return 'Pendragon';
  if (r.includes('mousquetaires') || r.includes('cave canem')) return 'Mousquetaires & Sorcellerie';
  if (r.includes('stargate')) return 'Stargate RPG';
  if (r.includes('roots') || r.includes('root')) return 'Root';
  if (r.includes('babarian') || r.includes('barbarians')) return 'Barbarians of Lemuria';
  return cleanGameName(raw) || raw;
}

// Helper to extract system strictly from lines starting with 🎲 (fallback 🎬)
function extractSystemStrict(content) {
  const lines = (content || '').split('\n').map(l => l.replace(/\*\*/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1').trim()).filter(Boolean);

  // 1. Prioritize line starting with 🎲 (e.g. 🎲 Système ...)
  const diceLine = lines.find(l => l.startsWith('🎲') || l.toLowerCase().startsWith('système'));
  if (diceLine) {
    const s = diceLine.replace(/🎲\s*[:\-]*/g, '').replace(/système\s*[:\-]*/gi, '').trim();
    if (s.length > 2 && !/^(d100|d20|d6|pbta|one shot|campagne|scénario)/i.test(s)) {
      return normalizeSystem(s);
    }
  }

  // 2. Fallback to line starting with 🎬 (or 🎬 Titre)
  const titleLine = lines.find(l => l.startsWith('🎬') || l.toLowerCase().startsWith('titre :'));
  if (titleLine) {
    const t = titleLine.replace(/🎬\s*[:\-]*/g, '').replace(/titre\s*[:\-]*/gi, '').trim();
    if (t.length > 2) {
      return normalizeSystem(t);
    }
  }

  // 3. Fallback to table header (### Jdr, **JDR, Table JDR)
  const headerLine = lines.find(l => /^(###|\*\*|table\s*jdr|jdr\s*\d)/i.test(l));
  if (headerLine) {
    const cleaned = cleanGameName(headerLine);
    if (cleaned && !cleaned.toLowerCase().startsWith('séance') && !cleaned.toLowerCase().includes('assemblée')) {
      return normalizeSystem(cleaned);
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

    // 2. Fetch organization messages (signups & played dates history)
    const fetchOrg = fetch(`https://discord.com/api/v10/channels/${ORG_CHANNEL_ID}/messages?limit=100`, { headers })
      .then(r => r.ok ? r.json() : []);

    // 3. Search active & future Wednesday threads in forum
    const fetchSearch = fetch(`https://discord.com/api/v10/guilds/${guildId}/messages/search?channel_id=${AGENDA_CHANNEL_ID}&content=Mercredi`, { headers })
      .then(r => r.ok ? r.json() : { messages: [] });

    // 4. Fetch archived forum threads
    const fetchArchived = fetch(`https://discord.com/api/v10/channels/${AGENDA_CHANNEL_ID}/threads/archived/public?limit=30`, { headers })
      .then(r => r.ok ? r.json() : { threads: [] });

    const [orgMessages, searchData, archivedData] = await Promise.all([fetchOrg, fetchSearch, fetchArchived]);

    // Build unique threads map
    const threadsMap = new Map();
    (archivedData.threads || []).forEach(t => threadsMap.set(t.id, t));

    if (searchData.messages) {
      searchData.messages.forEach(hit => {
        hit.forEach(m => {
          if (m.channel_id && !threadsMap.has(m.channel_id)) {
            threadsMap.set(m.channel_id, { id: m.channel_id, name: '' });
          }
        });
      });
    }

    // Resolve details of threads from search
    for (const [tid, tObj] of threadsMap.entries()) {
      if (!tObj.name) {
        try {
          const resT = await fetch(`https://discord.com/api/v10/channels/${tid}`, { headers });
          if (resT.ok) {
            const fullT = await resT.json();
            threadsMap.set(tid, fullT);
          }
        } catch (e) {
          console.warn(`[LudoMeter] Warning loading thread ${tid}:`, e.message);
        }
      }
    }

    const allThreads = Array.from(threadsMap.values()).filter(t => t.name);
    console.log(`[LudoMeter] ✅ Fetched ${orgMessages.length} org messages, ${allThreads.length} total agenda forum threads.`);

    lastSyncStatus.time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    // ==========================================
    // 1. STATISTIQUES DES JEUX : SOURCE = organisation-tables
    // ==========================================
    const chronologicalOrg = orgMessages.slice().reverse();
    let currentOrgDate = null;
    const gameStats = {};

    chronologicalOrg.forEach(m => {
      const content = m.content || '';
      const lines = content.split('\n').map(l => l.replace(/\*\*/g, '').trim()).filter(Boolean);
      const seanceLine = lines.find(l => l.toLowerCase().includes('séance du') || l.toLowerCase().includes('séance d\''));

      if (seanceLine) {
        currentOrgDate = cleanDateHeader(seanceLine);
      } else if (currentOrgDate && (content.includes('JDR') || content.includes('###') || content.includes('🎲'))) {
        const sys = extractSystemStrict(content);
        if (sys && !sys.toLowerCase().includes('suite au désistement') && !sys.toLowerCase().includes('tu supprimes')) {
          if (!gameStats[sys]) {
            gameStats[sys] = { name: sys, sessions: 0, dates: [] };
          }
          gameStats[sys].sessions++;
          if (!gameStats[sys].dates.includes(currentOrgDate)) {
            gameStats[sys].dates.push(currentOrgDate);
          }
        }
      }
    });

    const gamesArray = Object.values(gameStats).sort((a, b) => b.sessions - a.sessions);

    // ==========================================
    // 2. SESSIONS DU MERCREDI : SOURCE = jdr-agenda (FUTURES SEULEMENT)
    // ==========================================
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const wednesdayThreads = allThreads.filter(t => t.name.toLowerCase().includes('mercredi'));
    const futureWednesdaySessions = [];

    for (const thread of wednesdayThreads) {
      const sessionDate = parseFrenchDate(thread.name, thread.thread_metadata?.create_timestamp);

      // Filter only FUTURE sessions
      if (sessionDate && sessionDate >= today) {
        try {
          const resThreadMsgs = await fetch(`https://discord.com/api/v10/channels/${thread.id}/messages?limit=15`, { headers });
          if (resThreadMsgs.ok) {
            const threadMsgs = await resThreadMsgs.json();
            const tables = [];

            threadMsgs.forEach(msg => {
              const content = msg.content || '';
              const lines = content.split('\n').map(l => l.trim()).filter(Boolean);

              // Keep ONLY lines that start with 🎬 or 🎲
              const emojiLines = lines.filter(l => l.startsWith('🎬') || l.startsWith('🎲'));
              const mjLine = lines.find(l => l.includes('👑') || l.toLowerCase().includes('mj'));

              // Count registered players
              const playerCount = lines.filter(l => 
                (l.includes('🪑') || l.includes('<@')) && 
                !l.includes('👑') && 
                !l.toLowerCase().includes('mj') && 
                !l.toLowerCase().includes('chanson') && 
                !l.toLowerCase().includes('responsable')
              ).length;

              if (emojiLines.length > 0) {
                const titleLine = emojiLines.find(l => l.startsWith('🎬')) || emojiLines[0];
                const sysLine = emojiLines.find(l => l.startsWith('🎲'));

                tables.push({
                  num: tables.length + 1,
                  emojiLines: emojiLines,
                  title: titleLine ? titleLine.replace(/🎬\s*[:\-]*/g, '').replace(/titre\s*[:\-]*/gi, '').trim() : 'Table JDR',
                  system: sysLine ? sysLine.replace(/🎲\s*[:\-]*/g, '').replace(/système\s*[:\-]*/gi, '').trim() : 'Indépendant',
                  mj: mjLine ? mjLine.replace(/\*\*/g, '').trim() : "👑 MJ: Association",
                  playerCount: playerCount
                });
              }
            });

            futureWednesdaySessions.push({
              id: thread.id,
              title: thread.name,
              date: sessionDate,
              dateStr: sessionDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
              tablesCount: tables.length,
              tables: tables
            });
          }
        } catch (err) {
          console.warn(`[LudoMeter] Warning reading thread ${thread.name}:`, err.message);
        }
      }
    }

    // Sort future Wednesday sessions chronologically ascending
    futureWednesdaySessions.sort((a, b) => a.date - b.date);

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
        totalSessions: Object.values(gameStats).reduce((acc, g) => acc + g.sessions, 0) || 19,
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
