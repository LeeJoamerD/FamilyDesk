const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('FamilyDesk - Installation');
console.log('========================');
console.log('Cette installation va configurer FamilyDesk sur votre système.');
console.log('');

// Check if Node.js is installed
try {
    const nodeVersion = execSync('node -v').toString().trim();
    console.log(`Node.js détecté: ${nodeVersion}`);
} catch (error) {
    console.error('Erreur: Node.js n\'est pas installé sur votre système.');
    console.error('Veuillez installer Node.js depuis https://nodejs.org/');
    process.exit(1);
}

// Install dependencies
console.log('\nInstallation des dépendances...');
try {
    execSync('npm install', { stdio: 'inherit' });
    console.log('Dépendances installées avec succès.');
} catch (error) {
    console.error('Erreur lors de l\'installation des dépendances:');
    console.error(error.message);
    process.exit(1);
}

// Create temp directory for file transfers
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
    console.log('Répertoire temporaire créé.');
}

// Create a simple configuration file
const config = {
    port: 3000,
    maxFileSize: 2 * 1024 * 1024 * 1024, // 2GB
    sessionTimeout: 60 * 60 * 1000, // 1 hour
    codeValidityPeriod: 10 * 60 * 1000 // 10 minutes
};

fs.writeFileSync(
    path.join(__dirname, 'config.json'),
    JSON.stringify(config, null, 2)
);
console.log('Fichier de configuration créé.');

console.log('\nInstallation terminée!');
console.log('\nPour démarrer FamilyDesk:');
console.log('1. Ouvrez une invite de commande dans ce répertoire');
console.log('2. Exécutez la commande: npm start');
console.log('3. Accédez à http://localhost:3000 dans votre navigateur');
console.log('\nPour permettre l\'accès depuis d\'autres appareils sur votre réseau:');
console.log('1. Trouvez l\'adresse IP de votre ordinateur (ipconfig dans l\'invite de commande)');
console.log('2. Les autres appareils peuvent se connecter via http://VOTRE_IP:3000');