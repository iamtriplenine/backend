const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- ÉTAPE MAGIQUE : CRÉATION DE LA TABLE AUTOMATIQUE ---
pool.query(`
  CREATE TABLE IF NOT EXISTS utilisateurs (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  );
`, (err, res) => {
  if (err) console.log("Erreur lors de la création de la table:", err);
  else console.log("✅ L'étagère 'utilisateurs' est prête dans la base !");
});

app.get('/', (req, res) => res.send("Serveur actif et connecté à Postgres !"));

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  // Pour l'instant on garde le test simple, mais la base est prête !
  if (email === "admin@test.com" && password === "1234") {
    res.json({ success: true, message: "✅ Bienvenue !" });
  } else {
    res.status(401).json({ success: false, message: "❌ Identifiants faux." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}`));
