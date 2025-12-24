
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

// --- INITIALISATION DES TABLES ---
const initDB = async () => {
    try {
        // Ajout de la colonne "message" dans la table utilisateurs
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
                message TEXT DEFAULT '' 
            );
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                id_public_user VARCHAR(6),
                transaction_id TEXT UNIQUE,
                montant DECIMAL(15,2),
                statut TEXT DEFAULT 'en attente',
                date_crea TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        // Sécurité au cas où la table existe déjà sans la colonne message
        await pool.query(`ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS message TEXT DEFAULT '';`);
        
        console.log("✅ Base de données opérationnelle avec support Messages");
    } catch (err) { console.log("Erreur init:", err); }
};
initDB();

const genererCode = (long) => Math.floor(Math.pow(10, long-1) + Math.random() * 9 * Math.pow(10, long-1)).toString();

// --- ROUTES UTILISATEURS ---

app.post('/register', async (req, res) => {
    const { telephone, password, username, promo_parrain } = req.body;
    try {
        const id_p = genererCode(6);
        const mon_p = genererCode(4);
        await pool.query(
            `INSERT INTO utilisateurs (id_public, telephone, password, username, code_promo, parrain_code) VALUES ($1,$2,$3,$4,$5,$6)`,
            [id_p, telephone, password, username, mon_p, promo_parrain]
        );
        res.json({ success: true, id: id_p, promo: mon_p });
    } catch (e) { res.status(500).json({ success: false, message: "Numéro déjà pris." }); }
});

app.post('/login', async (req, res) => {
    const { telephone, password } = req.body;
    try {
        const u = await pool.query('SELECT * FROM utilisateurs WHERE telephone = $1 AND password = $2', [telephone, password]);
        if (u.rows.length > 0) res.json({ success: true, user: u.rows[0] });
        else res.status(401).json({ success: false, message: "Identifiants incorrects" });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/depot', async (req, res) => {
    const { id_public_user, transaction_id, montant } = req.body;
    try {
        await pool.query(
            `INSERT INTO transactions (id_public_user, transaction_id, montant, statut) VALUES ($1, $2, $3, 'en attente')`,
            [id_public_user, transaction_id, montant]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/retrait', async (req, res) => {
    const { id_public_user, montant, methode, numero } = req.body;
    try {
        if (montant < 100) return res.status(400).json({ message: "Minimum 100 FCFA" });
        const user = await pool.query('SELECT balance FROM utilisateurs WHERE id_public = $1', [id_public_user]);
        if (user.rows[0].balance < montant) return res.status(400).json({ message: "Solde insuffisant" });

        await pool.query('UPDATE utilisateurs SET balance = balance - $1 WHERE id_public = $2', [montant, id_public_user]);
        await pool.query(`INSERT INTO transactions (id_public_user, transaction_id, montant, statut) VALUES ($1, $2, $3, 'retrait en attente')`, 
        [id_public_user, `RETRAIT-${methode}-${numero}`, montant]);
        
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.get('/user/transactions/:id_public', async (req, res) => {
    const r = await pool.query("SELECT * FROM transactions WHERE id_public_user = $1 ORDER BY id DESC LIMIT 10", [req.params.id_public]);
    res.json(r.rows);
});

// --- ROUTES ADMIN ---

app.get('/admin/utilisateurs/:cle', async (req,res) => {
    if(req.params.cle !== "999") return res.status(403).send("Refusé");
    const r = await pool.query('SELECT * FROM utilisateurs ORDER BY id DESC');
    res.json(r.rows);
});

app.get('/admin/transactions/:cle', async (req,res) => {
    if(req.params.cle !== "999") return res.status(403).send("Refusé");
    const r = await pool.query("SELECT * FROM transactions WHERE statut = 'en attente' OR statut = 'retrait en attente' ORDER BY id DESC");
    res.json(r.rows);
});

// ROUTE POUR MODIFIER LE MESSAGE VITRE
app.post('/admin/modifier-message', async (req, res) => {
    const { cle, id_public_user, nouveau_message } = req.body;
    if(cle !== "999") return res.status(403).send("Refusé");
    try {
        await pool.query('UPDATE utilisateurs SET message = $1 WHERE id_public = $2', [nouveau_message, id_public_user]);
        res.json({ success: true });
    } catch (e) { res.status(500).send("Erreur"); }
});

app.post('/admin/valider-depot', async (req, res) => {
    const { cle, transaction_db_id, id_public_user, montant } = req.body;
    if(cle !== "999") return res.status(403).send("Refusé");
    try {
        await pool.query('UPDATE utilisateurs SET balance = balance + $1 WHERE id_public = $2', [montant, id_public_user]);
        const user = await pool.query('SELECT parrain_code FROM utilisateurs WHERE id_public = $1', [id_public_user]);
        if (user.rows[0]?.parrain_code) {
            await pool.query('UPDATE utilisateurs SET balance = balance + $1 WHERE code_promo = $2', [montant * 0.40, user.rows[0].parrain_code]);
        }
        await pool.query("UPDATE transactions SET statut = 'validé' WHERE id = $1", [transaction_db_id]);
        res.json({ success: true });
    } catch (e) { res.status(500).send("Erreur"); }
});

app.post('/admin/valider-retrait', async (req, res) => {
    const { cle, transaction_db_id } = req.body;
    if(cle !== "999") return res.status(403).send("Refusé");
    try {
        await pool.query("UPDATE transactions SET statut = 'retrait effectué' WHERE id = $1", [transaction_db_id]);
        res.json({ success: true });
    } catch (e) { res.status(500).send("Erreur"); }
});

app.post('/admin/refuser-depot', async (req, res) => {
    const { cle, transaction_db_id } = req.body;
    if(cle !== "999") return res.status(403).send("Refusé");
    try {
        const trans = await pool.query('SELECT * FROM transactions WHERE id = $1', [transaction_db_id]);
        if(trans.rows.length > 0 && trans.rows[0].statut === 'retrait en attente') {
            await pool.query('UPDATE utilisateurs SET balance = balance + $1 WHERE id_public = $2', [trans.rows[0].montant, trans.rows[0].id_public_user]);
        }
        await pool.query("DELETE FROM transactions WHERE id = $1", [transaction_db_id]);
        res.json({ success: true });
    } catch (e) { res.status(500).send("Erreur"); }
});

app.post('/admin/modifier-solde', async (req, res) => {
    const { cle, id_public_user, nouveau_solde } = req.body;
    if(cle !== "999") return res.status(403).send("Refusé");
    await pool.query('UPDATE utilisateurs SET balance = $1 WHERE id_public = $2', [nouveau_solde, id_public_user]);
    res.json({ success: true });
});

app.post('/admin/supprimer-user', async (req, res) => {
    const { cle, id_public_user } = req.body;
    if(cle !== "999") return res.status(403).send("Refusé");
    await pool.query('DELETE FROM utilisateurs WHERE id_public = $1', [id_public_user]);
    res.json({ success: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("🚀 Serveur sur port " + PORT));
