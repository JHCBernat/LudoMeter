# LudoMeter 🎲

Dashboard KPI et PWA pour l'association **Les Ludophiles d'Asnières et d'ailleurs**.
Conçu pour Samsung Galaxy S23 (Android) et hébergé sur NAS Synology via Docker.

---

## 🏛️ Architecture & Synchro sans Bot (Gateway NAS)

Puisque tu es modérateur (et non admin) sur le serveur Discord des Ludophiles, **aucune installation de bot n'est requise** sur ce serveur. 

L'application **LudoMeter** exploite directement le travail de fond de ton **Hermes Gateway** sur le NAS Synology :
1. Elle se connecte au volume partagé du Gateway (`/volume1/docker/hermes/data`).
2. Elle lit l'historique et les recaps agrégés par la tâche de surveillance des parties JDR (`discord_sessions_history.json`).
3. Aucun token bot n'est nécessaire sur le serveur des Ludophiles : tout est récupéré et sécurisé en interne sur le NAS.

---

## 🛠️ Instructions pour VS Code & Développement Local

1. **Ouvrir le projet dans VS Code :**
   ```bash
   code C:\GIT\LudoMeter
   ```

2. **Lancer le serveur en local :**
   ```bash
   npm install
   npm start
   ```
   Puis ouvrir `http://localhost:3000` dans le navigateur.

3. **Sécurité & API :**
   - Toutes les clés sensibles et identifiants (token Discord, connexions API) doivent impérativement rester **côté serveur** dans `server.js` ou via un fichier `.env` (non commité sur GitHub).
   - Le frontend (`public/index.html`) consomme uniquement l'API sécurisée exposée par le serveur via `/api/kpis`.

4. **Déploiement Docker (PC ou NAS Synology) :**
   ```bash
   docker build -t ludometer .
   docker run -p 3000:3000 ludometer
   ```
