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

// Création automatique de la table
pool.query(`
  CREATE TABLE IF NOT EXISTS utilisateurs (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  );
`, (err, res) => {
  if (err) console.log("Erreur table:", err);
  else console.log("✅ Table prête !");
});

app.get('/', (req, res) => res.send("Serveur en ligne !"));

// Inscription
app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  try {
    await pool.query('INSERT INTO utilisateurs (email, password) VALUES ($1, $2)', [email, password]);
    res.json({ success: true, message: "Compte créé avec succès !" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Email déjà utilisé ou erreur." });
  }
});

// Connexion
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await pool.query('SELECT * FROM utilisateurs WHERE email = $1 AND password = $2', [email, password]);
    if (user.rows.length > 0) {
      res.json({ success: true, message: "Connexion réussie !" });
    } else {
      res.status(401).json({ success: false, message: "Identifiants incorrects." });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: "Erreur serveur." });
  }
});


// --- VOIR TOUS LES MEMBRES ---
app.get('/admin/utilisateurs', async (req, res) => {
  try {
    const users = await pool.query('SELECT id, email FROM utilisateurs ORDER BY id DESC');
    res.json(users.rows);
  } catch (err) {
    res.status(500).send("Erreur lors de la récupération des données");
  }
});









const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Serveur sur port ${PORT}`));
