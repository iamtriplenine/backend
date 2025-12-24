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

const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS utilisateurs (
                id SERIAL PRIMARY KEY,
                id_public VARCHAR(6) UNIQUE,
                telephone VARCHAR(20) UNIQUE NOT NULL,
                password TEXT NOT NULL,
                username TEXT,
                code_promo VARCHAR(4) UNIQUE,
                parrain_code VARCHAR(4),
                balance DECIMAL(15,2) DEFAULT 0,
                message TEXT DEFAULT '',
                dernier_checkin TEXT DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                id_public_user VARCHAR(6),
                transaction_id TEXT UNIQUE,
                montant DECIMAL(15,2),
                statut TEXT DEFAULT 'en attente',
                date_crea TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS config_globale (
                cle TEXT PRIMARY KEY,
                valeur TEXT,
                montant DECIMAL(15,2)
            );
            CREATE TABLE IF NOT EXISTS roulette_lots (
                id SERIAL PRIMARY KEY,
                label TEXT,
                valeur INT,
                probabilite INT
            );
        `);

        // Configuration bonus par défaut
        await pool.query(`INSERT INTO config_globale (cle, valeur, montant) VALUES ('code_journalier', 'MEGA2025', 50) ON CONFLICT DO NOTHING;`);
        
        // Initialisation Roulette (8 segments) si vide
        const checkRoulette = await pool.query("SELECT COUNT(*) FROM roulette_lots");
        if (parseInt(checkRoulette.rows[0].count) === 0) {
            const defaultLots = [
                ['0 F', 0, 70], ['10 F', 10, 15], ['50 F', 50, 5], ['0 F', 0, 5],
                ['100 F', 100, 3], ['0 F', 0, 1], ['500 F', 500, 1], ['1000 F', 1000, 0]
            ];
            for (let lot of defaultLots) {
                await pool.query("INSERT INTO roulette_lots (label, valeur, probabilite) VALUES ($1, $2, $3)", lot);
            }
        }
        console.log("✅ Serveur et Roulette initialisés");
    } catch (err) { console.log("Erreur init:", err); }
};
initDB();

const genererCode = (long) => Math.floor(Math.pow(10, long-1) + Math.random() * 9 * Math.pow(10, long-1)).toString();

// --- ROUTES JEU ROULETTE (CONTRÔLÉE) ---
app.post('/jeu/roulette', async (req, res) => {
    const { id_public_user } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const user = await client.query('SELECT balance FROM utilisateurs WHERE id_public = $1 FOR UPDATE', [id_public_user]);
        if (parseFloat(user.rows[0].balance) < 100) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: "Solde insuffisant (100F)" });
        }
        await client.query('UPDATE utilisateurs SET balance = balance - 100 WHERE id_public = $1', [id_public_user]);
        
        const lots = await client.query('SELECT * FROM roulette_lots ORDER BY id ASC');
        let random = Math.floor(Math.random() * 100);
        let cumul = 0;
        let lotGagne = lots.rows[0];
        for (let lot of lots.rows) {
            cumul += lot.probabilite;
            if (random < cumul) { lotGagne = lot; break; }
        }
        await client.query('UPDATE utilisateurs SET balance = balance + $1 WHERE id_public = $2', [lotGagne.valeur, id_public_user]);
        await client.query('COMMIT');
        res.json({ success: true, lotIndex: lots.rows.indexOf(lotGagne), label: lotGagne.label });
    } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ message: "Erreur jeu" }); }
    finally { client.release(); }
});

// --- RESTE DES ROUTES (Login, Register, Admin, etc.) ---
// ... (Garder tes routes existantes pour /register, /login, /retrait, /depot) ...

app.post('/admin/update-roulette', async (req, res) => {
    const { cle, lots } = req.body;
    if(cle !== "999") return res.status(403).send("Refusé");
    for(let i=0; i<lots.length; i++) {
        await pool.query("UPDATE roulette_lots SET label=$1, valeur=$2, probabilite=$3 WHERE id=$4", 
        [lots[i].label, lots[i].valeur, lots[i].probabilite, i+1]);
    }
    res.json({ success: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("🚀 Serveur sur port " + PORT));
