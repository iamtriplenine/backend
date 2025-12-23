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
        // Note : On retire le DROP TABLE pour conserver les inscrits
        await pool.query(`
            CREATE TABLE IF NOT EXISTS utilisateurs (
                id SERIAL PRIMARY KEY,
                id_public VARCHAR(6) UNIQUE,
                telephone VARCHAR(20) UNIQUE NOT NULL,
                password TEXT NOT NULL,
                username TEXT,
                code_promo VARCHAR(4) UNIQUE,
                parrain_code VARCHAR(4),
                balance DECIMAL(15,2) DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                id_public_user VARCHAR(6),
                transaction_id TEXT UNIQUE,
                montant DECIMAL(15,2),
                statut TEXT DEFAULT 'en attente'
            );
        `);
        console.log("✅ Base de données opérationnelle");
    } catch (err) { console.log("Erreur init:", err); }
};
initDB();

const genererCode = (long) => Math.floor(Math.pow(10, long-1) + Math.random() * 9 * Math.pow(10, long-1)).toString();

app.get('/', (req, res) => res.send("Serveur Affiliation Actif"));

// --- INSCRIPTION ---
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

// --- CONNEXION ---
app.post('/login', async (req, res) => {
    const { telephone, password } = req.body;
    try {
        const u = await pool.query('SELECT * FROM utilisateurs WHERE telephone = $1 AND password = $2', [telephone, password]);
        if (u.rows.length > 0) res.json({ success: true, user: u.rows[0] });
        else res.status(401).json({ success: false, message: "Identifiants incorrects" });
    } catch (e) { res.status(500).json({ success: false }); }
});

// --- UTILISATEUR : ENVOYER UNE PREUVE DE DEPOT (LA MISE À JOUR) ---
app.post('/depot', async (req, res) => {
    const { id_public_user, transaction_id, montant } = req.body;
    try {
        await pool.query(
            `INSERT INTO transactions (id_public_user, transaction_id, montant, statut) VALUES ($1, $2, $3, 'en attente')`,
            [id_public_user, transaction_id, montant]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: "ID transaction déjà utilisé." });
    }
});

// --- ADMIN : VOIR TOUT ---
app.get('/admin/utilisateurs/:cle', async (req,res) => {
    if(req.params.cle !== "999") return res.status(403).send("Refusé");
    const r = await pool.query('SELECT * FROM utilisateurs ORDER BY id DESC');
    res.json(r.rows);
});

app.get('/admin/transactions/:cle', async (req,res) => {
    if(req.params.cle !== "999") return res.status(403).send("Refusé");
    const r = await pool.query("SELECT * FROM transactions WHERE statut = 'en attente'");
    res.json(r.rows);
});

// --- ADMIN : VALIDER DÉPÔT + 40% COMMISSION ---
app.post('/admin/valider-depot', async (req, res) => {
    const { cle, transaction_db_id, id_public_user, montant } = req.body;
    if(cle !== "999") return res.status(403).send("Refusé");

    try {
        await pool.query('UPDATE utilisateurs SET balance = balance + $1 WHERE id_public = $2', [montant, id_public_user]);
        const user = await pool.query('SELECT parrain_code FROM utilisateurs WHERE id_public = $1', [id_public_user]);
        const codeParrain = user.rows[0]?.parrain_code;

        if (codeParrain) {
            const commission = montant * 0.40;
            await pool.query('UPDATE utilisateurs SET balance = balance + $1 WHERE code_promo = $2', [commission, codeParrain]);
        }
        await pool.query("UPDATE transactions SET statut = 'validé' WHERE id = $1", [transaction_db_id]);
        res.json({ success: true });
    } catch (e) { res.status(500).send("Erreur validation"); }
});



// --- ADMIN : MODIFIER LE SOLDE MANUELLEMENT ---
app.post('/admin/modifier-solde', async (req, res) => {
    const { cle, id_public_user, nouveau_solde } = req.body;
    if(cle !== "999") return res.status(403).send("Refusé");

    try {
        await pool.query('UPDATE utilisateurs SET balance = $1 WHERE id_public = $2', [nouveau_solde, id_public_user]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).send("Erreur lors de la modification");
    }
});





// --- ADMIN : REFUSER UN DÉPÔT ---
app.post('/admin/refuser-depot', async (req, res) => {
    const { cle, transaction_db_id } = req.body;
    if(cle !== "999") return res.status(403).send("Refusé");
    try {
        // On supprime simplement la transaction de la liste d'attente
        await pool.query("DELETE FROM transactions WHERE id = $1", [transaction_db_id]);
        res.json({ success: true });
    } catch (e) { res.status(500).send("Erreur"); }
});







// --- RETRAIT UTILISATEUR ---
// --- RETRAIT UTILISATEUR (MINIMUM 100 FCFA) ---
app.post('/retrait', async (req, res) => {
    const { id_public_user, montant, methode, numero } = req.body;
    try {
        // CHANGEMENT ICI : Seuil à 100 au lieu de 1000
        if (montant < 100) return res.status(400).json({ message: "Le minimum est de 100 FCFA" });

        const user = await pool.query('SELECT balance FROM utilisateurs WHERE id_public = $1', [id_public_user]);
        if (user.rows[0].balance < montant) return res.status(400).json({ message: "Solde insuffisant" });

        await pool.query(`INSERT INTO transactions (id_public_user, transaction_id, montant, statut) VALUES ($1, $2, $3, $4)`, 
        [id_public_user, `RETRAIT-${methode}-${numero}`, montant, 'retrait en attente']);
        
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});





// --- ADMIN : VALIDER RETRAIT ---
app.post('/admin/valider-retrait', async (req, res) => {
    const { cle, transaction_db_id, id_public_user, montant } = req.body;
    if(cle !== "999") return res.status(403).send("Refusé");
    try {
        // On déduit l'argent du solde de l'utilisateur
        await pool.query('UPDATE utilisateurs SET balance = balance - $1 WHERE id_public = $2', [montant, id_public_user]);
        // On marque la transaction comme terminée
        await pool.query("UPDATE transactions SET statut = 'retrait effectué' WHERE id = $1", [transaction_db_id]);
        res.json({ success: true });
    } catch (e) { res.status(500).send("Erreur"); }
});











const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("🚀 Serveur prêt sur le port " + PORT));
