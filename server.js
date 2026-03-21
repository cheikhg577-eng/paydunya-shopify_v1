const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PAYDUNYA_MASTER_KEY  = "zSI0Bxkh-IJEk-d0Ik-ERUf-fJYa52ZoIelK";
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
  console.log("Token Shopify renouvelé");
  return shopifyToken;
  app.post("/pay/wave", async (req, res) => {
  const { phone, name, email, amount, order_id } = req.body;
  try {
    const response = await axios.post(
      "https://app.paydunya.com/api/v1/softpay/wave-senegal",
      {
        wave_senegal_fullName:      name,
        wave_senegal_email:         email,
        wave_senegal_phone:         phone,
        wave_senegal_payment_token: order_id,
        wave_senegal_amount:        amount
      },
      { headers: pdHeaders }
    );
    const encoded = Buffer.from(response.data.url).toString("base64");
    res.json({ success: true, lien: `${SERVER_URL}/wave/${encoded}` });
  } catch (err) {
    console.error("Erreur Wave:", err.response?.data || err.message);
    res.status(500).json({ success: false, error: "Erreur paiement Wave" });
  }
});

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
    const encoded = Buffer.from(response.data.url).toString("base64");
    res.json({ success: true, lien: `${SERVER_URL}/orange-money/${encoded}` });
  } catch (err) {
    console.error("Erreur Orange Money:", err.response?.data || err.message);
    res.status(500).json({ success: false, error: "Erreur paiement Orange Money" });
  }
});

app.get("/wave/:encoded", (req, res) => {
  const url = Buffer.from(req.params.encoded, "base64").toString("utf-8");
  res.redirect(url);
});

app.get("/orange-money/:encoded", (req, res) => {
  const url = Buffer.from(req.params.encoded, "base64").toString("utf-8");
  res.redirect(url);
});

app.post("/paydunya-webhook", async (req, res) => {
  const { data } = req.body;
  if (!data || data.status !== "completed") return res.status(200).send("ok");
  const order_id = data.custom_data?.shopify_order_id;
  if (!order_id) return res.status(200).send("ok");
  try {
    const verify = await axios.get(
      `https://app.paydunya.com/api/v1/checkout-invoice/confirm/${data.token}`,
      { headers: pdHeaders }
    );
    if (verify.data.status !== "completed") return res.status(200).send("ok");
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

app.listen(3000, () => console.log("Serveur démarré sur le port 3000"));
}
