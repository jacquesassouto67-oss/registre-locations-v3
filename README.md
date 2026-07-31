# Registre des locations — mode d'emploi

Application web pour suivre les locations de salles à l'heure, avec système
de code client et protection contre les locations non déclarées.

## 1. Tester en local (optionnel, sur votre ordinateur)

Il faut avoir Node.js installé (https://nodejs.org, version LTS).

Dans un terminal, dans le dossier du projet :

```
npm install
npm start
```

Puis ouvrez http://localhost:3000 dans votre navigateur.
Les employés sur le même réseau WiFi peuvent aussi y accéder via l'adresse
IP locale de l'ordinateur (ex : http://192.168.1.23:3000).

## 2. Mise en ligne (accès depuis n'importe où, y compris sur téléphone)

Étapes recommandées avec Render.com (offre gratuite pour démarrer) :

1. Créez un compte sur https://github.com si vous n'en avez pas.
2. Créez un nouveau dépôt ("New repository"), nommez-le par exemple
   `registre-locations`.
3. Sur la page du dépôt, cliquez "uploading an existing file" et
   glissez-déposez TOUS les fichiers et dossiers fournis (server.js,
   package.json, le dossier public/ avec ses 3 fichiers, .gitignore,
   ce README). Gardez la même structure de dossiers. Validez l'envoi.
4. Créez un compte sur https://render.com (vous pouvez vous inscrire avec
   votre compte GitHub).
5. Cliquez "New +" → "Web Service", puis connectez le dépôt GitHub créé
   à l'étape 2-3.
6. Render détecte un projet Node.js automatiquement. Renseignez :
   - Build Command : `npm install`
   - Start Command : `npm start`
7. **Sécurisez vos données — trois couches de protection sont prévues :**

   **a) Disque persistant Render (recommandé si vous suivez cette voie)**
   Dans les réglages du service, section "Disks", ajoutez un disque avec
   comme chemin de montage `/opt/render/project/src/data`. Sans cela, sur
   le plan gratuit, les données peuvent être perdues à chaque redémarrage
   ou mise à jour du service.

   **b) Sauvegarde externe automatique et gratuite (recommandée, indépendante de l'hébergeur)**
   L'application peut synchroniser vos données à chaque modification vers
   [jsonbin.io](https://jsonbin.io), un service gratuit de stockage JSON,
   et les récupérer automatiquement au démarrage si le fichier local a
   disparu. Pour l'activer :
   1. Créez un compte gratuit sur https://jsonbin.io.
   2. Créez un "Bin" vide, notez son "Bin ID".
   3. Dans les paramètres du compte, récupérez votre "X-Master-Key".
   4. Dans Render, allez dans "Environment" (variables d'environnement)
      de votre service et ajoutez `JSONBIN_ID` (le Bin ID) et
      `JSONBIN_KEY` (la Master Key).
   Sans ces variables, l'application fonctionne quand même, simplement
   sans cette sauvegarde externe automatique.

   **c) Sauvegarde manuelle téléchargeable (protection totalement indépendante)**
   Dans Mode Gérant → Configuration → "Sauvegarde des données", un bouton
   permet de télécharger à tout moment une copie complète de vos données,
   et un autre de restaurer une sauvegarde en cas de besoin. Téléchargez-en
   une chaque semaine et gardez-la ailleurs (email, Google Drive, clé USB)
   — c'est la seule protection qui survit même à la disparition complète
   de l'hébergeur.

   Avec (b) activé, (a) devient optionnel mais reste une bonne pratique.
   Sans (a) ni (b), utilisez (c) régulièrement pour ne rien perdre.

8. Cliquez "Create Web Service". Après quelques minutes, Render fournit
   une adresse publique du type `https://registre-locations.onrender.com`.
9. Ouvrez cette adresse sur le téléphone du gérant (ou n'importe quel
   appareil) — elle fonctionne partout où il y a une connexion internet.

Remarque sur le plan gratuit de Render : le service peut se mettre en
veille après 15 minutes sans visite, et le premier chargement prend alors
30 à 60 secondes. Pour un centre en activité quotidienne, un plan payant
(à partir d'environ 7 $/mois) garantit une disponibilité immédiate à tout
moment.

## 3. Utilisation quotidienne

### Configuration initiale (une seule fois)
1. Cliquez "Mode Gérant" → code par défaut : `1234` (changez-le tout de
   suite dans Configuration).
2. Dans Configuration : vérifiez vos salles, leurs tarifs horaires et
   leurs tarifs journaliers, ajoutez vos employés.

### Démarrer une location
1. Le client se présente et paie → onglet Salles → "Émettre un ticket"
   sur la salle choisie → choisissez l'employé et notez le client →
   un code à 5 chiffres s'affiche.
2. Remettez ce code au client.
3. Une fois dans la salle, le client ouvre l'adresse de l'application
   sur son propre téléphone, clique "📱 Espace client", et saisit le
   code → le chrono démarre à cet instant précis.

### Terminer une location
Sur la salle "Occupée" → "Terminer" → choisir l'employé qui clôture, le
mode de paiement, cocher si payé → "Valider la clôture".

### Suivi (Mode Gérant)
- **Historique** : toutes les locations passées.
- **Rapports** : chiffre d'affaires, impayés, annulations et tickets
  jamais activés, par employé.
- **Journal** : trace complète et horodatée de chaque action.

## 4. Règle de facturation appliquée

- 1 à 70 minutes : 1 heure pleine due
- 71 à 130 minutes : 2 heures pleines dues
- 131 à 190 minutes : 3 heures dues, avec 20% de remise sur le total
- Au-delà de 190 minutes (3h10) : le tarif journalier de la salle
  s'applique (à configurer par salle dans Configuration)

## 5. Limites à connaître

- Le système empêche qu'une location soit facturée sans que le client
  active lui-même son code. Il ne peut pas empêcher un employé de faire
  entrer quelqu'un sans jamais utiliser l'application — cela reste à
  surveiller par des contrôles physiques réguliers, en complément des
  indicateurs fournis dans les Rapports (annulations, tickets expirés).
- Le code Gérant protège les actions sensibles (annulation, rapports,
  journal, configuration) côté serveur — un employé ne peut pas y
  accéder sans le connaître, même en modifiant l'affichage dans son
  navigateur.
- Pensez à télécharger une sauvegarde manuelle (section 4-c) de temps en
  temps même si la synchronisation automatique est activée — c'est la
  seule copie qui vous appartient entièrement, indépendamment de tout
  service tiers.
