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
        `);
        // Sécurité colonnes et config par défaut
        await pool.query(`ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS message TEXT DEFAULT '';`);
        await pool.query(`ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS dernier_checkin TEXT DEFAULT '';`);
        await pool.query(`INSERT INTO config_globale (cle, valeur, montant) VALUES ('code_journalier', 'MEGA2025', 50) ON CONFLICT DO NOTHING;`);
        
        console.log("✅ Base de données mise à jour et opérationnelle");
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

// === SYSTÈME DE CODE BONUS JOURNALIER ===
app.post('/reclamer-bonus', async (req, res) => {
    const { id_public_user, code_saisi } = req.body;
    try {
        const config = await pool.query("SELECT * FROM config_globale WHERE cle = 'code_journalier'");
        const user = await pool.query("SELECT dernier_checkin FROM utilisateurs WHERE id_public = $1", [id_public_user]);
        const aujourdhui = new Date().toDateString();

        if (user.rows[0].dernier_checkin === aujourdhui) {
            return res.status(400).json({ message: "Bonus déjà récupéré aujourd'hui !" });
        }
        if (code_saisi !== config.rows[0].valeur) {
            return res.status(400).json({ message: "Code incorrect. Allez sur Telegram !" });
        }

        const montantBonus = config.rows[0].montant;
        await pool.query("UPDATE utilisateurs SET balance = balance + $1, dernier_checkin = $2 WHERE id_public = $3", 
            [montantBonus, aujourdhui, id_public_user]);

        res.json({ success: true, message: `Félicitations ! +${montantBonus} FCFA ajoutés.` });
    } catch (e) { res.status(500).json({ message: "Erreur serveur" }); }
});

// === MINI-JEU PILE OU FACE ===
app.post('/jeu/pile-face', async (req, res) => {
    const { id_public_user, mise } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const user = await client.query('SELECT balance FROM utilisateurs WHERE id_public = $1 FOR UPDATE', [id_public_user]);
        if (parseFloat(user.rows[0].balance) < mise || mise < 50) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: "Solde insuffisant (min 50F)" });
        }

        const gagne = Math.random() > 0.5;
        const gain = gagne ? mise : -mise;
        await client.query('UPDATE utilisateurs SET balance = balance + $1 WHERE id_public = $2', [gain, id_public_user]);
        
        await client.query('COMMIT');
        res.json({ success: true, gagne, nouveauSolde: parseFloat(user.rows[0].balance) + gain });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ message: "Erreur jeu" });
    } finally { client.release(); }
});

// === ROUTE RETRAIT SÉCURISÉE ===
app.post('/retrait', async (req, res) => {
    const { id_public_user, montant, methode, numero } = req.body;
    const client = await pool.connect();
    try {
        if (montant < 100) return res.status(400).json({ message: "Minimum 100 FCFA" });
        await client.query('BEGIN');
        const userRes = await client.query('SELECT balance FROM utilisateurs WHERE id_public = $1 FOR UPDATE', [id_public_user]);
        const currentBalance = parseFloat(userRes.rows[0].balance);

        if (currentBalance < montant) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: "Solde insuffisant" });
        }

        await client.query('UPDATE utilisateurs SET balance = balance - $1 WHERE id_public = $2', [montant, id_public_user]);
        const uniqueId = `RET-${Date.now()}-${genererCode(3)}`;
        await client.query(
            `INSERT INTO transactions (id_public_user, transaction_id, montant, statut) VALUES ($1, $2, $3, 'retrait en attente')`,
            [id_public_user, `${uniqueId}-${methode}-${numero}`, montant]
        );
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, message: "Erreur serveur" });
    } finally { client.release(); }
});

app.post('/depot', async (req, res) => {
    const { id_public_user, transaction_id, montant } = req.body;
    try {
        await pool.query(`INSERT INTO transactions (id_public_user, transaction_id, montant, statut) VALUES ($1, $2, $3, 'en attente')`,
            [id_public_user, transaction_id, montant]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.get('/user/transactions/:id_public', async (req, res) => {
    const r = await pool.query("SELECT * FROM transactions WHERE id_public_user = $1 ORDER BY id DESC LIMIT 10", [req.params.id_public]);
    res.json(r.rows);
});

// --- ROUTES ADMIN ---

app.post('/admin/update-bonus-code', async (req, res) => {
    const { cle, nouveau_code, nouveau_montant } = req.body;
    if(cle !== "999") return res.status(403).send("Refusé");
    await pool.query("UPDATE config_globale SET valeur = $1, montant = $2 WHERE cle = 'code_journalier'", 
        [nouveau_code, nouveau_montant]);
    res.json({ success: true });
});

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
    await pool.query("UPDATE transactions SET statut = 'retrait effectué' WHERE id = $1", [transaction_db_id]);
    res.json({ success: true });
});

app.post('/admin/refuser-depot', async (req, res) => {
    const { cle, transaction_db_id } = req.body;
    if(cle !== "999") return res.status(403).send("Refusé");
    const trans = await pool.query('SELECT * FROM transactions WHERE id = $1', [transaction_db_id]);
    if(trans.rows.length > 0 && trans.rows[0].statut === 'retrait en attente') {
        await pool.query('UPDATE utilisateurs SET balance = balance + $1 WHERE id_public = $2', [trans.rows[0].montant, trans.rows[0].id_public_user]);
    }
    await pool.query("DELETE FROM transactions WHERE id = $1", [transaction_db_id]);
    res.json({ success: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("🚀 Serveur Connecté sur port " + PORT));
