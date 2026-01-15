
    const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const app = express();

app.use(cors());
app.use(express.json());

// --- CONNEXION À LA BASE DE DONNÉES ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- INITIALISATION DES TABLES ET CONFIGURATION ---
// --- INITIALISATION DES TABLES ET CONFIGURATION ---
const initDB = async () => {
  try {
    // 1) Tables principales
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

    // 2) Colonnes / config
    await pool.query(`ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS mining_balance DECIMAL(15,2) DEFAULT 0;`);
    await pool.query(`ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS dernier_code_utilise TEXT DEFAULT '';`);



      await pool.query(`ALTER TABLE invest_machines ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';`);
await pool.query(`ALTER TABLE invest_machines ADD COLUMN IF NOT EXISTS limite_achat INT DEFAULT 0;`); // 0 = illimité
await pool.query(`ALTER TABLE invest_machines ADD COLUMN IF NOT EXISTS ordre INT DEFAULT 0;`);
await pool.query(`ALTER TABLE invest_machines ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);


      
    await pool.query(`
      INSERT INTO config_globale (cle, valeur, montant)
      VALUES ('code_journalier', 'MEGA2025', 50)
      ON CONFLICT DO NOTHING;
    `);

    await pool.query(`
      INSERT INTO config_globale (cle, montant)
      VALUES ('pourcentage_parrain', 40)
      ON CONFLICT DO NOTHING;
    `);

    // ---------------------------------------------------------
    // 3) SECTION INVEST (protégée : même si le reste plante)
    // ---------------------------------------------------------
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS invest_machines (
          id SERIAL PRIMARY KEY,
          nom TEXT NOT NULL,
          prix DECIMAL(15,2) NOT NULL,
          gain_jour DECIMAL(15,2) NOT NULL,
          duree_jours INT NOT NULL,
          total_retour DECIMAL(15,2) NOT NULL,
          actif BOOLEAN DEFAULT true
        );
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_investments (
          id SERIAL PRIMARY KEY,
          id_public_user VARCHAR(6) NOT NULL,
          machine_id INT NOT NULL REFERENCES invest_machines(id),
          prix DECIMAL(15,2) NOT NULL,
          gain_jour DECIMAL(15,2) NOT NULL,
          duree_jours INT NOT NULL,
          total_retour DECIMAL(15,2) NOT NULL,
          cycles_payes INT DEFAULT 0,
          start_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_claim_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          statut TEXT DEFAULT 'en cours'
        );
      `);

      // ✅ Seed d'une seule machine test (si table vide)
      const machineCount = await pool.query(`SELECT COUNT(*)::int as c FROM invest_machines`);
      if ((machineCount.rows[0]?.c || 0) === 0) {
        await pool.query(`
          INSERT INTO invest_machines (nom, prix, gain_jour, duree_jours, total_retour, actif)
          VALUES ('Machine Test 1 000', 1000, 100, 15, 1500, true)
        `);
        console.log("✅ Invest: Machine test ajoutée");
      } else {
        console.log("ℹ️ Invest: Machines déjà présentes");
      }

      console.log("✅ INIT INVEST OK");
    } catch (e) {
      console.error("❌ INIT INVEST ERROR:", e?.message);
      console.error(e?.stack);
    }

    // ---------------------------------------------------------
    // 4) Wallet address (après Invest)
    // ---------------------------------------------------------
    await pool.query(`ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS wallet_address TEXT UNIQUE;`);

    const anciens = await pool.query(`SELECT id_public FROM utilisateurs WHERE wallet_address IS NULL`);
    for (let row of anciens.rows) {
      const adr = '0x' + Math.random().toString(16).slice(2, 10).toUpperCase();
      await pool.query(`UPDATE utilisateurs SET wallet_address = $1 WHERE id_public = $2`, [adr, row.id_public]);
    }

    console.log("✅ Serveur prêt et Base de données synchronisée");
  } catch (err) {
    console.error("❌ Erreur initDB:", err?.message);
    console.error(err?.stack);
  }
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
app.get('/admin/invest/machines/:cle', async (req, res) => {
  if (req.params.cle !== "999") return res.status(403).send("Refusé");
  try {
    const r = await pool.query(`SELECT * FROM invest_machines ORDER BY ordre ASC, prix ASC, id ASC`);
    res.json({ success: true, machines: r.rows });
  } catch (e) {
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});


app.post('/admin/invest/machines/add', async (req, res) => {
  const { cle, nom, prix, gain_jour, duree_jours, total_retour, actif, limite_achat, description, ordre } = req.body;
  if (cle !== "999") return res.status(403).send("Refusé");

  try {
    await pool.query(
      `INSERT INTO invest_machines (nom, prix, gain_jour, duree_jours, total_retour, actif, limite_achat, description, ordre)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        nom,
        prix,
        gain_jour,
        duree_jours,
        total_retour,
        actif !== false,
        limite_achat || 0,
        description || "",
        ordre || 0
      ]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: "Erreur ajout" });
  }
});


app.post('/admin/invest/machines/update', async (req, res) => {
  const { cle, id, nom, prix, gain_jour, duree_jours, total_retour, actif, limite_achat, description, ordre } = req.body;
  if (cle !== "999") return res.status(403).send("Refusé");

  try {
    await pool.query(
      `UPDATE invest_machines
       SET nom=$1, prix=$2, gain_jour=$3, duree_jours=$4, total_retour=$5,
           actif=$6, limite_achat=$7, description=$8, ordre=$9
       WHERE id=$10`,
      [
        nom,
        prix,
        gain_jour,
        duree_jours,
        total_retour,
        actif !== false,
        limite_achat || 0,
        description || "",
        ordre || 0,
        id
      ]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: "Erreur update" });
  }
});



app.post('/admin/invest/machines/toggle', async (req, res) => {
  const { cle, id, actif } = req.body;
  if (cle !== "999") return res.status(403).send("Refusé");

  try {
    await pool.query(`UPDATE invest_machines SET actif = $1 WHERE id = $2`, [!!actif, id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: "Erreur toggle" });
  }
});

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
const MS_24H = 24 * 60 * 60 * 1000;

function calcClaimableCycles(lastClaimAt, now) {
  const diff = now.getTime() - new Date(lastClaimAt).getTime();
  if (diff < MS_24H) return 0;
  return Math.floor(diff / MS_24H);
}


app.get('/invest/machines', async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM invest_machines WHERE actif = true ORDER BY prix ASC`);
    return res.json({ success: true, machines: r.rows });
  } catch (e) {
    console.error("❌ INVEST machines error:", e?.message);
    console.error(e?.stack);

    // debug rapide si tu appelles /invest/machines?debug=1
    if (req.query.debug === "1") {
      return res.status(500).json({
        success: false,
        message: "Erreur serveur",
        debug: e?.message
      });
    }

    return res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});






app.post('/invest/acheter', async (req, res) => {
  const { id_public_user, machine_id } = req.body;
  const client = await pool.connect();

  try {
    if (!id_public_user || !machine_id) {
      return res.status(400).json({ success: false, message: "Paramètres manquants" });
    }

    await client.query('BEGIN');

    // Verrouille utilisateur
    const uRes = await client.query(
      'SELECT balance FROM utilisateurs WHERE id_public = $1 FOR UPDATE',
      [id_public_user]
    );
    if (uRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "Utilisateur introuvable" });
    }

    // Machine
    const mRes = await client.query(
      'SELECT * FROM invest_machines WHERE id = $1 AND actif = true',
      [machine_id]
    );
    if (mRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "Machine introuvable" });
    }

    const solde = parseFloat(uRes.rows[0].balance);
    const prix = parseFloat(mRes.rows[0].prix);

    if (solde < prix) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "Solde insuffisant" });
    }






      const limite = parseInt(mRes.rows[0].limite_achat || 0); // 0 illimité

