const express = require('express');
const app = express();
const port = process.env.PORT || 3000;  // Utilise le port de Render ou 3000 en local

// Configuration de base
app.use(express.static('public'));  // Si vous avez un dossier pour les fichiers statiques

// Route principale
app.get('/', (req, res) => {
  res.send('Bienvenue sur FamilyDesk !');
});

// Démarrage du serveur
app.listen(port, () => {
  console.log(`Serveur en cours d'exécution sur le port ${port}`);
});