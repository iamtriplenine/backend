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


// --- ROUTE POUR S'INSCRIRE ---
app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  try {
    // On insère l'email et le mot de passe dans l'étagère "utilisateurs"
    const result = await pool.query(
      'INSERT INTO utilisateurs (email, password) VALUES ($1, $2) RETURNING *',
      [email, password]
    );
    res.json({ success: true, message: "Compte créé avec succès !" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "L'email existe déjà ou erreur base." });
  }
});










// --- ROUTE POUR SE CONNECTER ---
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    // On demande à la base : "Est-ce que cet email et ce mot de passe existent ?"
    const user = await pool.query(
      'SELECT * FROM utilisateurs WHERE email = $1 AND password = $2',
      [email, password]
    );

    if (user.rows.length > 0) {
      res.json({ success: true, message: "Connexion réussie !" });
    } else {
      res.status(401).json({ success: false, message: "Identifiants incorrects." });
    }
  } catch (err) {
    res.status(500).send("Erreur serveur");
  }
});






