# 🎲 Guide de Déploiement : LudoMeter sur Synology DS218+ (Docker)

Ce guide pas à pas détaille le déploiement de l'application **LudoMeter** (PWA pour Les Ludophiles d'Asnières) sur votre NAS Synology DS218+ à l'aide de Docker / Container Manager.

---

## 📋 Prérequis

1. **NAS Synology DS218+** sous DSM 7+ avec le paquet **Container Manager** (ou **Docker** sous DSM 6/7.1).
2. Vos identifiants Discord dans le fichier `.env` :
   * `DISCORD_TOKEN` : Votre token Discord serveur.
   * `DISCORD_CHANNEL_ORG_ID` : `900499534109630484` (#organisation-tables).
   * `DISCORD_CHANNEL_AGENDA_ID` : `1318237559213658164` (#jdr-agenda).
3. Accès au dossier partagé `docker/` du NAS (accessible via le réseau `\\192.168.0.40\docker` ou le lecteur `H:\`).

---

## 🚀 Méthode 1 : Déploiement via le dossier partagé (Recommandée)

### Étape 1 : Créer le dossier sur le Synology
1. Dans l'explorateur de fichiers Windows (ou via DSM File Station) :
   * Ouvrez `\\192.168.0.40\docker\` (ou votre lecteur `H:\`).
   * Créez un sous-dossier nommé **`ludometer`**.
   * Créez un sous-dossier **`data`** à l'intérieur : `docker/ludometer/data/`.

### Étape 2 : Copier les fichiers du projet
Copiez le contenu du dépôt `C:\GIT\LudoMeter\` dans `\\192.168.0.40\docker\ludometer\` :
* `Dockerfile`
* `docker-compose.yml`
* `package.json`
* `server.js`
* dossier `public/` (avec `index.html`, `manifest.json`, `icon-192.png`, `icon-512.png`)
* `.env` (contenant votre token Discord secret)

### Étape 3 : Lancer le projet dans Container Manager
1. Connectez-vous à l'interface Web de DSM (`http://192.168.0.40:5000`).
2. Ouvrez l'application **Container Manager** (ou **Docker**).
3. Cliquez sur l'onglet **Projet** dans la barre latérale gauche.
4. Cliquez sur **Créer** :
   * **Nom du projet** : `ludometer`
   * **Chemin d'accès** : Sélectionnez `/docker/ludometer`
   * **Source** : Choisissez *« Utiliser un docker-compose.yml existant »* (il sera automatiquement détecté dans le dossier).
5. Cliquez sur **Suivant** > **Suivant** > **Appliquer**.
6. Container Manager construit l'image Docker légère (`node:20-alpine`) et démarre le conteneur.

---

## 💻 Méthode 2 : Déploiement en ligne de commande (SSH)

Si vous préférez le terminal SSH sur votre NAS :

```bash
# 1. Connexion SSH au NAS
ssh admin@192.168.0.40

# 2. Accéder au volume Docker
cd /volume1/docker
git clone https://github.com/JHCBernat/LudoMeter.git ludometer
cd ludometer

# 3. Créer le fichier .env sécurisé
cat <<EOF > .env
PORT=3000
NODE_ENV=production
DISCORD_TOKEN=votre_token_secret_ici
DISCORD_CHANNEL_ORG_ID=900499534109630484
DISCORD_CHANNEL_AGENDA_ID=1318237559213658164
EOF

# 4. Construire et lancer le conteneur en arrière-plan
sudo docker compose up -d --build
```

---

## 🔒 Configuration du Reverse Proxy HTTPS (Requis pour la PWA)

Pour que la PWA puisse être installée proprement sur votre **Samsung Galaxy S23** et bénéficier du mode hors-ligne, le protocole **HTTPS** est requis par Android / Chrome.

### Configuration du Reverse Proxy dans DSM :
1. Dans DSM, allez dans **Panneau de configuration** > **Portail de connexion** > onglet **Avancé**.
2. Cliquez sur **Proxy inversé** puis **Créer** :
   * **Nom de la description** : `LudoMeter PWA`
   * **Source :**
     * Protocole : `HTTPS`
     * Nom d'hôte : `ludometer.votre-domaine.synology.me` (ou votre IP/nom local)
     * Port : `443` (ou `3443`)
     * Activer HSTS : `Coché`
   * **Destination :**
     * Protocole : `HTTP`
     * Nom d'hôte : `localhost`
     * Port : `3000`
3. Dans l'onglet **En-tête personnalisé**, cliquez sur **Créer** > **WebSocket** (ajoute automatiquement `Upgrade` et `Connection`).
4. Cliquez sur **Sauvegarder**.

*(Si vous n'utilisez pas de domaine externe, vous pouvez également y accéder directement en local en HTTP sur `http://192.168.0.40:3000`).*

---

## 📱 Installation sur Samsung Galaxy S23 (PWA)

1. Ouvrez **Google Chrome** ou **Samsung Internet** sur votre S23.
2. Rendez-vous sur l'adresse de votre LudoMeter (`http://192.168.0.40:3000` ou votre URL HTTPS).
3. Une invite vous proposera automatiquement :
   * **« Ajouter à l'écran d'accueil »** ou **« Installer l'application »**.
4. L'icône dorée et bordeaux des Ludophiles apparaît sur votre écran d'accueil comme une application native autonome (sans barre d'adresse navigateur).

---

## 🔄 Mise à jour de l'application

Pour mettre à jour LudoMeter après un commit Git :

```bash
cd /volume1/docker/ludometer
git pull origin master
sudo docker compose up -d --build
```
Ou simplement depuis l'interface **Container Manager** > **Projet** > clic droit sur `ludometer` > **Reconstruire**.
