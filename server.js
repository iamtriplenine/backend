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

        await pool.query(`INSERT INTO config_globale (cle, valeur, montant) VALUES ('code_journalier', 'MEGA2025', 50) ON CONFLICT DO NOTHING;`);
        
        const checkRoulette = await pool.query("SELECT COUNT(*) FROM roulette_lots");
        if (parseInt(checkRoulette.rows[0].count) === 0) {
            const defaultLots = [
                ['0 F', 0, 70], ['10 F', 10, 10], ['20 F', 20, 10], ['0 F', 0, 5],
                ['100 F', 100, 2], ['0 F', 0, 1], ['500 F', 500, 1], ['1000 F', 1000, 1]
            ];
            for (let lot of defaultLots) {
                await pool.query("INSERT INTO roulette_lots (label, valeur, probabilite) VALUES ($1, $2, $3)", lot);
            }
        }
        console.log("✅ Base de données opérationnelle");
    } catch (err) { console.log("Erreur init:", err); }
};
initDB();

const genererCode = (long) => Math.floor(Math.pow(10, long-1) + Math.random() * 9 * Math.pow(10, long-1)).toString();

app.post('/register', async (req, res) => {
    const { telephone, password, username, promo_parrain } = req.body;
    try {
        const id_p = genererCode(6);
        const mon_p = genererCode(4);
        await pool.query(`INSERT INTO utilisateurs (id_public, telephone, password, username, code_promo, parrain_code) VALUES ($1,$2,$3,$4,$5,$6)`, [id_p, telephone, password, username, mon_p, promo_parrain]);
        res.json({ success: true, id: id_p, promo: mon_p });
    } catch (e) { res.status(500).json({ success: false, message: "Erreur" }); }
});

app.post('/login', async (req, res) => {
    const { telephone, password } = req.body;
    try {
        const u = await pool.query('SELECT * FROM utilisateurs WHERE telephone = $1 AND password = $2', [telephone, password]);
        if (u.rows.length > 0) res.json({ success: true, user: u.rows[0] });
        else res.status(401).json({ success: false, message: "Identifiants incorrects" });
    } catch (e) { res.status(500).json({ success: false }); }
});

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
        let cumul = 0; let lotGagne = lots.rows[0];
        for (let lot of lots.rows) {
            cumul += lot.probabilite;
            if (random < cumul) { lotGagne = lot; break; }
        }
        await client.query('UPDATE utilisateurs SET balance = balance + $1 WHERE id_public = $2', [lotGagne.valeur, id_public_user]);
        await client.query('COMMIT');
        res.json({ success: true, lotIndex: lots.rows.indexOf(lotGagne), label: lotGagne.label });
    } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ message: "Erreur" }); }
    finally { client.release(); }
});

app.post('/admin/update-roulette', async (req, res) => {
    const { cle, lots } = req.body;
    if(cle !== "999") return res.status(403).send("Refusé");
    for(let i=0; i<lots.length; i++) {
        await pool.query("UPDATE roulette_lots SET label=$1, valeur=$2, probabilite=$3 WHERE id=$4", [lots[i].label, lots[i].valeur, lots[i].probabilite, i+1]);
    }
    res.json({ success: true });
});

app.post('/retrait', async (req, res) => {
    const { id_public_user, montant, methode, numero } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userRes = await client.query('SELECT balance FROM utilisateurs WHERE id_public = $1 FOR UPDATE', [id_public_user]);
        if (parseFloat(userRes.rows[0].balance) < montant) { await client.query('ROLLBACK'); return res.status(400).json({message:"Insuffisant"}); }
        await client.query('UPDATE utilisateurs SET balance = balance - $1 WHERE id_public = $2', [montant, id_public_user]);
        await client.query(`INSERT INTO transactions (id_public_user, transaction_id, montant, statut) VALUES ($1, $2, $3, 'retrait en attente')`, [id_public_user, `RET-${Date.now()}-${methode}`, montant]);
        await client.query('COMMIT'); res.json({ success: true });
    } catch (e) { await client.query('ROLLBACK'); res.status(500).json({message:"Erreur"}); } finally { client.release(); }
});

app.post('/depot', async (req, res) => {
    const { id_public_user, transaction_id, montant } = req.body;
    await pool.query(`INSERT INTO transactions (id_public_user, transaction_id, montant, statut) VALUES ($1, $2, $3, 'en attente')`, [id_public_user, transaction_id, montant]);
    res.json({ success: true });
});

app.get('/user/transactions/:id_public', async (req, res) => {
    const r = await pool.query("SELECT * FROM transactions WHERE id_public_user = $1 ORDER BY id DESC LIMIT 10", [req.params.id_public]);
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
    await pool.query('UPDATE utilisateurs SET balance = balance + $1 WHERE id_public = $2', [montant, id_public_user]);
    const user = await pool.query('SELECT parrain_code FROM utilisateurs WHERE id_public = $1', [id_public_user]);
    if (user.rows[0]?.parrain_code) await pool.query('UPDATE utilisateurs SET balance = balance + $1 WHERE code_promo = $2', [montant * 0.40, user.rows[0].parrain_code]);
    await pool.query("UPDATE transactions SET statut = 'validé' WHERE id = $1", [transaction_db_id]);
    res.json({ success: true });
});

app.get('/admin/utilisateurs/:cle', async (req,res) => {
    if(req.params.cle !== "999") return res.status(403).send("Refusé");
    const r = await pool.query('SELECT * FROM utilisateurs ORDER BY id DESC');
    res.json(r.rows);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("🚀 Connecté"));
