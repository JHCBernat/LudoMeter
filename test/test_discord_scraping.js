const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const ORG_CHANNEL_ID = process.env.DISCORD_CHANNEL_ORG_ID || '900499534109630484';
const AGENDA_CHANNEL_ID = process.env.DISCORD_CHANNEL_AGENDA_ID || '1318237559213658164';

async function runNonRegressionTest() {
  console.log('🧪 [TEST DE NON-RÉGRESSION] Démarrage du test Discord API Ludophiles...');
  if (!DISCORD_TOKEN) {
    throw new Error('Variable DISCORD_TOKEN absente dans .env !');
  }

  const headers = {
    'Authorization': DISCORD_TOKEN,
    'Content-Type': 'application/json'
  };

  // Test 1: Channel Organisation Tables
  console.log('📡 1. Test du salon #organisation-tables (ID:', ORG_CHANNEL_ID, ')...');
  const resOrg = await fetch(`https://discord.com/api/v10/channels/${ORG_CHANNEL_ID}/messages?limit=50`, { headers });
  if (!resOrg.ok) {
    throw new Error(`Échec HTTP #organisation-tables: Status ${resOrg.status} (${resOrg.statusText})`);
  }
  const orgMsgs = await resOrg.json();
  if (!Array.isArray(orgMsgs) || orgMsgs.length === 0) {
    throw new Error('Données reçues vides pour #organisation-tables !');
  }
  console.log(`   ✅ #organisation-tables: ${orgMsgs.length} messages reçus avec succès.`);

  // Test 2: Channel JDR-Agenda (Forum Threads)
  console.log('📡 2. Test du salon forum #jdr-agenda (ID:', AGENDA_CHANNEL_ID, ')...');
  const resAgenda = await fetch(`https://discord.com/api/v10/channels/${AGENDA_CHANNEL_ID}/threads/archived/public?limit=30`, { headers });
  if (!resAgenda.ok) {
    throw new Error(`Échec HTTP #jdr-agenda: Status ${resAgenda.status} (${resAgenda.statusText})`);
  }
  const agendaData = await resAgenda.json();
  const threads = agendaData.threads || [];
  if (threads.length === 0) {
    throw new Error('Données reçues vides pour les threads #jdr-agenda !');
  }
  console.log(`   ✅ #jdr-agenda: ${threads.length} threads de forum archivés reçus.`);

  const wednesdayThreads = threads.filter(t => t.name.toLowerCase().includes('mercredi'));
  console.log(`   📅 Threads du Mercredi identifiés: ${wednesdayThreads.length}`);

  // Test 3: Tables parsing from first 3 Wednesday threads
  let tablesFound = 0;
  for (const t of wednesdayThreads.slice(0, 3)) {
    const resMsg = await fetch(`https://discord.com/api/v10/channels/${t.id}/messages?limit=10`, { headers });
    if (resMsg.ok) {
      const msgs = await resMsg.json();
      msgs.forEach(m => {
        const c = m.content || '';
        if (c.includes('🎬') || c.includes('Système') || c.toLowerCase().includes('titre :') || c.toLowerCase().includes('jdr')) {
          tablesFound++;
        }
      });
    }
  }
  console.log(`   🎲 Tables JDR extraites depuis les posts: ${tablesFound}`);
  if (tablesFound === 0) {
    throw new Error('Aucune table de jeu de rôle détectée dans les messages de threads !');
  }

  console.log('🎉 [SUCCÈS] Tous les tests de non-régression Discord sont validés !');
  return true;
}

runNonRegressionTest().catch(err => {
  console.error('❌ [ERREUR TEST NON-RÉGRESSION]:', err.message);
  process.exit(1);
});
