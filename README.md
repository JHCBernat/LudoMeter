# LudoMeter 🎲

Dashboard KPI et PWA pour l'association **Les Ludophiles d'Asnières et d'ailleurs** (JdR92).
Conçu pour Samsung Galaxy S23 (Android) et hébergé sur NAS Synology via Docker.

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