if (limite > 0) {
  const countRes = await client.query(
    `SELECT COUNT(*)::int as c
     FROM user_investments
     WHERE id_public_user = $1 AND machine_id = $2`,
    [id_public_user, machine_id]
  );

  const deja = countRes.rows[0].c || 0;
  if (deja >= limite) {
    await client.query('ROLLBACK');
    return res.status(400).json({
      success: false,
      message: `Limite atteinte : tu peux acheter cette machine ${limite} fois maximum.`
    });
  }
}


      

    // Retire solde
    await client.query(
      'UPDATE utilisateurs SET balance = balance - $1 WHERE id_public = $2',
      [prix, id_public_user]
    );

    // Crée investissement
    await client.query(
      `
      INSERT INTO user_investments
        (id_public_user, machine_id, prix, gain_jour, duree_jours, total_retour, cycles_payes, last_claim_at)
      VALUES
        ($1,$2,$3,$4,$5,$6,0, CURRENT_TIMESTAMP)
      `,
      [
        id_public_user,
        machine_id,
        mRes.rows[0].prix,
        mRes.rows[0].gain_jour,
        mRes.rows[0].duree_jours,
        mRes.rows[0].total_retour
      ]
    );

    // Historique transactions (optionnel mais utile)
    await client.query(
      `INSERT INTO transactions (id_public_user, transaction_id, montant, statut)
       VALUES ($1, $2, $3, $4)`,
      [id_public_user, `INV-BUY-${Date.now()}`, prix, `Achat machine Invest #${machine_id}`]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: "Machine achetée avec succès" });

  } catch (e) {
    await client.query('ROLLBACK');
    console.error("INVEST acheter error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  } finally {
    client.release();
  }
});


