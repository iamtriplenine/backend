
    const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const cron = require('node-cron');
const app = express();

app.use(cors());
app.use(express.json());

// --- CONNEXION À LA BASE DE DONNÉES ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- INITIALISATION DES TABLES ET CONFIGURATION ---
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
                dernier_code_utilise TEXT DEFAULT ''
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


     
// 
            // Ajoute la colonne pour stocker le minage (Mega Coins)
await pool.query(`ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS mining_balance DECIMAL(15,2) DEFAULT 0;`);




      
        // Mise à jour de la colonne pour la nouvelle logique (Code Unique au lieu de Date)
        await pool.query(`ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS dernier_code_utilise TEXT DEFAULT '';`);
        // Initialisation du code par défaut si la table est vide
        await pool.query(`INSERT INTO config_globale (cle, valeur, montant) VALUES ('code_journalier', 'MEGA2025', 50) ON CONFLICT DO NOTHING;`);

       // --- INITIALISATION DU TAUX DE PARRAINAGE ---
// Crée la variable dans la base de données avec 40% par défaut
await pool.query(`INSERT INTO config_globale (cle, montant) VALUES ('pourcentage_parrain', 40) ON CONFLICT DO NOTHING;`);






// --- (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((----------------- ---

        
// --- (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((----------------- ---






        





// 1. On crée la colonne wallet_address pour tout le monde
await pool.query(`ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS wallet_address TEXT UNIQUE;`);

// 2. On donne une adresse aux anciens qui n'en ont pas encore
const anciens = await pool.query(`SELECT id_public FROM utilisateurs WHERE wallet_address IS NULL`);
for (let row of anciens.rows) {
    const adr = '0x' + Math.random().toString(16).slice(2, 10).toUpperCase();
    await pool.query(`UPDATE utilisateurs SET wallet_address = $1 WHERE id_public = $2`, [adr, row.id_public]);
}





// --- INITIALISATION DE LA TABLE INVESTISSEMENTS ---
await pool.query(`
    CREATE TABLE IF NOT EXISTS investissements (
        id SERIAL PRIMARY KEY,
        id_public_user VARCHAR(6),
        type_machine TEXT DEFAULT 'TEST_50',
        date_achat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        jours_restants INTEGER DEFAULT 30
    );
`);




        
           
           
      
        console.log("✅ Serveur prêt et Base de données synchronisée");
    } catch (err) { console.log("Erreur lors de l'initialisation:", err); }
};
initDB();










// --- PETIT OUTIL POUR GÉNÉRER DES CODES (ID PUBLIC, ETC.) ---
const genererCode = (long) => Math.floor(Math.pow(10, long-1) + Math.random() * 9 * Math.pow(10, long-1)).toString();

// ---------------------------------------------------------
// --- SECTION : INSCRIPTION ET CONNEXION ---
// ---------------------------------------------------------

