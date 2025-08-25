/**
 * This file contains both the searchParts and sendQuoteEmail functions,
 * updated to use the Firebase Functions v2 SDK.
 */

// V2 SDK imports are more modular.
const { onCall, HttpsError } = require("firebase-functions/v2/https"); // <-- Added HttpsError
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/v2/params");

const admin = require("firebase-admin");
const axios = require("axios");
const cheerio = require("cheerio");
const nodemailer = require("nodemailer");

admin.initializeApp();

// Secret definitions remain the same.
const emailUser = defineSecret("EMAIL_USER");
const emailPass = defineSecret("EMAIL_PASS");


// --- SEARCH PARTS FUNCTION (V2 SYNTAX) ---
exports.searchParts = onCall(async (request) => {
  // In v2, the data is in `request.data`.
  const { partType, searchTerm } = request.data;

  if (!partType || !searchTerm) {
    // Use HttpsError directly (no "functions." prefix)
    throw new HttpsError(
        "invalid-argument",
        "The function must be called with \"partType\" and \"searchTerm\".",
    );
  }

  const query = `${partType} ${searchTerm}`;
  const url = `https://www.newegg.com/p/pl?d=${encodeURIComponent(query)}`;

  try {
    const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/91.0.4472.124 Safari/537.36";
    const response = await axios.get(url, {
      headers: {"User-Agent": userAgent},
    });
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
        const safeName = name.toLowerCase().replace(/\s+/g, "-").slice(0, 20);
        searchResults.push({
          id: `${partType}-${safeName}-${index}`,
          name: name,
          price: price,
          image: image,
        });
      }
    });

    return { results: searchResults };
  } catch (error) {
    logger.error("Error during scraping:", error.message);
    // Use HttpsError directly
    throw new HttpsError("internal", "Failed to fetch parts data.");
  }
});


// --- SEND QUOTE EMAIL FUNCTION (V2 SYNTAX) ---
// Options like 'secrets' are the first argument in v2.
exports.sendQuoteEmail = onCall({ secrets: [emailUser, emailPass] }, async (request) => {
  // Data is in `request.data`.
  const { quoteId, parts, estimatedTotal } = request.data;

  if (!quoteId || !parts || !estimatedTotal) {
    // Use HttpsError directly
    throw new HttpsError(
        "invalid-argument", "Missing required data for sending email.",
    );
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: emailUser.value(),
      pass: emailPass.value(),
    },
  });

  const partsHtml = parts.map((p) => `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #ddd;">${p.name}</td>
      <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">$${p.price.toFixed(2)}</td>
    </tr>
  `).join("");

  const emailBody = `
    <div style="font-family: Arial, sans-serif; color: #333;">
        <h2>New PC Build Quote Request</h2>
        <p><strong>Quote ID:</strong> ${quoteId}</p>
        <table style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr>
                    <th style="padding: 8px; border-bottom: 2px solid #ddd; text-align: left;">Component</th>
                    <th style="padding: 8px; border-bottom: 2px solid #ddd; text-align: right;">Price</th>
                </tr>
            </thead>
            <tbody>${partsHtml}</tbody>
            <tfoot>
                <tr>
                    <td style="padding-top: 10px; font-weight: bold;">Estimated Total:</td>
                    <td style="padding-top: 10px; font-weight: bold; text-align: right;"><strong>$${estimatedTotal.toFixed(2)}</strong></td>
                </tr>
            </tfoot>
        </table>
    </div>
  `;

  const mailOptions = {
    from: `RB Builds <${emailUser.value()}>`,
    to: "rbentertainmentinfo@gmail.com",
    subject: `New PC Build Quote Request - #${quoteId}`,
    html: emailBody,
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Email sent for quote ID: ${quoteId}`);
    return { success: true };
  } catch (error) {
    logger.error(`Error sending email for ${quoteId}:`, error);
    // Use HttpsError directly
    throw new HttpsError("internal", "Failed to send email.");
  }
});