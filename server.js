const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("Serveur PayDunya OK !");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Serveur démarré");
});
