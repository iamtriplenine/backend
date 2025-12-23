
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

// INITIALISATION DES TABLES (Utilisateurs et Transactions)
pool.query(`
  CREATE TABLE IF NOT EXISTS utilisateurs (
    id SERIAL PRIMARY KEY,
    id_public VARCHAR(6) UNIQUE,
    telephone VARCHAR(20) UNIQUE NOT NULL,
    password TEXT NOT NULL,
    username TEXT,
    code_promo VARCHAR(4) UNIQUE,
    parrain_code VARCHAR(4),
    balance DECIMAL(10,2) DEFAULT 0
  );
  
  CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    id_public_user VARCHAR(6),
    transaction_id TEXT UNIQUE,
    montant DECIMAL(10,2),
    statut TEXT DEFAULT 'en attente'
  );
`);

// FONCTION POUR GÉNÉRER LES CODES ALÉATOIRES
const genererCode = (longueur) => {
    return Math.floor(Math.pow(10, longueur-1) + Math.random() * 9 * Math.pow(10, longueur-1)).toString();
};

// --- INSCRIPTION AVEC TÉLÉPHONE ---
app.post('/register', async (req, res) => {
    const { telephone, password, username, promo_parrain } = req.body;
    const id_public = genererCode(6);
    const mon_promo = genererCode(4);

    try {
        await pool.query(
            `INSERT INTO utilisateurs (id_public, telephone, password, username, code_promo, parrain_code) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [id_public, telephone, password, username, mon_promo, promo_parrain]
        );
        res.json({ success: true, id: id_public, promo: mon_promo });
    } catch (err) {
        res.status(500).json({ success: false, message: "Numéro déjà utilisé." });
    }
});

// --- CONNEXION AVEC TÉLÉPHONE ---
app.post('/login', async (req, res) => {
    const { telephone, password } = req.body;
    try {
        const user = await pool.query('SELECT * FROM utilisateurs WHERE telephone = $1 AND password = $2', [telephone, password]);
        if (user.rows.length > 0) {
            res.json({ success: true, user: user.rows[0] });
        } else {
            res.status(401).json({ success: false, message: "Identifiants incorrects." });
        }
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Serveur Affiliation Prêt"));
