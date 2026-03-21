const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ====== VOS CLÉS PAYDUNYA — À REMPLACER ======
const PAYDUNYA_MASTER_KEY  = process.env.PAYDUNYA_MASTER_KEY;
const PAYDUNYA_PRIVATE_KEY = process.env.PAYDUNYA_PRIVATE_KEY;
const PAYDUNYA_TOKEN       = process.env.PAYDUNYA_TOKEN;
const SERVER_URL           = process.env.SERVER_URL;
const SHOPIFY_STORE        = process.env.SHOPIFY_STORE;
const SHOPIFY_CLIENT_ID    = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_SECRET       = process.env.SHOPIFY_SECRET;

// ====== SHOPIFY 2026 — À REMPLACER ======
const SHOPIFY_STORE        = "bc-shop-9080.myshopify.com";
const SHOPIFY_CLIENT_ID    = 5d1ee38278cf3341b0f13bd51044c099;
const SHOPIFY_SECRET       = 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;

// ====== GESTION DU TOKEN SHOPIFY (renouvelé toutes les 23h) ======
let shopifyToken  = null;
let tokenExpiry   = 0;

async function getShopifyToken() {
  if (shopifyToken && Date.now() < tokenExpiry) return shopifyToken;
  const response = await axios.post(
    `https://${SHOPIFY_STORE}/admin/oauth/access_token`,
    {
      client_id:     SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_SECRET,
      grant_type:    "client_credentials"
    }
  );
  shopifyToken = response.data.access_token;
  tokenExpiry  = Date.now() + 23 * 60 * 60 * 1000;
  console.log("Token Shopify renouvelé avec succès");
  return shopifyToken;
}

// ====== PAYDUNYA HEADERS ======
const pdHeaders = {
  "Content-Type":        "application/json",
  "PAYDUNYA-MASTER-KEY": PAYDUNYA_MASTER_KEY,
  "PAYDUNYA-PRIVATE-KEY":PAYDUNYA_PRIVATE_KEY,
  "PAYDUNYA-TOKEN":      PAYDUNYA_TOKEN
};

// ====== ROUTE 1 : Créer un paiement Wave ======
app.post("/pay/wave", async (req, res) => {
  const { phone, name, email, amount, order_id } = req.body;
  try {
    const response = await axios.post(
      "https://app.paydunya.com/api/v1/softpay/wave-senegal",
      {
        wave_senegal_fullName:       name,
        wave_senegal_email:          email,
        wave_senegal_phone:          phone,
        wave_senegal_payment_token:  order_id,
        wave_senegal_amount:         amount
      },
      { headers: pdHeaders }
    );
    const wave_url = response.data.url;
    const encoded  = Buffer.from(wave_url).toString("base64");
    res.json({ success: true, lien: `${SERVER_URL}/wave/${encoded}` });
  } catch (err) {
    console.error("Erreur Wave:", err.response?.data || err.message);
    res.status(500).json({ success: false, error: "Erreur paiement Wave" });
  }
});

// ====== ROUTE 2 : Créer un paiement Orange Money ======
app.post("/pay/orange-money", async (req, res) => {
  const { phone, name, email, amount, order_id } = req.body;
  try {
    const response = await axios.post(
      "https://app.paydunya.com/api/v1/softpay/orange-money-senegal",
      {
        orange_money_senegal_fullName:      name,
        orange_money_senegal_email:         email,
        orange_money_senegal_phone:         phone,
        orange_money_senegal_payment_token: order_id,
        orange_money_senegal_amount:        amount
      },
      { headers: pdHeaders }
    );
    const om_url  = response.data.url;
    const encoded = Buffer.from(om_url).toString("base64");
    res.json({ success: true, lien: `${SERVER_URL}/orange-money/${encoded}` });
  } catch (err) {
    console.error("Erreur Orange Money:", err.response?.data || err.message);
    res.status(500).json({ success: false, error: "Erreur paiement Orange Money" });
  }
});

// ====== ROUTE 3 : Redirection vers le lien de paiement ======
app.get("/wave/:encoded", (req, res) => {
  const url = Buffer.from(req.params.encoded, "base64").toString("utf-8");
  res.redirect(url);
});

app.get("/orange-money/:encoded", (req, res) => {
  const url = Buffer.from(req.params.encoded, "base64").toString("utf-8");
  res.redirect(url);
});

// ====== ROUTE 4 : Webhook IPN PayDunya ======
app.post("/paydunya-webhook", async (req, res) => {
  const { data } = req.body;
  if (!data || data.status !== "completed") return res.status(200).send("ok");

  const order_id = data.custom_data?.shopify_order_id;
  if (!order_id) return res.status(200).send("ok");

  try {
    // Vérification directe auprès de PayDunya
    const verify = await axios.get(
      `https://app.paydunya.com/api/v1/checkout-invoice/confirm/${data.token}`,
      { headers: pdHeaders }
    );
    if (verify.data.status !== "completed") return res.status(200).send("ok");

    // Marquer la commande comme payée dans Shopify
    const token = await getShopifyToken();
    await axios.post(
      `https://${SHOPIFY_STORE}/admin/api/2026-01/orders/${order_id}/transactions.json`,
      {
        transaction: {
          kind:    "capture",
          status:  "success",
          amount:  data.invoice.total_amount,
          gateway: "PayDunya"
        }
      },
      {
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type":           "application/json"
        }
      }
    );

    console.log(`Commande ${order_id} marquée comme payée`);
    res.status(200).send("ok");
  } catch (err) {
    console.error("Erreur webhook:", err.response?.data || err.message);
    res.status(500).send("erreur");
  }
});

// ====== DÉMARRAGE ======
app.listen(3000, () => console.log("Serveur PayDunya-Shopify démarré sur le port 3000"));
