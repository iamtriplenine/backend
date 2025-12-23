
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

// Création de la table au démarrage
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

app.get('/', (req, res) => res.send("Serveur actif !"));

// --- INSCRIPTION ---
app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  try {
    await pool.query('INSERT INTO utilisateurs (email, password) VALUES ($1, $2)', [email, password]);
    res.json({ success: true, message: "Compte créé !" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Erreur ou email déjà pris." });
  }
});

// --- CONNEXION ---
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await pool.query('SELECT * FROM utilisateurs WHERE email = $1 AND password = $2', [email, password]);
    if (user.rows.length > 0) {
      res.json({ success: true, message: "Connexion réussie !" });
    } else {
      res.status(401).json({ success: false, message: "Identifiants faux." });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: "Erreur serveur." });
  }
});

// --- VOIR LES MEMBRES (AVEC MOT DE PASSE 999) ---
app.get('/admin/utilisateurs/:cle', async (req, res) => {
  const { cle } = req.params;
  if (cle !== "999") {
    return res.status(403).send("Accès interdit : Mauvaise clé !");
  }
  try {
    const users = await pool.query('SELECT id, email FROM utilisateurs ORDER BY id ASC');
    res.json(users.rows);
  } catch (err) {
    res.status(500).send("Erreur récupération");
  }
});

// --- SUPPRIMER UN MEMBRE (AVEC MOT DE PASSE 999) ---
app.delete('/admin/utilisateurs/:id/:cle', async (req, res) => {
  const { id, cle } = req.params;
  if (cle !== "999") {
    return res.status(403).send("Interdit");
  }
  try {
    await pool.query('DELETE FROM utilisateurs WHERE id = $1', [id]);
    res.json({ success: true, message: "Supprimé !" });
  } catch (err) {
    res.status(500).send("Erreur suppression");
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Serveur prêt sur port ${PORT}`));