app.get('/invest/mes-investissements/:id_public', async (req, res) => {
  try {
    const { id_public } = req.params;
    const now = new Date();

    const r = await pool.query(
      `
      SELECT ui.*, im.nom
      FROM user_investments ui
      JOIN invest_machines im ON im.id = ui.machine_id
      WHERE ui.id_public_user = $1
      ORDER BY ui.id DESC
      `,
      [id_public]
    );

    const items = r.rows.map(inv => {
      const cyclesRestants = Math.max(0, parseInt(inv.duree_jours) - parseInt(inv.cycles_payes));
      const claimable = Math.min(cyclesRestants, calcClaimableCycles(inv.last_claim_at, now));
      return { ...inv, cycles_restants: cyclesRestants, cycles_reclamables: claimable };
    });

    res.json({ success: true, investments: items });
  } catch (e) {
    console.error("INVEST mes-investissements error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});


app.post('/invest/reclamer', async (req, res) => {
  const { id_public_user, investment_id } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Verrouille l'invest
    const invRes = await client.query(
      `SELECT * FROM user_investments WHERE id = $1 AND id_public_user = $2 FOR UPDATE`,
      [investment_id, id_public_user]
    );
    if (invRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "Investissement introuvable" });
    }

    const inv = invRes.rows[0];
    const now = new Date();

    const cyclesRestants = Math.max(0, parseInt(inv.duree_jours) - parseInt(inv.cycles_payes));
    const claimable = Math.min(cyclesRestants, calcClaimableCycles(inv.last_claim_at, now));

    if (claimable <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "Rien à réclamer pour le moment" });
    }

    const gainJour = parseFloat(inv.gain_jour);
    const gainTotal = gainJour * claimable;

    // Crédite le solde réel
    await client.query(
      'UPDATE utilisateurs SET balance = balance + $1 WHERE id_public = $2',
      [gainTotal, id_public_user]
    );

    // Met à jour cycles + last_claim_at (+ claimable jours)
    const newCycles = parseInt(inv.cycles_payes) + claimable;
    const newLast = new Date(new Date(inv.last_claim_at).getTime() + claimable * MS_24H);

    const statut = (newCycles >= parseInt(inv.duree_jours)) ? 'terminé' : 'en cours';

    await client.query(
      `UPDATE user_investments
       SET cycles_payes = $1, last_claim_at = $2, statut = $3
       WHERE id = $4`,
      [newCycles, newLast, statut, investment_id]
    );

    // Historique
    await client.query(
      `INSERT INTO transactions (id_public_user, transaction_id, montant, statut)
       VALUES ($1, $2, $3, $4)`,
      [id_public_user, `INV-CLAIM-${Date.now()}`, gainTotal, `Gain Invest (${claimable} jours)`]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `+${gainTotal} FCFA crédités (${claimable} cycles)`,
      gain: gainTotal,
      claimable
    });

  } catch (e) {
    await client.query('ROLLBACK');
    console.error("INVEST reclamer error:", e);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  } finally {
    client.release();
  }
});





// --- DÉMARRAGE DU SERVEUR ---
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => console.log("🚀 Serveur Connecté sur port " + PORT));
