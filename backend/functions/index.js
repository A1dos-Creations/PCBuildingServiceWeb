const express = require("express");
const cors = require("cors");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const axios = require("axios");
const cheerio = require("cheerio");
const nodemailer = require("nodemailer");

// Initialize Firebase Admin
admin.initializeApp();
const app = express();

// Middleware
app.use(cors({ origin: true }));
app.use(express.json());

// --- Core Logic (from your original functions) ---

async function searchPartsLogic(partType, searchTerm) {
  // 1. Get your API key from the environment variables we just set.
  const apiKey = process.env.scrapingbee_api_key;

  if (!apiKey) {
    throw new Error("ScrapingBee API key is not configured.");
  }
  if (!partType || !searchTerm) {
    throw new Error("partType and searchTerm are required.");
  }

  // 2. This is the original Newegg URL we want to scrape.
  const targetUrl = `https://www.newegg.com/p/pl?d=${encodeURIComponent(partType + ' ' + searchTerm)}`;

  // 3. We build the request to the ScrapingBee API.
  const scrapingBeeUrl = 'https://app.scrapingbee.com/api/v1/';

  // The parameters for the ScrapingBee API call.
  const params = {
    api_key: apiKey,
    url: targetUrl,
    render_js: false // Newegg doesn't require JavaScript to load products, so this is faster and cheaper.
  };

  // 4. We make the request to ScrapingBee, which will then request the page from Newegg for us.
  const response = await axios.get(scrapingBeeUrl, { params: params });

  // The rest of the logic is the same as before.
  const html = response.data;
  const $ = cheerio.load(html);
  const searchResults = [];

  $(".item-cell").each((index, element) => {
    const item = $(element);
    const name = item.find("a.item-title").text().trim();
    const image = item.find("a.item-img img").attr("src");
    const priceWhole = item.find(".price-current strong").text();
    const priceFraction = item.find(".price-current sup").text();
    let price = 0;
    if (priceWhole && priceFraction) {
      price = parseFloat(`${priceWhole}${priceFraction}`);
    }
    if (name && price > 0) {
      searchResults.push({
        id: `${partType}-${name.toLowerCase().replace(/\s+/g, "-").slice(0, 20)}-${index}`,
        name: name,
        price: price,
        image: image,
      });
    }
  });
  return { results: searchResults };
}

async function sendEmailLogic(quoteId, parts, estimatedTotal) {
  if (!quoteId || !parts || !estimatedTotal) {
    throw new Error("Missing required data for sending email.");
  }

  // NOTE: For this to work in App Hosting, you must set secrets.
  // Go to your App Hosting backend -> Settings -> Secret Manager
  // Add EMAIL_USER and EMAIL_PASS
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: emailUser, pass: emailPass },
  });

  const partsHtml = parts.map((p) => `<tr><td style="padding: 8px; border-bottom: 1px solid #ddd;">${p.name}</td><td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">$${p.price.toFixed(2)}</td></tr>`).join("");
  const emailBody = `<h2>New PC Build Quote Request</h2><p><strong>Quote ID:</strong> ${quoteId}</p><table style="width: 100%; border-collapse: collapse;"><thead><tr><th>Component</th><th>Price</th></tr></thead><tbody>${partsHtml}</tbody><tfoot><tr><td><strong>Estimated Total:</strong></td><td style="text-align: right;"><strong>$${estimatedTotal.toFixed(2)}</strong></td></tr></tfoot></table>`;

  const mailOptions = {
    from: `RB Builds <${emailUser}>`,
    to: "rbentertainmentinfo@gmail.com",
    subject: `New PC Build Quote Request - #${quoteId}`,
    html: emailBody,
  };

  await transporter.sendMail(mailOptions);
  return { success: true };
}


// --- API Endpoints ---
app.post("/searchParts", async (req, res) => {
  try {
    const { partType, searchTerm } = req.body;
    const data = await searchPartsLogic(partType, searchTerm);
    res.status(200).json(data);
  } catch (error) {
    logger.error("Error in /searchParts:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/sendQuoteEmail", async (req, res) => {
  try {
    const { quoteId, parts, estimatedTotal } = req.body;
    const data = await sendEmailLogic(quoteId, parts, estimatedTotal);
    res.status(200).json(data);
  } catch (error) {
    logger.error("Error in /sendQuoteEmail:", error);
    res.status(500).json({ error: error.message });
  }
});

// --- Start Server ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  logger.info(`Server is listening on port ${PORT}`);
});