app.post('/register', async (req, res) => {
    const { telephone, password, username, promo_parrain } = req.body;
    try {
        const id_p = genererCode(6);
        const mon_p = genererCode(4);

        // --- AJOUT : Génération de l'adresse de transfert interne ---
        const wallet_adr = '0x' + Math.random().toString(16).slice(2, 10).toUpperCase();

        await pool.query(
            `INSERT INTO utilisateurs (id_public, telephone, password, username, code_promo, parrain_code, wallet_address) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [id_p, telephone, password, username, mon_p, promo_parrain, wallet_adr]
        );
        
        res.json({ success: true, id: id_p, promo: mon_p });
    } catch (e) { 
        res.status(500).json({ success: false, message: "Numéro déjà pris ou erreur serveur." }); 
    }
});







app.post('/login', async (req, res) => {
    const { telephone, password } = req.body;
    try {
        // Le SELECT * récupère maintenant aussi la colonne wallet_address que nous avons ajoutée
        const u = await pool.query('SELECT * FROM utilisateurs WHERE telephone = $1 AND password = $2', [telephone, password]);
        
        if (u.rows.length > 0) {
            res.json({ success: true, user: u.rows[0] });
        } else {
            res.status(401).json({ success: false, message: "Identifiants incorrects" });
        }
    } catch (e) { 
        res.status(500).json({ success: false, message: "Erreur serveur lors de la connexion" }); 
    }
});

// ---------------------------------------------------------
// --- SECTION : SYSTÈME DE CODE CADEAU (LOGIQUE CODE UNIQUE) ---
// ---------------------------------------------------------

app.post('/reclamer-bonus', async (req, res) => {
    const { id_public_user, code_saisi } = req.body;
    try {
        // 1. Récupérer le code actuellement défini par l'admin
        const config = await pool.query("SELECT * FROM config_globale WHERE cle = 'code_journalier'");
        const codeActuel = config.rows[0].valeur;
        const montantBonus = config.rows[0].montant;

        // 2. Vérifier ce que l'utilisateur a utilisé en dernier
        const user = await pool.query("SELECT dernier_code_utilise FROM utilisateurs WHERE id_public = $1", [id_public_user]);

        // Vérification 1: Est-ce le bon code ?
        if (code_saisi !== codeActuel) {
            return res.status(400).json({ message: "Code incorrect ou expiré !" });
        }

        // Vérification 2: L'a-t-il déjà utilisé ? 
        // Si le code saisi est égal au dernier_code_utilise, on bloque.
        if (user.rows[0].dernier_code_utilise === codeActuel) {
            return res.status(400).json({ message: "Vous avez déjà récupéré ce cadeau !" });
        }

        // 3. Validation : On donne l'argent et on enregistre ce code comme étant le "dernier utilisé"
        await pool.query("UPDATE utilisateurs SET balance = balance + $1, dernier_code_utilise = $2 WHERE id_public = $3", 
            [montantBonus, codeActuel, id_public_user]);

        res.json({ success: true, message: `Félicitations ! +${montantBonus} FCFA ajoutés.` });
    } catch (e) { res.status(500).json({ message: "Erreur serveur" }); }
});

// ---------------------------------------------------------
// --- SECTION : JEU PILE OU FACE ---
// ---------------------------------------------------------

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

        const gagne = Math.random() > 0.5; // 50% de chance
        const gain = gagne ? mise : -mise;
        await client.query('UPDATE utilisateurs SET balance = balance + $1 WHERE id_public = $2', [gain, id_public_user]);
        
        await client.query('COMMIT');
        res.json({ success: true, gagne, nouveauSolde: parseFloat(user.rows[0].balance) + gain });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ message: "Erreur jeu" });
    } finally { client.release(); }
});

// ---------------------------------------------------------
// --- SECTION : DÉPÔTS ET RETRAITS ---
// ---------------------------------------------------------

app.post('/retrait', async (req, res) => {
    const { id_public_user, montant, methode, numero } = req.body;
    const client = await pool.connect();
    try {
        if (montant < 100) return res.status(400).json({ message: "Minimum 100 FCFA" });
        await client.query('BEGIN');
        const userRes = await client.query('SELECT balance FROM utilisateurs WHERE id_public = $1 FOR UPDATE', [id_public_user]);
        
        if (parseFloat(userRes.rows[0].balance) < montant) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: "Solde insuffisant" });
        }

        await client.query('UPDATE utilisateurs SET balance = balance - $1 WHERE id_public = $2', [montant, id_public_user]);
        const uniqueId = `RET-${Date.now()}`;
        await client.query(
            `INSERT INTO transactions (id_public_user, transaction_id, montant, statut) VALUES ($1, $2, $3, 'retrait en attente')`,
            [id_public_user, `${uniqueId}-${methode}-${numero}`, montant]
        );
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false });
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



// ---------------------------------------------------------
// --- SECTION : SYSTÈME DE MINAGE (NOUVEAU) ---
// ---------------------------------------------------------

// Route pour que l'utilisateur sauvegarde son minage en quittant la page
app.post('/update-mining', async (req, res) => {
    const { id_public_user, mining_balance } = req.body;
    try {
        await pool.query('UPDATE utilisateurs SET mining_balance = $1 WHERE id_public = $2', [mining_balance, id_public_user]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// Route Admin : Convertir le minage d'un utilisateur en FCFA (100,000 MEGA = 50 FCFA)
app.post('/admin/convertir-minage', async (req, res) => {
    const { cle, id_public_user } = req.body;
    if(cle !== "999") return res.status(403).send("Refusé");
    
    try {
        const user = await pool.query('SELECT mining_balance FROM utilisateurs WHERE id_public = $1', [id_public_user]);
        const mega = parseFloat(user.rows[0].mining_balance);
        
        if (mega < 100000) return res.status(400).json({ message: "Minimum 100,000 MEGA requis" });

        const gainFCFA = (mega / 100000) * 50; // Calcul de conversion

        await pool.query('BEGIN');
        // On remet le minage à 0
        await pool.query('UPDATE utilisateurs SET mining_balance = 0 WHERE id_public = $1', [id_public_user]);
        // On ajoute l'argent au solde réel
        await pool.query('UPDATE utilisateurs SET balance = balance + $1 WHERE id_public = $2', [gainFCFA, id_public_user]);
        await pool.query('COMMIT');

        res.json({ success: true, message: `Converti ${mega} MEGA en ${gainFCFA} FCFA` });
    } catch (e) {
        await pool.query('ROLLBACK');
        res.status(500).send("Erreur conversion");
    }
});















// ---------------------------------------------------------
// --- SECTION : SYSTÈME D'INVESTISSEMENT (MINING) ---
// ---------------------------------------------------------

// Route pour acheter la machine de test (50F)
app.post('/invest/acheter-test', async (req, res) => {
    const { id_public_user } = req.body;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // 1. Vérifier si l'utilisateur a assez d'argent (50F)
        const user = await client.query('SELECT balance FROM utilisateurs WHERE id_public = $1 FOR UPDATE', [id_public_user]);
        if (parseFloat(user.rows[0].balance) < 50) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: "Solde insuffisant (50F)" });
        }

        // 2. Vérifier la limite (Maximum 2 machines de ce type)
        const countRes = await client.query('SELECT COUNT(*) FROM investissements WHERE id_public_user = $1 AND type_machine = $2', [id_public_user, 'TEST_50']);
        if (parseInt(countRes.rows[0].count) >= 2) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: "Limite d'achat atteinte (Max 2)" });
        }

        // 3. Déduire les 50F et créer la machine
        await client.query('UPDATE utilisateurs SET balance = balance - 50 WHERE id_public = $1', [id_public_user]);
        await client.query('INSERT INTO investissements (id_public_user, type_machine, jours_restants) VALUES ($1, $2, 30)', [id_public_user, 'TEST_50']);

        await client.query('COMMIT');
        res.json({ success: true, message: "Machine activée ! Gains : 5F/jour." });

    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, message: "Erreur serveur" });
    } finally {
        client.release();
    }
});



// ---------------------------------------------------------
// --- SECTION : TRANSFERT ENTRE PORTEFEUILLES (WALLET) ---
// ---------------------------------------------------------

// --- SECTION : TRANSFERT ENTRE PORTEFEUILLES (MIS À JOUR POUR DOUBLE HISTORIQUE) ---
app.post('/transfert-wallet', async (req, res) => {
    const { id_public_expediteur, adresse_destinataire, montant } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Vérifier l'expéditeur et son solde
        const expRes = await client.query('SELECT id_public, balance, wallet_address FROM utilisateurs WHERE id_public = $1 FOR UPDATE', [id_public_expediteur]);
        if (expRes.rows.length === 0) throw new Error("Expéditeur introuvable");
        
        const soldeExp = parseFloat(expRes.rows[0].balance);
        if (soldeExp < montant) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: "Solde insuffisant" });
        }

        // 2. Vérifier le destinataire par son adresse
        const destRes = await client.query('SELECT id_public, balance FROM utilisateurs WHERE wallet_address = $1 FOR UPDATE', [adresse_destinataire]);
        if (destRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: "Adresse destinataire invalide" });
        }
        const id_dest = destRes.rows[0].id_public;

        // Sécurité : Interdire l'envoi à soi-même
        if (expRes.rows[0].wallet_address === adresse_destinataire) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: "Envoi à soi-même interdit" });
        }

        // 3. Mouvement d'argent
        await client.query('UPDATE utilisateurs SET balance = balance - $1 WHERE id_public = $2', [montant, id_public_expediteur]);
        await client.query('UPDATE utilisateurs SET balance = balance + $1 WHERE id_public = $2', [montant, id_dest]);

        // 4. DOUBLE ENREGISTREMENT DANS L'HISTORIQUE
        const temps = Date.now();
        
        // A. Pour l'expéditeur (Moins d'argent)
        await client.query(
            `INSERT INTO transactions (id_public_user, transaction_id, montant, statut) VALUES ($1, $2, $3, $4)`,
            [id_public_expediteur, `TRF-OUT-${temps}`, montant, `Transfert vers ${adresse_destinataire}`]
        );

        // B. Pour le destinataire (Plus d'argent)
        // On utilise l'adresse de l'expéditeur pour que le receveur sache d'où ça vient
        await client.query(
            `INSERT INTO transactions (id_public_user, transaction_id, montant, statut) VALUES ($1, $2, $3, $4)`,
            [id_dest, `TRF-IN-${temps}`, montant, `Reçu de ${expRes.rows[0].wallet_address}`]
        );

        await client.query('COMMIT');
        res.json({ success: true, message: "Transfert réussi" });

    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, message: "Erreur technique" });
    } finally {
        client.release();
    }
});







// ---------------------------------------------------------
// --- SECTION : ADMINISTRATION ---
// ---------------------------------------------------------

// --- MODIFICATION DU TAUX PAR L'ADMIN ---
// Met à jour la valeur du pourcentage dans la base de données
app.post('/admin/update-config-taux', async (req, res) => {
    const { cle, nouveau_taux } = req.body;
    if(cle !== "999") return res.status(403).send("Refusé");
    try {
        await pool.query("UPDATE config_globale SET montant = $1 WHERE cle = 'pourcentage_parrain'", [nouveau_taux]);
        res.json({ success: true });
    } catch (e) { res.status(500).send("Erreur"); }
});










// Met à jour le code secret et le montant. Dès que tu valides, l'ancien code ne fonctionne plus.
app.post('/admin/update-bonus-code', async (req, res) => {
    const { cle, nouveau_code, nouveau_montant } = req.body;
    if(cle !== "999") return res.status(403).send("Refusé");
    await pool.query("UPDATE config_globale SET valeur = $1, montant = $2 WHERE cle = 'code_journalier'", 
        [nouveau_code, nouveau_montant]);
    res.json({ success: true });
});

// Liste tous les membres
app.get('/admin/utilisateurs/:cle', async (req,res) => {
    if(req.params.cle !== "999") return res.status(403).send("Refusé");
    const r = await pool.query('SELECT * FROM utilisateurs ORDER BY id DESC');
    res.json(r.rows);
});

// Liste les transactions en attente
app.get('/admin/transactions/:cle', async (req,res) => {
    if(req.params.cle !== "999") return res.status(403).send("Refusé");
    const r = await pool.query("SELECT * FROM transactions WHERE statut = 'en attente' OR statut = 'retrait en attente' ORDER BY id DESC");
    res.json(r.rows);
});





// Valider un dépôt (Ajoute l'argent au client + Bonus Parrain 40%)

// --- VALIDATION DE DÉPÔT AVEC CALCUL DYNAMIQUE ---
app.post('/admin/valider-depot', async (req, res) => {
    const { cle, transaction_db_id, id_public_user, montant } = req.body;
    if(cle !== "999") return res.status(403).send("Refusé");
    try {
        await pool.query('BEGIN');
        
        // 1. Créditer le client
        await pool.query('UPDATE utilisateurs SET balance = balance + $1 WHERE id_public = $2', [montant, id_public_user]);

        // 2. Chercher le taux actuel en base de données
        const configRes = await pool.query("SELECT montant FROM config_globale WHERE cle = 'pourcentage_parrain'");
        const tauxActuel = (configRes.rows.length > 0 ? parseFloat(configRes.rows[0].montant) : 40) / 100;

        // 3. Verser le bonus au parrain si il existe
        const user = await pool.query('SELECT parrain_code FROM utilisateurs WHERE id_public = $1', [id_public_user]);
        if (user.rows[0]?.parrain_code) {
            const bonus = parseFloat(montant) * tauxActuel;
            await pool.query('UPDATE utilisateurs SET balance = balance + $1 WHERE code_promo = $2', [bonus, user.rows[0].parrain_code]);
        }
        
        // 4. Valider la transaction
        await pool.query("UPDATE transactions SET statut = 'validé' WHERE id = $1", [transaction_db_id]);
        
        await pool.query('COMMIT');
        res.json({ success: true });
    } catch (e) { 
        await pool.query('ROLLBACK'); 
        res.status(500).send("Erreur lors de la validation"); 
    }
});







// Valider un retrait (Marque juste comme payé)
app.post('/admin/valider-retrait', async (req, res) => {
    const { cle, transaction_db_id } = req.body;
    if(cle !== "999") return res.status(403).send("Refusé");
    await pool.query("UPDATE transactions SET statut = 'retrait effectué' WHERE id = $1", [transaction_db_id]);
    res.json({ success: true });
});

// Rejeter une transaction (Rend l'argent si c'était un retrait)
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


// --- AJOUTE CECI DANS LA SECTION ADMIN DU SERVEUR ---

// Permet de modifier manuellement le solde d'un utilisateur (Bouton Editer)
app.post('/admin/modifier-solde', async (req, res) => {
    const { cle, id_public_user, nouveau_solde } = req.body;
    if(cle !== "999") return res.status(403).send("Refusé");
    try {
        await pool.query('UPDATE utilisateurs SET balance = $1 WHERE id_public = $2', [nouveau_solde, id_public_user]);
        res.json({ success: true });
    } catch (e) { res.status(500).send("Erreur modification solde"); }
});

// Permet de changer le message personnalisé affiché à l'utilisateur
app.post('/admin/modifier-message', async (req, res) => {
    const { cle, id_public_user, nouveau_message } = req.body;
    if(cle !== "999") return res.status(403).send("Refusé");
    try {
        await pool.query('UPDATE utilisateurs SET message = $1 WHERE id_public = $2', [nouveau_message, id_public_user]);
        res.json({ success: true });
    } catch (e) { res.status(500).send("Erreur modification message"); }
});

// Permet de supprimer définitivement un utilisateur
app.post('/admin/supprimer-user', async (req, res) => {
    const { cle, id_public_user } = req.body;
    if(cle !== "999") return res.status(403).send("Refusé");
    try {
        await pool.query('DELETE FROM utilisateurs WHERE id_public = $1', [id_public_user]);
        res.json({ success: true });
    } catch (e) { res.status(500).send("Erreur suppression"); }
});


// (((((((((((((((((((((((((((((((((((((((------------------------((((((((((((((((((((((((((((((((((((((((

// (((((((((((((((((((((((((((((((((((((((------------------------((((((((((((((((((((((((((((((((((((((((


















// --- SECTION : RÉCUPÉRATION DES AFFILIÉS ---


// Route mise à jour pour garantir un retour propre (tableau vide au lieu de undefined)
/**
 * ROUTE : Récupérer les affiliés d'un utilisateur spécifique
 * Cette route est utilisée par la page "Invités" de l'utilisateur
 */
// ---------------------------------------------------------
// --- SECTION : RÉCUPÉRATION DES AFFILIÉS (CORRIGÉE SQL) ---
// ---------------------------------------------------------

/**
 * ROUTE : Récupérer les affiliés d'un utilisateur et leurs dépôts cumulés
 */
app.get('/user/affilies/:id_public', async (req, res) => {
    const { id_public } = req.params;

    try {
        // 1. On récupère d'abord le code_promo de l'utilisateur (le parrain)
        const parrainRes = await pool.query(
            'SELECT code_promo FROM utilisateurs WHERE id_public = $1', 
            [id_public]
        );

        if (parrainRes.rows.length === 0) {
            return res.status(404).json({ message: "Utilisateur non trouvé" });
        }

        const monCodePromo = parrainRes.rows[0].code_promo;

        // 2. On cherche les affiliés ET on calcule la somme de leurs dépôts validés en une seule requête SQL
        // Cette requête est beaucoup plus rapide et fiable
        const query = `
            SELECT 
                u.id_public, 
                u.username, 
                COALESCE(SUM(t.montant), 0) as total_depose
            FROM utilisateurs u
            LEFT JOIN transactions t ON u.id_public = t.id_public_user AND t.statut = 'validé'
            WHERE UPPER(u.parrain_code) = UPPER($1)
            GROUP BY u.id_public, u.username
        `;

        const affiliesRes = await pool.query(query, [monCodePromo]);

        // 3. On renvoie le tableau (sera vide [] si aucun affilié, ce qui est correct)
        res.json(affiliesRes.rows);

    } catch (e) {
        console.error("Erreur récupération affiliés:", e);
        res.status(500).json({ message: "Erreur serveur" });
    }
});








// --- RÉCUPÉRATION DU TAUX POUR L'INTERFACE UTILISATEUR ---
// Cette route permet à user.html d'afficher le bon pourcentage dynamiquement
app.get('/config/taux-parrainage', async (req, res) => {
    try {
        const config = await pool.query("SELECT montant FROM config_globale WHERE cle = 'pourcentage_parrain'");
        const taux = config.rows.length > 0 ? config.rows[0].montant : 40;
        res.json({ taux: taux });
    } catch (e) { res.json({ taux: 40 }); }
});









// --- ROUTES ADMIN : GESTION DU CATALOGUE ---




// --- DÉMARRAGE DU SERVEUR ---
const PORT = process.env.PORT || 10000;





// ---------------------------------------------------------
// --- SECTION : DISTRIBUTION AUTOMATIQUE (CHRONOS) ---
// ---------------------------------------------------------

// Ce robot se réveille chaque jour à 00h00
cron.schedule('0 0 * * *', async () => {
    console.log("🤖 [INVEST] Début de la distribution des gains...");
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 1. On cherche toutes les machines qui ont encore des jours de vie
        const actives = await client.query('SELECT * FROM investissements WHERE jours_restants > 0');
        
        for (let machine of actives.rows) {
            // 2. On verse les 5F à l'utilisateur
            await client.query('UPDATE utilisateurs SET balance = balance + 5 WHERE id_public = $1', [machine.id_public_user]);
            
            // 3. On réduit la durée de vie de la machine de 1 jour
            await client.query('UPDATE investissements SET jours_restants = jours_restants - 1 WHERE id = $1', [machine.id]);
        }
        
        await client.query('COMMIT');
        console.log(`✅ distribution terminée pour ${actives.rows.length} machines.`);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("❌ Erreur distribution investissement:", e);
    } finally {
        client.release();
    }
});






app.listen(PORT, () => console.log("🚀 Serveur Connecté sur port " + PORT));
