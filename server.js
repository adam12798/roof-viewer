require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GOOGLE_API_KEY;

app.use(express.static("public"));

// Geocode an address → { lat, lng, formatted_address }
app.get("/api/geocode", async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: "Missing address" });

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "OK" || !data.results.length) {
      return res.status(404).json({ error: "Address not found. Try including city and state." });
    }

    const result = data.results[0];
    res.json({
      formatted_address: result.formatted_address,
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
    });
  } catch (err) {
    res.status(500).json({ error: "Geocoding request failed." });
  }
});

// Proxy satellite image so the API key stays server-side
app.get("/api/satellite", async (req, res) => {
  const { lat, lng, zoom } = req.query;
  if (!lat || !lng || !zoom) return res.status(400).json({ error: "Missing params" });

  try {
    const url = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=640x640&scale=2&maptype=satellite&key=${API_KEY}`;
    const response = await fetch(url);

    if (!response.ok) {
      const text = await response.text();
      console.error("Google API error:", response.status, text);
      return res.status(502).json({ error: "Image fetch failed: " + response.status });
    }

    const buffer = await response.buffer();
    res.set("Content-Type", response.headers.get("content-type") || "image/png");
    res.send(buffer);
  } catch (err) {
    console.error("Satellite proxy error:", err);
    res.status(500).json({ error: "Failed to fetch satellite image." });
  }
});

app.listen(PORT, () => {
  console.log(`Roof Viewer running at http://localhost:${PORT}`);
});
