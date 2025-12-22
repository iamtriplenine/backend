const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors()); // Autorise votre page HTML à contacter ce serveur
app.use(express.json()); // Permet de lire les données envoyées (email/password)

// Route de test pour voir si le serveur marche
app.get('/', (req, res) => {
    res.send("Le serveur est en ligne !");
});

// Route de connexion
app.post('/login', (req, res) => {
    const { email, password } = req.body;

    // Simulation : on vérifie si c'est le bon test
    if (email === "admin@test.com" && password === "1234") {
        res.json({ success: true, message: "Bienvenue !" });
    } else {
        res.status(401).json({ success: false, message: "Identifiants faux." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Serveur démarré sur le port " + PORT);
});
