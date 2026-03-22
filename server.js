const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).send();
  next();
});

const PAYDUNYA_MASTER_KEY  = "test_public_3vMsUcwXAaBp4hYyiLd62z7QZq1";
const PAYDUNYA_PRIVATE_KEY = "test_private_qpNlrED1SSnIKNVcUYtKylt9V62";
const PAYDUNYA_TOKEN       = "LWfRGZaRkAFrZ9PvQKF1";
const SERVER_URL           = "https://paydunya-shopifyv1-production.up.railway.app";
const SHOPIFY_STORE        = "bc-shop-9080.myshopify.com";
const SHOPIFY_CLIENT_ID    = "5d1ee38278cf3341b0f13bd51044c099";
const SHOPIFY_SECRET       = "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";


const pdHeaders = {
  "Content-Type":         "application/json",
  "PAYDUNYA-MASTER-KEY":  PAYDUNYA_MASTER_KEY,
  "PAYDUNYA-PRIVATE-KEY": PAYDUNYA_PRIVATE_KEY,
  "PAYDUNYA-TOKEN":       PAYDUNYA_TOKEN
};

let shopifyToken = null;
let tokenExpiry  = 0;

async function getShopifyToken() {
  if (shopifyToken && Date.now() < tokenExpiry) return shopifyToken;
  const r = await axios.post(
    "https://" + SHOPIFY_STORE + "/admin/oauth/access_token",
    { client_id: SHOPIFY_CLIENT_ID, client_secret: SHOPIFY_SECRET, grant_type: "client_credentials" }
  );
  shopifyToken = r.data.access_token;
  tokenExpiry  = Date.now() + 23 * 60 * 60 * 1000;
  return shopifyToken;
}

async function creerFacture(amount, order_id) {
  const facture = await axios.post(
    "https://app.paydunya.com/api/v1/checkout-invoice/create",
    {
      invoice: { total_amount: parseInt(amount), description: "Commande Shopify #" + order_id },
      store: { name: "Ma Boutique Shopify" },
      custom_data: { shopify_order_id: order_id },
      actions: {
        cancel_url: "https://" + SHOPIFY_STORE,
        return_url: "https://" + SHOPIFY_STORE,
        callback_url: SERVER_URL + "/paydunya-webhook"
      }
    },
    { headers: pdHeaders }
  );
  console.log("Facture:", JSON.stringify(facture.data));
  return facture.data.token;
}

app.get("/", (req, res) => { res.send("Serveur PayDunya OK !"); });

app.post("/pay/wave", async (req, res) => {
  const { phone, name, email, amount, order_id } = req.body;
  console.log("Wave body:", JSON.stringify(req.body));
  try {
    const invoice_token = await creerFacture(amount, order_id);
    const r = await axios.post(
      "https://app.paydunya.com/api/v1/softpay/wave-senegal",
      {
        wave_senegal_fullName:      name,
        wave_senegal_email:         email,
        wave_senegal_phone:         phone,
        wave_senegal_payment_token: invoice_token,
        wave_senegal_amount:        parseInt(amount)
      },
      { headers: pdHeaders }
    );
    console.log("Wave response:", JSON.stringify(r.data));
    const url = r.data.url || r.data.link || r.data.payment_url;
    if (!url) return res.status(500).json({ success: false, error: "URL non trouvée", data: r.data });
    const encoded = Buffer.from(url).toString("base64");
    res.json({ success: true, lien: SERVER_URL + "/wave/" + encoded });
  } catch (err) {
    console.error("Erreur Wave:", err.response ? JSON.stringify(err.response.data) : err.message);
    res.status(500).json({ success: false, error: "Erreur paiement Wave" });
  }
});

app.post("/pay/orange-money", async (req, res) => {
  const { phone, name, email, amount, order_id } = req.body;
  console.log("OM body:", JSON.stringify(req.body));
  try {
    const invoice_token = await creerFacture(amount, order_id);
    const r = await axios.post(
      "https://app.paydunya.com/api/v1/softpay/orange-money-senegal",
      {
        orange_money_senegal_fullName:      name,
        orange_money_senegal_email:         email,
        orange_money_senegal_phone:         phone,
        orange_money_senegal_payment_token: invoice_token,
        orange_money_senegal_amount:        parseInt(amount)
      },
      { headers: pdHeaders }
    );
    console.log("OM response:", JSON.stringify(r.data));
    const url = r.data.url || r.data.link || r.data.payment_url;
    if (!url) return res.status(500).json({ success: false, error: "URL non trouvée", data: r.data });
    const encoded = Buffer.from(url).toString("base64");
    res.json({ success: true, lien: SERVER_URL + "/orange-money/" + encoded });
  } catch (err) {
    console.error("Erreur OM:", err.response ? JSON.stringify(err.response.data) : err.message);
    res.status(500).json({ success: false, error: "Erreur paiement Orange Money" });
  }
});

app.get("/wave/:encoded", (req, res) => {
  res.redirect(Buffer.from(req.params.encoded, "base64").toString("utf-8"));
});

app.get("/orange-money/:encoded", (req, res) => {
  res.redirect(Buffer.from(req.params.encoded, "base64").toString("utf-8"));
});

app.post("/paydunya-webhook", async (req, res) => {
  const { data } = req.body;
  if (!data || data.status !== "completed") return res.status(200).send("ok");
  const order_id = data.custom_data && data.custom_data.shopify_order_id;
  if (!order_id) return res.status(200).send("ok");
  try {
    const verify = await axios.get(
      "https://app.paydunya.com/api/v1/checkout-invoice/confirm/" + data.token,
      { headers: pdHeaders }
    );
    if (verify.data.status !== "completed") return res.status(200).send("ok");
    const token = await getShopifyToken();
    await axios.post(
      "https://" + SHOPIFY_STORE + "/admin/api/2026-01/orders/" + order_id + "/transactions.json",
      { transaction: { kind: "capture", status: "success", amount: data.invoice.total_amount, gateway: "PayDunya" } },
      { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } }
    );
    console.log("Commande " + order_id + " payée");
    res.status(200).send("ok");
  } catch (err) {
    console.error("Erreur webhook:", err.response ? JSON.stringify(err.response.data) : err.message);
    res.status(500).send("erreur");
  }
});

app.listen(process.env.PORT || 3000, () => { console.log("Serveur démarré"); });
