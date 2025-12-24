# Rika-firenet
Program that read data from the Rika stove connected with firenet.
Result can be seen at https://rika-domo.web.app/.

We use the [Google Firebase](https://firebase.google.com/) as data base, as well as website hosting.

## Backend

First step is to create a 'Firestore database' on Google Firebase.

There is a python script that needs to be run every few minutes.
The script is run from Github Action thanks to .github/workflows/main.yml. The period of running is not exact in Github.

It is necessary to create Secret variable in Github in order not to expose sensitive information. Here is how to do that:
```
Voici les étapes précises pour configurer vos variables secrètes sur GitHub afin que votre fichier main.yml puisse les utiliser en toute sécurité :

1. Ouvrez votre dépôt (Repository) sur GitHub : Allez sur la page principale du projet où vous avez déposé vos fichiers rika.py et main.yml.

2. Allez dans les Réglages : Cliquez sur l'onglet Settings (la petite roue dentée en haut à droite).

3. Accédez aux Secrets :
- Dans le menu latéral de gauche, cherchez la section Secrets and variables.
- Cliquez sur la petite flèche à côté pour dérouler le menu, puis cliquez sur Actions.

4. Créez une nouvelle variable :
- Cliquez sur le bouton vert New repository secret.

5. Ajoutez vos 3 variables une par une :
-Pour RIKA_EMAIL :
Nom : RIKA_EMAIL
Secret : Votre adresse email Firenet.
- Pour RIKA_PASSWORD :
Nom : RIKA_PASSWORD
Secret : Votre mot de passe Firenet.
- Pour FIREBASE_SERVICE_ACCOUNT :
Nom : FIREBASE_SERVICE_ACCOUNT
Secret : Copiez et collez l'intégralité du contenu du fichier .json que vous avez téléchargé depuis la console Firebase (tout le bloc de texte commençant par { et finissant par }).
```

## Frontend

The frontend has been developped with Gemini 3 AI. Many iterations have been needed to get exactly the desired result.

The file src/App.jsx needs to know how to access the Firestore database: the information is given in the variable firebaseConfig.

The web site is hosted on Google Firebase. 

It is necessary to create an anonymous authentication on Firebase:
*On Firebase -> Create Authentication -> sign-in method -> add new provider -> anonymous*

On Linux, Install Node.js.

To be done once on Linux:
```
npm install -g firebase-tools
npm create vite@latest . -- --template react
npm install
npm install firebase chart.js react-chartjs-2 lucide-react
firebase login
firebase init hosting
firebase init hosting
* Choose : *Use an existing project*.
* Select the right project : eg, `rika-domo`.
* Public directory : `dist` (if using Vite).
* Configure as SPA : `Yes`.
* GitHub Action : `No`.
```

To be done for the first time, or after an update of the code:
```
npm run build
firebase deploy 
```